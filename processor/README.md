# Processor

The Python program that runs detection models for openskycam. It runs on a machine you own, asks the API for work over HTTPS, decodes recordings, runs YOLO models, links detections into tracks, and uploads the results. It never listens for connections.

It needs macOS or Linux with Python 3.11 or later. With `device: auto` it uses an NVIDIA GPU (CUDA) when there is one, then Apple Silicon (MPS), then the CPU.

```sh
cd processor
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m skyvision_processor --help
```

`install-workshop.sh` installs the Workshop runner and `install-model-sync.sh` installs model sync, as launchd agents on macOS or systemd user services on Linux. Both take your API origin and a mode-600 key file.

| Read | For |
|---|---|
| [Processor](../docs/processor.md) | Installing the runner, registering a runtime, how a job runs, throughput and every command |
| [Models](../docs/models.md) | The model registry, publishing a trained model, and model sync |
| [Tracking and trajectories](../docs/workshop/tracking.md) | How detections become tracks |
| [Architecture](../docs/develop/architecture.md#the-processor) | The code layout and its checks |

Run the tests with `make processor-check` from the repository root. On macOS, PyAV and OpenCV can print duplicate AVFoundation class warnings; decoding still completes.
