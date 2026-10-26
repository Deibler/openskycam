---
title: Workshop API
description: Automate Workshop over /v1 with an Agent key, from editing workflows to exporting a dataset.
---

Every Workshop action on the website has a `/v1` equivalent: edit workflows and buckets, start and follow runs, review images, freeze dataset versions and export them. Use an **Agent key that covers every camera**; other keys answer `403` (see [API overview](../api.md)). The paths below are the website's `/api/workshop/...` paths with `/api` replaced by `/v1`, and image links in answers already point at `/v1`.

[Workflows](../workshop/workflows.md), [Runs](../workshop/runs.md) and [Buckets and datasets](../workshop/datasets.md) explain what the objects mean. This page covers the calls.

## The Workshop document

Workshop is one JSON document: every bucket and every workflow, with a revision number.

```
GET /v1/workshop
```

```json
{
  "revision": 746,
  "document": {
    "version": 3,
    "buckets": [
      { "id": "camera-archive", "name": "Camera archive", "kind": "raw", "description": "Original video from your cameras.", "createdAt": null },
      { "id": "planes", "name": "Planes", "kind": "labeled", "description": "", "createdAt": "2026-10-01T18:02:11.000Z" }
    ],
    "workflows": [
      { "id": "night", "name": "Night sky", "updatedAt": "…", "nodes": [], "edges": [] }
    ]
  }
}
```

Before anything is saved, the answer is revision `0` with only the camera archive. A workflow's `nodes` are `{ id, type: "workshop", position, data }`, where `data.kind` names the step (`input`, `footage`, `model`, `condition`, `output`, `schedule` and others) and holds its settings. `edges` are `{ id, source, target, sourceHandle, targetHandle }`. [Workflows](../workshop/workflows.md) documents each step's settings.

### Revisions

Save the whole document with the revision you read:

```
PUT /v1/workshop
{ "revision": 746, "document": { … } }
```

The answer is `{ "revision": 747, "document": { … } }`. If anyone saved in between, the answer is `409`: read the document again, reapply your change, and save. Saving also enforces these rules (`400` otherwise):

| Rule | Detail |
|---|---|
| IDs | Buckets and workflows: a letter or digit, then up to 79 letters, digits, `_` or `-` |
| Buckets | `kind` is `raw` (only `camera-archive`, with `createdAt: null`) or `labeled` (with an ISO `createdAt`). Names are 1 to 100 characters and unique ignoring case; descriptions are at most 300. |
| Removal | Buckets cannot be removed or change kind, and workflows cannot be removed, by saving. Use the deletion calls below. |
| Size | The request body is at most 800,000 bytes and the saved document under 750,000 bytes. |

### Delete a workflow or bucket

Read the preview first. It reports what deletion would remove, and the revision to confirm with:

```
GET /v1/workshop/buckets/planes/deletion
```

```json
{
  "kind": "bucket", "id": "planes", "name": "Planes", "revision": 747,
  "linked_workflows": [{ "id": "night", "name": "Night sky" }],
  "images": 812, "saved_images": 40, "versions": 2, "active_runs": 0
}
```

Then delete with that revision. The answer is the new `{ revision, document }`.

```
DELETE /v1/workshop/buckets/planes
{ "revision": 747 }
```

Deleting a bucket removes its images, dataset versions and test previews, and clears it from the input and output steps that used it. Saved image bytes are released after an hour unless another bucket still references them. Deleting a workflow clears it from schedule steps that started it. Either way, unfinished jobs of the affected runs are cancelled. The same paths under `/workflows/{id}` delete a workflow. The camera archive cannot be deleted.

## Runtimes

A run is bound to one registered processor runtime.

| Call | Body | Answer |
|---|---|---|
| `GET /v1/workshop/runtimes` | | `{ runtimes, enabled }`. Each runtime has `id`, `device_id`, `code_sha256`, `created_at`, `last_seen_at` and `capabilities` (`test-runs`, `live-progress`, `tracking`). `enabled` is `false` when Workshop storage is not configured. |
| `POST /v1/workshop/runtimes` | `{ device_id, code_sha256 }` | `201`, the runtime. Its `id` is `workshop-` followed by 32 hex characters derived from the device and code, so registering the same pair twice gives the same ID. |

The device must be registered in Models first. [Processor](../processor.md) covers installing and registering a runner.

## Runs

### Start a run

```
POST /v1/workshop/runs
{ "id": "night-2026-10-25", "workflow_id": "night", "runtime_id": "workshop-3f9a27c1…", "revision": 747, "mode": "test", "image_limit": 20 }
```

| Field | Rule |
|---|---|
| `id` | Your ID for the run, same pattern as other IDs. Sending the same ID and body again returns the existing run; the same ID with a different body answers `409`. |
| `workflow_id` | A saved workflow |
| `runtime_id` | A registered runtime. A test needs the `test-runs` capability, and a workflow that keeps frames by change or routes on motion needs `tracking`. |
| `revision` | The current Workshop revision; otherwise `409 Save and reload the latest workflow before running.` |
| `mode` | `test` or `run` (the default) |
| `image_limit` | Tests only: 1 to 100 frames |

