"""One job lifecycle: provenance, verified footage, analysis, and fenced publication."""
from pathlib import Path
import tempfile
import time
from ..db import ProcessorInferenceOps as ops
from ..models.processorInferencemodel import ProcessingError, RunSummary, Pipeline
from ..utils.httpSharedUtil import Client
from ..utils.provenanceInferenceUtil import manifest
from ..utils.leaseInferenceUtil import lease
from .analysisInferenceService import analyze
from .heartbeatInferenceService import Heartbeat
from .footageStorageService import download
from .evidenceInferenceService import upload_evidence

def run_one(client: Client, camera: str, weights: Path, expected_pipeline: Pipeline | None = None) -> RunSummary:
    job = ops.claim(client, camera)
    if not job:
        return {"status": "idle"}
    began = time.monotonic()
    try:
        with Heartbeat(client, job) as heartbeat, tempfile.TemporaryDirectory(prefix="skyvision-inference-") as tmp:
            if expected_pipeline and job['pipeline']['id'] != expected_pipeline['id']:
                raise ProcessingError('model_failed')
            fingerprint = manifest(weights, job["pipeline"]["config"])
            if any(fingerprint[k] != job["pipeline"][k] for k in ("id", "model_sha256", "code_sha256", "config_sha256")):
                raise ProcessingError("model_failed")
            path = Path(tmp) / "recording.mp4"
            download(client, job["input"], path)
            tracks, images, metrics, runtime = analyze(path, weights, job["pipeline"]["config"], heartbeat)
            if abs(metrics["processed_seconds"] - job["input"]["duration_s"]) > 2:
                raise ProcessingError("decode_failed")
            # Known catalog frame count catches truncated decodes even when duration looks plausible.
            expected_frames = job["input"].get("frames")
            if expected_frames and metrics["decoded_frames"] != expected_frames:
                raise ProcessingError("decode_failed")
            for track in tracks:
                heartbeat.check()
                track["evidence_sha256"] = upload_evidence(client, job, images[track["track_id"]])
            heartbeat.check()
            metrics["elapsed_seconds"] = time.monotonic() - began
            result = {"provenance": {"input_sha256": job["input"]["sha256"],
                      **{k: fingerprint[k] for k in ("model_sha256", "code_sha256", "config_sha256")}, "runtime": runtime},
                      "metrics": metrics, "tracks": tracks}
            completed = ops.complete(client, job["id"], {**lease(job), "result": result})
            return {**completed, "metrics": metrics, "tracks": len(tracks), "pipeline_id": fingerprint["id"]}
    except Exception as error:
        code = error.code if isinstance(error, ProcessingError) else "processor_failed"
        try:
            ops.fail(client, job["id"], {**lease(job), "error": code})
        except Exception:
            pass  # Lease expiry recovers the job. Never log exception dumps that could expose credentials.
        raise ProcessingError(code) from None
