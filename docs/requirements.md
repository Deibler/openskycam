---
title: Requirements
description: The camera, hosts, disk, and Cloudflare account openskycam needs, and how to size them.
---

openskycam needs a camera, three roles on machines you own (relay, footage store, processor), and a Cloudflare account. One machine can hold the store and the processor; the relay is usually a small board next to the camera.

| Component | Runs on | Needs |
|---|---|---|
| Relay | Linux with systemd | bash 5, `ffmpeg` and `ffprobe`, `curl`, GNU coreutils, SSH access, user lingering |
| Footage store | macOS (launchd) or Linux (systemd) | Python 3.10 or later, `cloudflared`, `openssl`, a large disk; Pillow for thumbnails |
| Processor | macOS (launchd) or Linux (systemd) | Python 3.11 or later; an Apple Silicon GPU, an NVIDIA GPU, or the CPU |
| Ingest Worker, website and API | Cloudflare Workers | A Cloudflare account and a domain on Cloudflare |
| Development | macOS or Linux | Node.js 24, Python 3, `shellcheck` |

## Camera

Any IP camera works if it serves an **H.264 or H.265** RTSP stream.

- **Codec.** H.264 or H.265. `record.sh` copies the stream without re-encoding. It asks `ffprobe` for the codec first and tags H.265 as `hvc1`, so that Safari and QuickTime play it; H.264 keeps its usual `avc1` tag.
- **Stream path.** The relay builds `rtsp://<user>:<password>@<address>:<port><path>`. The default path, `/cam/realmonitor?channel=1&subtype=0`, is the Dahua main stream. Set `CAMERA_RTSP_PATH` for other brands, for example `/Streaming/Channels/101` (Hikvision) or `/stream1` (TP-Link Tapo).
- **Credentials.** Write the username and password in `.env` as they are. The relay percent-encodes them when it builds the URL ([Relay](capture/relay.md)).
- **Bitrate.** The ingest Worker accepts segments of at most 95 MiB, because Workers on the Free and Pro plans reject request bodies over 100 MB. A 60-second segment stays under that up to about 13 Mbps.
- **Camera settings.** `camera_mcp.py`, which reads and changes camera settings from Claude Code, speaks the Dahua HTTP API only. Recording does not need it.

The reference camera is a Dahua 4K camera at 3840×2160, H.265, 4.16 Mbps constant bitrate.

## Disk for footage

The store keeps 41 days by default and always leaves 100 GB free (`--retention-days`, `--min-free-gb`). When the disk is too small for both, the janitor deletes the oldest hours first, so retention shrinks instead of recording stopping.

One camera's footage per day, in GB, is its bitrate in Mbps × 10.8:

| Camera bitrate | Per day | 41 days |
|---|---|---|
| 2 Mbps | 21.6 GB | 886 GB |
| 4 Mbps | 43.2 GB | 1,771 GB |
| 8 Mbps | 86.4 GB | 3,542 GB |

Add the 100 GB of free space. The reference camera writes about 43 GB a day, so it fills about 1.7 TB of a 2 TB drive.

Measured on the reference camera: switching from constant bitrate (4.16 Mbps) to variable bitrate with the same 4096 kbps cap saved 12% (3.65 Mbps). A 2048 kbps cap at 15 fps measured 1.84 Mbps and looked the same on one minute of overcast sky; confirm with a full day and night before relying on it.

## Relay host

A Raspberry Pi 4 or 5 is plenty. On a Pi 5, recording a 4 Mbps stream used under 1 second of CPU per minute.

- **RAM.** Segments are written to `/dev/shm`. The relay keeps the segment being recorded plus at most 3 finished ones there, about 30 MB each at 4 Mbps.
- **Disk.** It holds the backlog while the Worker is unreachable, in `~/skyvision/spool/pending/`. The relay never lets free space drop below `MIN_FREE_GB` (20 GB by default): it deletes quarantined files first, then the oldest backlog.
- **Network.** It needs a steady link to the camera and an upload rate above the camera's bitrate. The relay sends three uploads at once. Measured on the reference relay, one upload through the ingest Worker often ran at about 4 Mbit/s, and three at once reached 24 to 28 Mbit/s together.
- **Lingering.** Both relay services are systemd user services. Run `loginctl enable-linger $USER` once so they run without a login session. No root access is needed.

## Footage store host

The store only receives, serves and prunes files, so a small machine works. What matters is a large disk that stays mounted. **The footage root should be a mount point** (Python's `os.path.ismount`), such as `/mnt/footage` or `/Volumes/Footage`. When it is not mounted, the store answers `503` to every upload and the janitor deletes nothing, so the relay keeps its backlog rather than footage landing on the wrong disk. To use a folder on the system disk instead, install the store with `--system-disk`; uploads then stop only when free space falls below `--min-free-gb`. The host also runs `cloudflared` for the tunnel, which needs outbound internet access only. Inbound ports stay closed.

Pillow in the host's `python3` makes thumbnails for Workshop images and agent previews. Without it, footage still works, and thumbnail requests answer `503`.

## Processor host

The processor decodes 4K HEVC and runs YOLO models. With `device: auto` it uses CUDA if present, then Apple's Metal (MPS), then the CPU. The PyPI `torch` wheel for Linux includes CUDA. The CPU works, but slowly.

Measured on a 16 GB Mac mini:

| What | Measurement |
|---|---|
| 4K frames sampled from one recording, held in memory | about 1.5 GB |
| GPU memory, a YOLO26s model at 1280 px | 1.09 GB |
| GPU memory, the same model at 1920 px, batches of 8 | 2.09 GB; batches of 2 run as fast and use about 1 GB less |
| Inference at 1920 px | 55 ms per frame |
| Runner peak with the 1920 model, one recording in memory | about 4.3 GB |
| Time per one-minute recording, night workflow | about 15 s, so one processor keeps up with one camera |

Three recordings in memory at once with the 1920 model swapped this machine while another 9 GB process ran. The runner now holds one recording's frames at a time.

Only outbound HTTPS is needed. The processor polls the API for work and never listens on a port.

## Cloudflare account

One camera stays inside or near the free tiers. You need:

- **Workers**: the ingest Worker (on `workers.dev`) and the website and API Worker (on your custom domains). The website Worker also runs a cron trigger every minute, for Workshop schedules, and a Durable Object, for live run progress.
- **D1**: one database, `skyvision-catalog`, shared by both Workers.
- **R2**: two buckets, `skyvision-models` (model files) and `skyvision-workshop` (Workshop images). Footage never goes to R2.
- **Cloudflare Tunnel** and a **Workers VPC service**, which let the Workers reach the footage store without a public address. Both are free.
- **Zero Trust Access**, which protects the website. It is free for up to 50 users.
- **A domain on Cloudflare** with two hostnames, one for the website (`SITE_HOST`) and one for the API (`API_HOST`).

Keeping footage in R2 instead of on your disk would cost about $20 a month at 4.16 Mbps (R2 Standard storage, checked 2026-09-22). Cloudflare Stream would cost about $216.

## Development machine

- Node.js 24 (`.node-version`).
- Python 3 for the processor, store and camera MCP checks.
- `shellcheck` for the shell scripts.
- For the processor's image tests: `numpy` and `opencv-python-headless`.
- For the store's thumbnail tests: Pillow.

`make check` runs everything CI runs, and it needs no Cloudflare account. See [Local development and tests](develop/local.md).
