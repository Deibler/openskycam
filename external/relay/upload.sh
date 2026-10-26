#!/bin/bash
# Ship finished segments to the ingest Worker, oldest first.
# A file is deleted only after the Worker confirms it is stored (200/201).
# While the Worker is unreachable, or uploads fall behind, segments move from RAM to the SD-card spool and wait.
set -uo pipefail
shopt -s nullglob   # globs expand sorted; segment names sort chronologically
PENDING="$SPOOL_DIR/pending" BAD="$SPOOL_DIR/quarantine"
mkdir -p "$LIVE_DIR" "$PENDING" "$BAD"

# Returns 0 = stored, 1 = problem with this file (set aside), 2 = Worker unavailable (stop, retry later).
upload() {
  local f=$1 name start size sha code k v
  local -A m=()
  name=${f##*/}; start=${name#"${CAM_ID}_"}; start=${start%.mp4}
  while IFS='=' read -r k v; do m[$k]=$v; done < <(ffprobe -v error -select_streams v:0 -count_packets \
    -show_entries stream=codec_name,width,height,nb_read_packets:format=duration,bit_rate -of default=nw=1 "$f")
  if [[ ! ${m[duration]:-} =~ ^[0-9.]+$ || ! ${m[nb_read_packets]:-} =~ ^[0-9]+$ ]]; then
    echo "unreadable (cut off mid-write?), quarantined: $name"; mv "$f" "$BAD/"; return 1
  fi
  size=$(stat -c %s "$f")
  sha=$(sha256sum "$f" | cut -d' ' -f1)
  # Token goes in via stdin config so it never shows up in `ps`.
  code=$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 10 --max-time 600 -K - -X PUT -T "$f" \
    -H "Content-Type: video/mp4" -H "X-Sha256: $sha" \
    -H "X-Duration: ${m[duration]}" -H "X-Frames: ${m[nb_read_packets]}" -H "X-Codec: ${m[codec_name]}" \
    -H "X-Width: ${m[width]}" -H "X-Height: ${m[height]}" -H "X-Bitrate: ${m[bit_rate]}" \
    "$INGEST_URL/v1/segments/$CAM_ID/$start" <<< "header = \"Authorization: Bearer ${INGEST_TOKEN:-}\"")
  case $code in
    200|201) rm -f "$f"; echo "stored $name ($code, $((size / 1048576)) MB)"; return 0 ;;
    000|401|403|404|408|429|5??) echo "worker unavailable ($code), keeping $name"; return 2 ;;
    *) mv "$f" "$BAD/"; echo "rejected ($code), quarantined: $name"; return 1 ;;
  esac
}

# Finished segments kept in RAM. When uploads fall behind the camera, the rest wait on the SD card:
# a full RAM disk stops the recorder ("No space left on device"), losing footage.
RAM_BACKLOG=3
# Uploads at once. On 2026-10-14 one upload through the ingest Worker often crawled at ~4 Mbit/s
# (about the camera's rate) while three at once reached 24-28 Mbit/s together, every time.
PARALLEL=3

while true; do
  # Every live file except the newest is finished: ffmpeg writes one segment at a time.
  live=("$LIVE_DIR"/*.mp4)
  (( ${#live[@]} )) && unset 'live[-1]'
  if (( ${#live[@]} > RAM_BACKLOG )); then
    mv "${live[@]:0:${#live[@]}-RAM_BACKLOG}" "$PENDING/"
    live=("${live[@]: -RAM_BACKLOG}")
  fi
  # A few segments per pass, so RAM and disk are checked again after every batch, however long the backlog.
  # ponytail: a batch waits for its slowest upload; keep a rolling pool if one stalled upload holds up the rest.
  files=("${live[@]}" "$PENDING"/*.mp4)
  pause=10
  if (( ${#files[@]} )); then
    pids=() pause=0
    for f in "${files[@]:0:PARALLEL}"; do upload "$f" & pids+=($!); done
    for p in "${pids[@]}"; do wait "$p"; (( $? == 2 )) && pause=10; done
    if (( pause )); then
      for g in "${live[@]}"; do [[ -e $g ]] && mv "$g" "$PENDING/"; done
    fi
  fi
  # Never fill the disk; other services on this Pi need it. Oldest backlog goes first.
  while (( $(df --output=avail -k "$PENDING" | tail -1) < MIN_FREE_GB * 1048576 )); do
    backlog=("$PENDING"/*.mp4)
    (( ${#backlog[@]} )) || break
    echo "disk low, dropped oldest backlog: ${backlog[0]##*/}"; rm -f "${backlog[0]}"
  done
  sleep "$pause"
done
