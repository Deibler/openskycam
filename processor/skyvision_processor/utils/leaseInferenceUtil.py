from ..models.processorInferencemodel import Job, Lease

def lease(job: Job) -> Lease:
    return {"generation": job["generation"], "lease_token": job["lease_token"]}
