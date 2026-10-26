# Dashboard Worker

The `skyvision-dashboard` Worker serves the website at `SITE_HOST`, behind Cloudflare Access, and the API at `API_HOST`: footage, Workshop, the model registry, the processor job protocol and the MCP server. The website is a React app (shadcn/ui, Tailwind CSS, Vite) served by the same Worker, with every asset local.

## Develop

```sh
npm ci
npm run start    # the website and API at http://localhost:8787, reading your deployment's catalog and footage
npm run check    # architecture, types, frontend build, Worker integration, UI data, OpenAPI and React tests
```

`npm run check` needs no Cloudflare account. `npm run start` needs the configuration below plus `D1_DATABASE_ID`, and `.dev.vars` supplies the local viewer. Run `npm run types` after changing Worker bindings. [Local development](../../docs/develop/local.md) covers both in detail.

```text
src/            The Worker: routes → handler → service → db, plus models and utils (see Architecture)
ui/             The website
db/migrations/  The API key database; the shared catalog schema is in the repository's db/migrations/
openapi.json    The machine API description, served at /openapi.json
test/           Worker integration tests with local D1 and R2 and a fake footage store
test-ui/        UI data, OpenAPI and React tests
```

## Configuration

`wrangler.jsonc` holds no deployment hosts or account IDs. `npm run config`, which every Wrangler script here runs first, writes `wrangler.deploy.json` (git-ignored) from the environment or the repository's `.env`:

| Variable | Meaning |
| --- | --- |
| `SITE_HOST` | The website's custom domain, protected by Cloudflare Access, for example `sky.example.com` |
| `API_HOST` | The bearer-key API's custom domain, for example `api.sky.example.com` |
| `ACCESS_TEAM_DOMAIN` | Your Access team domain, `https://<team>.cloudflareaccess.com` |
| `ACCESS_AUD` | The Application Audience (AUD) tag of the Access application for `SITE_HOST` |
| `CAMERAS` | Comma-separated camera IDs, for example `sky01` |
| `STORE_SERVICE_ID` | The Workers VPC service that reaches the footage store |
| `D1_DATABASE_ID` | Optional. Deploys and remote migrations find `skyvision-catalog` by name; `npm run start` needs its ID |

Running `wrangler deploy` on `wrangler.jsonc` itself fails on purpose: its `STORE` binding has no `service_id`.

## Deploy

[Deploy your own](../../docs/deploy.md) creates the Cloudflare resources and deploys this Worker with `npm run release`, which applies both databases' migrations first. To deploy from Git with Workers Builds instead, see [Deploy on push](../../docs/deploy.md#11-deploy-on-push-optional).

## Documentation

- [Website](../../docs/website.md): recordings, activity, Workshop, the model library and API access.
- [API overview](../../docs/api.md), [Footage API](../../docs/api/footage.md), [Workshop API](../../docs/api/workshop.md) and [MCP server](../../docs/api/mcp.md).
- [Architecture](../../docs/develop/architecture.md#the-dashboard-worker): how this Worker is organized and what the checks enforce.
