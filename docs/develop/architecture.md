---
title: Architecture
sidebar: Architecture
description: How the repository is laid out, the layer rules every backend file follows, and the checks that enforce them.
---

openskycam is one repository with four kinds of program: two Cloudflare Workers, a static documentation site, three Python programs (the processor, the footage store and the camera MCP server), and shell scripts for the relay. The Workers and the processor follow the same layer rules, and automated checks fail the build when a file breaks them.

## Repository layout

```text
package/
  dashboard/        Website (React, ui/), footage and Workshop API, API keys, models, MCP server (src/)
  worker/           Ingest API: validates relay uploads, writes the footage store and the catalog
  shared/           Code both Workers use, the architecture check, deploy-config.mjs
  docs/             This documentation site (Astro, static)
external/
  relay/            Recorder and uploader for the relay host (bash, systemd user units)
  store/            Footage store and its tunnel (Python, launchd or systemd)
processor/          Workshop runner, model publishing and sync, inference preview (Python)
db/migrations/      Catalog, inference, model and Workshop schema (D1, shared by both Workers)
docs/               This documentation, as Markdown; package/docs builds the site from it
models/             Trained models to publish to your own registry, each with its card and license
setup/              The installer and guided setup (npm run setup)
camera_mcp.py       Dahua camera configuration MCP server
```

Each Worker in `package/` has its own `package.json` and lockfile, because Workers Builds installs and deploys each one from its own directory. API key tables have their own migrations in `package/dashboard/db/migrations/`, tracked in a separate `api_key_migrations` table of the same database.

## Layers

Backend code in both Workers (`src/`) and in the processor (`skyvision_processor/`) is split into six directories:

```text
routes → handler → service → db → D1 / R2 / footage store
```

| Directory | Holds | May import |
|---|---|---|
| `routes/` | Method, path and handler registration only. No functions, conditions or calls other than `route(…)`. | handler, models, and only the router utility |
| `handler/` | Reads the HTTP request (or CLI arguments), calls services, writes the response | service, models, utils |
| `service/` | Business rules: permissions, validation, limits, leases, retention, processing decisions | service, db, models, utils |
| `db/` | Every SQL statement, R2 call and footage store (`STORE`) request, plus transactions and atomic conditions | db, models, utils |
| `models/` | Interfaces and type aliases, with type-only imports | models |
| `utils/` | Mechanical helpers: hashing, key formats, transport parsing | utils, models |

Two kinds of file sit outside the layers.

- **Composition roots.** `package/dashboard/src/index.ts` and `package/worker/src/index.ts` build the route tables, authenticate each request, dispatch it, and turn errors into responses. They hold no business rules and no persistence.
- **Migrations and tests.** They are exempt from the import rules.

Services take application values, never `Request`, `Response` or `Headers`. They raise `ApplicationError` with a code (`invalid_input`, `forbidden`, `conflict`, `not_found`…), and a shared utility maps codes to HTTP statuses. A handler may not construct an `ApplicationError` itself, and may not call `Date.now`, `crypto.randomUUID` or `crypto.subtle`. Those are decisions, and decisions belong in services.

Handlers and services are stateless exported functions. Classes are used only where something owns state and a lifecycle: the processor's HTTP client, lease heartbeat, detector and tracker, and the dashboard's Durable Object for live run updates.

## Naming

A file's name states its concern, its category and its layer: `<concern><Category><Layer>`.

| Layer | Pattern | Example |
|---|---|---|
| routes | `<concern><Category>Route` | `footageStorageRoute.ts` |
| handler | `<concern><Category>Handler` | `workshopInferenceHandler.ts` |
| service | `<concern><Category>Service` | `credentialSharedService.ts` |
| db | `<Concern><Category>Ops`, capitalised | `WorkshopInferenceOps.ts` |
| utils | `<concern><Category>Util` | `cryptoSharedUtil.ts` |
| models | `<concern><Category>model`, lowercase `model` | `modelInferencemodel.ts` |

The category is `Storage` (footage and the catalog), `Inference` (models, Workshop, processing) or `Shared` (authentication, keys, HTTP and routing, bindings, cryptography). The Python processor uses the same names with `.py`.

## What the checks enforce

