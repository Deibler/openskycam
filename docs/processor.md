---
title: Processor
description: The Python process that decodes recordings, runs detection models and uploads results for Workshop runs.
---

The processor is a Python program (`processor/skyvision_processor/`) that runs on a machine you own. It polls the API for queued Workshop jobs, downloads each recording or image, decodes frames, runs the run's models, tracks objects across frames, and uploads the frames that reach an output bucket. It makes outbound HTTPS requests only and has no listener, so it can run behind NAT.

The same package also publishes trained models, keeps a device's assigned models in sync, and contains the older continuous-inference runner, described at the [end of this page](#continuous-inference-preview).

## Requirements

| | |
|---|---|
| OS | macOS (launchd) or Linux (systemd user services). Other platforms are refused by the installers. |
| Python | 3.11 or later (`requires-python` in `processor/pyproject.toml`). |
| GPU | Optional. NVIDIA (CUDA), Apple Silicon (MPS), or CPU. |
| Key | A **Run Workshop jobs** key (`workshop:run`) scoped to one registered device and its cameras. |

Runtime dependencies are pinned in `processor/requirements.txt` and in the `runtime` extra of `pyproject.toml`:

```text
av==16.1.0
torch==2.13.0
torchvision==0.28.0
ultralytics==8.4.58
numpy==2.4.3
scipy==1.17.1
opencv-python==4.13.0.92
```

These versions are verified on an Apple Silicon Mac. On Linux, the PyPI `torch` wheel includes CUDA support. The publishing and sync commands need only the standard library; install the extra only where inference runs.

```sh
cd processor
python3 -m venv .venv
.venv/bin/pip install '.[runtime]'        # or: .venv/bin/pip install -r requirements.txt
```

## Devices

With the default `auto` device, the processor picks the first available of:

1. `cuda` (NVIDIA GPU)
2. `mps` (Apple Silicon)
3. `cpu`

