import hashlib
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from skyvision_processor.utils.httpSharedUtil import Client, NoRedirect
from skyvision_processor.models.processorInferencemodel import ProcessingError
from skyvision_processor.service.footageStorageService import download
from skyvision_processor.utils.provenanceInferenceUtil import canonical, code_hash, manifest


class ContractTests(unittest.TestCase):
    def test_content_fingerprints_change_for_weights_code_and_configuration(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); weights = root / 'model.pt'; weights.write_bytes(b'first')
            first = manifest(weights, {'fps': 4, 'imgsz': 1280})
            self.assertEqual(first, manifest(weights, {'imgsz': 1280, 'fps': 4}))
            self.assertNotEqual(first['id'], manifest(weights, {'fps': 5, 'imgsz': 1280})['id'])
            weights.write_bytes(b'second')
            self.assertNotEqual(first['id'], manifest(weights, {'fps': 4, 'imgsz': 1280})['id'])
            (root / 'runner.py').write_text('v1')
            code = code_hash(root); (root / 'runner.py').write_text('v2')
            self.assertNotEqual(code, code_hash(root))
            with self.assertRaises(ValueError):
                canonical({'invalid': float('nan')})

    def test_credentials_cannot_follow_a_foreign_url_or_redirect(self):
        client = Client('https://api.example.com', 'private')
        for url in ['https://evil.example/file', '//evil.example/file', 'http://api.example.com/file']:
            with self.assertRaises(ProcessingError):
                client.open(url)
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.example'))
        with self.assertRaises(ValueError):
            Client('http://192.168.1.2', 'private')

    @patch('skyvision_processor.service.footageStorageService.time.sleep')
    def test_partial_download_retries_without_publishing_incomplete_file(self, _sleep):
        data = b'complete recording'; client = Client('http://127.0.0.1:8789', 'private')
        source = {'size': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'download_url': '/file'}
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'recording.mp4'
            with patch.object(client, 'open', side_effect=[io.BytesIO(data[:3]), io.BytesIO(data)]) as opened:
                download(client, source, target)
                self.assertEqual(opened.call_count, 2)
            self.assertEqual(target.read_bytes(), data)
            self.assertFalse(target.with_suffix('.partial').exists())
            target.unlink()
            with patch.object(client, 'open', side_effect=lambda *_: io.BytesIO(b'broken')):
                with self.assertRaisesRegex(ProcessingError, 'checksum_mismatch'):
                    download(client, source, target)
            self.assertFalse(target.exists())
            self.assertFalse(target.with_suffix('.partial').exists())


if __name__ == '__main__':
    unittest.main()
