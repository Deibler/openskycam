import hashlib
import io
import http.client
import json
import os
import re
import shutil
import tempfile
import threading
import time
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

from skyvision_store.__main__ import RETENTION_DAYS
from skyvision_store.janitor import prune
from skyvision_store.objects import INCOMING
from skyvision_store.server import StoreServer

TOKEN = 't' * 40
KEY = 'raw/cam=sky01/date=2026-09-22/hour=14/sky01_20260922T140500Z.mp4'


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.mounted = True
        self.server = StoreServer(('127.0.0.1', 0), self.root, TOKEN, min_free=0, mounted=lambda: self.mounted)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.connection = http.client.HTTPConnection('127.0.0.1', self.server.server_address[1], timeout=5)

    def tearDown(self):
        self.connection.close()
        self.server.shutdown()
        self.server.server_close()

    def request(self, method, key=KEY, body=None, headers=None, token=TOKEN):
        headers = {'Authorization': f'Bearer {token}', **(headers or {})}
        self.connection.request(method, f'/o/{key}', body=body, headers=headers, encode_chunked='Transfer-Encoding' in headers)
        response = self.connection.getresponse()
        return response, response.read()

    def put(self, data: bytes, key=KEY, digest=None, **options):
        return self.request('PUT', key, data, {'X-Sha256': digest or sha(data)}, **options)

    def stored(self, key=KEY) -> bytes | None:
        path = self.root / key
        return path.read_bytes() if path.exists() else None

    def leftovers(self) -> list:
        return list((self.root / INCOMING).glob('*'))

    # --- Writing ---

    def test_stores_new_bytes_exactly(self):
        data = os.urandom(3_000_000)
        response, body = self.put(data)
        self.assertEqual(response.status, 201)
        self.assertEqual(json.loads(body), {'size': len(data)})
        self.assertEqual(self.stored(), data)
        self.assertEqual(self.leftovers(), [])

    def test_accepts_a_chunked_body(self):
        data = os.urandom(200_000)
        response, _ = self.request('PUT', body=iter([data[:70_000], data[70_000:]]),
                                   headers={'X-Sha256': sha(data), 'Transfer-Encoding': 'chunked'})
        self.assertEqual(response.status, 201)
        self.assertEqual(self.stored(), data)

    def test_same_bytes_again_is_success(self):
        data = os.urandom(10_000)
        self.put(data)
        response, body = self.put(data)
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(body), {'size': len(data)})

    def test_refuses_different_bytes_and_keeps_the_connection_usable(self):
        original = os.urandom(10_000)
        self.put(original)
        response, _ = self.put(os.urandom(10_000))
        self.assertEqual(response.status, 409)
        self.assertEqual(self.stored(), original)
        response, body = self.request('GET')  # same connection: the refused body was drained
        self.assertEqual((response.status, body), (200, original))

    def test_refuses_a_body_that_does_not_match_its_checksum(self):
        response, _ = self.put(os.urandom(10_000), digest=sha(b'other'))
        self.assertEqual(response.status, 422)
        self.assertIsNone(self.stored())
        self.assertEqual(self.leftovers(), [])

    def test_refuses_writes_while_the_disk_is_not_mounted(self):
        self.mounted = False
        response, _ = self.put(os.urandom(1_000))
        self.assertEqual(response.status, 503)
        self.assertIsNone(self.stored())

    def test_refuses_writes_when_the_disk_is_nearly_full(self):
        self.server.min_free = 1 << 62
        response, _ = self.put(os.urandom(1_000))
        self.assertEqual(response.status, 507)
        self.assertIsNone(self.stored())

    def test_accepts_writes_while_free_space_is_above_the_floor(self):
        # The janitor stops pruning once free space reaches the floor, so a write must not demand more.
        free = shutil.disk_usage(self.root).free
        self.server.min_free = free - 500
        with mock.patch('skyvision_store.server.shutil.disk_usage', return_value=mock.Mock(free=free)):
            response, _ = self.put(os.urandom(1_000))
        self.assertEqual(response.status, 201)

    def test_rejects_a_malformed_checksum(self):
        response, _ = self.put(b'data', digest='abc')
        self.assertEqual(response.status, 400)

    # --- Access ---

    def test_requires_the_token(self):
        response, _ = self.put(b'data', token='wrong')
        self.assertEqual(response.status, 401)
        self.assertIsNone(self.stored())

    def test_rejects_keys_outside_the_footage_tree(self):
        for key in ['raw/../../etc/passwd', f'{INCOMING}/part', 'raw//x.mp4', 'raw/a%20b.mp4']:
            with self.subTest(key=key):
                response, _ = self.put(b'data', key=key)
                self.assertEqual(response.status, 404)
        self.assertFalse(any(self.root.rglob('*.mp4')))

    # --- Reading ---

    def test_reads_whole_files_ranges_and_sizes(self):
        data = bytes(i % 251 for i in range(1_000))
        self.put(data)
        cases = [
            (None, 200, data, None),
            ('bytes=100-199', 206, data[100:200], 'bytes 100-199/1000'),
            ('bytes=990-', 206, data[990:], 'bytes 990-999/1000'),
            ('bytes=-10', 206, data[990:], 'bytes 990-999/1000'),
            ('bytes=900-5000', 206, data[900:], 'bytes 900-999/1000'),
        ]
        for header, status, expected, content_range in cases:
            with self.subTest(range=header):
                response, body = self.request('GET', headers={'Range': header} if header else {})
                self.assertEqual((response.status, body), (status, expected))
                self.assertEqual(response.getheader('Content-Range'), content_range)
                self.assertEqual(response.getheader('Content-Type'), 'video/mp4')
        response, body = self.request('HEAD')
        self.assertEqual((response.status, body, response.getheader('Content-Length')), (200, b'', '1000'))
        self.assertTrue(response.getheader('ETag'))

    def test_answers_unsatisfiable_ranges_with_the_size(self):
        self.put(bytes(1_000))
        for header in ['bytes=1000-', 'bytes=5-3', 'bytes=-0']:
            with self.subTest(range=header):
                response, _ = self.request('GET', headers={'Range': header})
                self.assertEqual(response.status, 416)
                self.assertEqual(response.getheader('Content-Range'), 'bytes */1000')

    def test_missing_recording_is_404(self):
        response, _ = self.request('GET')
        self.assertEqual(response.status, 404)

    # --- Thumbnails ---

    def thumbnail(self, image: bytes, query: str, token=TOKEN):
        self.connection.request('POST', f'/thumbnail?{query}', body=image, headers={'Authorization': f'Bearer {token}'})
        response = self.connection.getresponse()
        return response, response.read()

    def test_crops_the_object_and_shrinks_whole_frames(self):
        from PIL import Image
        # A 4K frame, blue on the left half and green on the right, with a red object at (2000, 1000).
        frame = Image.new('RGB', (3840, 2160), 'blue')
        frame.paste('green', (1920, 0, 3840, 2160))
        frame.paste('red', (2000, 1000, 2060, 1034))
        jpeg = io.BytesIO()
        frame.save(jpeg, 'JPEG', quality=92)
        response, body = self.thumbnail(jpeg.getvalue(), 'size=512&left=1970&top=983&width=120&height=68')
        self.assertEqual((response.status, response.getheader('Content-Type')), (200, 'image/jpeg'))
        crop = Image.open(io.BytesIO(body))
        self.assertEqual(crop.size, (512, 290))
        self.assertGreater(crop.getpixel((256, 145))[0], 200)  # the object fills the middle, enlarged
        self.assertLess(crop.getpixel((5, 5))[0], 60)  # the margin around it is not red
        response, body = self.thumbnail(jpeg.getvalue(), 'size=512')
        whole = Image.open(io.BytesIO(body))
        self.assertEqual(whole.size, (512, 288))
        self.assertGreater(whole.getpixel((10, 144))[2], 200)  # blue left
        self.assertGreater(whole.getpixel((500, 144))[1], 100)  # green right

    def test_never_enlarges_a_whole_frame(self):
        from PIL import Image
        jpeg = io.BytesIO()
        Image.new('RGB', (300, 200), 'blue').save(jpeg, 'JPEG')
        response, body = self.thumbnail(jpeg.getvalue(), 'size=512')
        self.assertEqual(Image.open(io.BytesIO(body)).size, (300, 200))

    def test_refuses_bad_thumbnail_requests(self):
        self.assertEqual(self.thumbnail(b'jpeg', 'size=512', token='wrong')[0].status, 401)
        self.assertEqual(self.thumbnail(b'jpeg', 'size=0')[0].status, 400)
        self.assertEqual(self.thumbnail(b'jpeg', 'size=512&left=0&top=0&width=0&height=5')[0].status, 400)
        self.assertEqual(self.thumbnail(b'not a jpeg', 'size=512')[0].status, 422)


class JanitorTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        for day in ['2026-08-01', '2026-08-20', '2026-09-27']:
            for hour in ['00', '01']:
                folder = self.root / f'raw/cam=sky01/date={day}/hour={hour}'
                folder.mkdir(parents=True)
                (folder / 'clip.mp4').write_bytes(b'x')

    def remaining(self) -> list[str]:
        return sorted(str(p.relative_to(self.root / 'raw/cam=sky01')) for p in self.root.glob('raw/cam=*/date=*/hour=*'))

    def test_deletes_days_past_retention(self):
        prune(self.root, date(2026, 9, 28), retention_days=40, min_free=0)
        self.assertEqual(self.remaining(), ['date=2026-08-20/hour=00', 'date=2026-08-20/hour=01',
                                            'date=2026-09-27/hour=00', 'date=2026-09-27/hour=01'])

    def test_deletes_oldest_hours_until_there_is_room(self):
        freed = iter([0, 0, 1])  # room appears after two hours are gone
        prune(self.root, date(2026, 9, 28), retention_days=400, min_free=1, free=lambda: next(freed))
        self.assertEqual(self.remaining()[0], 'date=2026-08-20/hour=00')
        self.assertEqual(len(self.remaining()), 4)

    def test_removes_only_stale_upload_parts(self):
        incoming = self.root / INCOMING
        incoming.mkdir()
        (incoming / 'fresh').write_bytes(b'x')
        stale = incoming / 'stale'
        stale.write_bytes(b'x')
        os.utime(stale, (time.time() - 2 * 86400,) * 2)
        prune(self.root, date(2026, 9, 28), retention_days=400, min_free=0)
        self.assertEqual([p.name for p in incoming.glob('*')], ['fresh'])


class RetentionTest(unittest.TestCase):
    def test_files_outlive_the_workers_retention(self):
        shared = Path(__file__).parents[3] / 'package/shared/src/utils/layoutStorageUtil.ts'
        workers = int(re.search(r'RETENTION_DAYS = (\d+);', shared.read_text()).group(1))
        self.assertGreater(RETENTION_DAYS, workers)


class DeployTest(unittest.TestCase):
    def test_restart_waits_for_the_old_process(self):
        # Booting out by label returns before the process exits, so the bootstrap after it fails
        # and leaves the agent stopped. Only the plist-path form waits.
        script = (Path(__file__).parents[1] / 'deploy.sh').read_text()
        bootouts = re.findall(r'^\s*launchctl bootout (.*)$', script, re.MULTILINE)
        self.assertTrue(bootouts)
        for arguments in bootouts:
            self.assertRegex(arguments, r'^"gui/\$\(id -u\)" "[^"]+\.plist"')


if __name__ == '__main__':
    unittest.main()
