"""Run with python3 -m unittest discover -s test -p '*supervisor_test.py'."""
import json
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/verify-duck-financial-full.py'


class SupervisorTest(unittest.TestCase):
    def command(self, root, pid, result):
        return [sys.executable, str(SCRIPT), '--pid', str(pid), '--sdk', str(root),
                '--run', str(root), '--node', sys.executable, '--output', str(root / 'proof'),
                '--result', result]

    def test_resume_result_does_not_use_previous_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'batch-002.json').write_text('')
            (root / 'batch-003.json').write_text('{"status":"partial"}')
            with subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(0.5)']) as source:
                result = subprocess.run(self.command(root, source.pid, 'batch-003.json'), capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 1)
            state = json.loads((root / 'proof/status.json').read_text())
            self.assertEqual(state['status'], 'build-not-complete')
            self.assertEqual(state['result'], 'batch-003.json')
            self.assertEqual(state['stages'], [])

    def test_result_must_stay_inside_run(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ['../escape.json', '/tmp/escape.json', '.', '..']:
                result = subprocess.run(self.command(root, 0, name), capture_output=True, timeout=10)
                self.assertEqual(result.returncode, 2)
                self.assertIn(b'must be a filename', result.stderr)
            self.assertFalse((root / 'proof').exists())

    def test_stopping_waiter_preserves_source_process(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])
            waiter = subprocess.Popen(self.command(root, source.pid, 'batch-003.json'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                deadline = time.monotonic() + 10
                while not (root / 'proof/status.json').exists():
                    self.assertIsNone(waiter.poll())
                    self.assertLess(time.monotonic(), deadline)
                    time.sleep(0.01)
                waiter.send_signal(signal.SIGTERM)
                self.assertNotEqual(waiter.wait(timeout=10), 0)
                self.assertIsNone(source.poll())
                state = json.loads((root / 'proof/status.json').read_text())
                self.assertEqual(state['status'], 'stopped')
                self.assertEqual(state['stages'], [])
            finally:
                if waiter.poll() is None:
                    waiter.kill()
                waiter.wait()
                source.terminate()
                source.wait()
