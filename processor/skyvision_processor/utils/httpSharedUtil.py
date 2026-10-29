"""Stateful outbound transport: credentials are restricted to one origin, without redirects."""
import io
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from ..models.processorInferencemodel import ProcessingError

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

class Client:
    def __init__(self, base, token):
        self.base = base.rstrip("/")
        parsed = urllib.parse.urlsplit(self.base)
        if parsed.path or parsed.query or parsed.fragment or parsed.username or not parsed.hostname:
            raise ValueError("API base must be an origin")
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1", "::1")):
            raise ValueError("Use HTTPS, or loopback HTTP for local integration")
        self.origin = (parsed.scheme, parsed.netloc)
        self.token = token
        self.opener = urllib.request.build_opener(NoRedirect())

    def open(self, path, data=None, headers=None, method=None):
        url = urllib.parse.urljoin(self.base + "/", path)
        parsed = urllib.parse.urlsplit(url)
        if (parsed.scheme, parsed.netloc) != self.origin or parsed.username:
            raise ProcessingError("download_failed")
        if isinstance(data, bytes):
            # Sent in blocks, so the timeout bounds each block rather than a whole 8 MiB chunk on a slow uplink.
            headers = {**(headers or {}), "Content-Length": str(len(data))}
            data = io.BytesIO(data)
        return self.opener.open(urllib.request.Request(url, data=data,
            headers={"Authorization": "Bearer " + self.token, **(headers or {})}, method=method), timeout=45)

    def post(self, path, body, retry=False):
        data = json.dumps(body, separators=(",", ":"), allow_nan=False).encode()
        def send():
            with self.open(path, data, {"Content-Type": "application/json"}, "POST") as response:
                return json.load(response)
        return retrying(send, 3 if retry else 1)


def retrying(action, attempts=3):
    """Run action again after a 5xx answer or a network error; any other failure is final."""
    for attempt in range(attempts):
        try:
            return action()
        except urllib.error.HTTPError as error:
            if error.code < 500 or attempt == attempts - 1:
                raise
        except (OSError, TimeoutError):
            if attempt == attempts - 1:
                raise
        time.sleep(attempt + 1)
