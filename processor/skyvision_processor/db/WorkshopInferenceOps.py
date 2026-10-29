"""Bounded Workshop transport and disposable attempt storage."""
import hashlib
import json
import tempfile
from pathlib import Path
from ..utils.httpSharedUtil import Client, retrying
from ..models.workshopInferencemodel import WorkshopJob, WorkshopResult, WorkshopProgress


def claim(client: Client, runtime: str, code: str):
    return client.post('/v1/workshop/claim', {'runtime_id': runtime, 'code_sha256': code})['job']


def headers(job: WorkshopJob):
    return {'X-Lease-Generation': str(job['generation']), 'X-Lease-Token': job['lease_token']}


# Heartbeats, downloads and uploads are repeatable, so a dropped connection or a 5xx is tried again
# instead of failing the job for good.
def heartbeat(client, job):
    def renew():
        with client.open('/v1/workshop/jobs/' + job['id'] + '/heartbeat', b'{}', {**headers(job), 'Content-Type': 'application/json'}, 'POST') as response:
            return json.load(response)
    return retrying(renew)


def download(client, job, suffix, target: Path, expected: str, size=None):
    def fetch():
        digest = hashlib.sha256(); count = 0
        with client.open('/v1/workshop/jobs/' + job['id'] + suffix, headers=headers(job)) as response, target.open('wb') as output:
            for chunk in iter(lambda: response.read(1024 * 1024), b''):
                count += len(chunk)
                if count > (size if size is not None else 8 * 1024**2):
                    raise ValueError('Download exceeds pinned size')
                digest.update(chunk); output.write(chunk)
        return digest.hexdigest(), count
    digest, count = retrying(fetch)
    if digest != expected or (size is not None and count != size):
        raise ValueError('Pinned media checksum mismatch')


def temporary_attempt():
    return tempfile.TemporaryDirectory(prefix='skyvision-workshop-')


def upload(client, job, data: bytes):
    digest = hashlib.sha256(data).hexdigest()
    def send():
        with client.open('/v1/workshop/jobs/' + job['id'] + '/images/' + digest, data, {**headers(job), 'Content-Type': 'image/jpeg'}, 'PUT') as response:
            json.load(response)
    retrying(send)
    return digest


def complete(client: Client, job: WorkshopJob, result: WorkshopResult):
    return client.post('/v1/workshop/jobs/' + job['id'] + '/complete', {**result, 'generation': job['generation'], 'lease_token': job['lease_token']}, retry=True)


def fail(client, job):
    return client.post('/v1/workshop/jobs/' + job['id'] + '/fail', {'generation': job['generation'], 'lease_token': job['lease_token'], 'error': 'processor_failed'})


def progress(client: Client, job: WorkshopJob, value: WorkshopProgress):
    return client.post('/v1/workshop/jobs/' + job['id'] + '/progress', {**value, 'generation': job['generation'], 'lease_token': job['lease_token']}, retry=True)
