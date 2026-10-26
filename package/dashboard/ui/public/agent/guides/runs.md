# Runs

A run sends each recording in the workflow's footage window (or each image in a labeled input bucket) to the processor. The processor decodes the frames, runs the models, and uploads the frames that reach an output.

## Test first, then run

- `runs test` with `workflow_id` and `image_limit` (1–100, default 10) processes a few frames. Its results are **previews** that expire after an hour and never enter a bucket. Look at them with `images view` and the test's `run_id`.
- `runs start` with `workflow_id` runs the whole window and saves into the output buckets. Saved images expire with their source recording (40 days) unless you `images save` them.

Both use the saved workflow, so save your edits first. They fail with a clear message if the workflow is not ready (see guide `workflows`).

## One run at a time

The processor works on one workflow run at a time. A run started while another is unfinished, whether by you, the website, or a schedule, waits with status `queued`. Its `waiting_behind` lists the runs ahead of it, oldest first. It starts on its own when they finish; you don't need to retry. To go sooner, cancel a run ahead only if the user asks. Photos are single frames, so they skip the queue.

## Following progress live

`runs watch` with `run_id` waits until something changes, then returns. Something changes when a recording starts or finishes a phase, a frame is saved, or the run ends. With no change, it returns after `wait_seconds` (default 30, at most 45). Call it in a loop until `finished: true`.

Each result includes:

- `status`: `queued`, `running`, `completed`, `failed`, `cancelled`, or `expired`.
- `images.processed` / `images.expected`, and `percent`.
- `recordings`: counts by state.
- `working_on`: each recording in progress, with its `phase` (`downloading`, `loading_model`, `processing`, `uploading`, `finalizing`) and the workflow `step` it is on.
- `errors`: for any failed recording.
- `latest_images`: a few recent frames with their detections.

The processor works on 3 recordings at a time, at roughly a second or two per recording once the model is loaded. It checks for new work every few seconds.

`runs status` is the same view without waiting. `runs list` shows recent runs (optionally one workflow's). `runs cancel` stops a run: queued recordings are cancelled, and finished ones keep their results.

## Schedules

Add a `schedule` step to a workflow (guide `workflows`). The scheduler checks every minute. `runs schedules` lists each scheduled workflow and its last check:

- `started`: a run was created. Its `run_id` is given.
- `skipped`: nothing to do, for example no new footage.
- `failed`: the reason is in `message`.

A scheduled run's name says what started it.

## Processors

`runs runtimes` lists registered processor versions and when each last checked in. Runs go to the newest one that has checked in. When the processor's code changes, it needs a new runtime: `runs register_runtime` with `device_id` and `code_sha256`. Do this only when asked to update the processor.
