"""Footage files on disk, addressed by the keys the Workers used in R2.

    raw/cam=sky01/date=2026-09-22/hour=14/sky01_20260922T140500Z.mp4  ->  <root>/raw/cam=sky01/...

A file appears at its key only once it is complete, synced, and matches its SHA-256, and an existing
file is never replaced.
"""
import hashlib
import os
import re
import tempfile
from pathlib import Path

CHUNK = 1 << 20
INCOMING = '.incoming'
_PART = re.compile(r'^[A-Za-z0-9=_.-]+$')


class Conflict(Exception):
    """Different bytes already exist at this key."""


class Mismatch(Exception):
    """The body was cut short or does not match its declared SHA-256."""


def path_for(root: Path, key: str) -> Path | None:
    """The file for a key, or None for a key that could escape the root or name a hidden file."""
    parts = key.split('/')
    if any(not _PART.match(p) or p.startswith('.') for p in parts):
        return None
    return root.joinpath(*parts)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as f:
        while chunk := f.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def put(root: Path, target: Path, body, sha256: str) -> tuple[bool, int]:
    """Stores the chunks of `body` at `target`. Returns (created, size).

    Always consumes the whole body, so the connection stays usable. The same bytes again are a
    success (created=False); different bytes raise Conflict and leave the original untouched.
    """
    if target.exists():
        for _ in body:
            pass
        return _existing(target, sha256)

    incoming = root / INCOMING
    incoming.mkdir(exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=incoming)
    try:
        digest, size = hashlib.sha256(), 0
        with os.fdopen(fd, 'wb') as f:
            for chunk in body:
                digest.update(chunk)
                f.write(chunk)
                size += len(chunk)
            f.flush()
            os.fsync(f.fileno())
        if digest.hexdigest() != sha256:
            raise Mismatch('body does not match X-Sha256')
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.link(temporary, target)  # atomic, and refuses to replace a file a concurrent upload won with
        except FileExistsError:
            return _existing(target, sha256)
        _sync_directory(target.parent)
        return True, size
    finally:
        os.unlink(temporary)


def _existing(target: Path, sha256: str) -> tuple[bool, int]:
    if file_sha256(target) != sha256:
        raise Conflict('a different recording already exists at this key')
    return False, target.stat().st_size


def _sync_directory(directory: Path) -> None:
    fd = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
