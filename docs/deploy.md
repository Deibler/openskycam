---
title: Deploy your own
sidebar: Deploy your own
description: Every step from a fresh clone to video arriving on your own website, with a check after each one.
---

This page sets up a complete deployment: the Cloudflare resources, the footage store, both Workers, the relay, and optionally a processor. Do the steps in order; each one ends with a check. It takes about an hour, most of it in the Cloudflare dashboard.

Before you start, read [Requirements](requirements.md). You need SSH access to each host, a domain on Cloudflare, and the camera's address and credentials.

Commands run from the repository root unless a step says otherwise. Hosts are placeholders: `<store-host>`, `<relay-host>`, `<processor-host>`.

## Guided setup

The guided setup runs the steps on this page for you:

```sh
curl -fsSL https://raw.githubusercontent.com/Deibler/openskycam/main/setup/install.sh | bash
```

The installer checks for Git, Node.js 24, Python 3 and SSH, downloads openskycam to `~/openskycam` (or `OPENSKYCAM_DIR`), installs its dependencies and starts `npm run setup`. In a clone you already have, run `npm install && npm run setup`.

The setup does each step a command can do: it signs in to Cloudflare, creates the database, buckets and VPC service, installs the footage store and the relay over SSH, deploys both Workers with their secrets, and checks the camera's stream before recording it. Some steps happen only in a browser: creating the tunnel and the Access application in the Cloudflare dashboard, and keys on your website. For those it says what to click, opens the page, and checks what you paste. It saves every answer to `.env` and ends each step with the check this page describes, so a step either works or tells you why not.

