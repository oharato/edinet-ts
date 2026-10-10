import json
from pathlib import Path
import tempfile
import unittest
from artifact_store import activate, locked, publish

class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
    def tearDown(self):
        self.tmp.cleanup()
    def generation(self, name, value):
        stage = self.root / ('.staging-' + name)
        stage.mkdir()
        (stage / 'result').write_text(value)
        return publish(self.root, stage, {'sourceCommit': 'fixture'})
    def test_publish_retains_old_and_rollback(self):
        with locked(self.root):
            one = self.generation('one', 'old')
            self.generation('two', 'new')
            self.assertEqual((self.root / 'current/result').read_text(), 'new')
            self.assertEqual((one / 'result').read_text(), 'old')
            activate(self.root, 'one')
            self.assertEqual((self.root / 'current/result').read_text(), 'old')
    def test_corrupt_rollback_keeps_current(self):
        one = self.generation('one', 'old')
        self.generation('two', 'new')
        (one / 'result').write_text('corrupt')
        with self.assertRaises(RuntimeError):
            activate(self.root, 'one')
        self.assertEqual((self.root / 'current/result').read_text(), 'new')
    def test_failed_build_keeps_current(self):
        self.generation('one', 'old')
        (self.root / '.staging-failure').mkdir()
        self.assertEqual((self.root / 'current/result').read_text(), 'old')
    def test_concurrent_publish_lock(self):
        with locked(self.root):
            with self.assertRaises(BlockingIOError):
                with locked(self.root):
                    pass
    def test_symlink_and_traversal_rejected(self):
        stage = self.root / '.staging-bad'
        stage.mkdir()
        (stage / 'link').symlink_to('/etc/passwd')
        with self.assertRaises(RuntimeError):
            publish(self.root, stage, {})
        with self.assertRaises(ValueError):
            activate(self.root, '../outside')

if __name__ == '__main__':
    unittest.main()
