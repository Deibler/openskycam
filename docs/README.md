---
title: Intro
sidebar: Intro
description: openskycam records a sky camera around the clock, keeps the footage on your own disk, and finds what flew past.
---

openskycam keeps every frame your sky camera encodes: a relay copies the stream into 60-second MP4 files without re-encoding. The files live on a disk you own. Cloudflare Workers catalog them, serve a website and an API, and hand frames to a processor that runs detection models. Packages and cloud resources keep the project's first name, SkyVision (`skyvision-dashboard`, `skyvision_processor`, the `skyvision-catalog` database).

![A meteor in the review view: the detection model labeled it Meteorite, and a reviewer confirms or corrects the label](images/review.jpg)

```
IP camera ──RTSP──▶ relay ──HTTPS PUT──▶ ingest Worker ──Tunnel──▶ footage store
 H.264 or H.265     Linux host,          checks, names,              your disk,
                    60 s MP4s            catalogs in D1              rolling 40 days

website + API Worker ◀── Cloudflare Access (people), API keys (scripts, agents)
        │
        └── jobs over HTTPS ──▶ processor: decodes frames, runs YOLO models, tracks motion
                                (macOS with Apple GPU, Linux with NVIDIA GPU, or CPU)
```

## What you can do with it

- **Browse and download footage.** Pick a day, scrub through hours, skip by 1 to 30 seconds, loop a few seconds, zoom into the 4K frame, and download the original file. Footage stays for 40 days.
- **Find things in it.** A Workshop workflow samples frames from a time window, runs one to four detection or classification models, and routes each frame to a bucket by class, score, count, time of day, or motion. Workflows can run on a schedule, for example every night.
- **Tell planes from stars.** Boxes from the same object are linked across a recording into a track. Each track is moving, stationary, or brief, so a workflow can keep moving planes and set fixed lights aside.
- **Build training data.** Review detections, accept or reject them, correct their boxes, and freeze a dataset version. A version records its images, labels, tracks, classes, and splits, and a script can download it.
- **Script all of it.** Everything the website does is also an API call under `/v1`. AI agents can connect to the MCP server, which offers the same actions.

## What it is made of

| Part | Runs on | Code |
|---|---|---|
| Relay | A Linux host near the camera, such as a Raspberry Pi | `external/relay/` |
| Ingest Worker | Cloudflare | `package/worker/` |
| Footage store | A macOS or Linux host with a large disk | `external/store/` |
| Website and API Worker | Cloudflare | `package/dashboard/` |
| Processor | A macOS or Linux host, GPU optional | `processor/` |
| Catalog schema | Cloudflare D1 | `db/migrations/` |

The store and the processor can be the same machine. Nothing in Cloudflare holds footage: the Workers reach the store through a Cloudflare Tunnel.

## Where to go next

- [How it works](how-it-works.md)\
  The path of a recording, and of a workflow run, including what happens when a part is down.
- [Requirements](requirements.md)\
  Cameras, hosts, disk sizing, and the Cloudflare account.
- [Deploy your own](deploy.md)\
  Every step from a clone to video arriving.
- [Configuration](configuration.md)\
  Every setting and its default.
- [Workflows](workshop/workflows.md)\
  Sample frames, run detection models, and sort what they find into buckets.
- [API](api.md)\
  Keys, scopes, and the /v1 API that does everything the website does.
