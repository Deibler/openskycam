import hashlib
from ..db import ProcessorInferenceOps as ops
from ..models.processorInferencemodel import Job
from ..utils.httpSharedUtil import Client

def upload_evidence(client: Client, job: Job, jpeg: bytes) -> str:
    digest = hashlib.sha256(jpeg).hexdigest()
    ops.put_evidence(client, job, digest, jpeg)
    return digest
