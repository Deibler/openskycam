"""Registry transport and the explicitly owned, locked runtime model directory."""
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
from ..models.modelInferencemodel import ActiveDeployment, Artifact, Deployment
from ..utils.httpSharedUtil import Client

MARKER = 'skyvision-model-runtime-v1\n'

def get_desired(client: Client, device: str) -> Deployment | None:
    with client.open(f'/v1/models/devices/{device}/desired') as response:
        return json.load(response)['deployment']

def identity(client: Client) -> dict:
    with client.open('/v1/me') as response:
        return json.load(response)

def report(client: Client, device: str, revision: str | None, active_revision: str | None, status: str, error=None):
    return client.post(f'/v1/models/devices/{device}/status', {
        'revision': revision, 'active_revision': active_revision, 'status': status, 'error': error}, retry=True)

def upload_chunk(client: Client, digest: str, data: bytes):
    with client.open(f'/v1/models/chunks/{digest}', data, {'Content-Type': 'application/octet-stream'}, 'PUT') as response:
        return json.load(response)

def finish_artifact(client: Client, body: dict):
    return client.post('/v1/models/artifacts', body, retry=True)

def publish_model(client: Client, body: dict):
    return client.post('/v1/models', body, retry=True)

def save_training_card(directory: Path, metadata: dict) -> Path:
    destination = directory / 'skyvision-model.json'
    temporary = directory / '.skyvision-model.json.partial'
    temporary.write_text(json.dumps(metadata, indent=2, allow_nan=False) + '\n')
    os.replace(temporary, destination)
    return destination

@contextmanager
def runtime_lock(root: Path):
    # An arbitrary legacy model directory must never become a cleanup target.
    if root.is_symlink():
        raise ValueError('The runtime directory cannot be a symlink')
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    marker = root / '.skyvision-managed'
    if not marker.exists():
        if any(root.iterdir()):
            raise ValueError('Choose a new, empty directory for the managed model runtime')
        marker.write_text(MARKER)
    if marker.is_symlink() or marker.read_text() != MARKER:
        raise ValueError('Unrecognized model runtime directory')
    for name in ('artifacts', '.lock', 'active.json'):
        if (root / name).is_symlink():
            raise ValueError('Symlinks are not allowed in the managed runtime')
    with (root / '.lock').open('a') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        (root / 'artifacts').mkdir(exist_ok=True, mode=0o700)
        try:
            yield
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)

def read_active(root: Path) -> ActiveDeployment | None:
    path = root / 'active.json'
    return json.loads(path.read_text()) if path.exists() else None

def artifact_path(root: Path, artifact: Artifact) -> Path:
    digest = artifact['sha256']
    if not re.fullmatch('[a-f0-9]{64}', digest):
        raise ValueError('Invalid artifact hash')
    path = root / 'artifacts' / (digest + '.pt')
    if path.is_symlink():
        raise ValueError('Symlinks are not allowed in the model cache')
    return path

def available_bytes(root: Path) -> int:
    return shutil.disk_usage(root).free

def download_artifact(client: Client, artifact: Artifact, destination: Path):
    # A partial or corrupt download never replaces a usable checkpoint.
    temporary = destination.with_suffix('.partial')
    digest = hashlib.sha256(); count = 0
    try:
        with client.open('/v1/models/artifacts/' + artifact['sha256']) as response, temporary.open('wb') as target:
            while chunk := response.read(1024 * 1024):
                count += len(chunk)
                if count > artifact['bytes']:
                    raise ValueError('Model download exceeded its declared size')
                digest.update(chunk); target.write(chunk)
            target.flush(); os.fsync(target.fileno())
        if count != artifact['bytes'] or digest.hexdigest() != artifact['sha256']:
            raise ValueError('Model download checksum or size mismatch')
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)

def activate(root: Path, value: ActiveDeployment):
    fd, name = tempfile.mkstemp(prefix='.active-', dir=root)
    try:
        with os.fdopen(fd, 'w') as target:
            json.dump(value, target, sort_keys=True, allow_nan=False)
            target.flush(); os.fsync(target.fileno())
        os.replace(name, root / 'active.json')
    finally:
        Path(name).unlink(missing_ok=True)

def prune(root: Path, keep: set[str]):
    for path in (root / 'artifacts').iterdir():
        # Only exact filenames we create, in our owned directory. Never follow links.
        if not path.is_symlink() and path.is_file() and re.fullmatch('[a-f0-9]{64}\\.(pt|partial)', path.name):
            if path.suffix == '.partial' or path.stem not in keep:
                path.unlink()