`npm run check:architecture`, in each Worker, runs [`package/shared/check-architecture.mjs`](https://github.com/Deibler/openskycam/blob/main/package/shared/check-architecture.mjs) over `src/` and `package/shared/src/` with the TypeScript compiler. It fails on:

- a file name that does not match its layer's pattern;
- an `interface` or `type` declared outside `models/`, or a value import in `models/`;
- an import that skips or reverses a layer, and import cycles;
- an SQL literal outside `db/` (`SELECT … FROM`, `INSERT INTO`, `UPDATE … SET`, `DELETE FROM`, `CREATE TABLE`, `WITH … SELECT`);
- outside `db/`: any use of a D1 or R2 value, found by its TypeScript type even through an alias; `prepare`, `withSession`, `batch` or `STORE`; or destructuring those methods off a binding;
- `Request`, `Response` or `Headers` in a service;
- `new ApplicationError`, `Date.now`, `crypto.randomUUID` or `crypto.subtle` in a handler;
- functions, classes, `if` or `switch`, or any call except `route(…)`, in a route file;
- dynamic `import()`, which would hide a dependency from the check.

[`architecture.check.mjs`](https://github.com/Deibler/openskycam/blob/main/package/shared/architecture.check.mjs) feeds the checker known-bad snippets and expects each to fail, so a weakened rule fails the build. [`processor/tests/test_architecture.py`](https://github.com/Deibler/openskycam/blob/main/processor/tests/test_architecture.py) applies the same import matrix, naming, SQL and route rules to the processor, and checks that every relative import exists.

The checks cannot tell whether a rule sits in the right service. Review still has to.

## The dashboard Worker

The dashboard Worker serves three surfaces from one deployment.

| Surface | Host and path | Authentication |
|---|---|---|
| Website and its API | `SITE_HOST`, `/` and `/api/…` | A Cloudflare Access token, verified by the Worker on every request |
| Machine API | `API_HOST`, `/v1/…` | `Authorization: Bearer <key>`, or a signed link for one download |
| OpenAPI document | `/openapi.json` on either host | none |

Website routes that change data also require an `Origin` header equal to the site's own origin. This check runs once in the dispatcher in `index.ts`, so every state-changing website route has it. The API host serves only `/v1` and `/openapi.json`, and an `Authorization` header is refused on website routes.

`/v1` first looks for a machine route. If none matches, [`handler/apiSharedHandler.ts`](https://github.com/Deibler/openskycam/blob/main/package/dashboard/src/handler/apiSharedHandler.ts) maps `/v1/<path>` to the website route `/api/<path>` and runs it for an Agent key that covers every camera. It rewrites `*_url` links in JSON answers from `/api/` to `/v1/`. Key management (`/api/keys…`) is never mapped. Because this is one rule rather than a copy of each route, a new website route is reachable through `/v1` without further code. The served OpenAPI document adds the matching `/v1` operations the same way ([`utils/openapiSharedUtil.ts`](https://github.com/Deibler/openskycam/blob/main/package/dashboard/src/utils/openapiSharedUtil.ts)). See [API](../api.md).

A cron trigger runs every minute: it starts scheduled Workshop runs, and every 15 minutes it cleans up expired Workshop data. A Durable Object (`WorkshopRunSession`) pushes live run progress to browsers over WebSockets.

## Deployment configuration

`wrangler.jsonc` in each Worker holds no hosts or account IDs. [`package/shared/deploy-config.mjs`](https://github.com/Deibler/openskycam/blob/main/package/shared/deploy-config.mjs) writes `wrangler.deploy.json` beside it, and every wrangler script uses that file:

- a var set to `""` takes the environment variable of the same name (required);
- a `vpc_services` binding without `service_id` takes `<BINDING>_SERVICE_ID` (required);
- a D1 binding without `database_id` takes `D1_DATABASE_ID` when it is set;
- `--domains` names variables holding the Worker's custom domains (required).

Values come from the environment first, then the repository's `.env`. A missing value stops the command and names it. Deploying `wrangler.jsonc` directly fails Wrangler's validation before anything is uploaded, because the `STORE` binding has no `service_id`. [`deploy-config.check.mjs`](https://github.com/Deibler/openskycam/blob/main/package/shared/deploy-config.check.mjs) checks that the committed configs stay free of deployment values. To add a per-deployment value, set it to `""` in `wrangler.jsonc` and document it in `.env.example`. See [Configuration](../configuration.md).

## The processor

The processor is an installed Python package with the same six layers. Its `routes/` registers CLI commands instead of URLs, because it has no listener. `db/` holds the API calls, local partial-file writes and registration SQL generation. Its code fingerprint covers every `.py` file in the package, so moving or reformatting a file needs a new runtime registration (see [Processor](../processor.md)).

## The documentation site

`package/docs/` is an [Astro](https://astro.build) site built to static files. It has no Worker code; `wrangler.jsonc` there serves `dist/` as static assets at `DOCS_HOST`. Pages are Markdown in `src/content/docs/`, and the sidebar order is in `src/nav.ts`. `npm run build` builds the pages and a [Pagefind](https://pagefind.app) search index, then fails if any internal link or `#anchor` does not resolve. The build also fails when a page is missing from the sidebar or a sidebar entry has no page. Writing rules are in [`package/docs/README.md`](https://github.com/Deibler/openskycam/blob/main/package/docs/README.md).
