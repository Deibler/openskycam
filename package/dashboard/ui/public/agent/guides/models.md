# Models

`models list` gives each registered model's `model_key` (`family/version`), task, and class names. `workflow_ready: true` means a workflow's model step can use it. When it is false, `issue` says why, for example that the model needs tiling or crops, which this runner does not do.

`models get` with a `model_key` returns the full manifest: description, input size, evaluations, caveats, and artifacts. Read evaluations and caveats before recommending a model.

A model step's `score` is the minimum confidence to keep a detection. Lower it to find faint objects, at the cost of more false positives. Test runs show the trade-off quickly.

## Devices

Edge devices (for example a Raspberry Pi) run models on their own.

- `models devices` lists devices, their current deployment, and its `revision`.
- `models register_device` adds a device by ID.
- `models deploy` sets a device's models. Pass `device_id`, `previous_revision` (the current revision, or null), and `models`: `[{slot, family, version, sha256, parameters: {imgsz, confidence, iou, device}}]`. `sha256` is the `.pt` artifact from `models get`. `imgsz` is a multiple of 32, and `device` is `auto`, `cpu`, or `mps`. An empty list unloads everything.

Deploying changes a real device. Do it only when the user asks.
