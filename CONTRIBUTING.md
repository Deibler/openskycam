# Contributing

Thanks for helping. Bug reports, fixes, support for more cameras and hardware, and documentation are all welcome. Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

- **Questions and ideas** go in [Discussions](https://github.com/Deibler/openskycam/discussions); **bugs** in an [issue](https://github.com/Deibler/openskycam/issues/new/choose); **security problems** privately, as [SECURITY.md](SECURITY.md) describes.
- **Pull requests** need a passing `check` and the maintainer's approval before they merge, and they are squash-merged. Nobody pushes to `main` directly. For a large change, open a discussion first so the work fits.

## Before you change code

- Read [AGENTS.md](AGENTS.md) for the layer conventions (`routes → handler → service → db`) and file naming. The architecture checks enforce them.
- Read [docs/develop/architecture.md](docs/develop/architecture.md) for backend changes.
- Keep pull requests focused: one change, with the tests that prove it.

## Checks

```sh
npm install
make check        # what CI runs: both Workers, website, processor, store, shell lint, camera MCP self-test
```

Tests never reach Cloudflare. D1, R2 and the footage store are local stand-ins, so `make check` needs no account. Processor image tests need `numpy` and `opencv-python-headless`, and store thumbnail tests need Pillow (see `.github/workflows/check.yml`).

A new test should fail without your change. Break the code it guards, watch it fail, and then restore the code.

## Behaviour that must not change silently

- New detection logic applies to new detections only. Never rewrite existing bucket items or dataset versions.
- Schema changes are new, additive files in `db/migrations/` or `package/dashboard/db/migrations/`. Never change the schema an existing migration creates: deployments that already applied it never run it again.
- Changing processor source changes its fingerprint. Processors register a new runtime before they run new code (see [Runtimes](docs/processor.md#runtimes)).
- No deployment's hosts, account IDs or credentials belong in the repository. Add a new per-deployment value as an empty string in `wrangler.jsonc` and document it in `.env.example`; `package/shared/deploy-config.mjs` fills it.
