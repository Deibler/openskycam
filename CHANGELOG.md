# Changelog

Notable changes to openskycam. Versions follow [semantic versioning](https://semver.org); before 1.0, a minor version can change how a deployment is set up.

## 0.1.0 · 2026-10-25

The first public release.

- **Recording.** A relay copies an RTSP camera's H.264 or H.265 stream into 60-second MP4 files without re-encoding and uploads them. The ingest Worker checks each file and stores it on a footage store on your own disk, reached through a Cloudflare Tunnel, and the D1 catalog lists it. Footage is kept for 40 days.
- **Website and API.** Browse a day of footage, scrub and download original files, and see recording health, all behind Cloudflare Access. Every website action is also a key-authenticated API call under `/v1`, described by `/openapi.json`.
- **Workshop.** Workflows sample frames from footage or labeled images, run one to four detection models, and route each frame to buckets by class, score, count, time of day or motion. Runs can be tested, followed live and scheduled. Review results, correct boxes and freeze dataset versions.
- **Tracking.** Detections are linked across a recording into tracks that are moving, stationary or brief, so a workflow can keep moving aircraft and set stars and fixed lights aside.
- **Processor.** Runs Workshop jobs on macOS (Apple GPU) or Linux (NVIDIA GPU) or on the CPU, publishes trained models, and keeps a device's models in sync.
- **Agents.** An MCP server gives AI agents seven tools that cover the website, with guides and skills that teach them how to use them.
- **Setup.** A one-line installer and `npm run setup`, which runs every deploy step and checks it. `--check` checks a running deployment, and `--yes` runs without questions for agents and scripts.
- **Night detector.** A YOLO26s model for planes and meteors at night, ready to publish to your registry, and a notebook to train your own.
