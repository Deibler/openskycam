"""Publish immutable trained models. Device activation is an independent action."""
import hashlib
import json
from pathlib import Path
import time
from ..db import ModelInferenceOps as ops
from ..utils.httpSharedUtil import Client

CHUNK_BYTES = 8 * 1024 * 1024
MAX_BYTES = 1024 * 1024 * 1024

def publish(client: Client, metadata: dict, files: list[Path]) -> dict:
    if not files or len(files) > 16 or len({p.name for p in files}) != len(files):
        raise ValueError('Supply 1–16 artifact files with distinct filenames')
    # Validation before transferring weights avoids uploading an incomplete model card.
    required = ('family', 'version', 'name', 'description', 'task', 'adapter', 'classes', 'input', 'evaluations')
    if any(k not in metadata for k in required):
        raise ValueError('Model metadata needs: ' + ', '.join(required))
    formats = {a['filename']: a['format'] for a in metadata.get('artifacts', [])}
    artifacts = []
    for path in files:
        length = path.stat().st_size
        if not 0 < length <= MAX_BYTES:
            raise ValueError('Each model artifact must be between 1 byte and 1 GiB')
        chunks = []; digest = hashlib.sha256(); total = 0
        with path.open('rb') as source:
            while chunk := source.read(CHUNK_BYTES):
                digest.update(chunk); total += len(chunk)
                if total > length:
                    raise ValueError('The checkpoint changed during publication')
                sha = hashlib.sha256(chunk).hexdigest()
                for attempt in range(3):
                    try:
                        ops.upload_chunk(client, sha, chunk); break
                    except OSError:
                        if attempt == 2: raise
                        time.sleep(attempt + 1)
                chunks.append({'sha256': sha, 'bytes': len(chunk)})
        if total != length:
            raise ValueError('The checkpoint changed during publication')
        sha = digest.hexdigest()
        ops.finish_artifact(client, {'sha256': sha, 'bytes': length, 'chunks': chunks})
        artifacts.append({'sha256': sha, 'bytes': length, 'filename': path.name,
                          'format': formats.get(path.name, 'pytorch-checkpoint' if path.suffix == '.pt' else path.suffix.lstrip('.'))})
    return ops.publish_model(client, {**metadata, 'artifacts': artifacts})

def training_callback(client: Client, metadata: dict):
    """Ultralytics on_train_end callback. Failure propagates; never claim an upload succeeded."""
    def completed(trainer):
        names = trainer.model.names
        classes = [{'id': int(i), 'name': str(name)} for i, name in sorted(names.items())]
        metrics = {str(k): float(v) for k, v in trainer.metrics.items() if isinstance(v, (int, float))}
        card = {**metadata, 'classes': classes,
                'input': {**metadata.get('input', {}), 'training_size': trainer.args.imgsz},
                'evaluations': [{'label': 'Training completion validation', 'split': 'validation',
                                 'dataset': str(trainer.args.data), 'metrics': metrics,
                                 'independently_reproduced': False}]}
        # Preserve the actual class map and metrics even when the network is offline.
        ops.save_training_card(Path(trainer.save_dir), card)
        result = publish(client, card, [Path(trainer.best)])
        print(json.dumps({'published': result['family'] + '/' + result['version']}), flush=True)
    return completed

def train_and_publish(client: Client, metadata: dict, config: dict):
    from ultralytics import YOLO
    settings = dict(config)
    # Ultralytics puts a relative project under its own runs directory; resolve it from here instead.
    if 'project' in settings: settings['project'] = str(Path(settings['project']).resolve())
    source = settings.pop('model')
    model = YOLO(source)
    model.add_callback('on_train_end', training_callback(client, metadata))
    model.train(**settings)
