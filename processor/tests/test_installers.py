"""The GPU choice, and the systemd units the install scripts write on Linux."""
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from skyvision_processor.utils.deviceInferenceUtil import empty_cache, pick_device

PROCESSOR = Path(__file__).resolve().parents[1]


def fake_torch(cuda, mps, emptied=None):
    def empty(name):
        return lambda: emptied.append(name)
    return SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: cuda, empty_cache=empty('cuda')),
                           mps=SimpleNamespace(empty_cache=empty('mps')),
                           backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: mps)))


class Device(unittest.TestCase):
    def test_prefers_cuda_then_mps_then_cpu(self):
        self.assertEqual('cuda', pick_device(fake_torch(cuda=True, mps=True)))
        self.assertEqual('mps', pick_device(fake_torch(cuda=False, mps=True)))
        self.assertEqual('cpu', pick_device(fake_torch(cuda=False, mps=False)))
        self.assertEqual('cpu', pick_device(fake_torch(cuda=True, mps=True), 'cpu'))

    def test_empties_only_the_backend_in_use(self):
        emptied = []
        empty_cache(fake_torch(cuda=True, mps=False, emptied=emptied))
        empty_cache(fake_torch(cuda=False, mps=True, emptied=emptied))
        empty_cache(fake_torch(cuda=False, mps=False, emptied=emptied))
        self.assertEqual(['cuda', 'mps'], emptied)


def install(script, *args, home):
    """Run an install script's unit writer as it would run on Linux, without starting anything."""
    code = re.search(r"<<'PY'\n(.*?)\nPY\n", (PROCESSOR / script).read_text(), re.S).group(1)
    return subprocess.run([sys.executable, '-', *args], input="import sys; sys.platform = 'linux'\n" + code,
                          capture_output=True, text=True, env={**os.environ, 'HOME': home})


class LinuxUnits(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        self.key = Path(self.home) / 'key'
        self.key.write_text('k')
        self.key.chmod(0o600)

    def test_workshop_runner_is_a_restarting_user_service(self):
        result = install('install-workshop.sh', '/opt/my env/bin/python', str(self.key), 'workshop-' + 'a' * 32,
                         'https://api.example.com', '/src 100%', '/deps', home=self.home)
        self.assertEqual(0, result.returncode, result.stderr)
        unit = Path(result.stdout.strip())
        self.assertEqual(Path(self.home) / '.config/systemd/user/skyvision-workshop.service', unit)
        text = unit.read_text()
        self.assertIn('ExecStart="/opt/my env/bin/python" "-m" "skyvision_processor" "workshop-run" "--base-url" '
                      f'"https://api.example.com" "--key-file" "{self.key}" "--runtime" "workshop-{"a" * 32}" "--watch"', text)
        self.assertIn('WorkingDirectory="/src 100%%"', text)
        self.assertIn('Environment="PYTHONPATH=/src 100%%:/deps"', text)
        for line in ('Restart=always', 'Nice=10', 'WantedBy=default.target', 'Environment="PYTHONUNBUFFERED=1"'):
            self.assertIn(line + '\n', text)
        self.assertEqual(0o600, unit.stat().st_mode & 0o777)

    def test_workshop_runner_keeps_its_checks(self):
        args = ['/py', str(self.key), 'workshop-' + 'a' * 32, 'https://api.example.com', '/src', '']
        for index, bad in ((2, 'workshop-latest'), (3, 'http://api.example.com')):
            self.assertNotEqual(0, install('install-workshop.sh', *args[:index], bad, *args[index + 1:], home=self.home).returncode)
        self.key.chmod(0o644)
        self.assertNotEqual(0, install('install-workshop.sh', *args, home=self.home).returncode)

    def test_model_sync_is_a_timer_every_60_seconds(self):
        result = install('install-model-sync.sh', '/py', 'gpu-box', str(self.key), 'https://api.example.com',
                         '/models', '/src', home=self.home)
        self.assertEqual(0, result.returncode, result.stderr)
        timer = Path(result.stdout.strip())
        self.assertEqual('skyvision-models-gpu-box.timer', timer.name)
        self.assertIn('OnUnitActiveSec=60\n', timer.read_text())
        service = timer.with_suffix('.service').read_text()
        self.assertIn('Type=oneshot\n', service)
        self.assertIn('"sync-models" "--base-url" "https://api.example.com" "--key-file"', service)
        self.assertNotEqual(0, install('install-model-sync.sh', '/py', 'Bad Device', str(self.key), 'https://x', '/m', '/s',
                                       home=self.home).returncode)

    def test_scripts_require_the_api_origin(self):
        for script, args in (('install-workshop.sh', ['/py', str(self.key), 'workshop-' + 'a' * 32]),
                             ('install-model-sync.sh', ['/py', 'gpu-box', str(self.key)])):
            result = subprocess.run(['bash', str(PROCESSOR / script), *args], capture_output=True, text=True)
            self.assertEqual(2, result.returncode, result.stderr)
            self.assertIn('api-origin', result.stderr)


if __name__ == '__main__':
    unittest.main()
