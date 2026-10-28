---
title: Camera and relay
sidebar: Camera and relay
description: The relay pulls the camera's RTSP stream, cuts it into 60-second MP4 files without re-encoding, and uploads each one to the ingest Worker.
---

The relay is a Linux host, such as a Raspberry Pi, that sits between the camera and Cloudflare. It runs two systemd user services:

| Service | Script | Job |
|---|---|---|
| `skyvision-record` | `~/skyvision/record.sh` | Pulls the camera's main stream with `ffmpeg` and writes one MP4 per minute to RAM |
| `skyvision-upload` | `~/skyvision/upload.sh` | Uploads finished segments to the [ingest Worker](ingest.md), oldest first, and keeps a disk spool while it cannot |

A relay is needed because most IP cameras cannot push video to an HTTP endpoint. Workers accept only HTTP and WebSocket, and pulling RTSP gives standard MP4 with no change to the camera. The sources are in [`external/relay/`](https://github.com/Deibler/openskycam/blob/main/external/relay/).

## Requirements

- Linux with systemd, `bash` 5, `ffmpeg` and `ffprobe`, `curl`, and GNU coreutils. `upload.sh` uses `stat -c`, `df --output` and `sha256sum`, so it does not run on macOS.
- An SSH login for a normal user. The services run as that user and need no root. Run `loginctl enable-linger $USER` once so they keep running without a login session.
- A camera that serves RTSP, H.264 or H.265. Only video is kept: `-map 0:v:0` drops audio.

## Install

From the repository root, with the camera and Worker settings in `.env`:

```sh
make deploy HOST=<relay-host>
```

`external/relay/deploy.sh` copies `record.sh` and `upload.sh` to `~/skyvision/` and the two unit files to `~/.config/systemd/user/`. It writes `~/.config/skyvision/relay.env` with mode 600, then enables and restarts both services. It reads these values from the repository's `.env`:

| `.env` value | Default | Used for |
|---|---|---|
| `CAMERA_IP_ADDRESS` | | Camera host in the RTSP URL |
| `CAMERA_USERNAME`, `CAMERA_PASSWORD` | | Camera login in the RTSP URL. Write them as they are; `deploy.sh` percent-encodes them. |
| `CAMERA_RTSP_PORT` | `554` | RTSP port |
| `CAMERA_RTSP_PATH` | `/cam/realmonitor?channel=1&subtype=0` | Stream path. The default is a Dahua main stream; Hikvision uses `/Streaming/Channels/101`, TP-Link Tapo `/stream1`. Quote it in `.env` because it contains `&`. |
| `CAM_ID` | `sky01` | Camera ID in file names and object keys. It must be in the Workers' `CAMERAS` list. |
| `INGEST_URL` | | The ingest Worker, for example `https://skyvision-ingest.<subdomain>.workers.dev` |
| `MIN_FREE_GB` | `20` | Free space the spool never goes below |

The relay also gets `LIVE_DIR=/dev/shm/skyvision` and `SPOOL_DIR=~/skyvision/spool`.

The Worker token is not in `relay.env`. Write it once into its own file, which later deploys never overwrite:

```sh
ssh <relay-host> 'umask 077; echo "INGEST_TOKEN=<token>" > ~/.config/skyvision/ingest.env && systemctl --user restart skyvision-upload'
```

Redeploy after changing any value in `.env`. `relay.env` is rewritten each time.

## Recording

`record.sh` asks `ffprobe` for the stream's codec, then runs one `ffmpeg` process (`$tag` is `-tag:v hvc1` for H.265 and empty for H.264):

```sh
ffmpeg -nostdin -hide_banner -loglevel warning \
  -rtsp_transport tcp -timeout 15000000 -fflags +genpts \
  -i "$CAMERA_RTSP_URL" \
  -map 0:v:0 -c copy $tag \
  -f segment -segment_time 60 -segment_atclocktime 1 -reset_timestamps 1 -strftime 1 \
  -segment_format mp4 -segment_format_options movflags=+frag_keyframe+empty_moov+default_base_moof \
  "${CAM_ID}_%Y%m%dT%H%M%SZ.mp4"
```

| Option | Why |
|---|---|
| `-rtsp_transport tcp` | RTSP over UDP drops packets across the internet |
| `-timeout 15000000` | Give up on a silent camera after 15 seconds (the value is in microseconds), so systemd restarts the recorder |
| `-c copy` | No re-encoding: the stored bytes are what the camera encoded, so image quality is set on the camera only |
| `-tag:v hvc1` (H.265 only) | Safari and QuickTime refuse HEVC tagged `hev1`. Only the sample-entry label changes; decoded frames are identical. ffmpeg refuses the tag on H.264, which keeps `avc1`. |
| `-segment_time 60 -segment_atclocktime 1` | One file per minute, cut on the minute. The cut lands on the first keyframe after it, so files run about 59.4 to 60.4 seconds and no frames are lost between them. |
| `movflags=+frag_keyframe+empty_moov` | Fragmented MP4, one fragment per keyframe. If `ffmpeg` dies mid-file, the file is readable up to its last fragment. A plain MP4 writes its index at the end, so a crash lost the whole minute. |
| `-strftime 1` with `TZ=UTC` | File names are the segment's start in UTC, for example `sky01_20260922T140500Z.mp4`. UTC has no daylight-saving gaps or repeats. |

Segments are written to `/dev/shm/skyvision`, which is RAM, sparing the SD card 20 to 45 GB of writes a day while uploads keep up.

The unit restarts `ffmpeg` whenever it exits (`Restart=always`). The delay grows from 2 seconds to at most 10 (`RestartSec=2`, `RestartSteps=5`, `RestartMaxDelaySec=10`), so a long camera outage does not cause a tight loop. `StartLimitIntervalSec=0` means systemd never stops retrying. A crash costs about 5 seconds of footage: the cut-off file keeps what was written, and the restart takes about 4 seconds.

## Uploading

`upload.sh` loops forever. Every file in `/dev/shm/skyvision` except the newest is finished, because `ffmpeg` writes one segment at a time.

1. **Keep RAM small.** At most 3 finished segments stay in RAM. Older ones move to `~/skyvision/spool/pending/` on disk. A full RAM disk stops the recorder with "No space left on device" and loses footage.
2. **Upload a batch.** The next 3 files are uploaded in parallel: finished segments in RAM first, then the backlog in `pending/`, oldest first. One upload through the Worker often ran at about 4 Mbit/s, the camera's own rate, while three at once reached 24 to 28 Mbit/s together.
3. **Act on each response**, as shown in the table below.
4. **Guard the disk.** While the spool's file system has less than `MIN_FREE_GB` GiB free, the oldest file in `pending/` is deleted. Other services on the host need the disk; a log line names each dropped file.
5. **Sleep.** After a batch with no "unavailable" result, the loop runs again at once. Otherwise, or when there is nothing to upload, it waits 10 seconds.

For each file, the uploader:

- runs `ffprobe` to read the codec, width, height, duration, bitrate and packet count;
- moves the file to `quarantine/` if `ffprobe` cannot read a duration or packet count;
- computes the file's SHA-256;
- sends it with `curl`:

```
PUT $INGEST_URL/v1/segments/<CAM_ID>/<start>
Authorization: Bearer <INGEST_TOKEN>
Content-Type: video/mp4
X-Sha256: <sha256>
X-Duration, X-Frames, X-Codec, X-Width, X-Height, X-Bitrate: <from ffprobe>
```

The token reaches `curl` on stdin as a config line (`-K -`), so it never appears in `ps`. Connections time out after 10 seconds, and a whole upload after 600 seconds.

| Worker response | Meaning | What the relay does |
|---|---|---|
| `200`, `201` | Stored (`200`: these exact bytes were already stored) | Deletes the local file |
| `000`, `401`, `403`, `404`, `408`, `429`, `5xx` | Worker unreachable, not deployed, wrong token, rate-limited, or storage unavailable | Keeps the file. If any upload in the batch got one of these, it moves every finished RAM segment to `pending/` and waits 10 seconds. |
| Anything else (`400`, `409`, `411`, `413`, `415`, `422`, …) | A problem with this file | Moves it to `quarantine/` and continues |

`401` and `403` count as "unavailable" so that a wrong or missing token never discards footage. The backlog grows until you fix the token. A `workers.dev` URL with no Worker behind it answers `404`, so nothing is quarantined before the Worker exists.

The upload service runs at `Nice=10` and restarts 10 seconds after any exit.

### Where a segment can be

| Location | Meaning |
|---|---|
| `/dev/shm/skyvision/` | Being recorded, or one of the next 3 finished segments to upload |
| `~/skyvision/spool/pending/` | Waiting: the Worker was unavailable or uploads fell behind. Retried oldest first. |
| `~/skyvision/spool/quarantine/` | Unreadable, or rejected by the Worker. Kept for inspection, never retried or cleaned up. |

A day of outage at 4 Mbit/s is about 43 GB of spool (4 Mbit/s × 86,400 s). The free disk divided by that is how long the relay can hold a backlog; past `MIN_FREE_GB`, the oldest footage goes first.

## Operate

```sh
make status HOST=<relay-host>      # the Worker's /v1/status, the last 5 upload log lines, and spool counts
ssh <relay-host> systemctl --user status skyvision-record skyvision-upload
ssh <relay-host> journalctl --user-unit=skyvision-upload -f
ssh <relay-host> systemctl --user disable --now skyvision-record skyvision-upload
```

Use `journalctl --user-unit=…`. `journalctl --user -u …` shows nothing for these services.

`make status` reads `INGEST_URL` and `INGEST_TOKEN` from the repository's `.env`. Its first line is the [status endpoint](ingest.md) answer: how old each camera's newest stored segment is.

To check the uploader on the relay itself:

```sh
make test HOST=<relay-host>
```

This copies `upload.sh` and `test_upload.sh` to a temporary directory on the relay. It runs them against generated clips, an unreachable Worker and a deliberately slow one. It checks four things:

- an unreadable file is quarantined;
- the file being written is never touched;
- the disk guard drops the oldest backlog first;
- RAM holds at most 3 finished segments while 3 uploads run at once.

## Camera settings

Quality is fixed by the camera's encoder, since nothing downstream re-encodes. These measurements come from 60-second captures on the reference Dahua camera at 3840×2160, H.265:

| Encoder setting | Measured bitrate | 40 days of footage |
|---|---|---|
| Constant bitrate (CBR) 4096 kbps, 30 fps | 4.16 Mbit/s | 1,797 GB |
| Variable bitrate (VBR), 4096 kbps cap, 30 fps | 3.65 Mbit/s | 1,577 GB |
| VBR, 4096 kbps cap, 15 fps | 3.70 Mbit/s | 1,598 GB |
| VBR, 2048 kbps cap, 15 fps | 1.84 Mbit/s | 795 GB |

- **Use VBR.** It saved 12% at the same cap. With VBR the camera fills whatever cap it is given, so lowering the frame rate alone saves nothing; each frame gets more bits instead.
- **Set the keyframe interval (GOP) to the frame rate**, one keyframe per second, so the minute cuts stay within about half a second of the minute.
- **Turn off the burned-in timestamp** (`VideoWidget[0].TimeTitle.EncodeBlend=false` on Dahua). The time is already in the file name and catalog. The overlay changes every second in the same pixels, and [detection](../workshop/tracking.md) has to mask it out.
- 2048 kbps at 15 fps looked the same as 4096 kbps at 30 fps on one minute of overcast sky. Confirm with a full day, including night and clear sky, before halving storage.

### Camera MCP (Dahua)

`camera_mcp.py` in the repository root is a stdio [MCP](https://modelcontextprotocol.io) server for Dahua cameras. It lets Claude Code read and change camera settings:

```sh
claude mcp add skyvision-camera -- python3 /path/to/openskycam/camera_mcp.py
```

| Tool | Does |
|---|---|
| `snapshot` | Takes one JPEG from a channel (0 to 8) |
| `get_config` | Reads one config section (`Encode`, `VideoWidget`, `VideoColor`, …), optionally filtered to lines containing some text |
| `set_config` | Applies `Key=value` updates, for example `Encode[0].MainFormat[0].Video.BitRate=2048` |

It reads `CAMERA_IP_ADDRESS`, `CAMERA_SCHEME`, `CAMERA_PORT`, `CAMERA_USERNAME` and `CAMERA_PASSWORD` from the `.env` beside it, and logs in with HTTP digest authentication.

- **What it refuses:** keys and sections about passwords, login, users or accounts.
- **Redaction:** the password is removed from every reply.
- **Certificates:** it does not verify the camera's certificate, since cameras use self-signed ones.

`python3 camera_mcp.py --check` runs its self-test, part of `make check`.

## Security notes

- The RTSP URL contains the camera password and is visible in `ps` to other users on the relay, because `ffmpeg` cannot read it from a file. Use a relay host without untrusted users.
- RTSP is not encrypted. If the camera is reached over the internet, restrict its port forward to the relay's address.
- The Worker token is only in `~/.config/skyvision/ingest.env` (mode 600) and on `curl`'s stdin.
