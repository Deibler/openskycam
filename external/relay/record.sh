#!/bin/bash
# Pull the camera's main stream and cut it into 60 s MP4s aligned to the minute.
# -c copy: the bytes stored are exactly what the camera encoded; quality is set on the camera only.
# Fragmented MP4 (a fragment per keyframe, ~1 s): if ffmpeg dies mid-segment the file is still readable
# up to the last fragment. Plain MP4 writes its index only at the end, so a crash lost the whole segment.
# -tag:v hvc1, for HEVC only: Safari/QuickTime refuse HEVC tagged hev1 (ffmpeg's default for this stream).
# Retagging changes only the sample-entry label; decoded frames are bit-identical. ffmpeg refuses the
# tag on H.264, which keeps its usual avc1.
set -euo pipefail
mkdir -p "$LIVE_DIR"
cd "$LIVE_DIR"
export TZ=UTC   # filenames are UTC: no DST duplicates or gaps

codec=$(ffprobe -v error -rtsp_transport tcp -timeout 15000000 -select_streams v:0 \
  -show_entries stream=codec_name -of csv=p=0 "$CAMERA_RTSP_URL")
tag=()
[ "$codec" = hevc ] && tag=(-tag:v hvc1)

# ponytail: the RTSP URL (with camera password) is visible in `ps` to other users on this Pi; ffmpeg can't read it from a file.
exec ffmpeg -nostdin -hide_banner -loglevel warning \
  -rtsp_transport tcp -timeout 15000000 -fflags +genpts \
  -i "$CAMERA_RTSP_URL" \
  -map 0:v:0 -c copy "${tag[@]}" \
  -f segment -segment_time 60 -segment_atclocktime 1 -reset_timestamps 1 -strftime 1 \
  -segment_format mp4 -segment_format_options movflags=+frag_keyframe+empty_moov+default_base_moof \
  "${CAM_ID}_%Y%m%dT%H%M%SZ.mp4"
