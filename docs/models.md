---
title: Models
description: The model registry, how to publish a trained model, and how devices and Workshop runs use it.
---

The model registry stores every model version you publish: its weights and a model card that describes classes, task, input and evaluations. Versions are immutable. Workshop runs pin the exact checkpoint they use. A new deployment starts with an empty registry: publish your own model, or the night detector in `models/night-detector` ([below](#publish-the-night-detector)).

Model files live in the private `skyvision-models` R2 bucket, separate from footage retention, so they are never pruned. D1 holds the model cards, the artifact index, device assignments and device status.

## Versions and artifacts

A version is identified by `family/version`, for example `night-detector/v3`. Both parts are 1–64 lowercase letters, digits, dots, underscores or hyphens. Publishing the same card again is accepted and changes nothing. Publishing different content under an existing version returns 409, so give every training run a new version.

An artifact is one file, addressed by its SHA-256. A version lists 1–16 artifacts, for example the `.pt` checkpoint and an ONNX export. Each is at most 1 GiB. Two versions can share an artifact.

### Model card

The card is JSON. [`processor/examples/model.json`](https://github.com/Deibler/openskycam/blob/main/processor/examples/model.json) is a starting point:

```json
{
  "family": "my-detector", "version": "v1", "name": "My detector",
  "description": "Describe the model's intended operating conditions.",
  "task": "object-detection", "adapter": "ultralytics",
  "classes": [{ "id": 0, "name": "example-class" }],
  "input": { "kind": "image", "training_size": 640, "preprocessing": "Ultralytics letterbox" },
  "evaluations": [], "caveats": [], "dependencies": []
}
```

| Field | Rule |
|---|---|
| `task` | `object-detection`, `image-classification`, `feature-classification` or `image-encoder` |
| `adapter` | `ultralytics` (detection or classification `.pt` checkpoints) or `unsupported` (stored and searchable, but not runnable) |
| `classes` | Ordered from id 0 with no gaps, at most 1,000. A runnable `ultralytics` model needs at least one. |
| `name` | 1–120 characters |
| `description` | 1–4,000 characters |
| `input` | An object. Workshop reads its input size from `width`, `imgsz` or `training_size`. |
| `artifacts` | Filled in by the publisher: `sha256`, `bytes`, a plain `filename` with no path, and `format` |
| `evaluations` | Up to 50 objects, or an empty list when there are no metrics. Never invent metrics. |
| `caveats` | Up to 50 strings |
| `dependencies` | Up to 16 existing `family/version` names that a deployment must include too |
| `created_at` | Optional. The original training time, ISO 8601 with a time zone. Keep it the same on retries. The API never substitutes the upload time. |

## Publish a model

Publishing needs a **Publish trained models** key (`models:write`). It can publish and download models, and read the catalog. It cannot read footage, change device assignments or manage keys. Checkpoints are executable files, so keep these keys on your training machines.

Install the package wherever you train, including Colab. Publishing needs only the standard library:

```sh
pip install ./processor                # publishing only
pip install './processor[runtime]'     # also training and inference
```

### Publish the night detector

The repository includes a trained detector for planes and meteors at night, [`models/night-detector`](https://github.com/Deibler/openskycam/tree/main/models/night-detector), with its card, evaluation and limits. Publish it with a publishing key, from the repository root:

```sh
pip install ./processor
skyvision-processor publish-model --base-url https://<api-host> --key-file publish.key \
  --metadata models/night-detector/model.json --artifact models/night-detector/night-yolo26s-1920.pt
```

Its weights are licensed under AGPL-3.0, unlike the rest of the repository, because they derive from Ultralytics YOLO26s.

### Train in a notebook

[`processor/examples/train_detector.ipynb`](https://github.com/Deibler/openskycam/blob/main/processor/examples/train_detector.ipynb) downloads one or more dataset versions, shrinks frames the way the processor does, trains, scores the test split and publishes the result. Open it in Colab with File → Open notebook → GitHub, and keep its two keys in Colab Secrets.

### Train and publish

[`processor/examples/train.json`](https://github.com/Deibler/openskycam/blob/main/processor/examples/train.json) holds the Ultralytics training options (`model`, `data`, `epochs`, `imgsz`, `project`, `name`).

```sh
export SKYVISION_API_KEY=…            # or --key-file with a mode-600 file
skyvision-processor train --base-url https://<api-host> --metadata model.json --train-config train.json
```

When training ends, the hook publishes `best.pt` with the actual class IDs, the trainer's final validation metrics, the dataset and the input size. The metrics are what the trainer reported, not an independent benchmark. If the upload fails, the command fails. The training output and a generated `skyvision-model.json` card stay on disk, so you can retry without retraining:

```sh
skyvision-processor publish-model --base-url https://<api-host> \
  --metadata runs/my-detector-v1/skyvision-model.json --artifact runs/my-detector-v1/weights/best.pt
```

Repeat `--artifact` for exports. For a checkpoint from another framework, write the card yourself with verified metadata and `adapter: "unsupported"`.

### From an existing notebook

Attach the same hook to an Ultralytics model before training:

```python
import json
from google.colab import userdata
from skyvision_processor.utils.httpSharedUtil import Client
from skyvision_processor.service.modelInferenceService import training_callback

client = Client("https://<api-host>", userdata.get("SKYVISION_API_KEY"))
card = json.load(open("model.json"))
model.add_callback("on_train_end", training_callback(client, card))
model.train(data="data.yaml", imgsz=1280, epochs=100)
```

### Upload protocol

The commands above do this for you. Other clients follow the same three steps:

1. `PUT /v1/models/chunks/{sha256}` for each chunk of at most 8 MiB. The body's SHA-256 must equal the path. Chunks are stored by checksum, so retries are safe.
2. `POST /v1/models/artifacts {"sha256", "bytes", "chunks": [{"sha256", "bytes"}, …]}` with at most 128 ordered chunks. The server checks that the sizes add up and that the joined chunks hash to `sha256`.
3. `POST /v1/models` with the card. Each listed artifact must already be uploaded with the same size.

`GET /v1/models/artifacts/{sha256}` returns the original bytes with an `X-Content-SHA256` header. `GET /v1/models` returns the catalog to publishing keys and Agent keys.

If a Python client gets Cloudflare error 1010 before reaching the Worker, Browser Integrity Check is rejecting its user agent. Add a configuration rule with `bic: false` scoped to `http.host eq "<api-host>"`. Keys are still checked.

## Use a model in Workshop

A workflow's model step names one `family/version` from the picker. When you start a run, the server pins that version's `.pt` artifact by checksum into the run's snapshot, so publishing a new version never changes a run that already exists. The snapshot also fixes:

| Setting | Value |
|---|---|
| Input size | The card's `input.width`, `input.imgsz` or `input.training_size`, rounded up to a multiple of 32; 640 if none is set or it falls outside 32–2048 |
| Confidence | The step's minimum score |
| IoU for non-maximum suppression | 0.5 |
| Device | `auto`: CUDA, then MPS, then CPU (see [Processor](processor.md)) |

A run uses one to four models. A run is refused when a model:

- isn't an `ultralytics` detection or classification model with classes;
- needs tiles or crops (its name contains "tiled" or "crop", or its input kind is `crop`);
- has no `.pt` artifact.

The processor also refuses a checkpoint whose class map or task differs from its card.

## Devices and deployments

A device is a named machine with a managed model cache, for example a processor host. Deployments assign it exact model versions with inference settings. This drives the continuous-inference preview described on [Processor](processor.md), whose baseline runner accepts only detectors with the classes plane, wildlife and meteorite. Workshop runs do not use deployments: they download their models per run.

Register a device in **Models → Devices**. Then **Configure** assigns models to named slots (`detector`, for example). Each slot has:

| Parameter | Allowed |
|---|---|
| `imgsz` | A multiple of 32 from 32 to 2048 |
| `confidence` | 0–1 |
| `iou` | 0–1 |
| `device` | `auto`, `cpu`, `mps` or `cuda` |

A deployment holds up to 16 models in distinct slots. Each must be an `ultralytics` model with a `.pt` artifact, and the deployment must include its dependencies. An empty deployment unloads every managed model.

Each saved deployment gets a new revision. A save must name the revision it replaces (`previous_revision`), otherwise it returns 409 ("The deployment changed. Refresh before deploying."), so two editors cannot overwrite each other. Rolling back means assigning an earlier version again; history is kept.

### Sync a device

A **Sync device models** key (`models:sync`) is bound to one device. It can read that device's desired deployment, download only the artifacts assigned to it, and report status. Install the sync service on the device with `install-model-sync.sh`, described on [Processor](processor.md).

Each sync:

1. reads `GET /v1/models/devices/{id}/desired`;
2. checks there is room for every missing checkpoint plus 64 MiB;
3. downloads missing checkpoints to partial files and checks size and SHA-256;
4. checks each checkpoint's class map and task against its card, and runs one inference on a blank 64×64 image with the slot's settings;
5. reads the desired deployment again, and stops if it changed during the downloads;
6. replaces `active.json` in one step;
7. reports `POST /v1/models/devices/{id}/status`: `ready` with the active revision, or `error` with the code `model-sync-failed`.

A failed candidate leaves the working models and settings in place. A full disk never evicts active weights to make room. After a success, checkpoints that are no longer assigned and partial downloads are removed. Cleanup touches only directories that carry the `.skyvision-managed` marker, and only known file names.

```text
~/.local/share/skyvision/models/
  .skyvision-managed       ownership marker
  .lock                    held during inference, so models are not swapped mid-job
  active.json              versions, settings, source fingerprint, pipeline manifests
  artifacts/<sha256>.pt    only the checkpoints in the active deployment
```

**Models ready** on the website means every download passed the size, hash, class, task and test-inference checks. It says nothing about accuracy. The last-seen time is the device's last status report.

## Endpoints

| Endpoint | Key |
|---|---|
| `GET /v1/models` | `models:write` or Agent |
| `PUT /v1/models/chunks/{sha256}`, `POST /v1/models/artifacts`, `POST /v1/models` | `models:write` |
| `GET /v1/models/artifacts/{sha256}` | `models:write`, or `models:sync` for an assigned artifact |
| `GET /v1/models/devices/{id}/desired`, `POST /v1/models/devices/{id}/status` | `models:sync` for that device |
| `GET` and `POST /v1/models/devices`, `PUT /v1/models/devices/{id}/deployment` | An Agent key for every camera (the website's `/api/models/devices…`; see [API](api.md)) |

The full contract is in the [OpenAPI document](api.md).
