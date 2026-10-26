# openskycam development conventions

Read [docs/develop/architecture.md](docs/develop/architecture.md) before backend changes.

## Locations

- Cloudflare applications: `package/dashboard/`, `package/worker/`.
- Shared TypeScript: `package/shared/src/`.
- Relay (Raspberry Pi or any Linux host): `external/relay/`. Footage store host: `external/store/`.
- Independent processor (macOS or Linux): `processor/skyvision_processor/`.
- Shared schema: `db/migrations/`; website credentials: `package/dashboard/db/migrations/`.
- Documentation: `docs/` (Markdown; `package/docs/` builds the site). Guided setup: `setup/`. Published models: `models/`.

## Required backend boundaries

Follow `routes → handler → service → db`.

- Routes register endpoints/commands with named handlers only.
- Handlers translate transport inputs/outputs. Business decisions and validation belong in services.
- Services own business rules and invoke persistence operations. Do not use HTTP Request/Response/Headers in TypeScript services.
- Execute SQL, R2 and footage store (`STORE`) operations only in `db/`. Keep SQL strings, sessions, prepared statements, batches, and atomic persistence conditions there. Services supply policy values.
- Define application interfaces/type aliases in `models/`. Use utilities for mechanical, reusable operations.
- Use stateless functions by default. Classes are appropriate for cohesive persistent state and lifecycle, such as a tracker or renewal thread.

Use Storage and Inference categories. Shared is reserved for concerns used by both.

| Layer | Filename |
| --- | --- |
| routes | `<concern><Category>Route` |
| handler | `<concern><Category>Handler` |
| service | `<concern><Category>Service` |
| db | `<Concern><Category>Ops` |
| utils | `<concern><Category>Util` |
| models | `<concern><Category>model` |

Apply these conventions to Worker `src/` trees and the Python processor. Composition entry points, generated models, schema migrations, and tests have their documented roles. Avoid compatibility re-export files that hide old names or layers.

## Verification

Run focused behavior tests for changed code. Run `make check` for architecture or repository layout changes. Architecture checks run in each Worker package and in the Python tests; keep their negative fixtures working. Inspect real runtime behavior when changing processor/media integration.

Changing processor source changes its fingerprint: a processor needs a newly registered runtime before it can claim jobs ([docs/processor.md](docs/processor.md#runtimes)).

Repository path moves must update CI, the Makefile, migration and config paths, and the docs. A deployment that uses Workers Builds also needs its root directories and watch paths updated.
