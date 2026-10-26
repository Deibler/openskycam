---
title: API overview
sidebar: Overview
description: Hosts, keys and scopes, the /v1 website bridge, errors, limits and the OpenAPI document.
---

Everything openskycam stores or does is reachable over HTTPS with an API key: footage, Workshop, models, the processor job protocol and an [MCP server](api/mcp.md) for agents. Every machine endpoint lives under `/v1`. Send the key as a bearer token on every request, downloads included.

```sh
curl -H "Authorization: Bearer $OPENSKYCAM_KEY" https://<api-host>/v1/me
```

## Hosts

The dashboard Worker answers two hostnames, `SITE_HOST` and `API_HOST` (see [Configuration](configuration.md)).

| Host | Serves | Authentication |
|---|---|---|
| `<api-host>` | `/v1/...` and `/openapi.json` only. Any other path answers `404 Use /v1 for API requests.` | API key or signed link |
| `<site-host>` | The website and its `/api/...` routes | Cloudflare Access session |

The Worker also answers `/v1` on the website host, but Cloudflare Access sits in front of that host and turns away requests without a session, so scripts use `<api-host>`. In local development (`npm run dev`) the API is at `http://localhost:8787/v1`. A request to a website route that carries an `Authorization` header is refused with `403 API keys are accepted only on /v1 endpoints.`

## Keys

Create keys on the website under **API access**. A key is shown once, in the form `svk_<32 hex characters>_<43-character secret>`. Only a SHA-256 hash of the secret is stored, and every request checks the primary key store, so rotation and revocation take effect on the next request.

| Property | Rule |
|---|---|
| Owner | The signed-in email that created it. Each owner can have **20** active keys; a 21st answers `409`. |
| Name | 1 to 80 characters. |
| Lifetime | 1 to 365 days. |
| Cameras | At least one camera for every scope except the two model scopes, which must have none. A key's cameras are intersected with the deployment's current `CAMERAS`. |
| Last used | Updated at most every five minutes. |

Rotation keeps the key's ID, scope, cameras and expiry and replaces the secret; the old secret stops working at once. Key management (`/api/keys`) is website-only: no key can create, rotate or revoke keys, through the bridge or otherwise.

### Scopes

