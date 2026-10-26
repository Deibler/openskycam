"""Dependency-free, stable fingerprints shared by registration and execution."""
import hashlib
import json
from pathlib import Path


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def code_hash(root=None):
    root = Path(root or Path(__file__).parents[1])
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*.py")):
        digest.update(path.relative_to(root).as_posix().encode() + b"\0" + path.read_bytes() + b"\0")
    return digest.hexdigest()


def manifest(weights, config):
    result = {"model_sha256": file_hash(weights), "code_sha256": code_hash(),
              "config_sha256": hashlib.sha256(canonical(config).encode()).hexdigest(), "config": config}
    result["id"] = "baseline-" + hashlib.sha256(canonical(result).encode()).hexdigest()[:24]
    return result
