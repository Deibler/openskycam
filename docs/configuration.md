---
title: Configuration
description: Every setting in openskycam, where it lives, who reads it, and its default.
---

Settings live in six places. No deployment's hosts, account IDs or secrets are in the repository.

| Where | What | Read by |
|---|---|---|
| `.env` at the repository root | Camera, relay and Workers deployment values | `make deploy`, `make status`, `npm run config`, `camera_mcp.py` |
| `wrangler.deploy.json` beside each `wrangler.jsonc` | Generated from `wrangler.jsonc` plus your values; git-ignored | Every Wrangler command in that Worker folder |
| Worker secrets in Cloudflare | `INGEST_TOKEN`, `STORE_TOKEN` | The Workers |
| `~/.config/skyvision/` on the relay host | `relay.env`, `ingest.env` | The relay's systemd services |
| `~/.config/skyvision-store/` on the store host | `store.token`, `tunnel.token` | The store and `cloudflared` |
| Command-line flags and key files on the store and processor hosts | Ports, retention, API origin, credentials | The store, the processor, and its installers |

## Repository `.env`

Copy `.env.example` to `.env`. Three programs read it: bash (`make deploy`, `make status`), Node (`npm run config`), and `camera_mcp.py`. Keep comments on their own lines. Wrap a value in single quotes when it contains shell characters such as `&`.

### Camera

| Key | Default | Used by | Meaning |
|---|---|---|---|
| `CAMERA_IP_ADDRESS` | none | relay, camera MCP | The camera's address |
| `CAMERA_USERNAME`, `CAMERA_PASSWORD` | none | relay, camera MCP | Camera credentials, written as they are. The relay percent-encodes them in the RTSP URL |
| `CAMERA_RTSP_PORT` | `554` | relay | RTSP port |
| `CAMERA_RTSP_PATH` | `/cam/realmonitor?channel=1&subtype=0` | relay | Stream path after the port. The default is the Dahua main stream |
| `CAMERA_SCHEME` | `http` | camera MCP | `http` or `https`, for the camera's web API |
| `CAMERA_PORT` | `80`, or `443` with `https` | camera MCP | The camera's web API port |

### Relay

| Key | Default | Meaning |
|---|---|---|
| `CAM_ID` | `sky01` | Camera ID used in file names and object keys. Must be listed in `CAMERAS` |
| `INGEST_URL` | none, required | The ingest Worker's address, `https://skyvision-ingest.<your-subdomain>.workers.dev` |
| `INGEST_TOKEN` | none | The ingest Worker's token. `make status` sends it; `make deploy` does not copy it to the relay |
| `MIN_FREE_GB` | `20` | The relay never lets its disk drop below this many GB free |

### Workers deployment

| Key | Required by | Meaning |
|---|---|---|
| `SITE_HOST` | website | The website's custom domain, protected by Cloudflare Access |
| `API_HOST` | website | The API's custom domain, for API keys only |
| `ACCESS_TEAM_DOMAIN` | website | `https://<team>.cloudflareaccess.com` |
| `ACCESS_AUD` | website | The Access application's audience (AUD) tag |
| `CAMERAS` | both | Comma-separated camera IDs, for example `sky01,sky02` |
| `STORE_SERVICE_ID` | both | The Workers VPC service in front of the footage store's tunnel |
| `D1_DATABASE_ID` | optional | The `skyvision-catalog` database ID. Deploys and remote migrations find the database by name; `npm run dev` and `npm start` use remote bindings and need it |
| `DOCS_HOST` | docs site | The documentation site's custom domain. Only the project's own docs deployment uses it |

Variables already set in the environment win over `.env`. In Workers Builds, set these keys as build variables.

### Guided setup

