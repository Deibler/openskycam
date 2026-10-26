# Footage and photos

Each camera uploads one 60-second recording per minute: MP4, HEVC video, no audio. Recordings are kept 40 days. The newest upload is usually 1–3 minutes behind real time.

## Finding footage

1. `footage cameras` lists your cameras. `receiving: true` means an upload arrived within the last few minutes. It also shows storage for the last 24 hours and in total.
2. `footage days` with `month: "2026-09"` lists the UTC dates that have recordings.
3. `footage list` with `from` and `to` lists the recordings between them: `start`, `seconds`, `bytes`, `width`, `height`. A page holds up to `limit` (500 at most). Pass `next_cursor` back as `cursor` for the next page.

A gap in the list means the camera or its uploader was down. It does not mean the sky was empty.

## Downloading video

- `footage download` with `at` returns the one recording that contains that instant.
- `footage download` with `from` and `to` returns up to 60 recordings.

Each file has a `url` and a `filename`. Save it with `curl -fL -o <filename> "<url>"`. Links expire after an hour. QuickTime and Safari play HEVC. Elsewhere, convert with `ffmpeg -i in.mp4 -c:v libx264 out.mp4`.

## Photos

`footage photo` with `at` pulls a still frame from the stored recording that covers that instant. You get:

- a downscaled copy to look at (`size`, 1024 px by default),
- the frame's exact `captured_at` (within one second after `at`; the frame is decoded at or just after the requested time),
- a `full_size` link to the original-resolution JPEG,
- `available_until`, one hour from the request. Photos are temporary; the recording is the permanent copy.

The processor decodes photos, so it has to be online (`runs runtimes` shows when it last checked in). A photo usually takes 5–30 seconds. If it is not ready within `wait_seconds` (up to 45), you get a `photo_id`: call `footage photo` again with only that `photo_id` to collect it. Asking again for the same camera and time within the hour reuses the same photo.

A photo can only come from footage that exists. If there is no recording at that time, check `footage list` around it.
