---
title: How it works
description: The path of one recording from the camera to the website, and of one Workshop run from a workflow to a dataset, with what each step does when something is down.
---

Two paths make up openskycam. A **recording** travels from the camera to your disk and into the catalog, then out to the website and API until retention removes it. A **Workshop run** turns a window of recordings into labeled images, which you review and freeze into a dataset.

## The life of a recording

### 1. The relay records

`record.sh` runs `ffmpeg` against the camera's RTSP stream over TCP and copies the video track without re-encoding (`-c copy`). It cuts a new file every 60 seconds, aligned to the clock minute, named in UTC: `sky01_20260922T140500Z.mp4`. Files are fragmented MP4 with a fragment at each keyframe. If ffmpeg dies mid-file, the file is still readable up to its last fragment. A plain MP4 writes its index at the end, so the whole minute would be lost.

Files are written to `/dev/shm/skyvision/`, a RAM disk, so the relay's SD card sees no writes in normal operation. The systemd unit restarts ffmpeg after it exits, 2 seconds at first and backing off to 10.

| Failure | What happens |
|---|---|
| Camera unreachable | ffmpeg times out after 15 s and exits; systemd starts it again. Nothing is recorded until the stream returns. |
| ffmpeg crashes mid-minute | The partial file keeps every complete fragment and is uploaded like any other. |

### 2. The relay uploads

`upload.sh` treats every file in the RAM directory except the newest as finished. It measures each file with `ffprobe` (duration, frame count, codec, size, bitrate), hashes it with SHA-256, and sends it with `PUT /v1/segments/<camera>/<start>` to the ingest Worker. Three uploads run at once. A file is deleted only after the Worker answers `200` or `201`.

| Failure | What happens |
|---|---|
| Worker unreachable, or answers `401`, `403` (wrong token, or a camera missing from `CAMERAS`), `404`, `408`, `429` or `5xx` | The file is kept and retried after 10 s. Finished files move from RAM to `~/skyvision/spool/pending/` on disk and upload oldest first when the Worker is back. |
| More than 3 finished files in RAM | The extras move to `spool/pending/`, so a full RAM disk never stops the recorder. |
| `ffprobe` cannot read the file | It moves to `spool/quarantine/` and is never retried. |
| Any other answer, such as `409` or `422` | Same: quarantined for inspection. |
| Relay disk below `MIN_FREE_GB` (default 20) | Quarantined files are deleted first, then the oldest pending file, one at a time, until there is room. |

### 3. The ingest Worker checks and names it

The ingest Worker checks everything before it stores anything:

- the bearer token matches `INGEST_TOKEN`;
- the camera is in `CAMERAS`;
- the start time parses and lies within the 40-day retention window, and no more than 5 minutes in the future;
- the body is `video/mp4`, has a `Content-Length`, and is at most 95 MiB;
- `X-Sha256` is 64 hex characters, and the measurement headers are numbers.

The file's key comes from the camera and start time, for example `raw/cam=sky01/date=2026-09-22/hour=14/sky01_20260922T140500Z.mp4`. The `key=value` folders let DuckDB, Spark, pyarrow and Hugging Face datasets filter by date and hour.

### 4. The footage store writes it

The Worker streams the body through its `STORE` binding, a Workers VPC service that reaches the [footage store](capture/store.md) through a Cloudflare Tunnel. The store has no public address. It writes to a temporary part file, checks the SHA-256, syncs it to disk, and only then moves it to its key. It never replaces a file that already exists.

| Store answer | Worker answer | Relay does |
|---|---|---|
| `201` stored | `201` | deletes its copy |
| `200` identical bytes already stored | `200` | deletes its copy |
| `409` different bytes at that key | `409` | quarantines |
| `422` body does not match `X-Sha256` | `422` | quarantines |
| `503` disk not mounted, `507` disk nearly full, or no answer | `503` | keeps it and retries |

### 5. The catalog records it

The Worker adds a row to the `segments` table in D1 with the key, start, size, SHA-256, duration, frame count, resolution, bitrate and codec. In the same batch it deletes that camera's rows older than 40 days. If the D1 write fails after the store has the file, the Worker answers `503`. The relay retries, the store answers `200` for the identical bytes, and the catalog write is attempted again. Uploading the same segment twice leaves one row.

`GET /v1/status` on the ingest Worker reports the age of each camera's newest catalogued segment and answers `503` when any camera is more than 3 minutes behind. An uptime monitor can alert on the status code alone.

### 6. The website and API read it

