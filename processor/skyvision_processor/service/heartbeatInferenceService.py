"""Owns the renewal thread and the attempt's lease-loss state."""
import threading
from ..db import ProcessorInferenceOps as ops
from ..models.processorInferencemodel import Job, ProcessingError
from ..utils.httpSharedUtil import Client
from ..utils.leaseInferenceUtil import lease

class Heartbeat:
    def __init__(self, client: Client, job: Job):
        self.client, self.job = client, job
        self.stop = threading.Event()
        self.error = None
        self.thread = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        while not self.stop.wait(60):
            try:
                ops.heartbeat(self.client, self.job["id"], lease(self.job))
            except Exception:
                self.error = ProcessingError("processor_failed")
                return

    def check(self):
        if self.error:
            raise self.error

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.stop.set()
        self.thread.join(timeout=50)