| Scope | Bound to | Can call |
|---|---|---|
| `footage:read` | Cameras | `/v1/me`, `/v1/cameras`, `/v1/recordings` and recording files; dataset manifests (`GET /v1/workshop/versions/{id}`), dataset images (`GET /v1/workshop/items/{id}/image`) and test-run previews (`GET /v1/workshop/runs/{id}/previews/{item}/image`) when every image is from one of its cameras |
| `agent` | Cameras | Everything `footage:read` can, plus `/v1/mcp` and `GET /v1/models`. An Agent key for **every** camera can also call the whole website through `/v1` ([below](#the-website-under-v1)) |
| `workshop:run` | Cameras and one registered device | The Workshop runner protocol: `POST /v1/workshop/claim` and `/v1/workshop/jobs/{id}/...` (`progress`, `heartbeat`, `fail`, `complete`, `input`, `models/{sha}`, `images/{sha}`), plus footage reads for its cameras |
| `models:write` | No cameras | `GET /v1/models`, `POST /v1/models`, `PUT /v1/models/chunks/{sha}`, `POST /v1/models/artifacts`, `GET /v1/models/artifacts/{sha}` |
| `models:sync` | No cameras, one registered device | `GET /v1/models/devices/{id}/desired` and `POST /v1/models/devices/{id}/status` for its own device, and `GET /v1/models/artifacts/{sha}` for artifacts assigned to that device |
| `processor:run` | Cameras and one registered pipeline | `/v1/processor/jobs/...` (the continuous-inference preview), plus footage reads for its cameras. It can be created only when `INFERENCE_ENABLED` is `true` |

Endpoints that read footage or images check the camera of what they return; a key for `sky01` gets `403 This key cannot access that camera.` for anything recorded by another camera. `GET /v1/me` shows what a key is:

```json
{ "key_id": "4f0c…", "scope": "agent", "cameras": ["sky01"] }
```

`device_id` and `pipeline_id` appear for keys bound to one. `GET /v1/cameras` returns `{ "cameras": [...] }`.

### Signed links

Some answers contain download links that work without the bearer header, so they can be passed to `curl` or a browser: video, full-size images, photos and dataset manifests from the MCP server. A link is `https://<api-host><path>?key=<key id>&expires=<unix seconds>&sig=<HMAC>`:

- It is valid for one path, for `GET` and `HEAD` only, and with exactly those three query parameters.
- It lasts one hour, or until the key expires if that is sooner.
- It is signed with the key's secret hash, so revoking or rotating the key ends every link it made.

## The website under /v1

Every website action is also an API call. With an **Agent key that covers every camera**, `/v1/<path>` runs the website's `/api/<path>`:

| Website | API |
|---|---|
| `GET /api/workshop` | `GET /v1/workshop` |
| `POST /api/workshop/runs` | `POST /v1/workshop/runs` |
| `PUT /api/models/devices/{id}/deployment` | `PUT /v1/models/devices/{id}/deployment` |
| `GET /api/overview?cam=sky01` | `GET /v1/overview?cam=sky01` |

That covers Workshop (workflows, buckets, runs, review, dataset versions, schedules, runtimes), model devices and deployments, footage browsing and inference status. [Workshop API](api/workshop.md) and [Footage API](api/footage.md) list the calls.

- **Links point at /v1.** In JSON answers, fields ending in `_url` that start with `/api/` are rewritten to `/v1/`, so the same key can follow them, for example `image_url: "/v1/workshop/items/{id}/image"`.
- **Machine endpoints win.** Where `/v1` already has an endpoint at the same path and method, that endpoint answers: `GET /v1/models`, `GET /v1/workshop/versions/{id}`, `GET /v1/workshop/items/{id}/image` and `GET /v1/workshop/runs/{id}/previews/{item}/image`. They return the same data, with their own camera checks.
- **Key management is excluded.** `/v1/keys` answers `404`.
- **Other keys are refused** with `403 This endpoint needs an Agent key for every camera.` That includes an Agent key for only some cameras: Workshop data is not divided by camera, so such a key keeps to MCP and the footage endpoints.
- **No browser checks.** Website routes that change data refuse a browser request from another origin. Key requests have no `Origin` check, because a key is never sent automatically.

The bridge is one rule in the API dispatcher ([`handler/apiSharedHandler.ts`](https://github.com/Deibler/openskycam/blob/main/package/dashboard/src/handler/apiSharedHandler.ts)), so a new website route is available under `/v1` as soon as it exists.

## Errors

Errors are JSON with one field:

```json
{ "error": "This key cannot access that camera." }
```

| Status | Meaning |
|---|---|
| `400` | Invalid input: a missing or malformed field, or a value outside its range |
| `401` | Missing, malformed, expired or revoked key, or an invalid signed link. Adds `WWW-Authenticate: Bearer realm="OpenSkyCam"` |
| `403` | The key's scope, camera or device does not allow this |
| `404` | Unknown endpoint (`API endpoint not found.`), or the record does not exist or has expired |
| `405` | The path exists but not with this method |
| `409` | A revision or ID conflict, or the 20-key limit |
| `413` | The request body is larger than the endpoint accepts |
| `415` | A JSON endpoint was sent something other than `Content-Type: application/json` |
| `416` | The byte range cannot be satisfied (answers `Content-Range: bytes */<size>`) |
| `422` | Uploaded data failed verification |
| `503` | A dependency is unavailable, such as the footage store or Workshop storage. Retry later |
| `500` | An unexpected failure: `{"error": "internal error"}` |

Error responses carry `Cache-Control: no-store`.

## Revisions and retries

Workshop is one document with a revision number. Every write that changes it takes the revision you last read and answers `409` if it has moved on: read again, reapply your change and retry. Runs and dataset versions take an ID you choose; sending the same ID and body again returns the existing record, so a retry after a timeout cannot create a duplicate. Reusing an ID with a different body answers `409`. Details are in [Workshop API](api/workshop.md).

## Pages

| Endpoint | Page size | Next page |
|---|---|---|
| `GET /v1/recordings` | `limit`, 1 to 500, default 100 | Follow `next_url` until it is `null` |
| `GET /v1/workshop/buckets/{id}/browse` | `limit`, 1 to 200, default 120 | Pass `cursor` back |
| `GET /v1/workshop/buckets/{id}` | First 500 images | `has_more` is `true` when there are more; use `browse` |
| `GET /v1/workshop/runs` | Newest 100 runs | None |

## Limits

| Request | Body limit |
|---|---|
| Most JSON bodies | 4,096 bytes |
| `PUT /v1/workshop` | 800,000 bytes; the saved document must stay under 750,000 bytes |
| `POST /v1/mcp` | 1,000,000 bytes |
| `POST /v1/models` | 65,536 bytes |
| `PUT /v1/models/devices/{id}/deployment`, `POST /v1/models/artifacts` | 32,768 bytes |
| `PUT /v1/models/chunks/{sha}`, `PUT /v1/workshop/jobs/{id}/images/{sha}` | 8 MiB |

## Caching

JSON answers from `/v1` are `Cache-Control: no-store` with `X-Content-Type-Options: nosniff`, except the website's footage endpoints, which send neither. Recording files are `private, no-store`. `/openapi.json` is `public, max-age=300`.

## OpenAPI

`GET /openapi.json` (on the API host, no key needed) is an OpenAPI 3.1.1 document. The website's **API access → Documentation** tab renders it. As served, it lists every website operation twice: at `/api/...` under the name `website_<operationId>`, and at `/v1/...` under its original `operationId` with the `ApiKey` security scheme. Generate a client from the `/v1` operations, for example TypeScript types:

```sh
npx openapi-typescript https://<api-host>/openapi.json -o openskycam.d.ts
```

The footage-browsing endpoints (`/v1/availability`, `/v1/overview`, `/v1/segments`, `/v1/video/...`) and the live run WebSocket are served but not described in the document.
