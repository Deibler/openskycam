# Workflows

A workflow is a graph of **steps** joined by **links**. Frames flow from the input, through footage sampling, models, and conditions, into output buckets.

`workflows get` returns:

```json
{"revision":231,"workflow_id":"…","name":"Planes at dusk",
 "steps":[{"id":"input","kind":"input","label":"Input bucket","bucketId":"camera-archive","camera":"sky01"}, …],
 "links":[{"from":"input","to":"footage","port":"out"}, …],
 "ready":false,"issue":"Connect every output port."}
```

## Step kinds and settings

| kind | settings |
| --- | --- |
| `schedule` | `trigger`: `time`, `arrival`, or `workflow`. `days`: weekdays 0–6 (0 = Sunday). `at`: `HH:MM` UTC. `workflowId`: the workflow to follow. `onlyIf`: skip when there is nothing to do. |
| `input` | `bucketId`: `camera-archive` for video, or a labeled bucket's ID to re-process its images. `camera`: e.g. `sky01`, for the archive. `includeRejected`: `true` to re-process images reviewed as rejected too (default `false`), e.g. to see whether a model repeats a false alarm. |
| `footage` | `day`: `YYYY-MM-DD`, `run-day` (the run's UTC date), or `previous-day`. `from`, `until`: `HH:MM:SS` UTC. `interval`: seconds between frames, 1–3600. `pick`: `first` (default) keeps the first frame of each interval; `change` reads every frame and keeps the one with the most new light, which catches short events like meteors and also follows saved objects through every frame. |
| `model` | `modelKey`: `family/version` from `models list` with `workflow_ready: true`. `score`: minimum confidence, 0–1. |
| `condition` | `match`: `all` or `any`. `rules`: 1–8 rules, listed below. Has two ports: `yes` and `no`. |
| `nothing` | Ends a branch without saving the frame. |
| `output` | `bucketId`: a labeled bucket. A bucket name also works. |

Every step also has `label`, a display name.

Condition rules (the `id` is optional; one is generated):

- `{"kind":"class","className":"Plane","operator":"present"}`. The operator is `present` or `absent`.
- `{"kind":"confidence","className":"Plane","operator":"at-least","threshold":0.7}`. The operator is `at-least` or `below`.
- `{"kind":"count","className":"Bird","operator":"at-least","count":3}`. The operator is `at-least`, `equal`, or `at-most`.
- `{"kind":"motion","className":"Plane","operator":"moving"}`. The operator is `moving`, `stationary`, or `brief` (seen once or too briefly to tell). Each box is followed through its recording; the rule matches when at least one box of the class has that motion. To set fixed lights aside, match `any` of `moving` and `brief` and send `no` to another bucket.
- `{"kind":"time","from":"19:00","until":"05:00","timeZone":"UTC"}`. This covers overnight too.
- `{"kind":"weekday","days":[1,2,3,4,5],"timeZone":"UTC"}`

Class, confidence, count, and motion rules read the predictions of the model upstream. Class names are the model's (see `models list`). Motion rules and `pick: "change"` need a processor that tracks: starting a run on an older processor fails with "Update the Workshop processor".

## Links

`{"from":"<step id>","to":"<step id>","port":"out"}`. Conditions link out with `port: "yes"` and `port: "no"`. A schedule links only into the input.

## What a runnable workflow needs

`ready: true` in `get`, `check`, `create`, or `update` means a run can start. Otherwise, `issue` names the first problem. The rules:

- One input and at least one output. Every step is connected, and nothing loops.
- Each step has exactly one incoming link. Outputs and `nothing` may have several.
- Every port is linked: `out`, or both `yes` and `no` on a condition.
- A camera-archive input needs exactly one footage step, before any model. A labeled-bucket input has none.
- Every path into an output passes a model. A run cannot write into its own input bucket.
- 1–4 models, all `workflow_ready`. A run covers at most 100 recordings and 2,000 sampled frames, or 2,000 labeled images. Use a shorter window or a larger interval to fit.
- A schedule needs a moving footage day (`run-day` or `previous-day`). A `time` trigger needs days and `at`. With `run-day`, `at` must be at least 10 minutes after the window's `until`, so the footage has uploaded.

## Editing

- `workflows create` with `name` only builds input → footage → model → output for you to fill in. With `steps` and `links`, it builds exactly those.
- `workflows update` takes `workflow_id`, `revision`, and any of `name`, `steps`, `links`.
  - **`steps` replaces the step list.** Include every step to keep. For a kept step (same `id` and `kind`), omitted settings keep their current values. So `{"id":"detect","kind":"model","score":0.3}` changes only the score.
  - **`links` replaces all links.** Leave it out to keep the current links (links to removed steps are dropped).
- `workflows check` also counts the clips and frames the footage window holds for a run started now.
- `workflows delete` previews what goes: unfinished runs are cancelled, and results are kept. Then call it with `confirm: true` and the preview's `revision`.

New steps are placed on the website canvas automatically. Existing steps keep their positions.
