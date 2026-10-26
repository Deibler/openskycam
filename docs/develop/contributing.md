---
title: Contributing
description: What a pull request needs, the behaviour that must not change silently, and how to report a security issue.
---

Bug reports, fixes, support for more cameras and hardware, and documentation are all welcome. The repository's [CONTRIBUTING.md](https://github.com/Deibler/openskycam/blob/main/CONTRIBUTING.md) and [SECURITY.md](https://github.com/Deibler/openskycam/blob/main/SECURITY.md) are the source for this page.

## Before you change code

- Read [Architecture](architecture.md) and the repository's [AGENTS.md](https://github.com/Deibler/openskycam/blob/main/AGENTS.md). Backend files follow `routes → handler → service → db`, with names that state their concern, category and layer, and `make check` fails when they don't.
- Set up as described in [Local development](local.md). The tests need no Cloudflare account.

## A pull request

- **One change per pull request**, with the tests that prove it.
- **`make check` passes.** CI runs it on every pull request.
- **Each new test can fail.** Break the code it guards, watch it fail, and restore the code. A test that passes regardless of the code gives false confidence.
- **Format only the files you change** (`npx biome format --write <files>`), so the diff stays about your change.
- **Update the docs** that describe what you changed: this site (`package/docs/`), a component's README, or `openapi.json` for API changes. The docs build fails on broken internal links.

## Behaviour that must not change silently

These rules protect data that already exists and deployments you cannot see. A pull request that needs to break one should say so plainly and explain how existing deployments are handled.

| Rule | Why |
|---|---|
| New detection logic applies to new detections only. Never rewrite existing bucket items or dataset versions. | Reviewed labels and frozen datasets are training data; changing them after the fact changes results nobody re-checked. |
| Schema changes are new, additive migration files in `db/migrations/` or `package/dashboard/db/migrations/`. Never change the schema an existing migration creates. | A deployment that already applied a migration never runs it again, so an edit only reaches new installs. |
| A processor source change ships with a new runtime registration. | The runtime pins the code fingerprint; see [Processor](../processor.md). |
| No hosts, account IDs or credentials in the repository. A new per-deployment value is an empty string in `wrangler.jsonc` and an entry in `.env.example`. | Every deployment fills its own values; see [Configuration](../configuration.md). A check fails if a committed config gains an ID. |
| API key management stays on the website. | A leaked key must not be able to create more keys. |

## Report a security issue

Report a vulnerability privately: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue. Include what an attacker can reach (website, API key scope, relay, footage store, processor) and the steps to reproduce.

These boundaries are in scope:

- The website trusts only verified Cloudflare Access tokens.
- The API trusts only scoped keys.
- The footage store accepts only the Workers' bearer token.
- The processor makes only outgoing requests with its own key.

A way around any of them is in scope, and so is reading footage or data from a camera a key was not given.

Never put real API keys, Access tokens, camera passwords or footage in a report.

## License

openskycam is released under the [MIT license](https://github.com/Deibler/openskycam/blob/main/LICENSE). The openskycam name and logo in `package/dashboard/openskycam-media-kit/` identify the original project and are not covered by it.
