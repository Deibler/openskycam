#!/bin/bash
# Installs model synchronization only. It never enables production inference.
# macOS: a launchd agent. Linux: a systemd user timer (run `loginctl enable-linger $USER` once so it
# keeps running after you log out).
set -euo pipefail
if [ "$#" -lt 4 ]; then
  echo "Usage: $0 /absolute/python device-id /absolute/key-file api-origin [runtime-directory]" >&2
  exit 2
fi
processor_python=$1
processor_device=$2
processor_key=$3
processor_origin=$4
processor_runtime=${5:-$HOME/.local/share/skyvision/models}
processor_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$processor_dir"
# Prove the interpreter, credential and assignment work before installing a timer.
"$processor_python" -m skyvision_processor sync-models --base-url "$processor_origin" \
  --key-file "$processor_key" --device "$processor_device" --runtime-dir "$processor_runtime"
processor_plist=$("$processor_python" - "$processor_python" "$processor_device" "$processor_key" "$processor_origin" "$processor_runtime" "$processor_dir" <<'PY'
import os, plistlib, re, sys
from pathlib import Path
python, device, key, origin, runtime, source = sys.argv[1:]
if not re.fullmatch('[a-z0-9][a-z0-9._-]{0,63}', device):
    raise SystemExit('Invalid device ID')
# Preserve the venv interpreter symlink; resolving it would bypass the environment.
python, key, runtime, source = (str(Path(p).absolute()) for p in (python, key, runtime, source))
arguments = [python, '-m', 'skyvision_processor', 'sync-models', '--base-url', origin,
             '--key-file', key, '--device', device, '--runtime-dir', runtime]
if sys.platform == 'darwin':
    label = 'org.openskycam.models.' + device
    folder = Path.home() / 'Library/LaunchAgents'
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / (label + '.plist')
    value = {'Label': label, 'WorkingDirectory': source, 'StartInterval': 60, 'RunAtLoad': True,
             'ProcessType': 'Background', 'LowPriorityIO': True,
             'EnvironmentVariables': {'PYTHONUNBUFFERED': '1', 'PYTHONDONTWRITEBYTECODE': '1'},
             'ProgramArguments': arguments,
             'StandardOutPath': '/dev/null', 'StandardErrorPath': '/dev/null'}
    files = {path: plistlib.dumps(value)}
elif sys.platform.startswith('linux'):
    def quote(value, expand=True):  # systemd unit quoting; ExecStart= also expands $
        value = value.replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%')
        return '"' + (value.replace('$', '$$') if expand else value) + '"'
    def unit_path(value):  # systemd never strips quotes from WorkingDirectory=, so write it raw
        return value.replace('%', '%%')
    folder = Path.home() / '.config/systemd/user'
    folder.mkdir(parents=True, exist_ok=True)
    name = 'skyvision-models-' + device
    path = folder / (name + '.timer')
    files = {
        folder / (name + '.service'): '\n'.join([
            '[Unit]', f'Description=SkyVision model sync ({device})', '',
            '[Service]', 'Type=oneshot', 'WorkingDirectory=' + unit_path(source),
            'Environment=PYTHONUNBUFFERED=1', 'Environment=PYTHONDONTWRITEBYTECODE=1',
            'ExecStart=' + ' '.join(quote(a) for a in arguments),
            'Nice=10', 'IOSchedulingClass=idle', 'StandardOutput=null', 'StandardError=null', '']).encode(),
        path: '\n'.join([
            '[Unit]', f'Description=SkyVision model sync ({device}) every 60 seconds', '',
            '[Timer]', 'OnActiveSec=0', 'OnUnitActiveSec=60', 'AccuracySec=5s', '',
            '[Install]', 'WantedBy=timers.target', '']).encode(),
    }
else:
    raise SystemExit('Supported on macOS (launchd) and Linux (systemd) only')
for target, content in files.items():
    temporary = target.with_suffix('.partial')
    temporary.write_bytes(content); temporary.chmod(0o600); os.replace(temporary, target)
print(path)
PY
)
case $processor_plist in
  *.plist)
    processor_domain="gui/$(id -u)"
    launchctl bootout "$processor_domain" "$processor_plist" 2>/dev/null || true
    launchctl bootstrap "$processor_domain" "$processor_plist"
    ;;
  *)
    systemctl --user daemon-reload
    # systemd keeps a unit it cannot parse and the timer then fails every minute; stop here instead of reporting success.
    for processor_unit in "skyvision-models-$processor_device.service" "skyvision-models-$processor_device.timer"; do
      processor_state=$(systemctl --user show --property=LoadState --value "$processor_unit")
      if [ "$processor_state" != loaded ]; then
        echo "systemd cannot load $processor_unit ($processor_state). See: systemctl --user status $processor_unit" >&2
        exit 1
      fi
    done
    systemctl --user enable "skyvision-models-$processor_device.timer"
    systemctl --user restart "skyvision-models-$processor_device.timer"
    echo "Run 'loginctl enable-linger $(id -un)' once to keep model sync running after logout."
    ;;
esac
echo "Model sync installed: $processor_device (every 60 seconds). Status is visible under Models → Devices."
