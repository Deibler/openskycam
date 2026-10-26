"""Remote persistence operations through the scoped Worker API. No inference policy."""
import json
from ..models.processorInferencemodel import Job, Lease, JsonObject
from ..utils.httpSharedUtil import Client

def claim(client: Client, camera: str) -> Job | None:
    return client.post('/v1/processor/jobs/claim', {'camera': camera})['job']

def heartbeat(client: Client, job_id: str, lease: Lease) -> None:
    client.post(f'/v1/processor/jobs/{job_id}/heartbeat', lease, retry=True)

def complete(client: Client, job_id: str, body: JsonObject) -> JsonObject:
    return client.post(f'/v1/processor/jobs/{job_id}/complete', body, retry=True)

def fail(client: Client, job_id: str, body: JsonObject) -> None:
    client.post(f'/v1/processor/jobs/{job_id}/fail', body)

def put_evidence(client: Client, job: Job, digest: str, jpeg: bytes) -> None:
    with client.open(f"/v1/processor/jobs/{job['id']}/evidence/{digest}", jpeg,
                    {'Content-Type': 'image/jpeg', 'X-Lease-Token': job['lease_token'],
                     'X-Lease-Generation': str(job['generation'])}, 'PUT') as response:
        json.load(response)
