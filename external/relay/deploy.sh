#!/bin/bash
# Install or update the relay on a Pi as systemd user services (no sudo; needs `loginctl enable-linger`).
# Usage: external/relay/deploy.sh <ssh-host>. Settings come from the repo's .env.
# The Worker token lives only on the Pi, in ~/.config/skyvision/ingest.env, so redeploys never touch it.
set -euo pipefail
if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <ssh-host>   (the relay host, for example: $0 pi@relay)" >&2
  exit 2
fi
HOST=$1
cd "$(dirname "$0")"
set -a
# shellcheck source=/dev/null
. ../../.env
set +a
: "${INGEST_URL:?set INGEST_URL in .env}" "${CAMERA_IP_ADDRESS:?set CAMERA_IP_ADDRESS in .env}" "${CAMERA_USERNAME?set CAMERA_USERNAME in .env}" "${CAMERA_PASSWORD?set CAMERA_PASSWORD in .env}"
esc() { printf '%s' "$1" | sed 's/[\\"]/\\&/g'; }
# The URL the setup guide's stream check opened: the same function percent-encodes the login.
CAMERA_RTSP_URL=$(node --input-type=module -e "import { rtspUrl } from '../../setup/lib.mjs'; process.stdout.write(rtspUrl(process.env));")

REMOTE_HOME=$(ssh "$HOST" 'mkdir -p ~/skyvision ~/.config/skyvision ~/.config/systemd/user && echo "$HOME"')
scp -q record.sh upload.sh "$HOST":skyvision/
scp -q skyvision-record.service skyvision-upload.service "$HOST":.config/systemd/user/
# Expanded here on purpose: the Pi receives finished values, never this repo's .env.
# shellcheck disable=SC2087
ssh "$HOST" 'chmod 755 ~/skyvision/*.sh; umask 077; cat > ~/.config/skyvision/relay.env' <<EOF
CAM_ID=${CAM_ID:-sky01}
CAMERA_RTSP_URL="$(esc "$CAMERA_RTSP_URL")"
LIVE_DIR=/dev/shm/skyvision
SPOOL_DIR=$REMOTE_HOME/skyvision/spool
INGEST_URL=$INGEST_URL
MIN_FREE_GB=${MIN_FREE_GB:-20}
EOF
ssh "$HOST" 'systemctl --user daemon-reload && systemctl --user enable skyvision-record skyvision-upload >/dev/null 2>&1 && systemctl --user restart skyvision-record skyvision-upload && systemctl --user --no-pager status skyvision-record skyvision-upload | grep -E "●|Active:"'
