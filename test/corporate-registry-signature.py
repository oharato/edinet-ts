import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/roadmap/verify-corporate-registry-signature.py'

class SignatureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='registry-signature-test-')
        cls.root = Path(cls.temp.name)
        cls.home = cls.root / 'keys'; cls.home.mkdir(mode=0o700)
        cls.gpg = ['gpg', '--no-options', '--homedir', str(cls.home), '--batch', '--pinentry-mode', 'loopback', '--passphrase', '']
        subprocess.run(cls.gpg + ['--quick-generate-key', 'Test fixture <test@example.invalid>', 'ed25519', 'sign', '0'], check=True, capture_output=True)
        listing = subprocess.run(cls.gpg + ['--with-colons', '--list-keys'], check=True, capture_output=True).stdout.decode()
        cls.fingerprint = next(x.split(':')[9] for x in listing.splitlines() if x.startswith('fpr:'))
        (cls.root/'key.asc').write_bytes(subprocess.run(cls.gpg+['--armor','--export'],check=True,capture_output=True).stdout)

    @classmethod
    def tearDownClass(cls):
        subprocess.run(['gpgconf','--homedir',str(cls.home),'--kill','all'],capture_output=True)
        cls.temp.cleanup()

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(dir=self.root)
        self.path = Path(self.directory.name)
        self.addCleanup(self.directory.cleanup)
        xml=self.path/'data.xml';xml.write_text('<test>signed bytes</test>')
        subprocess.run(self.gpg+['--armor','--detach-sign',str(xml)],check=True,capture_output=True)
        self.manifest={'file':'data.xml','signature':'data.xml.asc','publicKey':str(self.root/'key.asc'),'fingerprint':self.fingerprint,'sha256':hashlib.sha256(xml.read_bytes()).hexdigest(),'source':{'sourceUrl':'https://example.invalid','observedAt':'2026-10-30T00:00:00Z','dataDate':'2026-10-29','kind':'diff','purpose':'sample'},'part':'data.xml'}

    def run_verifier(self,success):
        (self.path/'input.json').write_text(json.dumps(self.manifest))
        result=subprocess.run(['python3',str(SCRIPT),'--manifest',str(self.path/'input.json'),'--out',str(self.path/'out')],capture_output=True,text=True)
        self.assertEqual(result.returncode==0,success,result.stderr)
        if not success:self.assertFalse((self.path/'out').exists())
        return result

    def test_valid_and_no_overwrite(self):
        self.run_verifier(True)
        receipt=json.loads((self.path/'out/receipt.json').read_text())
        self.assertEqual(receipt['trustedFingerprint'],self.fingerprint)
        self.assertFalse(receipt['networkRequested'])
        self.assertEqual(receipt['importManifest']['sha256'],self.manifest['sha256'])
        before=(self.path/'out/receipt.json').read_bytes()
        result=subprocess.run(['python3',str(SCRIPT),'--manifest',str(self.path/'input.json'),'--out',str(self.path/'out')],capture_output=True)
        self.assertNotEqual(result.returncode,0);self.assertEqual((self.path/'out/receipt.json').read_bytes(),before)

    def test_wrong_trust_anchor(self):
        self.manifest['fingerprint']='0'*40;self.run_verifier(False)

    def test_changed_xml_even_with_updated_hash(self):
        (self.path/'data.xml').write_text('<test>changed</test>')
        self.manifest['sha256']=hashlib.sha256((self.path/'data.xml').read_bytes()).hexdigest();self.run_verifier(False)

    def test_wrong_acquisition_hash(self):
        self.manifest['sha256']='0'*64;self.run_verifier(False)

    def test_symlink_input(self):
        (self.path/'link.xml').symlink_to(self.path/'data.xml');self.manifest['file']='link.xml';self.run_verifier(False)

    def test_missing_signature(self):
        (self.path/'data.xml.asc').unlink();self.run_verifier(False)

if __name__=='__main__':unittest.main()