The website lists recordings from the catalog and plays them by streaming the file from the store through the Worker, with no transcoding. The API lists recordings by camera and time range and downloads originals with byte ranges, so a large transfer can resume. See [Footage API](api/footage.md). If the store is offline, the catalog still lists recordings, but playback and downloads fail until it is back.

### 7. Retention removes it

Two clocks remove footage:

- The catalog forgets a recording after 40 days, when the next upload for that camera prunes old rows.
- The store's janitor runs every 10 minutes. It deletes date folders older than 41 days, so files outlive their catalog rows by a day. While free space is under 100 GB, it also deletes the oldest hours. Both limits are store flags (`--retention-days`, `--min-free-gb`).

A Workshop image made from a recording expires with that recording unless you save it.

## The life of a Workshop run

### 1. Freeze the work

Starting a run saves the Workshop document, validates the workflow graph on the server, and freezes a **snapshot**: the input window or bucket, the models and their checksums, thresholds, conditions, outputs, and the processor runtime that will run it. Later edits to the workflow do not change a run in progress.

The run becomes **jobs**: one per recording, or one per image when the input is a labeled bucket. A full run accepts at most 100 recordings of up to 5 minutes each and at most 2,000 sampled images, or at most 2,000 input images. A test run processes the number of images you ask for (1 to 100) and keeps them only as previews for an hour. Each job expires with its source: 40 days after its recording started, or when its input image expires.

A processor runtime works on one run at a time. A second run, whether from the website, a schedule or an agent, waits as `queued` until the runs ahead of it finish. Photos taken by agents are single-frame jobs and skip the queue.

### 2. Claim and lease

The processor polls `POST /v1/workshop/claim` with its runtime ID and code fingerprint, using a `workshop:run` key limited to its device and cameras. A claim returns one job with a **lease**: a token, a generation number and a 5-minute deadline. The processor renews the lease every 45 seconds and posts progress, which the website shows live.

| Failure | What happens |
|---|---|
| Processor crashes, sleeps or loses its network | The lease lapses after 5 minutes and the job can be claimed again with a new generation. After three generations the job fails as `attempts_exhausted`. |
| A late processor finishes a job whose lease lapsed | Its upload and result are refused, so two attempts never both publish. |
| Processor reports an error (bad file, model failure) | The job fails with that error, shown on the run page. Other jobs continue. |
| The job's source expires first | The job becomes `expired`. |
| Run cancelled | Queued and leased jobs become `cancelled`; finished results stay. |

### 3. Download and decode

The processor downloads the recording through the Worker and checks its byte length and SHA-256 before using it. It downloads each model file by checksum and caches it, and keeps one model loaded between jobs. Several recordings download at once, but only one recording's decoded frames are held in memory, because 4K samples take about 1.5 GB per recording.

It takes one frame per interval of the footage step (1 to 3,600 seconds):

- `first` keeps the first keyframe after each tick if it lands within 1.5 s and inside the interval, and otherwise decodes the exact frame at the tick.
- `change` decodes every frame and keeps the one with the most new light in each interval, so a meteor or strobe flash between ticks is not missed.

See [Workflows](workshop/workflows.md) for how to choose between them.

### 4. Run the models and track

Each model step runs on the GPU when there is one, two images per call. Detections from each model are linked across the recording into tracks, and each track is labeled `moving`, `stationary` or `brief`. Conditions then route each frame: by class, score, count, capture time, weekday, or motion. A frame either reaches an output bucket or ends at **Do nothing**. See [Tracking and trajectories](workshop/tracking.md).

### 5. Upload and complete

For each kept frame the processor uploads a JPEG (at most 8 MiB) under the job's lease, then completes the job with every frame's boxes, track records and provenance. The Worker checks the lease, the code fingerprint, and that the result accounts for every sampled frame. It then adds the frames to their output buckets in one transaction. Sending the same result again is harmless; a different result for a completed job is refused.

### 6. Review

New images arrive in their bucket as `pending`. You accept or reject each one, and you can correct its boxes. A corrected box keeps the track of the model box it came from. **Save images** copies an image, its labels and its provenance so they outlive the source recording; without it, the image expires with the recording.

### 7. Freeze a dataset

A **dataset version** freezes the latest accepted labels for each image in a bucket, the complete class list, and a train/validation/test split of 80/10/10. The split is by camera and UTC capture day, so a whole night stays in one split. Images you rejected can be included too. A version never changes once created, and a script can download its manifest and images with an API key. A version that contains unsaved images stops being readable when those images expire, so save images before you freeze data you mean to keep. See [Buckets and datasets](workshop/datasets.md).
