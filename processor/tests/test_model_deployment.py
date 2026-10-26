import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid

from skyvision_processor.db import ModelInferenceOps as ops
from skyvision_processor.service import deploymentInferenceService as service
from skyvision_processor.service.modelInferenceService import publish, training_callback
from skyvision_processor.utils.httpSharedUtil import Client

def deployment(data=b'weights', version='v1'):
    a = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data), 'filename': 'best.pt', 'format': 'pytorch-checkpoint'}
    return {'schema_version': 1, 'device_id': 'gpu-box', 'revision': str(uuid.uuid4()), 'created_at': '2026-09-23T00:00:00Z',
            'models': [{'slot': 'detector', 'artifact': a, 'parameters': {'imgsz': 640, 'confidence': .3, 'iou': .5, 'device': 'cpu'},
                        'model': {'family': 'test', 'version': version, 'adapter': 'ultralytics', 'task': 'object-detection',
                                  'classes': [{'id': 0, 'name': 'Plane'}, {'id': 1, 'name': 'WildLife'}, {'id': 2, 'name': 'Meteorite'}], 'artifacts': [a]}}]}

class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'runtime'
        self.client = Client('http://127.0.0.1:8789', 'secret')

    def sync(self, spec, data=b'weights', fail=False):
        with patch.object(ops, 'get_desired', return_value=spec), patch.object(ops, 'report'), \
             patch.object(self.client, 'open', side_effect=lambda *_: io.BytesIO(data)), \
             patch.object(service, 'smoke_model', side_effect=ValueError('bad runtime') if fail else None):
            return service.sync_models(self.client, 'gpu-box', self.root)

    def test_successful_switch_removes_old_managed_weights_and_pins_parameters(self):
        old = deployment(); self.sync(old)
        new = deployment(b'new weights', 'v2'); new['models'][0]['parameters']['confidence'] = .6
        self.sync(new, b'new weights')
        active = ops.read_active(self.root)
        self.assertEqual(active['deployment'], new)
        self.assertEqual(active['pipelines']['detector']['config']['confidence'], .6)
        self.assertEqual(active['pipelines']['detector']['config']['device'], 'cpu')
        self.assertEqual([p.name for p in (self.root / 'artifacts').iterdir()], [new['models'][0]['artifact']['sha256'] + '.pt'])

    def test_bad_checksum_or_runtime_keeps_previous_weights_and_parameters(self):
        old = deployment(); self.sync(old); before = (self.root / 'active.json').read_bytes()
        for data, fail in [(b'truncated', False), (b'new weights', True)]:
            with self.assertRaises(ValueError): self.sync(deployment(b'new weights', 'v2'), data, fail)
            self.assertEqual((self.root / 'active.json').read_bytes(), before)
            self.assertEqual(len(list((self.root / 'artifacts').iterdir())), 1)
            self.assertEqual(ops.artifact_path(self.root, old['models'][0]['artifact']).read_bytes(), b'weights')

    def test_empty_assignment_removes_weights_but_not_cloud_history_or_unrelated_files(self):
        old = deployment(); self.sync(old)
        note = self.root / 'artifacts' / 'my-notes.txt'; note.write_text('keep')
        new = deployment(); new['models'] = []; self.sync(new)
        self.assertEqual(list((self.root / 'artifacts').iterdir()), [note])
        self.assertEqual(ops.read_active(self.root)['deployment']['models'], [])

    def test_refuses_to_adopt_legacy_directories_or_follow_symlinks(self):
        self.root.mkdir(); (self.root / 'old.pt').write_bytes(b'legacy')
        with self.assertRaisesRegex(ValueError, 'new, empty'): self.sync(deployment())
        self.assertEqual((self.root / 'old.pt').read_bytes(), b'legacy')
        link = Path(self.temp.name) / 'link'; link.symlink_to(self.root)
        with self.assertRaises(ValueError):
            with ops.runtime_lock(link): pass

    def test_identical_revision_is_verified_but_not_downloaded_or_loaded_again(self):
        spec = deployment(); self.sync(spec)
        with patch.object(ops, 'get_desired', return_value=spec), patch.object(ops, 'report'), \
             patch.object(self.client, 'open') as download, patch.object(service, 'smoke_model') as smoke:
            self.assertEqual(service.sync_models(self.client, 'gpu-box', self.root)['status'], 'ready')
            download.assert_not_called(); smoke.assert_not_called()

    def test_changed_assignment_during_download_cannot_activate_stale_candidate(self):
        old = deployment(); self.sync(old); new = deployment(b'new'); newest = deployment(b'newest')
        with patch.object(ops, 'get_desired', side_effect=[new, newest]), patch.object(ops, 'report'), \
             patch.object(self.client, 'open', return_value=io.BytesIO(b'new')), patch.object(service, 'smoke_model'):
            with self.assertRaisesRegex(ValueError, 'changed'): service.sync_models(self.client, 'gpu-box', self.root)
        self.assertEqual(ops.read_active(self.root)['deployment'], old)

    def test_insufficient_disk_does_not_evict_active_model_to_make_room(self):
        old = deployment(); self.sync(old)
        with patch.object(ops, 'get_desired', return_value=deployment(b'new')), patch.object(ops, 'report'), patch.object(ops, 'available_bytes', return_value=0):
            with self.assertRaisesRegex(ValueError, 'disk'): service.sync_models(self.client, 'gpu-box', self.root)
        self.assertEqual(ops.read_active(self.root)['deployment'], old)

    def test_failed_acknowledgment_does_not_roll_back_successful_local_activation(self):
        spec = deployment()
        with patch.object(ops, 'get_desired', return_value=spec), patch.object(ops, 'report', side_effect=OSError('offline')), \
             patch.object(self.client, 'open', return_value=io.BytesIO(b'weights')), patch.object(service, 'smoke_model'):
            with self.assertRaises(OSError): service.sync_models(self.client, 'gpu-box', self.root)
        self.assertEqual(ops.read_active(self.root)['deployment'], spec)
        self.assertTrue(ops.artifact_path(self.root, spec['models'][0]['artifact']).exists())

    def test_invalid_assignment_is_rejected_before_downloading(self):
        spec = deployment(); spec['models'][0]['parameters']['execute'] = 'arbitrary code'
        with patch.object(self.client, 'open') as download:
            with self.assertRaises(ValueError): self.sync(spec)
            download.assert_not_called()

    def test_source_change_revalidates_and_updates_pipeline_fingerprint(self):
        spec = deployment(); self.sync(spec); old = ops.read_active(self.root)
        with patch.object(ops, 'get_desired', return_value=spec), patch.object(ops, 'report'), \
             patch.object(service, 'code_hash', return_value='f' * 64), patch.object(service, 'smoke_model') as smoke:
            service.sync_models(self.client, 'gpu-box', self.root)
            smoke.assert_called_once()
        self.assertNotEqual(ops.read_active(self.root)['code_sha256'], old['code_sha256'])

