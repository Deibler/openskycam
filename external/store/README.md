# Footage store

All recorded footage lives on one host's disk, served by this small HTTP server: any macOS or Linux
machine with Python 3, `cloudflared` and a large drive. Cloudflare Workers reach it through a Cloudflare Tunnel as a
[Workers VPC service](https://developers.cloudflare.com/workers-vpc/): the `STORE` binding in both
Workers. It has no public hostname and listens only on `127.0.0.1:8096`.

Files keep the keys the Workers used in R2, under the footage root you choose:

```
<footage-root>/raw/cam=sky01/date=2026-09-22/hour=14/sky01_20260922T140500Z.mp4
```

## Protocol

Every request needs `Authorization: Bearer <store token>`.

| Request | Responses |
|---|---|
| `PUT /o/<key>` with `X-Sha256` and a sized or chunked body | `201 {size}` stored · `200 {size}` identical bytes already stored · `409` different bytes already stored · `422` body does not match `X-Sha256` · `503` disk not mounted or failing · `507` less than `--min-free-gb` free |
| `GET /o/<key>`, optionally one `Range` | `200` · `206` with `Content-Range` · `416` with `Content-Range: bytes */<size>` · `404` |
| `HEAD /o/<key>` | Size (`Content-Length`) and `ETag` |
| `POST /thumbnail?size=<px>[&left=&top=&width=&height=]` with a sized JPEG body | `200` a JPEG: the crop (pixels) fit to `size`×`size`, or the whole image only shrunk · `400` bad size or crop · `413` over 32 MB · `422` not an image · `503` Pillow missing |

Thumbnails are for Workshop images and agent previews, so the website needs no paid image service.
They use Pillow in the host's `python3` (`python3 -m pip install --user pillow`, or your distribution's
`python3-pil` package), imported on first use, so footage never depends on it. On macOS the deploy prefers
Homebrew's `python3`.

A file appears at its key only once it is complete, synced to disk and matches its SHA-256, and an
existing file is never replaced.

## Retention

A janitor thread, every 10 minutes:

- deletes date folders older than `--retention-days` (41 by default; keep it above the Workers'
  retention, so the dashboard forgets a recording before its file goes);
- then deletes the oldest hours while free space is under `--min-free-gb` (100);
- removes abandoned upload parts older than a day.

Size the drive for your camera's bitrate: at about 4 Mbps (43 GB per day), 40 days of footage fill
about 1.7 TB.

## Deploy

```sh
external/store/deploy.sh <ssh-host> <footage-root>     # for example: me@store-host /mnt/footage
```

The host needs `python3`, `cloudflared` and `openssl`. Both services are restarted if they exit:

| Host | Installs | Logs |
|---|---|---|
| macOS | launchd agents `org.openskycam.store` (this server) and `org.openskycam.store-tunnel` (`cloudflared`) | `~/Library/Logs/<label>.log` |
| Linux | systemd user services `skyvision-store` and `skyvision-store-tunnel`; run `loginctl enable-linger $USER` once so they run without a login | `journalctl --user-unit=skyvision-store` |

Secrets stay on the store host in `~/.config/skyvision-store/`. `store.token` is created on the first
deploy. Before it, create a tunnel in Cloudflare Zero Trust and write its token to `tunnel.token`
(mode 600). Both Workers need the store token as the `STORE_TOKEN` secret. Deploy each Worker once, then pipe
the token straight from the store host so it is never displayed. Run this in `package/worker/` and again in
`package/dashboard/`:

```sh
npm run config
ssh <ssh-host> cat .config/skyvision-store/store.token | npx wrangler secret put STORE_TOKEN --config wrangler.deploy.json
```

The store refuses writes (`503`) while `<footage-root>` is not a mount point, so a drive that failed to
mount never fills the system disk. To keep footage in a folder on the system disk itself, deploy with
`--system-disk`: `external/store/deploy.sh <ssh-host> <footage-root> --system-disk`. Writes still stop
when free space falls below `--min-free-gb` (100 GB by default).

## Tests

`make store-check` (`python3 -m unittest discover -s tests` here). Worker tests use
[`package/shared/test/fakeFootageStore.js`](../../package/shared/test/fakeFootageStore.js), which
answers the same protocol.
