# Skill: download footage

1. Confirm the footage exists: `footage days`, then `footage list` for the window.
2. Get links:
   - One moment: `footage download` with `camera` and `at`.
   - A window: `footage download` with `from` and `to`. Each call returns up to 60 one-minute files. For longer windows, call once per hour.
3. Tell the user the size first (`total_bytes`). A minute is typically tens of MB.
4. Save each file with `curl -fL -o <filename> "<url>"`, where the user wants it. Links expire in an hour, so download soon or ask for new links.
5. Verify: each file exists, its size equals that entry's `bytes`, and `ffprobe <file>` (if installed) shows about 60 s of HEVC video.

To join clips: `ffmpeg -f concat -safe 0 -i list.txt -c copy out.mp4`, where list.txt has one `file 'name.mp4'` line per clip, in order.
