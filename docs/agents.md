---
title: Run it with an agent
sidebar: Run it with an agent
description: An AI agent can set openskycam up, run it day to day and change its code. Here is what it can do, how to connect it, and the few steps that still need you.
---

openskycam is built so an AI agent can do the work. Every action on the website is also an API call under `/v1`. An [MCP server](api/mcp.md) gives agents seven tools that cover the website, with guides that teach them how to use them. The setup runs unattended from `.env`, and `make check` verifies any change an agent makes to the code.

A person is needed for three things, all by design: creating API keys on the website, creating the tunnel and the sign-in application in the Cloudflare dashboard, and the first Cloudflare login in a browser. [What needs you](#what-needs-you) lists them.

## What you can ask

Connected over MCP, an agent answers questions like these with the tools on the right. Each answer comes from the live deployment, and the agent can look at the images it finds.

| You ask | The agent uses |
|---|---|
| Did the camera record all night? | `footage cameras` (upload health and storage), `footage days`, `footage list` |
| Take a photo of the sky at 03:12:40 UTC. | `footage photo`: the processor decodes that frame from stored video |
| Download every recording from 02:00 to 03:00 UTC. | `footage download`: signed links that last an hour |
| Find last night's meteors and show me the clearest three. | `images search` by bucket, class, confidence and time, then `images view` |
| Build a workflow that keeps moving planes between 02:00 and 09:30 UTC, and run it every night. | `workflows create` and `update`, `workflows check`, `runs test`, `runs watch`, then a schedule step and `runs start` |
| Is the night workflow keeping up? | `runs list`, `runs status`, `runs schedules` |
| Review the waiting images in Planes: accept real planes, reject stars. | `images search` for pending items, `images view`, then `images review` in batches of up to 100 |
| Keep the best meteor images past their expiry. | `images save` |
| Freeze a dataset of the reviewed meteors and give me the manifest. | `buckets create_version`, `buckets export_version` |
| Is the processor online, and which version is it running? | `runs runtimes` |
| Put the night detector on the gpu-box device. | `models list`, `models devices`, `models deploy` |

An Agent key that covers every camera can also call any website route through `/v1`, so an agent writing a script has the same reach as the website, except managing keys ([API overview](api.md#the-website-under-v1)).

## Connect your agent

On the website, open **API access** and create a key with Purpose **Agent: MCP and full API**. The dialog shows the command for Claude Code with the key filled in:

```sh
claude mcp add --transport http openskycam https://<api-host>/v1/mcp \
  --header "Authorization: Bearer svk_…" --scope user
```

Any MCP client that speaks Streamable HTTP connects to the same URL with the same header. [MCP server](api/mcp.md) lists every tool and action.

## What the agent learns from the server

The agent does not need to read this documentation. On connect, the server sends instructions that point it to the `guide` tool, which serves:

- **Six guides**: `overview`, `footage`, `workflows`, `runs`, `images` and `models`.
- **Five step-by-step skills**: `build-a-workflow`, `find-detections`, `take-photos`, `download-footage` and `verify-changes`. In Claude Code they are also commands, such as `/mcp__openskycam__build-a-workflow`.
- **The rules.** Times are UTC. Test a workflow before a full run, and follow the run until it finishes. After any change, read it back and report what it observed, not what it attempted.

The guides are Markdown files in [`package/dashboard/ui/public/agent/`](https://github.com/Deibler/openskycam/tree/main/package/dashboard/ui/public/agent). Edit them to change what every connected agent is told.

## Guardrails

These are enforced by the server, not left to the agent:

- **No key can make keys.** Keys are created, rotated and revoked only on the website, by someone signed in through Cloudflare Access.
- **Deletes show what would be lost first.** Nothing is deleted until the agent calls again with `confirm: true` and the revision the preview gave it.
- **Edits cannot overwrite each other.** A Workshop edit carries the revision the agent read and fails on a newer one.
- **Cameras.** An Agent key reaches only the footage and images of its cameras.
- **Links expire.** Download links last an hour and stop working when the key is revoked.
- **Every call is logged.** Each tool call writes an `agent_tool` event with the key, tool and action to Workers Logs.

## Set it up with a coding agent

A coding agent with a terminal, such as Claude Code, can run the whole setup. It writes the answers to `.env`, then runs:

```sh
npm install
npm run setup -- --yes
```

With `--yes` the setup asks nothing. It takes every answer from `.env`, uses suggested values where there is one, and stops at the first missing or wrong answer, naming the key to set, with exit code 1. The agent fixes that key and runs it again; finished steps are skipped. Two secrets are read from the environment instead, so they are never written to `.env`:

| Variable | What it is |
|---|---|
| `STORE_TUNNEL_TOKEN` | The footage store's tunnel token, written only to the store host |
| `OPENSKYCAM_WORKSHOP_KEY` | The processor's Run Workshop jobs key, written only to the processor host |

[Configuration](configuration.md#guided-setup) lists every `.env` key the setup reads. With `--yes`, a processor is installed only when `PROCESSOR_HOST` is set.

`npm run setup -- --check` checks all nine steps of a running deployment and changes nothing. It exits with 1 when a required step fails and says why, so an agent can use it to confirm a deployment works, or to find what broke.

### What needs you

| Step | Why an agent cannot do it |
|---|---|
| Sign in to Cloudflare once (`wrangler login`) | It opens a browser login |
| Create the tunnel and the Access application in the Cloudflare dashboard, and the Browser Integrity Check rule for the API host | Wrangler's login cannot create them. The setup explains each click; the agent passes on the tunnel token, team domain and audience tag |
| Create API keys on the website: Agent, and Run Workshop jobs for a processor | Only a person signed in through Access can create keys |
| Allow SSH key login to each host, and `sudo` on Linux hosts | The setup uses `sudo -n` with `--yes`, so it fails at once instead of waiting for a password |

## Change the code with an agent

The repository is laid out for coding agents:

- [`AGENTS.md`](https://github.com/Deibler/openskycam/blob/main/AGENTS.md) gives the conventions: where code goes, the layer rules and file names, and what to verify.
- `make check` runs every test suite, the architecture checks, the docs build with its link check, and shell lint. It needs no Cloudflare account, so an agent can run it anywhere.
- The architecture checks enforce the layer rules mechanically: SQL outside `db/`, HTTP objects in services, and a misplaced type all fail ([Architecture](develop/architecture.md#what-the-checks-enforce)).
- Every deploy step is a command: `npm run release` and `npm run deploy` for the Workers, `external/store/deploy.sh`, `make deploy HOST=<relay-host>` for the relay, and `install-workshop.sh` for a processor. A change to processor code needs a new runtime, which an agent registers with `runs register_runtime` ([Processor](processor.md#runtimes)).
