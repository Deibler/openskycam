"""Verify length/checksum and retry downloads before making a source file available."""
import hashlib
import time
import urllib.error
from pathlib import Path
from ..db import FootageStorageOps as ops
from ..models.processorInferencemodel import ProcessingError, Source
from ..utils.httpSharedUtil import Client

def download(client: Client, source: Source, target: Path) -> None:
    target = Path(target)
    partial = target.with_suffix(".partial")
    expected = source["size"]
    if not isinstance(expected, int) or not 0 < expected <= 256 * 1024 * 1024:
        raise ProcessingError("download_failed")
    for attempt in range(3):
        try:
            digest = hashlib.sha256(); size = 0
            with ops.open_partial(partial) as output:
                for chunk in ops.read_chunks(client, source["download_url"]):
                    size += len(chunk)
                    if size > expected:
                        raise ProcessingError("checksum_mismatch")
                    output.write(chunk); digest.update(chunk)
            if size != expected or digest.hexdigest() != source["sha256"]:
                raise ProcessingError("checksum_mismatch")
            ops.publish(partial, target)
            return
        except urllib.error.HTTPError as error:
            if error.code in (404, 410):
                raise ProcessingError("source_missing") from None
            if error.code < 500 or attempt == 2:
                raise ProcessingError("download_failed") from None
        except (OSError, ProcessingError) as error:
            if attempt == 2:
                raise ProcessingError(error.code if isinstance(error, ProcessingError) else "download_failed") from None
        finally:
            ops.discard(partial)
        time.sleep(attempt + 1)
