---
title: Local development and tests
sidebar: Local development
description: Run the website and API on your machine, point a processor at it, and run the checks CI runs.
---

Everything runs from a clone with Node.js 24 (`.node-version`), Python 3 and `shellcheck`. The tests never contact Cloudflare: D1, R2 and the footage store are local stand-ins, so `make check` needs no account. Running the website locally against your data does need your deployment's values in `.env` (see [Configuration](../configuration.md)).

## Install

```sh
npm install        # Biome at the root, then `npm ci` in package/dashboard, package/worker and package/docs
cp .env.example .env
```

Each Worker and the documentation site install from their own lockfiles.

## Run the website

```sh
npm run dev        # from the repository root; serves http://localhost:8787
```

The first run writes `package/dashboard/.dev.vars` with `DEV_VIEWER_EMAIL` set to your git email. On `localhost` (and only there), that email stands in for a Cloudflare Access sign-in. Then `npm start` runs in `package/dashboard`, which:

1. writes `wrangler.deploy.json` from `.env` (`npm run config`);
2. applies the API-key migrations to a local database;
3. starts `wrangler dev --env dev`, rebuilding the UI and reloading the page on save.

The `dev` environment uses **your deployment's real resources** for everything except API keys:

| Binding | In `npm run dev` |
|---|---|
| `CATALOG` (D1) | Remote. Needs `D1_DATABASE_ID` in `.env`: `npm run wrangler -- d1 info skyvision-catalog` |
| `MODELS`, `WORKSHOP` (R2) | Remote |
| `STORE` (footage store) | Remote, through the VPC service |
| `API_KEYS` (D1) | Local, so keys you create locally never work in production |

Changes you make here, such as saving Workshop or reviewing items, change real data. Cron triggers do not run in `wrangler dev`, so schedules stay idle.

The ingest Worker has its own `npm run dev` in `package/worker`. It uses a local catalog but the real footage store, so test uploads you send it land in your store.

## Run fully local for the processor

```sh
cd package/dashboard
npm run start:inference      # http://127.0.0.1:8789
```

The `inference` environment keeps the catalog, API keys, models, Workshop images and inference evidence in local D1 and R2 under `package/dashboard/.wrangler/state/`. Only `STORE` reads your real footage store. It also sets `INFERENCE_ENABLED=true`, which turns on the [continuous-inference preview](../processor.md). It listens on loopback only.

To point a processor at it, open `http://127.0.0.1:8789/?view=api`, create a key, and pass `--base-url http://127.0.0.1:8789`. The processor accepts plain HTTP only for `localhost`, `127.0.0.1` and `::1`. If the processor runs on another machine, forward the port to it:

```sh
ssh -N -o ExitOnForwardFailure=yes -R 127.0.0.1:8789:127.0.0.1:8789 <user>@<processor-host>
```

Local state persists between sessions. Delete `.wrangler/state` to start over.

## Run the checks

```sh
make check
```

This is what CI runs. It stops at the first failing part:

| Target | Runs |
|---|---|
| `worker-check` | In `package/worker`: the architecture check, `tsc` for source and tests, and the Worker tests (Vitest) |
| `dashboard-check` | In `package/dashboard`: the architecture check; `tsc` for source, tests and UI; a UI build; the Worker tests; `node --test test-ui/*.check.mjs`; the React tests |
| `docs-check` | In `package/docs`: builds this site and its search index, and fails on a broken internal link, a missing `#anchor`, or a page that is not in the sidebar |
| `processor-check` | `python3 -m unittest discover -s tests` in `processor/` |
| `store-check` | The same in `external/store/` |
| `setup-check` | `node --test setup/lib.check.mjs`, the guided setup's parsing and validation |
| `lint` | `shellcheck -x` on the relay, store and processor shell scripts and `setup/install.sh` |
| (last step) | `python3 camera_mcp.py --check`, the camera MCP self-test |

The processor's image tests need `numpy` and OpenCV, and the store's thumbnail tests need Pillow. CI installs them like this:

```sh
sudo apt-get install shellcheck python3-pil
python3 -m pip install --user --break-system-packages numpy==2.4.3 opencv-python-headless==4.13.0.92
```

On your own machine, a virtual environment avoids `--break-system-packages`: `python3 -m venv .venv && .venv/bin/pip install numpy==2.4.3 opencv-python-headless==4.13.0.92 pillow`, then `PATH="$PWD/.venv/bin:$PATH" make check`.

The GitHub workflow ([`.github/workflows/check.yml`](https://github.com/Deibler/openskycam/blob/main/.github/workflows/check.yml)) runs on every pull request and on pushes to `main`, on Ubuntu, with a 15-minute limit. Workers Builds runs each Worker's `npm run check` again before deploying it.

To run one part while working:

```sh
cd package/dashboard && npx vitest run test/workshop.test.ts      # one Worker test file
cd package/dashboard && npx vitest run --config vitest.ui.config.ts test-ui/workshop.test.tsx
cd processor && python3 -B -m unittest discover -s tests -p test_workshop.py -v   # -B: no stale .pyc files
```

## How the tests are built

| Suite | Location | Runs in |
|---|---|---|
| Worker tests | `package/dashboard/test/*.test.ts`, `package/worker/test/*.test.ts` | The Workers runtime, through `@cloudflare/vitest-plugin`, with local D1 and R2 |
| Script checks | `package/dashboard/test-ui/*.check.mjs`, `package/shared/*.check.mjs` | `node --test` |
| React tests | `package/dashboard/test-ui/*.test.tsx` | Vitest with jsdom at `http://localhost:8787/` |
| Python tests | `processor/tests/`, `external/store/tests/` | `unittest` |

The Worker tests read the Worker's own `wrangler.jsonc`, with three changes:

- [`fakeFootageStoreConfig.mjs`](https://github.com/Deibler/openskycam/blob/main/package/shared/test/fakeFootageStoreConfig.mjs) writes a copy without the remote `vpc_services` binding (`wrangler.test.json`, git-ignored).
- It binds `STORE` to [`fakeFootageStore.js`](https://github.com/Deibler/openskycam/blob/main/package/shared/test/fakeFootageStore.js), which answers like the real store, with the same routes, status codes and headers, backed by local R2.
- The deployment values `wrangler.jsonc` leaves empty come from `vitest.config.ts`. The camera is `sky01`, the API host is `api.example.com`, and the Access team is `https://test-team.cloudflareaccess.com`.

`test/apply-migrations.ts` applies every catalog and API-key migration before the tests start. Tests sign their own Access tokens with a generated key, and `globalThis.fetch` returns that key's public half in place of Access's certificate URL. `DEV_VIEWER_EMAIL` is set in tests too, so every Access test also proves the local sign-in has no effect off `localhost`.

Keys created by other tests count toward an owner's limit of 20 active API keys. Give a new test file its own owner email, as the existing files do.

### Write a test that can fail

A test that passes no matter what the code does is worse than none. After writing one, break the code it guards and run it: it must fail. Then restore the code and watch it pass. Change one thing at a time. For Python, use `python3 -B` while doing this, because a stale `.pyc` file can make a test pass against code you already changed.

## Formatting

[Biome](https://biomejs.dev) formats TypeScript, JavaScript, JSON and CSS under `package/`: two-space indent, 120-column lines, single quotes, semicolons. Its linter is off.

```sh
npm run format                         # format everything
npx biome format --write <files>       # format only what you changed
npm run lint                           # check formatting, then the architecture checks and shellcheck
```

`make check` and CI do not check formatting, and some existing files are not formatted. Format the files you change rather than the whole tree, so your diff stays about your change.
