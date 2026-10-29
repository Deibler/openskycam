---
title: Ingest Worker
description: The Cloudflare Worker that accepts one-minute segments from the relay, writes them to the footage store, and records them in the D1 catalog.
---

The ingest Worker (`skyvision-ingest`, in [`package/worker/`](https://github.com/Deibler/openskycam/blob/main/package/worker/)) is the only way footage enters openskycam. It has two endpoints: one stores a segment and one reports whether footage is arriving. There is no delete endpoint. Footage leaves only through the [footage store's retention](store.md), so a leaked token cannot erase anything.

It is served at `https://skyvision-ingest.<subdomain>.workers.dev`, which is the relay's `INGEST_URL`.

## Authentication

Every request, including one to an unknown path, needs:

```
Authorization: Bearer <INGEST_TOKEN>
```

The Worker hashes the given token and the `INGEST_TOKEN` secret with SHA-256 and compares the hashes in constant time. A missing or wrong token gets `401 {"error": "unauthorized"}`. After that, an unknown path gets `404`, and a known path with the wrong method gets `405`.

## `PUT /v1/segments/:cam/:start`

Stores one segment. `:cam` is the camera ID and `:start` is the segment's UTC start in the relay's file-name format, `20260922T140500Z`.

| Header | Required | Rule |
|---|---|---|
| `Content-Length` | yes | A positive integer, at most 95 MiB (99,614,720 bytes). Workers reject bodies over 100 MB. |
| `Content-Type` | yes | Exactly `video/mp4` |
| `X-Sha256` | yes | 64 hex characters, the SHA-256 of the body (either case) |
| `X-Duration`, `X-Frames`, `X-Width`, `X-Height`, `X-Bitrate` | no | A decimal number each when present. They become the catalog's `duration_s`, `frames`, `width`, `height` and `bitrate`. |
| `X-Codec` | no | 1 to 16 lowercase letters or digits, for example `hevc` |

### Validation

Everything is checked before any storage call, in this order:

| Check | Failure |
|---|---|
| `:cam` is in the `CAMERAS` list | `403 unknown camera: <cam>` |
| `:start` is a real UTC time in the form `YYYYMMDDTHHMMSSZ`. Impossible values such as month 13 are refused. | `400 start must look like 20260922T140500Z` |
| `:start` is no more than 40 days old and no more than 5 minutes ahead of the Worker's clock | `400 start is outside the retention window` |
| `Content-Length` is present and positive | `411` |
| `Content-Length` is at most 95 MiB | `413` |
| `Content-Type` is `video/mp4` | `415` |
| `X-Sha256`, then each measurement header, then `X-Codec` is well formed | `400` naming the header |

### Storing

The Worker streams the body to the footage store at the object key for that camera and time:

```
raw/cam=<cam>/date=<YYYY-MM-DD>/hour=<HH>/<cam>_<YYYYMMDDTHHMMSSZ>.mp4
```

The store hashes the body as it writes and keeps nothing that does not match `X-Sha256`. The Worker never hashes the body itself, so a 15 to 30 MB upload costs it only a few milliseconds of CPU. It sends the store its own `STORE_TOKEN`, through the `STORE` Workers VPC binding.

Then it records the segment in the D1 catalog in one batch:

- inserts the segment row (`INSERT OR IGNORE`, so a repeat leaves one row); triggers add it to the camera's daily totals;
- deletes this camera's rows that started more than 40 days ago.

See [Catalog and storage layout](catalog.md) for the columns.

### Responses

| Status | Body | Meaning |
|---|---|---|
| `201` | `{"key": "raw/…/sky01_20260922T140500Z.mp4", "size": 24117248}` | Stored and catalogued |
| `200` | `{"key": "raw/…", "stored": "already"}` | These exact bytes were already stored: a retry. The catalog row is written again if it was missing. |
| `400`, `411`, `413`, `415` | `{"error": "…"}` | The request failed validation |
| `409` | `{"error": "a different segment already exists at this key"}` | Different bytes are stored for this camera and minute. The stored file is never replaced. |
| `422` | `{"error": "body does not match X-Sha256"}` | The body was cut short or corrupted in transit. Nothing was kept. |
| `503` | `{"error": "storage unavailable, retry later"}` | The store is unreachable, its disk is missing or nearly full, or it refused the request |
| `503` | `{"error": "stored, but the catalog is unavailable; retry to record it"}` | The file is stored but the catalog write failed |

Every outcome is safe to retry. After a catalog failure, the retry finds the file already stored (`200`) and writes the missing row. The relay's retry loop is what heals the catalog.

The [relay](relay.md) deletes its copy on `200` or `201` and keeps it for later on `5xx`. It quarantines the file on any other `4xx` except `401`, `403`, `404`, `408` and `429`, which it treats as "Worker unavailable".

## `GET /v1/status`

How long ago each camera's newest segment was catalogued:

```json
{
  "healthy": true,
  "cameras": [{ "cam": "sky01", "newest": "raw/cam=sky01/date=2026-09-22/hour=14/sky01_20260922T140500Z.mp4", "age_seconds": 41 }]
}
```

`age_seconds` counts from when the segment was uploaded, not from when it was recorded. A camera with no segments has `newest` and `age_seconds` set to `null`. The answer is `200` when every camera in `CAMERAS` has a segment catalogued in the last 3 minutes, and `503` otherwise. An uptime monitor can alert on the status code alone. `make status` prints this answer.

## Configuration

| Name | Kind | Meaning |
|---|---|---|
| `CAMERAS` | variable | Comma-separated camera IDs the relay may upload for, for example `sky01`. Also the cameras `/v1/status` reports. |
| `CATALOG` | D1 binding | The `skyvision-catalog` database, found by name |
| `STORE` | Workers VPC binding | The footage store, through its Cloudflare Tunnel. Its ID comes from `STORE_SERVICE_ID`. |
| `INGEST_TOKEN` | secret | The relay's bearer token. Generate it with `openssl rand -hex 32`. |
| `STORE_TOKEN` | secret | The footage store's token, from `~/.config/skyvision-store/store.token` on the store host |

`wrangler.jsonc` leaves `CAMERAS` empty and has no `service_id` or database ID. `npm run config` fills them from the environment or the repository's `.env` into `wrangler.deploy.json`, which `npm run dev` and `npm run deploy` use. Running `wrangler deploy` on `wrangler.jsonc` fails on purpose, before anything is uploaded. See [Configuration](../configuration.md).

Set the secrets once, from `package/worker/`:

```sh
npm run config
npx wrangler secret put INGEST_TOKEN --config wrangler.deploy.json
ssh <store-host> cat .config/skyvision-store/store.token | npx wrangler secret put STORE_TOKEN --config wrangler.deploy.json
```

Piping the store token straight from the store host keeps it off your screen.

## Deploy and test

```sh
npm ci
npm run check     # architecture check, type-check, and tests in the Workers runtime
npm run deploy    # npm run config, then wrangler deploy
```

The tests need no Cloudflare account. D1 is local, and `STORE` is bound to a fake footage store ([`package/shared/test/fakeFootageStore.js`](https://github.com/Deibler/openskycam/blob/main/package/shared/test/fakeFootageStore.js)) that answers the store's protocol. Upload tests read the stored file back from the fake instead of trusting the response.

With [Workers Builds](../deploy.md), use root directory `/package/worker/`, build command `npm run check` and deploy command `npm run deploy`. Set `CAMERAS` and `STORE_SERVICE_ID` as build variables. Watch `package/shared/` and `db/` as well as the root.