class PublishingTests(unittest.TestCase):
    def test_failed_upload_cannot_publish_an_incomplete_version(self):
        metadata = {k: [] for k in ('classes', 'evaluations')}
        metadata.update(family='test', version='v1', name='Test', description='Test', task='object-detection', adapter='ultralytics', input={})
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'weights.pt'; path.write_bytes(b'weights')
            with patch.object(ops, 'upload_chunk'), patch.object(ops, 'finish_artifact', side_effect=ValueError('checksum mismatch')), patch.object(ops, 'publish_model') as final:
                with self.assertRaises(ValueError): publish(None, metadata, [path])
                final.assert_not_called()

    def test_training_hook_uses_checkpoint_classes_and_propagates_publication_failure(self):
        from types import SimpleNamespace
        trainer = SimpleNamespace(model=SimpleNamespace(names={0: 'Bird', 1: 'Plane'}), metrics={'map50': .8}, args=SimpleNamespace(imgsz=640, data='test.yaml'), best='best.pt', save_dir='/run')
        with patch.object(ops, 'save_training_card') as saved, patch('skyvision_processor.service.modelInferenceService.publish', side_effect=OSError('offline')) as published:
            with self.assertRaises(OSError): training_callback(None, {'family': 'new', 'version': 'v2'})(trainer)
            self.assertEqual(published.call_args.args[1]['classes'], [{'id': 0, 'name': 'Bird'}, {'id': 1, 'name': 'Plane'}])
            self.assertEqual(published.call_args.args[2], [Path('best.pt')])
            self.assertEqual(saved.call_args.args[1], published.call_args.args[1])