GPUs run the model in half precision (`half=True`); the CPU runs full precision. After a model is swapped out, the processor frees cached GPU memory on whichever backend is present. The choice is in [`deviceInferenceUtil.py`](https://github.com/Deibler/openskycam/blob/main/processor/skyvision_processor/utils/deviceInferenceUtil.py). Workshop jobs always use `auto`. Model deployments to a device can pin `cpu`, `mps` or `cuda` (see [Models](models.md)).

## Install the Workshop runner

1. In the website, open **Models → Devices** and register a device ID, for example `gpu-box`. IDs are 1–64 lowercase letters, digits, dots, underscores or hyphens.
2. Create a **Run Workshop jobs** key for that device under **API access**. Save the secret in a file readable only by you (`chmod 600`).
3. Deploy the processor source to its own directory per version, for example `~/skyvision-workshop-<commit>/`, and create its virtual environment there.
4. Generate the code fingerprint and register a runtime (see [Runtimes](#runtimes)). You get an ID like `workshop-` followed by 32 hex characters.
5. Install the service from the deployed `processor/` directory:

```sh
./install-workshop.sh /absolute/path/.venv/bin/python /private/workshop.key \
  workshop-<runtime-hash> https://<api-host> [/optional/dependency-directory]
```

| Argument | Meaning |
|---|---|
| 1. Python | Absolute path of the interpreter. A virtual environment's interpreter is used as given, not resolved. It must import `av`, `cv2`, `torch` and `ultralytics`, or the installer stops. |
| 2. Key file | Must exist with mode 600, or the installer stops. |
| 3. Runtime ID | Must match `workshop-[a-f0-9]{32}`. |
| 4. API origin | Must be HTTPS, with no path: `https://<api-host>`. |
| 5. Dependency directory | Optional. Added to `PYTHONPATH` after the source directory. |

The service runs `python -m skyvision_processor workshop-run --base-url <origin> --key-file <key> --runtime <id> --watch`.

| Host | Installs | Status | Stop |
|---|---|---|---|
| macOS | `~/Library/LaunchAgents/org.openskycam.workshop.plist`: `KeepAlive`, `Nice` 10, low-priority I/O, standard process type | `launchctl print gui/$(id -u)/org.openskycam.workshop` | `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/org.openskycam.workshop.plist` |
| Linux | `~/.config/systemd/user/skyvision-workshop.service`: `Restart=always`, `RestartSec=30`, `Nice=10`, best-effort I/O priority 7 | `systemctl --user status skyvision-workshop` | `systemctl --user disable --now skyvision-workshop` |

On Linux, run `loginctl enable-linger $USER` once so the service runs without a login session. If systemd cannot load the unit the installer wrote, the installer stops with an error before enabling it; `systemctl --user status skyvision-workshop` shows why. On macOS the agent runs at standard priority on purpose. Background priority confines it to efficiency cores, where decoding measured 4.8 times slower on a Mac mini.

Both services discard standard output and error. To see what the runner does, stop the service and run one job in the foreground:

```sh
.venv/bin/python -m skyvision_processor workshop-run \
  --base-url https://<api-host> --key-file /private/workshop.key --runtime workshop-<runtime-hash>
```

Without `--watch` it claims at most one job, prints one JSON result, and exits. `{"status": "idle"}` means nothing was queued for this runtime. Without `--key-file`, the key is read from `SKYVISION_WORKSHOP_KEY`.

The website's Workshop page and the MCP `runs runtimes` action show when each runtime last checked in. A runtime checks in every time it asks for work.

## Runtimes

A runtime is an immutable record that ties a device to one exact version of the processor's Python source. A run is bound to one runtime when it is created, and only a processor presenting that runtime's fingerprint can claim its jobs.

The fingerprint is a SHA-256 over every `.py` file under `skyvision_processor/`, path and contents, in sorted order. Third-party packages are not part of it. Print it with:

```sh
.venv/bin/python -m skyvision_processor workshop-manifest --device gpu-box
# {"device_id": "gpu-box", "code_sha256": "…"}
```

Register it with `POST /v1/workshop/runtimes {"device_id": …, "code_sha256": …}` using an Agent key for every camera, or with the MCP `runs register_runtime` action. The website uses `POST /api/workshop/runtimes`. Registration requires the device to exist. The runtime ID is derived from the manifest (`workshop-` plus the first 32 hex characters of its SHA-256), so registering the same source twice returns the same runtime.

Each runtime records an engine. The engine decides which workflows it can run:

| Engine | Capabilities |
|---|---|
| `workshop-v2` | test runs, live progress |
| `workshop-v3` | test runs, live progress, tracking (frames kept by change, motion conditions) |

New registrations record `workshop-v3`. A test run on a runtime without `test-runs` is refused, as is a workflow that keeps frames by change or routes on motion on a runtime without `tracking`.

**Any change to a `.py` file changes the fingerprint.** The old runtime then refuses to hand jobs to the new code ("Register this immutable runtime before claiming work."), and the processor refuses a job whose snapshot names a different fingerprint.

To upgrade:

1. Deploy the new source to a new directory (`~/skyvision-workshop-<new-commit>/`).
2. Print its fingerprint and register a new runtime.
3. Rerun `install-workshop.sh` from the new directory with the new runtime ID. The installer replaces the service definition and restarts it.

If `npm run setup` installed the processor, update your clone (`git pull`) and run `npm run setup -- processor` instead. It copies the new source to `~/openskycam-processor/<commit>/`, registers its runtime and reinstalls the service.

Runs already created stay bound to the runtime they were created with. To roll back, rerun `install-workshop.sh` from the previous directory with the previous runtime ID; runtime records are never deleted.

## How a job runs

A Workshop run is split into jobs: one per recording, or one per image for runs over a labeled bucket. The processor drives each job through the `/v1/workshop/...` endpoints with its `workshop:run` key. Every request after the claim carries the job's lease generation and lease token (`X-Lease-Generation`, `X-Lease-Token` headers or body fields).

1. **Claim.** `POST /v1/workshop/claim {runtime_id, code_sha256}` returns the oldest queued job for that runtime and the key's cameras, or `{"job": null}`. It returns the job together with its input (recording or image, size and SHA-256) and the run's frozen snapshot (workflow, models, sampling). Photo jobs go first, and jobs from other workflows wait until the earliest unfinished workflow run is done, so one workflow runs at a time.
2. **Lease.** A claim leases the job for 5 minutes and increments its generation. A background thread renews it every 45 seconds (`POST …/jobs/{id}/heartbeat`). A job whose lease runs out goes back to the queue and is claimed again with a new generation. After its third lease expires it fails with `attempts_exhausted`. A stale attempt cannot publish: every write checks the generation and token, and returns 409 "The lease is no longer valid. Discard this attempt." The processor stops the job as soon as a renewal fails.
3. **Input.** `GET …/jobs/{id}/input` streams the original recording from the footage store, or the image. The download goes to a temporary directory and must match the pinned SHA-256 and size.
4. **Models.** `GET …/jobs/{id}/models/{sha256}` downloads a model's `.pt` file. The server allows only models the leased run uses. Files are cached by checksum, in `~/Library/Caches/openskycam-workshop/` on macOS or `$XDG_CACHE_HOME/openskycam-workshop/` (default `~/.cache/…`) on Linux. Before use, the checkpoint's class map and task must match the registry. One model stays loaded between jobs.
5. **Frames.** The processor samples frames (see [Workflows](workshop/workflows.md)), runs the workflow graph on each, and tracks boxes across the recording (see [Tracking](workshop/tracking.md)). `POST …/jobs/{id}/progress` reports the phase (`downloading`, `loading_model`, `processing`, `uploading`, `finalizing`), and each finished frame for the website's live view.
6. **Upload.** Each kept frame is uploaded as `PUT …/jobs/{id}/images/{sha256}` (a JPEG of at most 8 MiB; the server checks the JPEG markers and the checksum).
7. **Complete or fail.** `POST …/jobs/{id}/complete` sends the fingerprint, the sample count, slots the recorder skipped (`empty_slots`), and every frame's labels and tracks. Repeating the same result is accepted. On any error the processor sends `POST …/jobs/{id}/fail` with `processor_failed`; the other accepted codes are `download_failed`, `decode_failed` and `model_failed`.

The temporary directory is removed after every job, whether it succeeded or failed.

## Throughput and memory

In `--watch` mode, three worker threads keep three recordings in flight. Each idle thread polls every 15 seconds, the same claim rate as one runner polling every 5 seconds. A failed request waits 10 seconds. Downloads, decoding and API calls overlap, but:

- A lock allows one model pass at a time, because Ultralytics predictors are not thread-safe and only one model is resident.
- A semaphore allows one recording's decoded frames in memory at a time. A recording's 4K samples take about 1.5 GB.
- The model is called with batches of 2 images.

These limits come from measurements on a 16 GB Mac mini:

| Measurement | Result |
|---|---|
| A 1920-input YOLO26s model | 55 ms per frame at batch sizes of 2, 4 and 8 |
| GPU memory, same model, batch 8 | 2.09 GB |
| GPU memory, same model, batch 2 | 1.09 GB |
| Three recordings decoded at once with that model | 7.9 GB footprint, which swapped the machine while other work ran |
| One recording at a time | 4.3 GB peak, 3.2 GB idle |

One recording at a time keeps up with a night of footage, at about 15 seconds per 60-second recording. To trade memory for speed, change `_frames` and `BATCH` in [`workshopInferenceService.py`](https://github.com/Deibler/openskycam/blob/main/processor/skyvision_processor/service/workshopInferenceService.py). Changing the source changes the fingerprint, so register a new runtime afterwards.

## Model sync

`install-model-sync.sh` keeps a device's assigned models on disk for the continuous-inference runner. Workshop jobs do not need it, because they download their models per run. See [Models](models.md).

```sh
./install-model-sync.sh /absolute/path/.venv/bin/python gpu-box /private/model-sync.key https://<api-host> [runtime-directory]
```

It runs one sync first and installs nothing if that fails. It then runs `sync-models` every 60 seconds: a launchd agent `org.openskycam.models.<device>` on macOS, or `skyvision-models-<device>.service` with a `.timer` on Linux. The default runtime directory is `~/.local/share/skyvision/models/`.

## Continuous inference (preview)

An older pipeline processes every new recording automatically with a fixed baseline detector: YOLO at 1280, sampled at 4 fps, with a Kalman/Hungarian tracker. It is a local integration preview:

- Production keeps it disabled. It runs only when the Worker has `INFERENCE_ENABLED=true`, which only the local `inference` environment sets (`npm run start:inference`).
- It uses its own scope, **Run inference** (`processor:run`), restricted to one registered pipeline and its cameras.
- `python -m skyvision_processor manifest --weights … --config baseline.json` prints an immutable pipeline manifest. `processor/register.py` turns it into registration SQL.
- `run --weights … --base-url … --camera …` processes one job and exits. Its lease is 5 minutes, renewed every minute.
- `run-deployed` does the same with the device's synced models.

It is not ready for production use: each recording is processed on its own, so an object that crosses from one file into the next is counted twice; its results are not deleted when their recordings expire; and the website has no view of them.

## Commands

| Command | Purpose | Key |
|---|---|---|
| `workshop-manifest --device <id>` | Print the code fingerprint to register | none |
| `workshop-run --base-url … --runtime … [--watch]` | Run Workshop jobs | `workshop:run`, `--key-file` or `SKYVISION_WORKSHOP_KEY` |
| `publish-model`, `train` | Publish a model version | `models:write`, `--key-file` or `SKYVISION_API_KEY` |
| `sync-models --device …` | Download a device's assigned models | `models:sync`, `--key-file` or `SKYVISION_API_KEY` |
| `manifest`, `run`, `run-deployed` | Continuous-inference preview | `manifest`: none; `run`, `run-deployed`: `processor:run`, `--key-file` or `SKYVISION_PROCESSOR_KEY` |

Every command that calls the API requires `--base-url`, an origin with no path. HTTPS is required, except plain HTTP to `localhost`, `127.0.0.1` or `::1`. The client never follows redirects and never sends the key to another origin. Key files must have mode 600.
