# Ingest Worker

Receives 60-second segments from the relay, stores them in the [footage store](../../external/store/README.md), and records them in the D1 catalog. The full API is in [docs/capture/ingest.md](../../docs/capture/ingest.md).

## API

All routes require `Authorization: Bearer <INGEST_TOKEN>`.

| Route | Purpose |
|---|---|
| `PUT /v1/segments/:cam/:start` | Store one segment. `201` stored · `200` identical retry · `409` different bytes at that key · `422` body doesn't match `X-Sha256` · `503` store or catalog unavailable, retry |
| `GET /v1/status` | Age of each camera's newest catalogued segment; `503` if any camera is stale for more than 3 minutes |

## Code layout

```text
src/
  index.ts       Composition root: authenticate, dispatch, and translate errors
  routes/        Endpoint registrations
  handler/       HTTP input/output
  service/       Upload rules, idempotency, camera health, authentication
  db/            D1 transactions and footage store requests
  models/        Application, request/result, and persistence types
  utils/         Constants and mechanical helpers
test/            Worker integration tests with local D1 and a fake footage store
```

## Development

```sh
npm ci
npm run check        # type-check + tests (no Cloudflare account needed)
npm run dev          # local server; STORE is the real footage store (put INGEST_TOKEN and STORE_TOKEN in .dev.vars)
```

## Configuration

`wrangler.jsonc` holds no deployment hosts or account IDs. `npm run config`, which `dev` and `deploy` run
first, writes `wrangler.deploy.json` (git-ignored) from the environment or the repository's `.env`:

| Variable | Meaning |
|---|---|
| `CAMERAS` | Comma-separated camera IDs the relay may upload for, for example `sky01` |
| `STORE_SERVICE_ID` | The Workers VPC service that reaches the footage store ([Set up the footage store](../../docs/deploy.md#4-set-up-the-footage-store)) |
| `D1_DATABASE_ID` | Optional. Deploys find the `skyvision-catalog` database by name; `npm run dev` with remote bindings needs its ID |

Running `wrangler deploy` on `wrangler.jsonc` itself fails on purpose: its `STORE` binding has no `service_id`.

## Deployment

Create the shared resources once, as described in [Deploy your own](../../docs/deploy.md). Deploy
once, then set the tokens, which are Worker secrets and never in git:

```sh
npm run deploy
openssl rand -hex 32    # the relay's INGEST_TOKEN; keep it in the repository's .env
npx wrangler secret put INGEST_TOKEN --config wrangler.deploy.json
ssh <store-host> cat .config/skyvision-store/store.token | npx wrangler secret put STORE_TOKEN --config wrangler.deploy.json
```

Later deploys are `npm run deploy` again. The Worker is served at `skyvision-ingest.<your-subdomain>.workers.dev`; that URL is
the relay's `INGEST_URL`.

To deploy from Git with Workers Builds instead, connect the repository to this Worker with these settings and add the
variables above as build variables:

| Setting | Value |
|---|---|
| Branch | `main` |
| Root directory | `/package/worker/` |
| Build command | `npm run check`: type-check and tests; a failure stops the deploy |
| Deploy command | `npm run deploy` |
| Build watch paths | `package/worker/*`, `package/worker/**/*`, `package/shared/*`, `package/shared/**/*`, `db/*`, `db/**/*` |
