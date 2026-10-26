"""Retention for the footage disk: whole days past retention go first, then the oldest hours while space is low."""
import shutil
import time
from datetime import date, timedelta
from pathlib import Path

from .objects import INCOMING

STALE_INCOMING_S = 86400


def prune(root: Path, today: date, retention_days: int, min_free: int, free=None) -> list[Path]:
    """Deletes footage folders and returns them, oldest first."""
    free = free or (lambda: shutil.disk_usage(root).free)
    cutoff = f'date={today - timedelta(days=retention_days)}'
    removed = []
    for day in sorted(root.glob('raw/cam=*/date=*'), key=lambda d: d.name):
        if day.name < cutoff:
            shutil.rmtree(day)
            removed.append(day)
    for hour in sorted(root.glob('raw/cam=*/date=*/hour=*'), key=lambda h: (h.parent.name, h.name)):
        if free() >= min_free:
            break
        shutil.rmtree(hour)
        removed.append(hour)
    for leftover in (root / INCOMING).glob('*'):  # parts of uploads cut off by a crash
        if time.time() - leftover.stat().st_mtime > STALE_INCOMING_S:
            leftover.unlink()
    return removed