The answer is `201` with the run record: `id`, `request_hash`, `workflow_id`, `name`, `runtime_id`, `snapshot_json` (the frozen workflow, models, footage window and buckets) and `created_at`.

A test saves nothing to buckets. Its frames are temporary previews that expire after an hour. A full run saves into the workflow's output buckets and is limited to 100 recordings and 2,000 sampled frames, or 2,000 images when the input is a labeled bucket. A workflow uses one to four models. A processor works on one workflow run at a time, so a run started while another is unfinished waits in the queue.

### Follow a run

| Call | Answer |
|---|---|
| `GET /v1/workshop/runs?workflow={id}` | `{ runs }`: the newest 100 runs, optionally for one workflow. Each has the run record plus job counts (`total`, `queued`, `leased`, `completed`, `failed`, `expired`, `cancelled`) and image counts (`images`, `pending`, `accepted`, `rejected`). |
| `GET /v1/workshop/runs/{id}` | The run's progress, below. |
| `GET /v1/workshop/runs/{id}/live` | A WebSocket that sends the same object whenever progress changes. |
| `POST /v1/workshop/runs/{id}/cancel` | `{ "cancelled": true }`. The run's queued and leased jobs are marked cancelled. |
| `GET /v1/workshop/runs/{id}/review` | Everything needed to review a full run: `run`, `recordings`, the models' `classes`, and up to 1,000 `items` with `has_more`. |

`GET /v1/workshop/runs/{id}` returns:

| Field | Meaning |
|---|---|
| `status` | `queued`, `running`, `completed`, `failed`, `cancelled` or `expired` |
| `mode` | `test` or `run` |
| `expected_images`, `processed_images` | Frames planned and processed so far |
| `requested_images`, `preview_expires_at` | A test's `image_limit` and when its previews expire |
| `output_buckets` | Where a full run saves; empty for a test |
| `workflow`, `steps` | The frozen workflow, and each step's `id`, `kind` and `label` |
| `jobs` | One per recording or image: `id`, `status`, `expected`, `processed`, `error`, `progress` |
| `images` | Up to 100 frames: the item fields (`id`, `cam`, `captured_at`, `review`, labels as a JSON string in `annotation_json`, …) and `image_url`; `has_more` when there are more |

A run is `running` while any job is leased, `queued` while any job waits, and otherwise `failed`, `cancelled`, `expired` or `completed`, in that order of precedence. A test is `expired` once its previews are.

For the WebSocket, send the `Authorization` header with the upgrade request. Updates are coalesced, about 120 ms after the processor reports progress. Each message is the run object, or `{ "error": "…" }`. The bridge does not rewrite WebSocket messages, so their `image_url` values start with `/api/`; replace that with `/v1/` before fetching.

### Images from a run

A full run's frames are bucket items, at `GET /v1/workshop/items/{id}/image`. A test's frames are previews, at `GET /v1/workshop/runs/{run}/previews/{item}/image`, until they expire. Both answer `image/jpeg`.

## Buckets and review

| Call | Answer |
|---|---|
| `GET /v1/workshop/summary` | Image and review counts per bucket, and per workflow: runs, the last run, image counts, classes and daily totals |
| `GET /v1/workshop/schedules` | `{ schedules }`: each scheduled workflow's latest outcome |
| `GET /v1/workshop/buckets/{id}` | The first 500 images with parsed `annotations` and `image_url`, `has_more`, the `accepted` count and the bucket's `versions` |
| `GET /v1/workshop/buckets/{id}/browse` | One filtered page: `items`, `total`, `facets` and `cursor` |
| `GET /v1/workshop/items/{id}` | One image with its `recording`, `run` (`id`, `name`, `created_at`) and the model's `classes` |
| `GET /v1/workshop/items/{id}/thumbnail` | A small JPEG: `size=256` (default) or `512`, `mode=frame` (default) or `object` to crop to the detections. Supports `If-None-Match`. |

`browse` filters: `run`, `camera`, `class`, `review` (`pending`, `accepted` or `rejected`), `saved=true`, `q` (text, up to 200 characters), `from` and `to` (capture time), `min_confidence` and `max_confidence` (0 to 1), `min_objects` and `max_objects` (0 to 100), `sort` (`newest` or `oldest`), `limit` (1 to 200, default 120) and `cursor` from the previous page.

### Review an image

```
PUT /v1/workshop/items/{id}/review
{ "review": "accepted" }
```

`review` is `pending`, `accepted` or `rejected`. To correct the labels as well, send `annotations`, which replace the model's:

```json
{
  "review": "accepted",
  "annotations": [{ "class_name": "Plane", "confidence": 1, "box": [0.412, 0.218, 0.447, 0.236] }]
}
```

| Label field | Rule |
|---|---|
| `class_name` | One of the classes of the model that labeled the image |
| `confidence` | 0 to 1 |
| `box` | Detection models only: `[left, top, right, bottom]` as fractions of the frame, left below right and top below bottom |

