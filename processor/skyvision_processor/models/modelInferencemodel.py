"""Model registry and device deployment contracts."""
from typing import Any, TypedDict

class Artifact(TypedDict):
    sha256: str
    bytes: int
    filename: str
    format: str

class ModelBinding(TypedDict):
    slot: str
    artifact: Artifact
    model: dict[str, Any]
    parameters: dict[str, Any]

class Deployment(TypedDict):
    schema_version: int
    device_id: str
    revision: str
    models: list[ModelBinding]
    created_at: str

class ActiveDeployment(TypedDict):
    deployment: Deployment
    code_sha256: str
    pipelines: dict[str, dict[str, Any]]

class SyncResult(TypedDict):
    status: str
    revision: str | None
    models: int

