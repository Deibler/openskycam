# Skill: take photos from recordings

Photos come from stored video, so they exist only where footage does.

1. Find footage near the time you want. Use `footage days` for the month, then `footage list` with `from`/`to` around the moment. For "now", use `footage cameras` to get `newest_recording` (1–3 minutes behind real time).
2. Take it: `footage photo` with `camera` and `at`, e.g. `2026-09-24T18:42:10Z`. The time must fall inside a listed recording (`start` to `start + seconds`).
3. If the result has only a `photo_id` (still decoding), call `footage photo` again with just that `photo_id`.
4. Look at the returned image. Report its `captured_at`, which can be up to a second after `at`.
5. For the full-resolution file, share the `full_size.url` or save it with `curl -fL -o photo.jpg "<url>"`. It expires with the photo, after an hour.
6. For a series (a timelapse, before and after): repeat with different `at` values. For many frames at a fixed interval, build a workflow instead (skill `build-a-workflow`).

If photos never finish, check `runs runtimes`: the processor must have checked in recently.
