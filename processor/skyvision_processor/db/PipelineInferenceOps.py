"""Registration SQL generation only; applying migrations is an explicit operator action."""
from datetime import datetime, timezone
from ..models.processorInferencemodel import JsonObject
from ..utils.provenanceInferenceUtil import canonical

def quote(value: object) -> str:
    return 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"

def registration_sql(pipeline: JsonObject, camera: str, enable: bool, recording: JsonObject | None) -> str:
    m = pipeline
    statements = ['-- Apply ONLY to the isolated inference environment with --local.',
        'INSERT OR IGNORE INTO inference_pipelines VALUES (' + ','.join(quote(v) for v in
            (m['id'], m['model_sha256'], m['code_sha256'], m['config_sha256'], canonical(m['config']), datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z'))) + ');',
        'INSERT INTO inference_subscriptions (pipeline_id, cam, enabled) VALUES (' + ','.join(quote(v) for v in
            (m['id'], camera, int(enable))) + ') ON CONFLICT(pipeline_id, cam) DO UPDATE SET enabled = excluded.enabled;']
    if recording is not None:
        fields = ('object_key', 'cam', 'start', 'day', 'size', 'duration_s', 'frames', 'width', 'height', 'bitrate', 'codec', 'sha256', 'uploaded_at')
        statements.append('INSERT OR IGNORE INTO segments (' + ','.join(fields) + ') VALUES (' + ','.join(quote(recording[k]) for k in fields) + ');')
    return '\n'.join(statements)
