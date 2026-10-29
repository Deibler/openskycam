"""HTTP interface the Workers call through Workers VPC. Every request needs the store's bearer token.

    PUT  /o/<key>   X-Sha256 required. 201 stored, 200 already stored, 409 different bytes stored,
                    422 body does not match X-Sha256, 507 disk nearly full, 503 disk not mounted.
    GET  /o/<key>   One byte range allowed: 206 with Content-Range, 416 when unsatisfiable.
    HEAD /o/<key>   Size and ETag only.
    POST /thumbnail?size=<px>[&left=&top=&width=&height=]   A sized JPEG body: 200 a JPEG thumbnail,
                    400 bad size or crop, 413 over 32 MB, 422 not an image, 503 Pillow missing.
"""
import hmac
import json
import os
import re
import shutil
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from . import images, objects

_SHA256 = re.compile(r'^[0-9a-f]{64}$')
_RANGE = re.compile(r'^bytes=(\d*)-(\d*)$')
UNSATISFIABLE = 'unsatisfiable'
MAX_IMAGE = 32 * 1024 * 1024


class StoreServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, root: Path, token: str, min_free: int, mounted=None):
        super().__init__(address, Handler)
        self.root, self.token, self.min_free = root, token, min_free
        # A missing disk would otherwise fill the boot volume through an empty mount-point folder.
        self.mounted = mounted or (lambda: os.path.ismount(root))


def parse_range(header: str, size: int):
    """(first, last) inclusive, None to ignore the header, or UNSATISFIABLE."""
    match = _RANGE.match(header.strip())
    if not match or match[1] == match[2] == '':
        return None
    if match[1] == '':
        suffix = int(match[2])
        return (max(0, size - suffix), size - 1) if suffix and size else UNSATISFIABLE
    first = int(match[1])
    last = int(match[2]) if match[2] else size - 1
    if first >= size or last < first:
        return UNSATISFIABLE
    return first, min(last, size - 1)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server: StoreServer

    def do_PUT(self):
        target = self._authorized_target()
        if not target:
            return
        sha256 = self.headers.get('X-Sha256', '').lower()
        chunked = self.headers.get('Transfer-Encoding', '').lower() == 'chunked'
        length = self.headers.get('Content-Length')
        if not _SHA256.match(sha256):
            return self._reply(400, error='X-Sha256 must be 64 hex characters', close=True)
        if not chunked and not (length or '').isdigit():
            return self._reply(411, error='Content-Length is required', close=True)
        if not self.server.mounted():
            return self._reply(503, error='footage disk is not mounted', close=True)
        try:
            if shutil.disk_usage(self.server.root).free < self.server.min_free:
                return self._reply(507, error='footage disk is nearly full', close=True)
            body = self._chunked_body() if chunked else self._sized_body(int(length))
            created, size = objects.put(self.server.root, target, body, sha256)
        except objects.Conflict as error:
            return self._reply(409, error=str(error))
        except objects.Mismatch as error:
            return self._reply(422, error=str(error), close=True)
        except OSError as error:  # the relay keeps the file and retries on 5xx
            self.log_error('write failed for %s: %s', target.name, error)
            return self._reply(503, error='footage disk error', close=True)
        self.log_message('stored %s (%s bytes%s)', target.name, size, '' if created else ', already')
        self._reply(201 if created else 200, size=size)

    def do_POST(self):
        if not self._authorized():
            return
        url = urlsplit(self.path)
        if url.path != '/thumbnail':
            return self._reply(404, error='not found', close=True)
        query = {name: values[0] for name, values in parse_qs(url.query).items()}
        try:
            size = int(query['size'])
            crop = tuple(int(query[name]) for name in ('left', 'top', 'width', 'height')) if 'width' in query else None
        except (KeyError, ValueError):
            crop, size = None, 0
        if not 1 <= size <= 2048 or (crop and (min(crop) < 0 or min(crop[2:]) < 1)):
            return self._reply(400, error='size must be 1-2048 and a crop four whole pixels', close=True)
        length = self.headers.get('Content-Length', '')
        if not length.isdigit():
            return self._reply(411, error='Content-Length is required', close=True)
        if int(length) > MAX_IMAGE:
            return self._reply(413, error='image is over 32 MB', close=True)
        data = self.rfile.read(int(length))
        try:
            jpeg = images.thumbnail(data, size, crop)
        except ImportError:
            return self._reply(503, error='Pillow is not installed')
        except (OSError, ValueError) as error:
            return self._reply(422, error=f'not a readable image: {error}')
        self.send_response(200)
        self.send_header('Content-Type', 'image/jpeg')
        self.send_header('Content-Length', str(len(jpeg)))
        self.end_headers()
        self.wfile.write(jpeg)

    def do_GET(self):
        self._read(send_body=True)

    def do_HEAD(self):
        self._read(send_body=False)

    def _read(self, send_body: bool):
        target = self._authorized_target()
        if not target:
            return
        try:
            stat = target.stat()
        except FileNotFoundError:
            return self._reply(404, error='no recording at this key')
        size = stat.st_size
        span = parse_range(self.headers['Range'], size) if send_body and self.headers['Range'] else None
        if span == UNSATISFIABLE:
            return self._reply(416, error='requested range is not satisfiable', headers={'Content-Range': f'bytes */{size}'})
        first, last = span or (0, size - 1)
        self.send_response(206 if span else 200)
        self.send_header('Content-Type', 'video/mp4' if target.suffix == '.mp4' else 'application/octet-stream')
        self.send_header('Content-Length', str(last - first + 1))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('ETag', f'"{size:x}-{stat.st_mtime_ns:x}"')
        if span:
            self.send_header('Content-Range', f'bytes {first}-{last}/{size}')
        self.end_headers()
        if send_body:
            self._send_file(target, first, last - first + 1)

    def _send_file(self, target: Path, offset: int, remaining: int):
        try:
            with target.open('rb') as f:
                f.seek(offset)
                while remaining > 0 and (chunk := f.read(min(objects.CHUNK, remaining))):
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):  # the player moved on to another range
            self.close_connection = True

    def _authorized(self) -> bool:
        if hmac.compare_digest(self.headers.get('Authorization', ''), f'Bearer {self.server.token}'):
            return True
        self._reply(401, error='unauthorized', close=True)
        return False

    def _authorized_target(self) -> Path | None:
        if not self._authorized():
            return None
        target = objects.path_for(self.server.root, self.path[3:]) if self.path.startswith('/o/') else None
        if not target:
            self._reply(404, error='not found', close=True)
        return target

    def _sized_body(self, length: int):
        while length > 0:
            chunk = self.rfile.read(min(objects.CHUNK, length))
            if not chunk:
                raise objects.Mismatch('body ended early')
            length -= len(chunk)
            yield chunk

    def _chunked_body(self):
        while True:
            size = int(self.rfile.readline().split(b';')[0], 16)
            if size == 0:
                while self.rfile.readline() not in (b'\r\n', b'\n', b''):  # trailers
                    pass
                return
            yield from self._sized_body(size)
            self.rfile.readline()

    def _reply(self, status: int, headers=None, close=False, **body):
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        if close:  # an unread request body would corrupt the next request on this connection
            self.send_header('Connection', 'close')
            self.close_connection = True
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(payload)

    def log_request(self, code='-', size='-'):
        if isinstance(code, int) and code >= 500:
            super().log_request(code, size)
