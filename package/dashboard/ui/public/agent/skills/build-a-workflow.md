# Skill: build and run a workflow

Goal: a workflow that samples a footage window, detects objects, keeps the frames you want, and runs to completion.

1. **Know the parts.** Read guide `workflows` if you haven't. Then gather:
   - `models list`: pick a `workflow_ready` model whose classes fit the goal.
   - `buckets list`: pick an output bucket, or `buckets create` one with a descriptive name.
   - `footage days` and `footage list`: make sure the window you want has recordings.
2. **Create it** with every step and link in one call:
   ```json
   {"action":"create","name":"Planes 18:00–19:00",
    "steps":[
     {"id":"input","kind":"input","bucketId":"camera-archive","camera":"sky01"},
     {"id":"footage","kind":"footage","day":"2026-09-23","from":"18:00:00","until":"19:00:00","interval":5},
     {"id":"detect","kind":"model","modelKey":"combined-detector/v2","score":0.4},
     {"id":"planes","kind":"condition","match":"all","rules":[{"kind":"class","className":"Plane","operator":"present"}]},
     {"id":"keep","kind":"output","bucketId":"<bucket_id>"},
     {"id":"drop","kind":"nothing"}],
    "links":[{"from":"input","to":"footage"},{"from":"footage","to":"detect"},{"from":"detect","to":"planes"},
     {"from":"planes","to":"keep","port":"yes"},{"from":"planes","to":"drop","port":"no"}]}
   ```
   Class names must match the model's exactly (see `models list`).
3. **Read the result.** `ready: true` means it can run. Otherwise fix `issue` with `workflows update` (pass the returned `revision`), and repeat until ready.
4. **Check the size.** `workflows check` reports the clips and frames in the window. A run allows at most 100 clips and 2,000 frames. Shorten the window or raise `interval` if needed.
5. **Test.** `runs test` with `image_limit` 10. Loop `runs watch` until `finished: true`. Look at a few previews with `images view` (pass the test's `run_id`). Are the detections right? Is `score` too strict or too loose? Adjust and test again.
6. **Run.** `runs start`, then loop `runs watch` until finished. Report progress to the user as it moves.
7. **Verify** (skill `verify-changes`): `runs status` shows `completed` with no `errors`, and `images search` with the `run_id` returns the saved frames.

To run it automatically, add a schedule step linked into the input (guide `workflows`, Schedules). Use `run-day` or `previous-day` as the footage day.
