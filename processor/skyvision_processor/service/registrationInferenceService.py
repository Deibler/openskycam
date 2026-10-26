import hashlib
import re
from ..db.PipelineInferenceOps import registration_sql
from ..models.processorInferencemodel import JsonObject
from ..utils.provenanceInferenceUtil import canonical

def register(pipeline: JsonObject, camera: str, enable: bool, recording_rows: list[JsonObject] | None) -> str:
    m = pipeline
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', camera):
        raise ValueError('Invalid camera')
    for field in ('model_sha256', 'code_sha256', 'config_sha256'):
        if not re.fullmatch(r'[a-f0-9]{64}', str(m.get(field, ''))):
            raise ValueError('Invalid pipeline fingerprint')
    if hashlib.sha256(canonical(m['config']).encode()).hexdigest() != m['config_sha256']:
        raise ValueError('Config hash mismatch')
    expected_id = 'baseline-' + hashlib.sha256(canonical({k: m[k] for k in ('model_sha256', 'code_sha256', 'config_sha256', 'config')}).encode()).hexdigest()[:24]
    if m['id'] != expected_id:
        raise ValueError('Pipeline id mismatch')
    recording = None
    if recording_rows is not None:
        if len(recording_rows) != 1 or recording_rows[0]['cam'] != camera or not re.fullmatch(r'[a-f0-9]{64}', recording_rows[0]['sha256']):
            raise ValueError('Expected exactly one recording from the selected camera with its checksum')
        recording = recording_rows[0]
    return registration_sql(m, camera, enable, recording)
