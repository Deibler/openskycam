---
title: Footage API
description: List recordings by camera and time, and download original files with resume and checksum verification.
---

Recordings are the relay's 60-second MP4 segments, stored unchanged on the [footage store](../capture/store.md) and listed in the [catalog](../capture/catalog.md). Any key with a camera can list and download that camera's recordings: `footage:read`, `agent`, `workshop:run` and `processor:run`. Model keys have no cameras. Times are UTC ISO 8601.

## Endpoints

| Endpoint | Returns |
|---|---|
| `GET /v1/me` | The key: `key_id`, `scope`, `cameras`, and `device_id` or `pipeline_id` when bound to one |
| `GET /v1/cameras` | `{ "cameras": ["sky01"] }`: the cameras this key can read |
| `GET /v1/recordings` | One page of recordings that overlap a time window |
| `GET`/`HEAD /v1/recordings/{camera}/{start}/file` | The original MP4, whole or one byte range |

## List recordings

```
GET /v1/recordings?camera=sky01&from=2026-10-25T02:00:00Z&to=2026-10-25T03:00:00Z
```

| Parameter | Rule |
|---|---|
| `camera` | Required. A camera the key can read; anything else answers `403`. |
| `from`, `to` | Required. ISO 8601 with a time zone (`Z` or `+02:00`), optional milliseconds. `to` must be later than `from`. |
| `limit` | 1 to 500, default 100. |
| `cursor` | From the previous page. It only works with the same `camera`, `from` and `to`; a changed query answers `400 Invalid cursor, or query changed between pages.` |

A recording is listed when it overlaps `[from, to)`: it starts before `to` and ends after `from`. Its end is `start + duration_s`, or 60 seconds when the duration is unknown. Results are ordered by `start`.

The first page fixes an upload cutoff, `as_of`, and every later page uses it. A recording uploaded while you page through is left out instead of shifting the pages. List the window again to pick it up.

```json
{
  "camera": "sky01",
  "from": "2026-10-25T02:00:00.000Z",
  "to": "2026-10-25T03:00:00.000Z",
  "as_of": "2026-10-25T09:41:07.312Z",
  "recordings": [
    {
      "object_key": "raw/cam=sky01/date=2026-10-25/hour=02/sky01_20261025T020000Z.mp4",
      "cam": "sky01",
      "start": "2026-10-25T02:00:00.000Z",
      "size": 30212345,
      "sha256": "9b1c…",
      "duration_s": 60.02,
      "frames": 504,
      "width": 3840,
      "height": 2160,
      "bitrate": 4027000,
      "codec": "hevc",
      "download_url": "https://<api-host>/v1/recordings/sky01/20261025T020000Z/file"
    }
  ],
  "next_cursor": "eyJ2Ijox…",
  "next_url": "https://<api-host>/v1/recordings?camera=sky01&from=…&cursor=eyJ2Ijox…"
}
```

`duration_s`, `frames`, `width`, `height`, `bitrate` and `codec` are the relay's `ffprobe` measurements, and `null` when it did not send them. Follow `next_url` until it is `null`.

## Download a file

```
GET /v1/recordings/sky01/20261025T020000Z/file
```

`{start}` is the compact UTC start time, as in `download_url`. The file streams from the footage store through the Worker without buffering or transcoding.

| Response header | Value |
|---|---|
| `Content-Type` | `video/mp4` |
| `Content-Length` | The bytes in this response |
| `Accept-Ranges` | `bytes` |
| `Content-Disposition` | `attachment; filename="sky01_20261025T020000Z.mp4"` |
| `ETag` | When the store sends one |
| `Cache-Control` | `private, no-store` |

`HEAD` returns the same headers without the body.

### Ranges and resume

Send one range in the form `bytes=N-`, `bytes=N-M` or `bytes=-N`. A satisfiable range answers `206` with `Content-Range: bytes N-M/<size>`. A range past the end answers `416` with `Content-Range: bytes */<size>`, and a malformed one answers `416 provide one valid byte range`. Multiple ranges are not supported.

To resume, request `bytes=<bytes you have>-`. Check that `Content-Range` starts at that offset before appending, and replace the file if the answer is a full `200`. Verify the finished file against the listing's `sha256`.

### Failure cases

| Status | When |
|---|---|
| `400` | `start` is not a compact timestamp such as `20261025T020000Z` |
| `403` | The key cannot read that camera |
| `404` | Nothing is stored at that time, including recordings the store has already pruned |
| `503` | The footage store is unreachable. Retry with the same range |