| Command | What it does |
|---|---|
| `npm run setup` | Sets up everything that is not working yet. Steps that pass their check are skipped. |
| `npm run setup -- relay` | Runs one step again, for example after changing the camera: `cloudflare`, `hosts`, `storage`, `store`, `access`, `website`, `ingest`, `relay` or `processor`. |
| `npm run setup -- --check` | Checks every step of a running deployment and changes nothing. It exits with 1 if a required step fails. |
| `npm run setup -- --yes` | Asks nothing: takes every answer from `.env` and stops, naming the key, at the first missing one. For coding agents and scripts ([Run it with an agent](agents.md#set-it-up-with-a-coding-agent)). |

The setup needs key-based SSH login to each host (`ssh-copy-id <host>`). On Linux hosts it offers to run `loginctl enable-linger` and to install missing packages with `sudo`, which ask for your password there.

The steps below are what the setup runs, for doing it by hand.

## 1. Clone and check

```sh
git clone https://github.com/Deibler/openskycam.git
cd openskycam
cp .env.example .env
npm install            # installs both Workers from their lockfiles
make check             # every test and lint CI runs; needs no Cloudflare account
```

`.env` is git-ignored. You fill it in as you go; [Configuration](configuration.md) explains every key.

## 2. Sign in to Cloudflare

```sh
npm run wrangler -- login
```

`npm run wrangler` runs the Workers' own copy of Wrangler from the repository root. Inside `package/dashboard/` or `package/worker/`, Wrangler refuses `wrangler.jsonc` until your values are filled in, because that file leaves them empty on purpose (see [step 6](#6-fill-in-env)).

## 3. Create the database and buckets

```sh
npm run wrangler -- d1 create skyvision-catalog
npm run wrangler -- r2 bucket create skyvision-models
npm run wrangler -- r2 bucket create skyvision-workshop
```

Both Workers share the `skyvision-catalog` database and find it by name. If `d1 create` offers to add a binding to a configuration file, decline. The command prints the database ID: keep it for `D1_DATABASE_ID`, which only local development against your real catalog needs.

Check: `npm run wrangler -- d1 list` and `npm run wrangler -- r2 bucket list` show all three.

## 4. Set up the footage store

The store is a small HTTP server on the host with the big disk. It listens on `127.0.0.1:8096` only; the Workers reach it through a Cloudflare Tunnel. See [Footage store](capture/store.md).

1. **Prepare the host.** Install Python 3.10 or later, [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) and `openssl`. Mount the footage disk. The footage root should be a mount point, such as `/mnt/footage`: the store refuses uploads while it is not mounted. For a folder on the system disk, add `--system-disk` to the install command below. For thumbnails, install Pillow for that `python3` (`python3 -m pip install --user pillow`, or the `python3-pil` package).

2. **Create a tunnel.** In the Cloudflare dashboard, open Zero Trust → Networks → Tunnels and create a Cloudflared tunnel. It needs no public hostname. Copy its token and its tunnel ID.

3. **Put the tunnel token on the host**, readable only by you. Paste the token, then press Ctrl-D:

   ```sh
   ssh <store-host> 'mkdir -p ~/.config/skyvision-store && umask 077 && cat > ~/.config/skyvision-store/tunnel.token'
   ```

4. **Install the store and the tunnel.** This copies the server, creates `~/.config/skyvision-store/store.token` on the first run, and starts both as services: launchd agents on macOS, systemd user services on Linux.

   ```sh
   external/store/deploy.sh <store-host> <footage-root>      # for example: me@store-host /mnt/footage
   ```

   On Linux, also run `loginctl enable-linger $USER` on the store host once, so the services run without a login.

5. **Create the VPC service** that the Workers bind to as `STORE`. The ID it prints is `STORE_SERVICE_ID`.

   ```sh
   npm run wrangler -- vpc service create skyvision-store --type http --tunnel-id <tunnel-id> --ipv4 127.0.0.1 --http-port 8096
   ```

Check: the tunnel shows as healthy under Zero Trust → Networks → Tunnels. On the store host, the log shows `serving <footage-root> on 127.0.0.1:8096`. That log is `~/Library/Logs/org.openskycam.store.log` on macOS, or `journalctl --user-unit=skyvision-store` on Linux.

## 5. Protect the website with Access

1. In Zero Trust → Access → Applications, add a **self-hosted** application for your website hostname (`SITE_HOST`). Give it a policy that allows your email addresses; that policy decides who can sign in.
2. Copy the application's **Application Audience (AUD) tag**: it is `ACCESS_AUD`. Your team domain, `https://<team>.cloudflareaccess.com`, is `ACCESS_TEAM_DOMAIN`.
3. Leave the API hostname (`API_HOST`) out of any Access application. It serves only the key-authenticated API and `/openapi.json`, and the Worker refuses website routes there.
4. Give `API_HOST` a configuration rule with Browser Integrity Check off (`bic: false`, scoped to `http.host eq "<api-host>"`). Otherwise Cloudflare answers standard Python HTTP clients with error 1010 before the Worker sees their key. Keys and Access still apply.

The Worker verifies every Access token itself, against `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`, so a request that bypasses Access is refused.

## 6. Fill in `.env`

Add the deployment values to `.env`:

```sh
SITE_HOST=sky.example.com
API_HOST=api.sky.example.com
ACCESS_TEAM_DOMAIN=https://<team>.cloudflareaccess.com
ACCESS_AUD=<application-audience-tag>
CAMERAS=sky01
STORE_SERVICE_ID=<vpc-service-id>
D1_DATABASE_ID=<optional, from step 3>
```

`CAMERAS` lists the camera IDs the relay may upload for, separated by commas. Each relay's `CAM_ID` must be one of them. Every Wrangler script in the Worker folders first runs `npm run config`, which writes these values into a git-ignored `wrangler.deploy.json`. A missing value stops the command and names the variable.

## 7. Deploy the website and API

```sh
cd package/dashboard
npm run release
ssh <store-host> cat .config/skyvision-store/store.token | npx wrangler secret put STORE_TOKEN --config wrangler.deploy.json
cd ../..
```

`npm run release` applies the catalog and API-key migrations to D1, builds the website, and deploys the Worker with `SITE_HOST` and `API_HOST` as custom domains. The second command pipes the store token straight into a Worker secret, so it is never displayed.

Check:

- `https://<site-host>` asks you to sign in through Access, then shows the website. It has no recordings yet.
- `curl -i https://<api-host>/v1/me` answers `401` with a JSON error.
- `https://<api-host>/openapi.json` loads.

## 8. Deploy the ingest Worker

```sh
cd package/worker
npm run deploy
openssl rand -hex 32          # the relay's token: save it as INGEST_TOKEN in .env
npx wrangler secret put INGEST_TOKEN --config wrangler.deploy.json
ssh <store-host> cat .config/skyvision-store/store.token | npx wrangler secret put STORE_TOKEN --config wrangler.deploy.json
cd ../..
```

The deploy prints the Worker's address, `https://skyvision-ingest.<your-subdomain>.workers.dev`. Save it as `INGEST_URL` in `.env`.

Check: the status endpoint answers `503` with `"healthy":false` and no newest segment, because nothing has been uploaded yet.

```sh
curl -s -H "Authorization: Bearer <INGEST_TOKEN>" https://skyvision-ingest.<your-subdomain>.workers.dev/v1/status
```

## 9. Install the relay

1. **Prepare the relay host.** Install `ffmpeg` and `curl` (`sudo apt install ffmpeg curl` on Raspberry Pi OS and Debian). Then run `loginctl enable-linger $USER` once.

2. **Fill in the camera** in `.env`:
   - `CAMERA_IP_ADDRESS`, `CAMERA_USERNAME` and `CAMERA_PASSWORD`;
   - `CAMERA_RTSP_PORT` and `CAMERA_RTSP_PATH` (see [Requirements](requirements.md) for paths and the H.265 requirement);
   - `CAM_ID`.

3. **Install the recorder and uploader.** This copies the scripts, writes `~/.config/skyvision/relay.env` (mode 600), and starts both systemd user services.

   ```sh
   make deploy HOST=<relay-host>
   ```

4. **Give the relay its token.** It lives only on the relay host, and later deploys never overwrite it:

   ```sh
   ssh <relay-host> 'umask 077; echo "INGEST_TOKEN=<token>" > ~/.config/skyvision/ingest.env && systemctl --user restart skyvision-upload'
   ```

Check, two minutes later:

```sh
ssh <relay-host> journalctl --user-unit=skyvision-upload -n 5      # "stored sky01_…Z.mp4 (201, <size> MB)" once a minute
make status HOST=<relay-host>                                       # healthy, nothing waiting or set aside
```

The website's Recordings view now shows the newest minute. `make test HOST=<relay-host>` runs the uploader's self-test on the relay host, if you want to check the host's tools.

## 10. Install a processor (optional)

The processor runs Workshop workflows and takes photos from stored video. Skip this step if you only want recording and playback. See [Processor](processor.md) for details.

1. **Copy the source** to its own folder for this version, and install its dependencies:

   ```sh
   rsync -a --exclude .venv processor/ <processor-host>:skyvision-workshop-$(git rev-parse --short HEAD)/
   ssh <processor-host>
   cd ~/skyvision-workshop-<commit>
   python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
   ```

2. **Register the device.** In the website, open Models, choose **Add device**, and register a device ID for this machine, such as `gpu-box`.

3. **Register the runtime.** The runtime is this exact code on this device. Print its manifest on the processor host:

   ```sh
   .venv/bin/python -m skyvision_processor workshop-manifest --device gpu-box > runtime.json
   ```

   Post it with an Agent key that covers every camera, created under API access in the website. The answer's `id` is the runtime ID, `workshop-` followed by 32 hex characters.

   ```sh
   curl -s -X POST https://<api-host>/v1/workshop/runtimes \
     -H "Authorization: Bearer <agent-key>" -H 'Content-Type: application/json' -d @runtime.json
   ```

4. **Create the processor's key.** Under API access, create a key with purpose **Run Workshop jobs**, the device, and its cameras. Save the secret on the processor host in a file only you can read:

   ```sh
   mkdir -p ~/.config/skyvision && umask 077 && cat > ~/.config/skyvision/workshop.key
   ```

5. **Install the runner** as a service: a launchd agent on macOS, a systemd user service on Linux (then run `loginctl enable-linger $USER` once). All paths must be absolute.

   ```sh
   ./install-workshop.sh "$PWD/.venv/bin/python" "$HOME/.config/skyvision/workshop.key" workshop-<id> https://<api-host>
   ```

6. **Publish a model** so workflows have something to run. See [Models](models.md).

Check: `GET https://<api-host>/v1/workshop/runtimes` with the Agent key shows the runtime with a `last_seen_at` under two minutes old; the website starts runs only on a runtime seen that recently. On the host, `launchctl print gui/$(id -u)/org.openskycam.workshop` (macOS) or `systemctl --user status skyvision-workshop` (Linux) shows it running.

Changing the processor's source changes its code fingerprint. After an update, copy it to a new folder, then register a new runtime, and then reinstall the runner with the new runtime ID.

## 11. Deploy on push (optional)

With [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), each push to `main` checks and deploys the Worker it touches. In the Cloudflare dashboard, connect your fork to each Worker:

| Setting | Ingest | Website and API |
|---|---|---|
| Root directory | `/package/worker/` | `/package/dashboard/` |
| Build command | `npm run check` | `npm run check` |
| Deploy command | `npm run deploy` | `npm run release` |
| Build watch paths | `package/worker/*`, `package/worker/**/*` | `package/dashboard/*`, `package/dashboard/**/*` |
| Build variables | `CAMERAS`, `STORE_SERVICE_ID` | `SITE_HOST`, `API_HOST`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `CAMERAS`, `STORE_SERVICE_ID` |

Add `package/shared/*`, `package/shared/**/*`, `db/*` and `db/**/*` to both sets of watch paths. Set the build variables under Settings → Build → Variables and secrets; the values are the ones in your `.env`. `.node-version` selects Node.js 24. A failing check stops the deploy, and a missing variable stops it before anything is uploaded, so the running Worker stays as it was.

GitHub Actions runs `make check` on every pull request ([`.github/workflows/check.yml`](https://github.com/Deibler/openskycam/blob/main/.github/workflows/check.yml)).
