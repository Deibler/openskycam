"""Wire contracts for bounded Workshop jobs and immutable frame proposals."""
from typing import Any, NotRequired, TypedDict
from .processorInferencemodel import Lease

class WorkshopAnnotation(TypedDict):
    class_id: int
    class_name: str
    confidence: float
    model_node: str
    box: NotRequired[list[float]]
    track_id: NotRequired[str]

class WorkshopScan(TypedDict):
    """A track measured in every decoded frame; samples are [t, x or None, y or None, peak] near the photo."""
    fps: float
    searched: int
    seen: int
    speed: float | None
    first: float | None
    last: float | None
    samples: list[list[float | None]]

class WorkshopTrack(TypedDict):
    """One object across a recording. path: [t, x, y, width, height, class_id, confidence] per detection."""
    id: str
    motion: str
    speed: float | None
    start: float
    end: float
    detections: int
    clipped: NotRequired[list[str]]
    path: list[list[float]]
    scan: NotRequired[WorkshopScan]

class WorkshopFrame(TypedDict):
    bucket_id: str
    model_node: str
    pts: int
    time_base: list[int]
    offset: float
    width: int
    height: int
    sha256: str
    annotations: list[WorkshopAnnotation]
    tracks: NotRequired[list[WorkshopTrack]]

class WorkshopJob(Lease):
    id: str
    input: dict[str, Any]
    snapshot: dict[str, Any]

class WorkshopResult(TypedDict):
    code_sha256: str
    sampled_frames: int
    frames: list[WorkshopFrame]

class WorkshopProgress(TypedDict):
    phase: str
    node_id: str | None
    processed: int
    sequence: NotRequired[int]
    frame: NotRequired[WorkshopFrame]
