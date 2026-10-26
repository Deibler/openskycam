"""Reconcile desired models at job boundaries, preserving the last usable deployment."""
from pathlib import Path
import re
from ..db import ModelInferenceOps as ops
from ..models.modelInferencemodel import Deployment, ModelBinding, SyncResult
from ..utils import deviceInferenceUtil as devices
from ..utils.httpSharedUtil import Client
from ..utils.provenanceInferenceUtil import code_hash, file_hash, manifest
from .jobInferenceService import run_one

def validate_deployment(value: Deployment, device: str):
    if value.get('schema_version') != 1 or value.get('device_id') != device or not re.fullmatch('[a-f0-9-]{36}', value.get('revision', '')):
        raise ValueError('Invalid device assignment')
    if not isinstance(value.get('models'), list) or len(value['models']) > 16:
        raise ValueError('Invalid model assignment')
    slots = set()
    for binding in value['models']:
        artifact = binding['artifact']; model = binding['model']; p = binding['parameters']
        if not re.fullmatch('[a-z0-9][a-z0-9._-]{0,63}', binding['slot']) or binding['slot'] in slots:
            raise ValueError('Invalid model slot')
        slots.add(binding['slot'])
        if model['adapter'] != 'ultralytics' or model['task'] not in ('object-detection', 'image-classification'):
            raise ValueError('Unsupported runtime adapter')
        if not re.fullmatch('[a-f0-9]{64}', artifact['sha256']) or not 0 < artifact['bytes'] <= 1024**3:
            raise ValueError('Invalid artifact')
        if artifact not in model['artifacts'] or not artifact['filename'].endswith('.pt'):
            raise ValueError('Artifact is not part of its immutable model version')
        if set(p) != {'imgsz', 'confidence', 'iou', 'device'} or not isinstance(p['imgsz'], int) or not 32 <= p['imgsz'] <= 2048 or p['imgsz'] % 32 or p['device'] not in ('auto', 'cpu', 'mps', 'cuda'):
            raise ValueError('Invalid inference parameters')
        if not all(isinstance(p[k], (int, float)) and 0 <= p[k] <= 1 for k in ('confidence', 'iou')):
            raise ValueError('Invalid confidence or IoU')

def smoke_model(path: Path, binding: ModelBinding):
    # Publisher credentials control trusted model code. Never load checkpoints from arbitrary URLs.
    import numpy as np
    import torch
    from ultralytics import YOLO
    torch.set_num_threads(2)
    model = YOLO(str(path))
    try:
        expected = {c['id']: c['name'] for c in binding['model']['classes']}
        if model.names != expected:
            raise ValueError('Checkpoint class IDs do not match its registry manifest')
        task = {'object-detection': 'detect', 'image-classification': 'classify'}[binding['model']['task']]
        if model.task != task:
            raise ValueError('Checkpoint task does not match its registry manifest')
        p = binding['parameters']
        device = devices.pick_device(torch, p['device'])
        result = model.predict(np.zeros((64, 64, 3), dtype=np.uint8), imgsz=p['imgsz'], conf=p['confidence'], iou=p['iou'], device=device, verbose=False)
        if len(result) != 1:
            raise ValueError('Runtime model validation failed')
    finally:
        del model
        devices.empty_cache(torch)

def baseline_settings(binding: ModelBinding) -> dict:
    # This adapter bridges the existing integration runner. Workflow execution is separate.
    names = {c['name'].lower() for c in binding['model']['classes']}
    if binding['model']['task'] != 'object-detection' or names != {'plane', 'wildlife', 'meteorite'}:
        raise ValueError('This model needs a workflow adapter; the baseline runner supports the three legacy classes only')
    p = binding['parameters']
    return {'process_fps': 4, 'yolo_imgsz': p['imgsz'], 'confidence': p['confidence'], 'nms_iou': p['iou'],
            'device': p['device'], 'enabled_classes': [1, 2, 3], 'half': False, 'tta': False, 'deep_scan': False,
            'edge_margin': 0, 'min_box_px': 0, 'max_aspect': 1000000, 'track_lost_buffer': 12}

def sync_models(client: Client, device: str, root: Path) -> SyncResult:
    if not re.fullmatch('[a-z0-9][a-z0-9._-]{0,63}', device):
        raise ValueError('Invalid device ID')
    with ops.runtime_lock(root):
        active = ops.read_active(root)
        current = active['deployment'] if active else None
        keep = {m['artifact']['sha256'] for m in current['models']} if current else set()
        desired = None
        try:
            desired = ops.get_desired(client, device)
            if desired is None:
                return {'status': 'unassigned', 'revision': None, 'models': len(keep)}
            validate_deployment(desired, device)
            missing = [m['artifact'] for m in desired['models'] if not ops.artifact_path(root, m['artifact']).exists()]
            if sum({a['sha256']: a['bytes'] for a in missing}.values()) + 64 * 1024**2 > ops.available_bytes(root):
                raise ValueError('Insufficient disk space for an atomic model replacement')
            current_code = code_hash()
            changed = not active or active['code_sha256'] != current_code or current['revision'] != desired['revision']
            for binding in desired['models']:
                artifact = binding['artifact']; path = ops.artifact_path(root, artifact)
                valid = path.exists() and path.stat().st_size == artifact['bytes'] and file_hash(path) == artifact['sha256']
                if not valid:
                    ops.download_artifact(client, artifact, path); changed = True
                if changed:
                    smoke_model(path, binding)
            if (ops.get_desired(client, device) or {}).get('revision') != desired['revision']:
                raise ValueError('Assignment changed during download; retry sync')
            pipelines = {}
            for binding in desired['models']:
                try: settings = baseline_settings(binding)
                except ValueError: continue
                pipelines[binding['slot']] = manifest(ops.artifact_path(root, binding['artifact']), settings)
            if changed:
                ops.activate(root, {'deployment': desired, 'code_sha256': current_code, 'pipelines': pipelines})
            keep = {m['artifact']['sha256'] for m in desired['models']}
            ops.prune(root, keep)
        except Exception:
            # A failed candidate is disposable; the active version and parameters survive.
            ops.prune(root, keep)
            try: ops.report(client, device, desired['revision'] if desired else None, current['revision'] if current else None, 'error', 'model-sync-failed')
            except Exception: pass
            raise
        # Report after committing. An offline acknowledgment cannot roll back local activation.
        ops.report(client, device, desired['revision'], desired['revision'], 'ready')
        return {'status': 'ready', 'revision': desired['revision'], 'models': len(desired['models'])}

def run_deployed(client: Client, camera: str, root: Path, slot: str):
    with ops.runtime_lock(root):
        active = ops.read_active(root)
        if not active or active['code_sha256'] != code_hash():
            raise ValueError('Sync and validate this processor revision before running')
        binding = next((m for m in active['deployment']['models'] if m['slot'] == slot), None)
        if not binding or slot not in active['pipelines']:
            raise ValueError('No compatible baseline detector in that slot')
        identity = ops.identity(client)
        if identity.get('scope') != 'processor:run' or identity.get('pipeline_id') != active['pipelines'][slot]['id']:
            raise ValueError('Use an inference key scoped to the active immutable pipeline')
        return run_one(client, camera, ops.artifact_path(root, binding['artifact']), active['pipelines'][slot])
