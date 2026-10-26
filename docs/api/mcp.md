---
title: MCP server
description: Connect an AI agent to openskycam through its remote Model Context Protocol server.
---

`https://<api-host>/v1/mcp` is a remote [Model Context Protocol](https://modelcontextprotocol.io) server. An agent connected to it can browse footage, take photos from stored video, build and run workflows, review detections, freeze datasets and deploy models: everything the website does except managing API keys. It needs an **Agent** key. [Run it with an agent](../agents.md) shows what to ask and which tools answer.

## Connect

1. On the website, open **API access**, choose **Create key**, set Purpose to **Agent: MCP and full API**, and choose the key's cameras and expiry.
2. The dialog shows a command with the key filled in. For Claude Code:

   ```sh
   claude mcp add --transport http openskycam https://<api-host>/v1/mcp \
     --header "Authorization: Bearer svk_…" --scope user
   ```

3. Restart the agent. It receives the server's instructions on connect and starts from the `guide` tool.

Other MCP clients connect to the same URL over Streamable HTTP with an `Authorization: Bearer` header.

## Protocol

The server is stateless: each `POST` carries one JSON-RPC 2.0 message and gets its answer as JSON, with no session and no server-sent stream. `GET` and `DELETE` answer `405` with `Allow: POST`.

| Detail | Value |
|---|---|
| Protocol versions | `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`. An unknown version is answered with the newest. |
| Server | `name: openskycam`, `title: OpenSkyCam` |
| Capabilities | `tools`, `resources`, `prompts` |
| Request size | 1,000,000 bytes |
| Notifications | Answered `202` with no body |
| Errors | A missing or wrong key is an HTTP `401` or `403`, so clients report it at connect. An unknown method is JSON-RPC `-32601`, a malformed message `-32600`, and invalid arguments `-32602`. A tool that fails returns a result with `isError: true` and the reason as text. |

## Tools

Seven tools cover the site. Each takes an `action` argument, and the tool descriptions list every action's arguments.

| Tool | Actions |
|---|---|
| `guide` | No topic: the index of guides and skills. `topic`: one guide or skill. Read-only. |
| `footage` | `cameras` (your cameras, upload health, storage), `days` (dates with footage in a month), `list` (recordings from–to), `download` (links for the recording at `at`, or every recording from–to), `photo` (a still JPEG from stored video at `at`) |
| `workflows` | `list`, `get` (steps, settings and links), `check` (can it run, and how much footage its window holds), `create`, `update`, `delete` |
| `runs` | `list`, `test`, `start`, `status`, `watch`, `cancel`, `schedules`, `runtimes`, `register_runtime` |
| `images` | `search` (by bucket, run, class, minimum confidence, review status, camera and time), `view` (up to 4 images, optionally cropped to a box), `review` (up to 100 at once), `save` (up to 20, kept past their expiry), `link` (full-size download links) |
| `buckets` | `list`, `create`, `update`, `delete`, `versions`, `create_version`, `export_version` (a manifest link) |
| `models` | `list`, `get` (one model's manifest), `devices`, `register_device`, `deploy` |

Agents read and write workflow steps as `{ id, kind, label, ...settings }` and links as `{ from, to, port }`, a flattened form of the website's document. `workflows create` without steps makes input → footage → model → output for the agent to fill in.

Two actions wait instead of polling:

- `runs watch` waits up to `wait_seconds` (at most 45, default 30) and returns as soon as the run's progress changes or it finishes. Call it again to keep following.
- `footage photo` queues a one-frame job on the newest processor that has checked in. The processor decodes the frame, usually in 5 to 30 seconds. If the photo is not ready within `wait_seconds` (at most 45), the answer carries a `photo_id` to ask again with. The agent gets a downscaled copy to look at and a signed link to the full frame. Photo runs are temporary previews for an hour and are not listed with workflow runs.

## Guides, resources and prompts

The guides and skills are Markdown files in [`package/dashboard/ui/public/agent/`](https://github.com/Deibler/openskycam/tree/main/package/dashboard/ui/public/agent). Edit them to change what agents are told.

| Kind | Names | Also served as |
|---|---|---|
| Guides | `overview`, `footage`, `workflows`, `runs`, `images`, `models` | Resources `openskycam://guides/<name>` |
| Skills (step-by-step) | `build-a-workflow`, `find-detections`, `take-photos`, `download-footage`, `verify-changes` | Resources `openskycam://skills/<name>`, and prompts; in Claude Code, `/mcp__openskycam__build-a-workflow` |

## Rules the agent receives

The server's instructions, sent at connect, tell the agent to read `guide` (index, then `overview`, then the area it will touch) before acting, and set these rules:

- Times are UTC ISO 8601.
- Workshop edits take the revision the agent last read; on a conflict, read again and reapply.
- Delete shows a preview first. Confirm only what the user asked to delete.
- Test a workflow (`runs test`) before a full run (`runs start`), then follow it with `runs watch` until finished.
- After any change, read it back to verify it (the `verify-changes` skill), and report what was observed, not what was attempted.
- Download links are short-lived and grant access to their file: give them only to the user.

## Security

- **Scope.** Only `agent` keys can call `/v1/mcp`; others get `403`. Agent keys work only on the API host, never on the website, and cannot create, rotate or revoke keys.
- **Cameras.** Footage, photos and images are limited to the key's cameras. A workflow's camera-archive input must name one of them.
- **Revisions.** Workshop edits carry the revision the agent read, and fail on a newer one instead of overwriting.
- **Deletes.** `delete` first returns a preview of what would be lost and the revision to confirm with. Nothing is deleted until the agent calls again with `confirm: true` and that revision.
- **Links.** Download links for video, full-size images, photos and manifests are signed for one `GET` path and last an hour. Revoking or rotating the key ends them ([API overview](../api.md)).
- **Audit.** Every tool call logs an `agent_tool` event to Workers Logs with the key ID, tool and action.
- **Lifetime.** Keys expire after at most 365 days; revoking one stops it on the next request.

## MCP or the REST API

Use MCP when a person directs an agent in conversation. The tools return compact, readable results and images the agent can look at, and the guides teach it the rules. Use the REST API for scripts, schedules outside openskycam and clients in other languages: the same Agent key, for every camera, calls every website action at `/v1` with exact JSON in and out ([Workshop API](workshop.md)). An Agent key for only some cameras works with MCP and the footage endpoints but not the rest of the REST API.