The footage store deletes whole days past its retention (41 days by default) and the oldest hours when its disk runs low, so a recording near the edge of the window can be listed and then answer `404`.

## Example: download one hour

This script needs only the standard library. It lists an hour, resumes partial files, and deletes any file whose checksum does not match.

```python
import hashlib, json, os, urllib.parse, urllib.request
from pathlib import Path

API = os.environ["OPENSKYCAM_API"]  # https://<api-host>
KEY = os.environ["OPENSKYCAM_KEY"]  # a footage:read key


def get(url, headers=None):
    request = urllib.request.Request(url, headers={"Authorization": "Bearer " + KEY, **(headers or {})})
    return urllib.request.urlopen(request, timeout=60)


def recordings(camera, start, end):
    query = urllib.parse.urlencode({"camera": camera, "from": start, "to": end, "limit": 500})
    url = f"{API}/v1/recordings?{query}"
    while url:
        with get(url) as response:
            page = json.load(response)
        yield from page["recordings"]
        url = page["next_url"]


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(recording, folder):
    start = recording["download_url"].rsplit("/", 2)[-2]
    target = folder / f"{recording['cam']}_{start}.mp4"
    have = target.stat().st_size if target.exists() else 0
    if have > recording["size"]:
        target.unlink()
        have = 0
    if have < recording["size"]:
        with get(recording["download_url"], {"Range": f"bytes={have}-"} if have else None) as response:
            if response.status == 206 and not response.headers["Content-Range"].startswith(f"bytes {have}-"):
                raise RuntimeError(f"{target.name}: the server sent a different range")
            with open(target, "ab" if response.status == 206 else "wb") as f:
                while chunk := response.read(1 << 20):
                    f.write(chunk)
    if sha256(target) != recording["sha256"]:
        target.unlink()
        raise RuntimeError(f"{target.name}: checksum mismatch, deleted; run again")
    return target


folder = Path("footage")
folder.mkdir(exist_ok=True)
for recording in recordings("sky01", "2026-10-25T02:00:00Z", "2026-10-25T03:00:00Z"):
    print(download(recording, folder))
```

The same with `curl`; `-C -` resumes from the size of the local file:

```sh
curl -fsS -H "Authorization: Bearer $OPENSKYCAM_KEY" \
  "https://<api-host>/v1/recordings?camera=sky01&from=2026-10-25T02:00:00Z&to=2026-10-25T03:00:00Z&limit=500"

curl -fL -C - -H "Authorization: Bearer $OPENSKYCAM_KEY" -o sky01_20261025T020000Z.mp4 \
  "https://<api-host>/v1/recordings/sky01/20261025T020000Z/file"
shasum -a 256 sky01_20261025T020000Z.mp4
```

For bulk transfers, keep a few downloads in flight rather than dozens; the files come from one disk through a tunnel.

## Browsing endpoints

The website's footage views are also available under `/v1` to an Agent key for every camera ([API overview](../api.md)). They take `cam` rather than `camera`, and they are not in `openapi.json`.

| Endpoint | Returns |
|---|---|
| `GET /v1/overview?cam=sky01` | `cameras`, `cam`, `generated_at`; `health` (`healthy` when the newest upload is under 3 minutes old, `newest_start`, `newest_uploaded_at`, `age_seconds`); `last_24h` and `retained` totals (`segments`, `bytes`, `seconds`); `days`, one entry per UTC day for the last 40 days; `projection` (`bytes_per_day`, `steady_state_bytes`). `cam` defaults to the first camera. |
| `GET /v1/segments?cam=sky01&from=…&to=…` | `segments` starting in `[from, to)`, at most 48 hours: `start`, `size`, `duration_s`, `frames`, `width`, `height`, `bitrate`, `codec` |
| `GET /v1/availability?cam=sky01&boundaries=…` | `days`: which calendar days have footage. `boundaries` is 2 to 32 consecutive day boundaries in epoch milliseconds, each 20 to 28 hours apart, so local days of 23 or 25 hours work. Each day is returned as the ISO time of its first boundary. |
| `GET /v1/video/{cam}/{start}` | The same file as `/v1/recordings/.../file`, with ranges, cached `private, max-age=86400`. Add `?download` for a `Content-Disposition` attachment. |
