---
title: Runs
description: How a workflow run is created, queued, leased to the processor, followed live, cancelled and reviewed.
---

A run executes one saved workflow once. Creating it freezes everything the result depends on into a **snapshot** and splits the input into **jobs**, one per recording or per labeled image. The [processor](../processor.md) claims jobs one at a time, decodes and labels the frames, and uploads them. A **test** run does the same work on at most 100 frames and keeps the results for an hour; a **full** run saves into the workflow's output buckets.

## Test and full runs

| | Test | Full run |
| --- | --- | --- |
| Request | `mode: "test"`, `image_limit` 1–100 | `mode: "run"` (default), no `image_limit` |
| Frames | Up to `image_limit`, allotted across recordings in order | Every slot in the window |
| Results | Previews only: never in a bucket, cannot be reviewed, saved, used as input or frozen | Bucket items, pending review |
| Lifetime | One hour after submission, or the source's expiry if earlier | The source recording's 40 days, unless saved |
| Processor | A runtime with `test-runs` | Any compatible runtime |

Both use the same pinned models, sampling and processor path, so a test shows what a full run would save. The editor sets the test's image count beside **Run test**.

## Creating a run

```http
POST /api/workshop/runs
{"id": "<your run id>", "workflow_id": "night", "runtime_id": "workshop-…", "revision": 746, "mode": "test", "image_limit": 20}
```

The same body works at `POST /v1/workshop/runs` with an Agent key (see [Workshop API](../api/workshop.md)).

- **`id`** is chosen by the client, so a retried request is safe. The same `id` with the same body returns the existing run; with a different body it is `409`.
- **`revision`** must be the Workshop document's current revision. Save first; a stale revision is `409`, and the server checks it again while it inserts the jobs.
- **`runtime_id`** names the processor runtime that will run every job. The website picks the newest runtime that has checked in within the last 2 minutes and has the capabilities the workflow needs. Schedules and agents use the newest runtime that has ever checked in.

The server then validates the graph ([rules](workflows.md)) and resolves `run-day` and `previous-day` to a date. It looks up each model's weights and lists the input. These limits apply:

| Limit | Value |
| --- | --- |
| Recordings per full run | 100 |
| Recording length | 300 s |
| Sampled frames per run | 2,000 |
| Labeled input images per full run | 2,000 |
| Models per workflow | 4 |

A run whose input has no media fails with "The selected input has no available media."

### The snapshot

The snapshot is stored with the run and never changes (a database trigger refuses updates). Later edits to the workflow, its models or the processor cannot change a submitted run.

| Field | What it pins |
| --- | --- |
| `workflow` | The whole workflow graph as saved |
| `models` | Per model step: the full model manifest, the `.pt` artifact's SHA-256, input size and score |
| `runtime` | The processor runtime, including its code SHA-256 |
| `input_bucket`, `output_buckets` | Bucket IDs |
| `interval`, `pick`, `from`, `until` | The sampling window in UTC and how frames are kept |
| `mode`, `image_limit`, `preview_expires_at` | Test settings |
| `expected_images` | Slots to process |

The processor refuses a job when its own code fingerprint differs from the snapshot's runtime, and the server rejects a result whose `code_sha256` differs.

## One run at a time

The processor works on one workflow run at a time per runtime. A run's jobs can be claimed only when every older run on the same runtime has no queued or leased jobs left, so a second run waits with status `queued`. Nothing needs retrying: the queued run starts when those finish. The MCP `runs` tool adds `waiting_behind` to a queued run: up to five runs ahead of it, oldest first. Within the run in progress, the processor keeps three recordings in flight (downloads and decoding overlap; one model pass runs at a time).

