"""Wire contracts for archived inference jobs; no storage or processing behavior."""
from __future__ import annotations
from typing import Any, NotRequired, Protocol, TypedDict

class ProcessingError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code

class Progress(Protocol):
    def check(self) -> None: ...

class Settings(TypedDict):
    process_fps: float
    yolo_imgsz: int
    track_lost_buffer: int

class Pipeline(TypedDict):
    id: str
    model_sha256: str
    code_sha256: str
    config_sha256: str
    config: Settings

class Source(TypedDict):
    download_url: str
    size: int
    sha256: str
    duration_s: float
    frames: NotRequired[int | None]

class Lease(TypedDict):
    generation: int
    lease_token: str

class Job(Lease):
    id: str
    pipeline: Pipeline
    input: Source

class Point(TypedDict):
    t: float
    box: list[float]
    score: float

class Track(TypedDict):
    track_id: int
    points: list[Point]
    score: float
    label: NotRequired[str]
    classification_basis: NotRequired[str]
    evidence_time: NotRequired[float]
    evidence_box: NotRequired[list[float]]
    evidence_sha256: NotRequired[str]

class Metrics(TypedDict):
    decoded_frames: int
    sampled_frames: int
    processed_seconds: float
    raw_detections: int
    first_pts: float
    sample_times: list[float]
    elapsed_seconds: NotRequired[float]

Runtime = dict[str, Any]
Analysis = tuple[list[Track], dict[int, bytes], Metrics, Runtime]
RunSummary = dict[str, Any]
JsonObject = dict[str, Any]