At most 100 labels, and the request body is limited to 4,096 bytes. A label that differs from the model's is marked `edited`. A corrected box keeps the `track_id` of the model box it matches or overlaps by more than half, so trajectories survive review. The answer echoes `review`, and `annotations` when sent.

### Keep an image

Images expire with the recording they came from. `POST /v1/workshop/items/{id}/save` copies the image, its labels and provenance so they never expire, and answers `{ "saved": true }`. The original video is not kept.

## Dataset versions

A version freezes a bucket's reviewed images as a training dataset.

```
POST /v1/workshop/buckets/planes/versions
{ "id": "planes-v3", "name": "Planes v3", "include_rejected": false }
```

| Field | Rule |
|---|---|
| `id` | Your version ID. The same ID, bucket and name again returns the existing version. |
| `name` | 1 to 100 characters |
| `include_rejected` | Optional. `true` also includes rejected images, as negatives |

The answer is `201` with `id`, `bucket_id`, `name`, `sha256`, `created_at` and `images`. The version takes accepted images, one per source asset, and needs at least one. All images must share one task: put detection and classification outputs in separate buckets. Splits are assigned by camera and UTC capture day (SHA-256 modulo 100: 80 train, 10 validation, 10 test), so a whole night stays in one split.

`GET /v1/workshop/versions/{id}` exports it: the version's metadata and a `manifest` with `class_names`, `split_policy` and one entry per image. Each entry has `item_id`, `cam`, `media_path` (`/v1/workshop/items/{id}/image`), `asset_id`, `sha256`, `source_sha256`, `captured_at`, `expires_at`, `review`, `split`, `provenance` and `annotations`. In annotations, `class_id` indexes `class_names` and `model_class_id` keeps the model's own ID. A version whose images have expired answers `404`; save images you want to keep beyond the recording.

## Example: test a workflow

This script adds a bucket, runs a 20-frame test of an existing workflow on the most recently seen runtime, waits for it, and downloads the previews. It uses only the standard library.

```python
import datetime, json, os, sys, time, urllib.error, urllib.request, uuid
from pathlib import Path

API = os.environ["OPENSKYCAM_API"]  # https://<api-host>
KEY = os.environ["OPENSKYCAM_KEY"]  # an Agent key for every camera
WORKFLOW = sys.argv[1]              # the workflow's name, e.g. "Night sky"


class Conflict(Exception):
    pass


def call(method, path, body=None, raw=False):
    data = None if body is None else json.dumps(body).encode()
    headers = {"Authorization": "Bearer " + KEY}
    if data is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read() if raw else json.load(response)
    except urllib.error.HTTPError as error:
        message = error.read().decode(errors="replace")
        if error.code == 409:
            raise Conflict(message)
        raise SystemExit(f"{method} {path}: {error.code} {message}")


def add_bucket(name):
    """Adds a labeled bucket unless one has this name, retrying if someone else saves first."""
    while True:
        state = call("GET", "/v1/workshop")
        if any(b["name"].lower() == name.lower() for b in state["document"]["buckets"]):
            return state
        state["document"]["buckets"].append({
            "id": "bucket-" + uuid.uuid4().hex[:12],
            "kind": "labeled",
            "name": name,
            "description": "Made by the Workshop API example",
            "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        })
        try:
            return call("PUT", "/v1/workshop", state)
        except Conflict:
            continue


def start_test(state, workflow_name, frames):
    workflow = next(w for w in state["document"]["workflows"] if w["name"] == workflow_name)
    seen = [r for r in call("GET", "/v1/workshop/runtimes")["runtimes"]
            if r["last_seen_at"] and "test-runs" in r["capabilities"]]
    if not seen:
        raise SystemExit("No processor runtime that runs tests has checked in.")
    runtime = max(seen, key=lambda r: r["last_seen_at"])
    while True:
        try:
            return call("POST", "/v1/workshop/runs", {
                "id": "test-" + uuid.uuid4().hex[:12],
                "workflow_id": workflow["id"],
                "runtime_id": runtime["id"],
                "revision": state["revision"],
                "mode": "test",
                "image_limit": frames,
            })
        except Conflict:
            state = call("GET", "/v1/workshop")  # Workshop changed: run against the latest revision


state = add_bucket("API example")
run = start_test(state, WORKFLOW, 20)
while True:
    detail = call("GET", f"/v1/workshop/runs/{run['id']}")
    print(f"{detail['status']}: {detail['processed_images']}/{detail['expected_images']} frames")
    if detail["status"] in ("completed", "failed", "cancelled", "expired"):
        break
    time.sleep(5)

folder = Path(run["id"])
folder.mkdir(exist_ok=True)
for image in detail["images"]:
    labels = ", ".join(a["class_name"] for a in json.loads(image["annotation_json"])) or "no labels"
    (folder / f"{image['id']}.jpg").write_bytes(call("GET", image["image_url"], raw=True))
    print(image["captured_at"], labels, image["image_url"])
```

Run it as `python3 test_workflow.py "Night sky"`. A test that queues behind a full run waits until that run finishes, and its previews can be fetched for an hour.
