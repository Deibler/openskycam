#!/bin/bash
# Processes only explicitly submitted Workshop jobs. Independent of continuous inference.
# macOS: a launchd agent. Linux: a systemd user service (run `loginctl enable-linger $USER` once so it
# keeps running after you log out).
set -euo pipefail
if [ "$#" -lt 4 ]; then
  echo "Usage: $0 /absolute/python /absolute/key-file runtime-id api-origin [dependency-directory]" >&2
  exit 2
fi
workshop_python=$1
workshop_key=$2
workshop_runtime=$3
workshop_origin=$4
workshop_dependencies=${5:-}
workshop_source=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
workshop_plist=$("$workshop_python" - "$workshop_python" "$workshop_key" "$workshop_runtime" "$workshop_origin" "$workshop_source" "$workshop_dependencies" <<'PY'
import os, plistlib, re, sys
from pathlib import Path
from urllib.parse import urlsplit
python, key, runtime, origin, source, dependencies = sys.argv[1:]
if not re.fullmatch(r'workshop-[a-f0-9]{32}', runtime):
    raise SystemExit('A registered immutable Workshop runtime ID is required')
if urlsplit(origin).scheme != 'https':
    raise SystemExit('The persistent runner requires HTTPS')
python, key, source = (str(Path(p).absolute()) for p in (python, key, source))
if not Path(key).is_file() or Path(key).stat().st_mode & 0o077:
    raise SystemExit('Credential file must exist with mode 600')
environment = {'PYTHONUNBUFFERED': '1', 'PYTHONDONTWRITEBYTECODE': '1',
               'PYTHONPATH': os.pathsep.join(p for p in (source, dependencies) if p)}
arguments = [python, '-m', 'skyvision_processor', 'workshop-run',
             '--base-url', origin, '--key-file', key, '--runtime', runtime, '--watch']
if sys.platform == 'darwin':
    label = 'org.openskycam.workshop'
    folder = Path.home() / 'Library/LaunchAgents'; folder.mkdir(parents=True, exist_ok=True)
    path = folder / (label + '.plist')
    value = {'Label': label, 'WorkingDirectory': source, 'RunAtLoad': True, 'KeepAlive': True,
             # Background confines the runner to efficiency cores (decode measured 4.8x slower). Nice still yields to the recorder.
             'ThrottleInterval': 30, 'ProcessType': 'Standard', 'Nice': 10, 'LowPriorityIO': True,
             'EnvironmentVariables': environment,
             'ProgramArguments': arguments,
             'StandardOutPath': '/dev/null', 'StandardErrorPath': '/dev/null'}
    content = plistlib.dumps(value)
elif sys.platform.startswith('linux'):
    def quote(value, expand=True):  # systemd unit quoting; ExecStart= also expands $
        value = value.replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%')
        return '"' + (value.replace('$', '$$') if expand else value) + '"'
    folder = Path.home() / '.config/systemd/user'; folder.mkdir(parents=True, exist_ok=True)
    path = folder / 'skyvision-workshop.service'
    content = '\n'.join([
        '[Unit]', 'Description=SkyVision Workshop runner', 'After=network-online.target', 'StartLimitIntervalSec=0', '',
        '[Service]', 'WorkingDirectory=' + quote(source, False),
        *('Environment=' + quote(f'{k}={v}', False) for k, v in environment.items()),
        'ExecStart=' + ' '.join(quote(a) for a in arguments),
        'Restart=always', 'RestartSec=30', 'Nice=10', 'IOSchedulingClass=best-effort', 'IOSchedulingPriority=7',
        'StandardOutput=null', 'StandardError=null', '',
        '[Install]', 'WantedBy=default.target', '']).encode()
else:
    raise SystemExit('Supported on macOS (launchd) and Linux (systemd) only')
temporary = path.with_suffix('.partial')
temporary.write_bytes(content); temporary.chmod(0o600); os.replace(temporary, path)
print(path)
PY
)
case $workshop_plist in
  *.plist)
    workshop_domain="gui/$(id -u)"
    launchctl bootout "$workshop_domain" "$workshop_plist" 2>/dev/null || true
    launchctl bootstrap "$workshop_domain" "$workshop_plist"
    ;;
  *)
    systemctl --user daemon-reload
    systemctl --user enable skyvision-workshop.service
    systemctl --user restart skyvision-workshop.service
    echo "Status: systemctl --user status skyvision-workshop. Run 'loginctl enable-linger $USER' once to keep it running after logout."
    ;;
esac
echo "Workshop runner installed. Verify its heartbeat under Workshop before submitting work."
