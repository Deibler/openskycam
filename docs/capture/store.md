---
title: Footage store
description: A small HTTP server on a host with a large disk that keeps every recording, serves byte ranges and thumbnails to the Workers, and prunes old footage.
---

All footage lives on one disk that you own, served by the footage store. The store is a Python program using only the standard library, in [`external/store/`](https://github.com/Deibler/openskycam/blob/main/external/store/). Pillow is needed only for thumbnails. It runs on macOS or Linux and listens only on `127.0.0.1:8096`. Both Workers reach it through a Cloudflare Tunnel exposed as a [Workers VPC service](https://developers.cloudflare.com/workers-vpc/), so it has no public hostname.

Files keep the object keys the Workers use:

```
<footage-root>/raw/cam=sky01/date=2026-09-22/hour=14/sky01_20260922T140500Z.mp4
```

## Run it

```sh
python3 -m skyvision_store --root <footage-root> --token-file ~/.config/skyvision-store/store.token
```

| Option | Default | Meaning |
|---|---|---|
| `--root` | (required) | The footage volume. It must be a **mount point** unless `--system-disk` is set; see below. |
| `--system-disk` | off | Skip the mount check for a folder on the system disk. |
| `--token-file` | (required) | The bearer token, at least 32 characters |
| `--host`, `--port` | `127.0.0.1`, `8096` | Where to listen. The tunnel connects to this address. |
| `--retention-days` | `41` | Date folders older than this are deleted |
| `--min-free-gb` | `100` | Writes are refused, and the oldest hours pruned, below this much free space (decimal GB) |
| `--prune-every-s` | `600` | How often the janitor runs |

`--root` must be the mount point of the footage disk, because the store checks `os.path.ismount`. If the disk is missing, writes go nowhere instead of filling the boot volume through an empty mount-point folder. A plain directory on the system disk counts as "not mounted": every upload is refused with `503` and nothing is pruned. Point `--root` at the volume itself, for example `/Volumes/Footage` or `/mnt/footage`. To keep footage in a folder on the system disk on purpose, pass `--system-disk` (`external/store/deploy.sh <store-host> <footage-root> --system-disk`); then only `--min-free-gb` stops writes before the disk fills.

## Protocol

Every request needs `Authorization: Bearer <store token>`, compared in constant time; otherwise `401`. Each part of a key may contain only letters, digits and `= _ . -`, and no part may start with a dot. Other keys get `404`, so a key cannot escape the root or name a hidden file. Errors are JSON, `{"error": "…"}`.

| Request | Responses |
|---|---|
| `PUT /o/<key>` with `X-Sha256` and a sized or chunked body | `201 {"size": n}` stored · `200 {"size": n}` the same bytes were already stored · `400` bad `X-Sha256` · `409` different bytes are already stored · `411` no length · `422` the body does not match `X-Sha256` or ended early · `503` disk not mounted or a write failed · `507` free space under `--min-free-gb` |
| `GET /o/<key>`, optionally with one `Range` | `200` whole file · `206` with `Content-Range` · `416` with `Content-Range: bytes */<size>` · `404` no recording at this key |
| `HEAD /o/<key>` | `Content-Length` and `ETag` only |
| `POST /thumbnail?size=<px>[&left=&top=&width=&height=]` with a JPEG body | `200` a JPEG · `400` bad size or crop · `411` no length · `413` over 32 MiB · `422` not a readable image · `503` Pillow is not installed |

### Writes

A file appears at its key only once it is complete, on disk, and matches its checksum. An existing file is never replaced:

1. The body streams into a temporary file in `<footage-root>/.incoming/`, hashed as it arrives, then is flushed with `fsync`.
2. If the SHA-256 differs from `X-Sha256`, the temporary file is deleted and the answer is `422`.
3. Otherwise the file is hard-linked to its key. A hard link fails rather than replace a file, so two concurrent uploads of the same key cannot overwrite each other; the loser is compared with the winner. Then the folder is synced.
4. If a file already exists at the key, the body is still read to the end, so the connection stays usable. The answer is `200` if the bytes match and `409` if not.

### Reads

`GET` serves one byte range: `bytes=a-b`, `bytes=a-`, or the last n bytes with `bytes=-n`. A malformed header, or one asking for several ranges, is ignored, and the whole file is sent. MP4 files are served as `video/mp4`, anything else as `application/octet-stream`. The `ETag` is the size and modification time in hex, `"<size>-<mtime_ns>"`. The website's player and the API's resumable downloads both rely on ranges.

### Thumbnails

The website asks for small JPEGs of Workshop images, and agents for previews, so no paid image service is needed.

- **With a crop** (all four of `left`, `top`, `width`, `height`, in pixels), that region is enlarged or shrunk to fit `size`×`size`.
- **Without one**, the whole image is shrunk to fit and never enlarged.
- `size` is 1 to 2048.
- The output is JPEG quality 75. A 4K frame is decoded at reduced size (JPEG DCT scaling), so a thumbnail is fast.
- Pillow is imported on the first thumbnail request, so recording never depends on it. Install your distribution's `python3-pil` package, or `brew install pillow` with Homebrew on macOS.

## Retention

A janitor thread runs every `--prune-every-s` seconds while the disk is mounted:

1. **Old days.** It deletes every `raw/cam=*/date=*` folder dated before today minus `--retention-days`.
2. **Low space.** While free space is under `--min-free-gb`, it deletes the oldest hour folder (across all cameras), one at a time. This can remove footage younger than the retention period, and each removal is logged.
3. **Leftovers.** It deletes parts in `.incoming/` older than a day. They come from uploads cut off by a crash or restart.

The store keeps 41 days and the Workers' catalog 40, so the website forgets a recording before its file is deleted. A test in `external/store/tests/` holds that order. If you change `--retention-days`, keep it above the Workers' `RETENTION_DAYS` (40, in `package/shared/src/utils/layoutStorageUtil.ts`).

### Sizing the disk

Disk use is set by the camera's bitrate. 4 Mbit/s is about 43 GB a day, so 40 days need about 1.7 TB, plus the 100 GB the store keeps free. See [Camera settings](relay.md) for measured bitrates.

## Install

```sh
external/store/deploy.sh <store-host> <footage-root>     # for example: me@store-host /mnt/footage
```

Before the first deploy, create a Cloudflare Tunnel (Zero Trust → Networks → Tunnels). Write its token on the store host to `~/.config/skyvision-store/tunnel.token` with mode 600. The host needs `python3`, `cloudflared` and `openssl`.

`deploy.sh`:

- copies the package to `~/skyvision-store/` on the host;
- creates `~/.config/skyvision-store/store.token` (32 random bytes in hex, mode 600) if it does not exist;
- finds `python3` and `cloudflared`, checking `/opt/homebrew/bin` and `/usr/local/bin` first;
- warns if that `python3` has no Pillow;
- installs two always-restarting services, then shows their status and last log lines.

| Host | Services | Logs |
|---|---|---|
| macOS | launchd agents `org.openskycam.store` and `org.openskycam.store-tunnel` (`KeepAlive`, restarted at most every 10 s) | `~/Library/Logs/org.openskycam.store.log` and `…store-tunnel.log` |
| Linux | systemd user services `skyvision-store` and `skyvision-store-tunnel` (`Restart=always`, 10 s apart). Run `loginctl enable-linger $USER` once. | `journalctl --user-unit=skyvision-store` |

The tunnel runs `cloudflared tunnel --no-autoupdate run --token-file ~/.config/skyvision-store/tunnel.token`. Point a Workers VPC service at it, at `127.0.0.1` port `8096`; its ID is `STORE_SERVICE_ID` (see [Deploy your own](../deploy.md)). `deploy.sh` uses the default retention and free-space settings.

Both Workers send the store token as their `STORE_TOKEN` secret. Pipe it from the store host, from each Worker's folder:

```sh
npm run config
ssh <store-host> cat .config/skyvision-store/store.token | npx wrangler secret put STORE_TOKEN --config wrangler.deploy.json
```

To rotate the token, replace `store.token`, rerun `deploy.sh` to restart the store, and set `STORE_TOKEN` again on both Workers. Uploads in between get `401` from the store, which the ingest Worker turns into `503`, so the relay keeps them.

The store logs to stderr:

- `serving …` at start;
- `stored <file> (<bytes> bytes)` for each new file, with `, already` added for a repeat;
- `pruned <folder>` for each deletion;
- write failures, and any request answered with `5xx`. Other requests are not logged.

## When something fails

| Failure | What you see | What happens to footage |
|---|---|---|
| Footage disk not mounted | `PUT` answers `503`; the janitor does nothing | The ingest Worker answers `503`, and the relay keeps segments in its spool until the disk is back |
| Free space under `--min-free-gb` | `PUT` answers `507` until the janitor's next pass deletes the oldest hours | The relay retries; the oldest footage is deleted first |
| Store process or tunnel down | The Workers' `STORE` requests fail | Uploads are spooled on the relay. The website cannot play footage, and the ingest status shows the age of the last stored segment. |
| Crash during an upload | Nothing at the key; a part in `.incoming/` | The relay retries the whole file; the part is deleted after a day |
| Pillow missing | Thumbnails answer `503` | The website shows the full image instead; footage is unaffected |

## Test

```sh
make store-check     # python3 -m unittest discover -s tests, in external/store
```

The tests run the real server on a temporary directory. They cover:

- checksums, conflicts and chunked bodies;
- refusing writes while the disk is unmounted or nearly full;
- keys that try to leave the footage tree;
- whole-file and range reads;
- thumbnails, including never enlarging a whole frame;
- retention, and files outliving the Workers' retention.