Photos skip the queue (see [Photos](#photos)).

## Jobs and leases

A job moves through `queued` → `leased` → `completed`, or ends `failed`, `cancelled` or `expired`.

- **Claim.** The processor calls `POST /v1/workshop/claim` with its runtime ID and code SHA-256, using a `workshop:run` key bound to the runtime's device. The claim records that the runtime was seen, and leases the next job for a camera the key covers: photos first, then the oldest run, then job order. The answer includes the job's input and the run's snapshot.
- **Lease.** A lease lasts 5 minutes, never past the job's expiry. The processor renews it every 45 s (`/heartbeat`). Every upload, progress event and the final result carry the lease's `generation` and token; anything sent under an old lease is refused.
- **Retries.** If a processor dies or loses its network, its lease lapses and the job can be claimed again with a new generation. After a third lapsed lease, the job fails with `attempts_exhausted`.
- **Failure.** When the processor itself hits an error (download, decode, model, upload), it reports `processor_failed` and the job fails without a retry. A recording that ends before its last scheduled slot fails this way.
- **Expiry.** A job expires with its source: the recording's 40 days, or the test's hour. Expired jobs are marked `expired` and their input is cleared.
- **Completion.** The result must account for every slot: frames sent plus `empty_slots` (slots the recorder skipped) must equal the expected count, and each frame must sit in its own slot and inside the window. A workflow with a Do nothing step may send fewer frames than it sampled. Results are committed only after the whole job succeeds, so a full run's bucket never holds part of a job. Committing the same result twice is accepted; a different result for a completed job is `409`.

## Following a run

`GET /api/workshop/runs/{id}` returns the run's status and counts, each job's phase, and up to 100 recent images.

| Field | Meaning |
| --- | --- |
| `status` | `queued`, `running` (any job leased), `completed`, `failed`, `cancelled`, or `expired` |
| `expected_images`, `processed_images` | Slots to process and slots done |
| `jobs[]` | Each job's `status`, `expected`, `processed`, `error`, and `progress` |
| `jobs[].progress` | `phase` (`downloading`, `loading_model`, `processing`, `uploading`, `finalizing`) and the step `node_id` it is on |
| `images[]` | Committed bucket items and in-flight previews, each with an `image_url`; `has_more` past 100 |
| `steps[]` | Each step with its model name |

Status is worked out from the jobs in that order: any leased job means `running`, then any queued, then any failed, cancelled or expired. A test whose hour has passed is `expired` and shows no images.

**Live updates.** `GET /api/workshop/runs/{id}/live` with `Upgrade: websocket` opens a WebSocket to the run's Durable Object. It sends the same JSON as the run detail as soon as it connects, then again whenever the processor reports progress or publishes a frame, a job completes or fails, or the run is cancelled. Bursts within 120 ms are sent once. The run page uses it; a closed socket or a missing Durable Object never affects the processor's results. Agents follow runs with `runs watch`, which waits on the same session ([MCP server](../api/mcp.md)).

`GET /api/workshop/runs` lists recent runs, optionally `?workflow={id}`, with job and review counts. Photos are not listed.

## Cancelling

`POST /api/workshop/runs/{id}/cancel` marks every queued and leased job `cancelled`. A processor working on a cancelled job finds its lease invalid at the next heartbeat or upload and stops; anything it sends afterwards is refused. Completed jobs keep their results. Deleting a workflow or a bucket cancels the unfinished runs that use it the same way.

## Previews

While a job runs, the processor publishes each frame that reaches an output as a preview, in slot order, before it uploads the next. Previews feed the run page's live images for both test and full runs. A full run's previews are replaced by bucket items when the job completes; a test's previews are all it has.

Preview images are served at `/api/workshop/runs/{run}/previews/{item}/image`, and to `footage:read` or Agent keys for that camera at the same path under `/v1`. Labels and images become unreadable when the preview expires. A cleanup every 15 minutes deletes expired previews and up to 500 expired uploads per pass. Test images are stored under `workshop-tests/` in the Workshop R2 bucket; a one-day R2 lifecycle rule on that prefix is a useful backstop, but it is a bucket setting you add, not something the code creates.

## Photos

A photo is a still frame from a stored recording, requested through the MCP `footage` tool. It runs as a one-frame test with no model, through the same lease, upload and checksum path, and it skips the run queue. The server picks the newest recording that covers the requested time, so overlapping clips never land on a clip's missing last frame. Asking for the same camera and time within the same clock hour returns the same photo. A photo lasts an hour. Photo runs are kept out of the Workshop run list and summaries.

## Processor runtimes

A runtime is one registered version of processor code on one device: `workshop-` plus the first 32 hex characters of a SHA-256 over its manifest (`engine`, `device_id`, `code_sha256`). Changing any processor source changes `code_sha256`, so a new version needs a new runtime and a reinstalled runner ([processor](../processor.md)).

```http
POST /api/workshop/runtimes
{"device_id": "gpu-box", "code_sha256": "<python -m skyvision_processor workshop-manifest --device gpu-box>"}
```

The device must already be registered under Models → Devices. `GET /api/workshop/runtimes` lists runtimes with `last_seen_at` and `capabilities`:

| Engine | Capabilities |
| --- | --- |
| `workshop-v2` | `test-runs`, `live-progress` |
| `workshop-v3` | `test-runs`, `live-progress`, `tracking` |

Registration now always records `workshop-v3`, so register only processor code that tracks. A run that keeps frames by `change` or has a `motion` rule is refused on a runtime without `tracking`: "Update the Workshop processor: this workflow keeps frames by change or routes on motion."

## Reviewing a run

`GET /api/workshop/runs/{id}/review` returns what the run review page needs:

- the run's recordings, for the player;
- the class lists of its models;
- up to 1,000 of its saved items, oldest first, with `has_more` beyond that.

The review page groups a run's consecutive frames of one object into **sightings**: same bucket and class, at most 5 s apart, and the box within 3 of its own widths of where it was last. Each sighting is decided at once: Confirm or None sets every photo in it, and a class key relabels them. Decisions are reviews of bucket items, described in [Buckets and datasets](datasets.md).

`GET /api/workshop/summary` returns the counts behind the Workshop overview: per bucket (images, accepted, rejected, pending, saved, last added) and per workflow (runs, the last run, per-class detections and confirmations, and images per day).
