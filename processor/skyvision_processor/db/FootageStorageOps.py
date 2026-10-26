"""Stream source bytes and manage the attempt's temporary file."""
from pathlib import Path
from typing import Iterator, BinaryIO
from ..utils.httpSharedUtil import Client

def read_chunks(client: Client, url: str) -> Iterator[bytes]:
    with client.open(url) as response:
        yield from iter(lambda: response.read(1024 * 1024), b'')

def open_partial(path: Path) -> BinaryIO:
    return path.open('wb')

def publish(partial: Path, target: Path) -> None:
    partial.replace(target)

def discard(partial: Path) -> None:
    partial.unlink(missing_ok=True)