[`npm run setup`](deploy.md#guided-setup) writes every key above except `CAMERA_SCHEME`, `CAMERA_PORT`, `MIN_FREE_GB` and `DOCS_HOST`, which keep their defaults, and these, which only it reads. They let it check and redo steps later.

| Key | Meaning |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | The account to use when your Cloudflare login has more than one |
| `STORE_HOST`, `RELAY_HOST`, `PROCESSOR_HOST` | SSH hosts of the footage store, relay and processor |
| `STORE_ROOT`, `STORE_SYSTEM_DISK` | The footage folder, and `yes` when it is on the system disk (`--system-disk`) |
| `STORE_TUNNEL_ID` | The footage store's Cloudflare Tunnel |
| `PROCESSOR_DEVICE` | The processor's registered device name |
| `OPENSKYCAM_AGENT_KEY` | An Agent key for every camera. The setup registers the processor with it; your scripts can use it too |

With `npm run setup -- --yes`, two secrets come from the environment instead of `.env`: `STORE_TUNNEL_TOKEN`, written only to the store host, and `OPENSKYCAM_WORKSHOP_KEY`, written only to the processor host.

## How `npm run config` fills `wrangler.jsonc`

The `wrangler.jsonc` files leave every deployment value out. [`package/shared/deploy-config.mjs`](https://github.com/Deibler/openskycam/blob/main/package/shared/deploy-config.mjs) fills them in. Every Wrangler script in `package/dashboard/` and `package/worker/` runs it first, and it writes the result to `wrangler.deploy.json`:

- A var set to `""` takes the environment variable of the same name. It is required.
- A `vpc_services` binding without `service_id` takes `<BINDING>_SERVICE_ID`, which for `STORE` is `STORE_SERVICE_ID`. It is required.
- A D1 binding without `database_id` takes `D1_DATABASE_ID` when it is set.
- `--domains SITE_HOST,API_HOST` makes each named variable's value a custom domain of the Worker. The values are required.

The rules apply to the top level and to every environment in the file. When values are missing, the command stops and names all of them at once. Deploying `wrangler.jsonc` directly fails before anything is uploaded, because Wrangler refuses a VPC binding without a `service_id`.

To add a new per-deployment value, add it to `wrangler.jsonc` as an empty string and document it in `.env.example`.

## Website and API Worker

`package/dashboard/wrangler.jsonc`, Worker `skyvision-dashboard`.

| Name | Kind | Meaning |
|---|---|---|
| `CAMERAS`, `API_HOST`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | var | From `.env`, as above |
| `INFERENCE_ENABLED` | var | `"true"` only in the `inference` environment. Continuous inference is off everywhere else |
| `STORE_TOKEN` | secret | The footage store's token |
| `DEV_VIEWER_EMAIL` | `.dev.vars` only | The signed-in email for local development. It has no effect on any host other than `localhost` |
| `CATALOG` | D1 | `skyvision-catalog`, migrations in `db/migrations/` |
| `API_KEYS` | D1 | The same database; its migrations are in `package/dashboard/db/migrations/`, tracked in `api_key_migrations` |
| `MODELS`, `WORKSHOP` | R2 | Buckets `skyvision-models` and `skyvision-workshop` |
| `STORE` | VPC service | The footage store |
| `RUN_SESSIONS` | Durable Object | Live progress for Workshop runs |
| `ASSETS` | static assets | The built website, `dist/` |

The Worker has no `workers.dev` address and no preview URLs. A cron trigger runs every minute: it starts scheduled Workshop runs, and every 15 minutes it also cleans up expired Workshop data.

Its Wrangler environments are used only for development:

| Environment | Command | What is local |
|---|---|---|
| `dev` | `npm start` (`npm run dev` at the root) | The Worker and API keys. The catalog, buckets and footage store are your real ones |
| `inference` | `npm run start:inference` | The catalog, keys, buckets and evidence. Only the footage store is real; inference is enabled |

## Ingest Worker

`package/worker/wrangler.jsonc`, Worker `skyvision-ingest`, served at `https://skyvision-ingest.<your-subdomain>.workers.dev`.

| Name | Kind | Meaning |
|---|---|---|
| `CAMERAS` | var | Cameras the relay may upload for |
| `INGEST_TOKEN` | secret | The bearer token the relay sends. Generate it with `openssl rand -hex 32` |
| `STORE_TOKEN` | secret | The footage store's token |
| `CATALOG` | D1 | `skyvision-catalog` |
| `STORE` | VPC service | The footage store |

Fixed in code ([`package/worker/src/utils/configStorageUtil.ts`](https://github.com/Deibler/openskycam/blob/main/package/worker/src/utils/configStorageUtil.ts), [`package/shared/src/utils/layoutStorageUtil.ts`](https://github.com/Deibler/openskycam/blob/main/package/shared/src/utils/layoutStorageUtil.ts)):

| Limit | Value |
|---|---|
| Largest segment | 95 MiB |
| Segment start ahead of the Worker's clock | at most 5 minutes |
| Catalog retention | 40 days |
| A camera counts as stale in `/v1/status` after | 3 minutes |

## Relay

`make deploy HOST=<relay-host>` runs [`external/relay/deploy.sh`](https://github.com/Deibler/openskycam/blob/main/external/relay/deploy.sh). It writes `~/.config/skyvision/relay.env` (mode 600) from `.env`, then restarts both services:

| Key in `relay.env` | Value |
|---|---|
| `CAM_ID` | From `.env`, default `sky01` |
| `CAMERA_RTSP_URL` | `rtsp://<user>:<password>@<address>:<port><path>`, with the user and password percent-encoded |
| `LIVE_DIR` | `/dev/shm/skyvision` (RAM) |
| `SPOOL_DIR` | `~/skyvision/spool` (disk), with `pending/` and `quarantine/` |
| `INGEST_URL` | From `.env` |
| `MIN_FREE_GB` | From `.env`, default `20` |

`~/.config/skyvision/ingest.env` holds `INGEST_TOKEN=<token>`. You write it once by hand, and deploys never overwrite it.

Fixed in the scripts:

| Setting | Value | Where |
|---|---|---|
| Segment length | 60 s, aligned to the clock minute | `record.sh` |
| RTSP transport and timeout | TCP, 15 s | `record.sh` |
| Finished segments kept in RAM | 3 | `upload.sh` (`RAM_BACKLOG`) |
| Uploads at once | 3 | `upload.sh` (`PARALLEL`) |
| Pause before retrying | 10 s | `upload.sh` |
| Upload connect and total timeout | 10 s and 600 s | `upload.sh` |
| Recorder restart | after 2 s, backing off to 10 s | `skyvision-record.service` |
| Uploader restart and priority | after 10 s, `Nice=10` | `skyvision-upload.service` |

## Footage store

`external/store/deploy.sh <ssh-host> <footage-root>` installs the store with these flags. To change one, edit the deploy script or run the server by hand:

```sh
python3 -m skyvision_store --root <footage-root> --token-file ~/.config/skyvision-store/store.token
```

| Flag | Default | Meaning |
|---|---|---|
| `--root` | required | The footage disk. Uploads answer `503` while it is not a mount point, unless `--system-disk` is set |
| `--system-disk` | off | The root is a folder on the system disk: skip the mount check. `--min-free-gb` still stops writes before the disk fills |
| `--token-file` | required | A file holding the bearer token, at least 32 characters |
| `--host` | `127.0.0.1` | Listen address |
| `--port` | `8096` | Listen port. The VPC service must point at the same port |
| `--retention-days` | `41` | Delete date folders older than this. Keep it above the catalog's 40 days |
| `--min-free-gb` | `100` | Refuse uploads (`507`) and prune the oldest hours below this much free space |
| `--prune-every-s` | `600` | How often the janitor runs |

| File in `~/.config/skyvision-store/` | Meaning |
|---|---|
| `store.token` | Created by the first deploy with `openssl rand -hex 32`. Both Workers hold it as `STORE_TOKEN` |
| `tunnel.token` | The Cloudflare Tunnel's token. Write it yourself before the first deploy, mode 600 |

## Processor

Run from the processor folder as `.venv/bin/python -m skyvision_processor <command>`. `--base-url` is the API origin, such as `https://<api-host>`. It must be HTTPS, except `http://localhost`, `127.0.0.1` or `::1` for local development. A `--key-file` must be readable only by its owner (mode 600). Without one, each command reads its key from an environment variable.

| Command | Flags | Key variable | What it does |
|---|---|---|---|
| `workshop-manifest` | `--device` | none | Prints `{device_id, code_sha256}` to register as a runtime |
| `workshop-run` | `--base-url`, `--key-file`, `--runtime`, `--watch` | `SKYVISION_WORKSHOP_KEY` | Runs Workshop jobs for one registered runtime; `--watch` keeps polling |
| `publish-model` | `--base-url`, `--key-file`, `--metadata`, `--artifact` (repeat for each file) | `SKYVISION_API_KEY` | Publishes a model version |
| `train` | `--base-url`, `--key-file`, `--metadata`, `--train-config` | `SKYVISION_API_KEY` | Trains with Ultralytics, then publishes the result when training ends |
| `sync-models` | `--base-url`, `--key-file`, `--device`, `--runtime-dir` | `SKYVISION_API_KEY` | Downloads the models assigned to a device |
| `run-deployed` | `--base-url`, `--key-file`, `--runtime-dir`, `--slot` (`detector`), `--camera` (`sky01`) | `SKYVISION_PROCESSOR_KEY` | Runs one job of the continuous-inference preview with the model synced to this device |
| `manifest` | `--weights`, `--config` | none | Prints a pipeline manifest for the continuous-inference preview |
| `run` | `--weights`, `--base-url`, `--camera` (`sky01`), `--key-file` | `SKYVISION_PROCESSOR_KEY` | Processes one job of the continuous-inference preview and exits |

`--runtime-dir` defaults to `~/.local/share/skyvision/models`.

The installers take absolute paths and install a service that survives reboots:

```sh
./install-workshop.sh /absolute/python /absolute/key-file workshop-<runtime-id> https://<api-host> [dependency-directory]
./install-model-sync.sh /absolute/python <device-id> /absolute/key-file https://<api-host> [runtime-directory]
```

| Installer | macOS | Linux |
|---|---|---|
| `install-workshop.sh` | launchd agent `org.openskycam.workshop`, `Nice` 10 | systemd user service `skyvision-workshop`, `Restart=always`, `Nice=10` |
| `install-model-sync.sh` | launchd agent `org.openskycam.models.<device>`, every 60 s | systemd user timer `skyvision-models-<device>.timer`, every 60 s |

Both installers check their arguments before writing anything. The runtime ID must look like `workshop-` followed by 32 hex characters, the origin must be HTTPS with no path, and the key file must be mode 600. `install-workshop.sh` also checks that the Python imports `av`, `cv2`, `torch` and `ultralytics`. `install-model-sync.sh` runs one sync first, to prove the interpreter, key and assignment work. The optional dependency directory is added to `PYTHONPATH`. On Linux, each installer stops with an error if systemd cannot load the unit it wrote. Run `loginctl enable-linger $USER` once so the services keep running after you log out.
