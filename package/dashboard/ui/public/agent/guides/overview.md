# openskycam: start here

openskycam stores a sky camera's video and turns it into labeled images.

- **Footage**: 60-second MP4 (HEVC) recordings, uploaded continuously, kept 40 days.
- **Workshop workflows** sample frames from a footage window, run detection or classification models on them, route frames with conditions, and save the kept frames with their detections into **buckets**.
- **Runs** execute a workflow on the processor. A **test** run processes a few frames into temporary previews. A full run saves into the output buckets.
- **Schedules** start workflows automatically: at set times, when new footage arrives, or after another workflow.
- **Datasets**: a bucket's accepted images can be frozen into a versioned train/validation/test manifest.

## Tools

| Tool | Actions |
| --- | --- |
| guide | Index, or one guide or skill by topic |
| footage | cameras, days, list, download, photo |
| workflows | list, get, check, create, update, delete |
| runs | list, test, start, status, watch, cancel, schedules, runtimes, register_runtime |
| images | search, view, review, save, link |
| buckets | list, create, update, delete, versions, create_version, export_version |
| models | list, get, devices, register_device, deploy |

Every tool takes an `action` plus that action's arguments. Results are JSON. Many include `next`, the usual next call.

## Conventions

- **Times are UTC**, ISO 8601: `2026-09-24T13:05:30Z`. Footage settings use `HH:MM:SS` UTC.
- **IDs** come from list and get results. Never guess one. Workflow steps may use readable IDs like `detect`.
- **Revisions**: the Workshop (workflows and buckets) is one document with a revision number. `update` and `delete` require the revision you last read. If the website saved in between, you get a conflict: read again, reapply your change, and retry. After an agent edit, an open website tab shows "Workshop changed in another window" until it reloads.
- **Deletes are two-step.** Without `confirm` you get a preview of what would be lost. Delete only what the user asked for, and tell them what the preview says.
- **Download links** (footage download, images link, full-size photos, dataset manifests) work without a key for one hour. Treat them like passwords: give them to the user or use them yourself, and never post them anywhere public.

## What this key can and cannot do

An Agent key acts for its owner on its cameras: footage, photos, every Workshop workflow, bucket, and run, models, and devices. It cannot create, rotate, or revoke API keys, and it cannot sign in to the website. The owner can revoke it at any time under API access, which also ends every link it made. Each tool call is logged with the key ID.

## Where to go next

- Building or changing a workflow: guide `workflows`, then skill `build-a-workflow`.
- Looking for detections: guide `images`, skill `find-detections`.
- Photos or video: guide `footage`, skills `take-photos` and `download-footage`.
- Always finish with skill `verify-changes`.
