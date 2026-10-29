#!/bin/bash
# Self-test for upload.sh. Runs on the relay host (bash 5, ffmpeg): make test HOST=<ssh-host>
# Uses generated clips and an unreachable Worker; touches nothing outside a temp dir.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export CAM_ID=sky01 LIVE_DIR=$T/live SPOOL_DIR=$T/spool INGEST_URL=http://127.0.0.1:9 INGEST_TOKEN=test
mkdir -p "$LIVE_DIR"
clip() { ffmpeg -v error -f lavfi -i testsrc=size=64x64:rate=5 -t 1 -c:v mpeg4 -f mp4 "$LIVE_DIR/sky01_$1.mp4"; }
fail() { echo "FAIL: $*"; echo "--- upload.sh log"; cat "$T/log"; exit 1; }
has() { [[ -e $1/sky01_$2.mp4 ]]; }

head -c 4000 /dev/urandom > "$LIVE_DIR/sky01_20260101T000000Z.mp4"   # unreadable, oldest
clip 20260101T000100Z
clip 20260101T000200Z
clip 20260101T000300Z                                               # newest: still being written

# 1) Worker unreachable: quarantine the unreadable file, park finished segments, leave the newest alone.
MIN_FREE_GB=0 timeout 6 bash "$here/upload.sh" > "$T/log" 2>&1 || true
has "$SPOOL_DIR/quarantine" 20260101T000000Z || fail "unreadable segment not quarantined"
has "$SPOOL_DIR/pending" 20260101T000100Z    || fail "finished segment not parked"
has "$SPOOL_DIR/pending" 20260101T000200Z    || fail "finished segment not parked"
has "$LIVE_DIR" 20260101T000300Z             || fail "newest segment (still being written) was touched"
[[ $(find "$LIVE_DIR" -name '*.mp4' | wc -l) == 1 ]] || fail "unexpected files left in RAM"

# 2) Disk guard: with the floor above free space, set-aside files go first, then the backlog oldest first.
MIN_FREE_GB=1000000 timeout 6 bash "$here/upload.sh" > "$T/log" 2>&1 || true
[[ -z $(find "$SPOOL_DIR/pending" "$SPOOL_DIR/quarantine" -name '*.mp4') ]] || fail "disk guard left backlog"
grep -o 'dropped oldest [^ ]*' "$T/log" | head -3 | tr '\n' ' ' \
  | grep -q 'quarantine/sky01_20260101T000000Z.mp4 .*pending/sky01_20260101T000100Z.mp4 .*000200Z.mp4' \
  || fail "quarantine and backlog not dropped in order"
has "$LIVE_DIR" 20260101T000300Z || fail "disk guard touched the segment being written"

# 3) A Worker that takes uploads but slower than the camera records: RAM keeps only the next few
#    finished segments and the rest wait on the SD card, so the recorder never runs out of space.
#    Three uploads run at once.
rm -rf "$LIVE_DIR" "$SPOOL_DIR"; mkdir -p "$LIVE_DIR"
for m in 1 2 3 4 5 6; do clip "20260101T000${m}00Z"; done                 # 6: still being written
python3 -c "import socket, sys
s = socket.socket(); s.bind(('127.0.0.1', 0)); s.listen(8)
open(sys.argv[1], 'w').write(str(s.getsockname()[1])); held = []
while True: held.append(s.accept()); open(sys.argv[2], 'w').write(str(len(held)))" "$T/port" "$T/conns" &
slow=$!
while [[ ! -s $T/port ]]; do sleep 0.1; done
INGEST_URL=http://127.0.0.1:$(cat "$T/port") MIN_FREE_GB=0 timeout 6 bash "$here/upload.sh" > "$T/log" 2>&1 || true
kill "$slow" 2>/dev/null || true
has "$SPOOL_DIR/pending" 20260101T000100Z || fail "older finished segment left in RAM while uploads lag"
has "$SPOOL_DIR/pending" 20260101T000200Z || fail "older finished segment left in RAM while uploads lag"
has "$LIVE_DIR" 20260101T000600Z           || fail "newest segment (still being written) was touched"
[[ $(find "$LIVE_DIR" -name '*.mp4' | wc -l) == 4 ]] || fail "RAM holds more than 3 finished segments"
[[ $(cat "$T/conns" 2>/dev/null) == 3 ]] || fail "expected 3 uploads at once, saw $(cat "$T/conns" 2>/dev/null || echo 0)"

echo "upload.sh: all checks passed"
