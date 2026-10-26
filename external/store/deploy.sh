#!/bin/bash
# Install or update the footage store and its tunnel on a macOS host (launchd agents) or a Linux host
# (systemd user services; run `loginctl enable-linger $USER` there once so they run without a login).
# Usage: external/store/deploy.sh <ssh-host> <footage-root> [--system-disk]
# The store refuses writes while <footage-root> is not a mount point, so a missing drive never fills
# the system disk. --system-disk is for a footage folder on the system disk itself.
# Secrets live only on the host, in ~/.config/skyvision-store/: store.token (created here when
# missing) and tunnel.token (the store tunnel's token, written once during setup).
set -euo pipefail
if [ "$#" -lt 2 ] || [ "$#" -gt 3 ] || { [ "$#" -eq 3 ] && [ "$3" != --system-disk ]; }; then
  echo "Usage: $0 <ssh-host> <footage-root> [--system-disk]   (for example: $0 me@store-host /mnt/footage)" >&2
  exit 2
fi
HOST=$1
ROOT=$2
DISK=${3:-}
cd "$(dirname "$0")"

ssh "$HOST" 'mkdir -p ~/skyvision-store && rm -rf ~/skyvision-store/skyvision_store'
scp -qr skyvision_store "$HOST":skyvision-store/
# shellcheck disable=SC2029  # ROOT is expanded here on purpose; the rest runs remotely.
ssh "$HOST" "ROOT='$ROOT' DISK='$DISK' bash -s" <<'EOF'
set -euo pipefail
# Non-interactive ssh on macOS usually lacks Homebrew's PATH; prefer its python3, which has Pillow.
PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
python=$(command -v python3) || { echo "python3 not found on the store host" >&2; exit 1; }
cloudflared=$(command -v cloudflared) || { echo "cloudflared not found on the store host; install it first" >&2; exit 1; }
config=$HOME/.config/skyvision-store
[ -s "$config/tunnel.token" ] || { echo "missing $config/tunnel.token" >&2; exit 1; }
[ -s "$config/store.token" ] || (umask 077 && openssl rand -hex 32 > "$config/store.token")
"$python" -c 'import PIL' 2>/dev/null || echo "warning: no Pillow for $python; thumbnails will answer 503" >&2

case $(uname) in
Darwin)
  "$python" - "$ROOT" "$config" "$python" "$cloudflared" "$DISK" <<'PY'
import os, plistlib, sys
from pathlib import Path
root, config, python, cloudflared, disk = sys.argv[1:]
home = Path.home()
agents = {
    'org.openskycam.store': [python, '-m', 'skyvision_store', '--root', root,
                             '--token-file', f'{config}/store.token', *([disk] if disk else [])],
    'org.openskycam.store-tunnel': [cloudflared, 'tunnel', '--no-autoupdate', 'run',
                                    '--token-file', f'{config}/tunnel.token'],
}
for label, arguments in agents.items():
    log = str(home / 'Library/Logs' / f'{label}.log')
    plist = {'Label': label, 'ProgramArguments': arguments, 'WorkingDirectory': str(home / 'skyvision-store'),
             'EnvironmentVariables': {'PYTHONUNBUFFERED': '1', 'PYTHONDONTWRITEBYTECODE': '1'},
             'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 10,
             'StandardOutPath': log, 'StandardErrorPath': log}
    path = home / 'Library/LaunchAgents' / f'{label}.plist'
    temporary = path.with_suffix('.partial')
    temporary.write_bytes(plistlib.dumps(plist))
    os.replace(temporary, path)
PY
  for label in org.openskycam.store org.openskycam.store-tunnel; do
    # By plist path, bootout waits for the process to exit. By label it returns at once, and the
    # bootstrap fails ("Operation already in progress") while the old process is still exiting.
    launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/$label.plist" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/$label.plist"
  done
  sleep 3
  launchctl list | grep -E 'org\.openskycam\.store'
  tail -n 3 "$HOME/Library/Logs/org.openskycam.store.log"
  ;;
Linux)
  units=$HOME/.config/systemd/user
  mkdir -p "$units"
  cat > "$units/skyvision-store.service" <<UNIT
[Unit]
Description=SkyVision footage store
StartLimitIntervalSec=0

[Service]
WorkingDirectory=$HOME/skyvision-store
Environment=PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
ExecStart="$python" -m skyvision_store --root "$ROOT" --token-file "$config/store.token" $DISK
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
UNIT
  cat > "$units/skyvision-store-tunnel.service" <<UNIT
[Unit]
Description=SkyVision footage store tunnel (cloudflared)
StartLimitIntervalSec=0

[Service]
ExecStart="$cloudflared" tunnel --no-autoupdate run --token-file "$config/tunnel.token"
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable skyvision-store skyvision-store-tunnel >/dev/null 2>&1
  systemctl --user restart skyvision-store skyvision-store-tunnel
  sleep 3
  systemctl --user --no-pager status skyvision-store skyvision-store-tunnel | grep -E "●|Active:"
  journalctl --user-unit=skyvision-store -n 3 -o cat --no-pager
  ;;
*)
  echo "unsupported store host: $(uname)" >&2
  exit 1
  ;;
esac
EOF
