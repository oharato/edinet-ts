import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
import warnings
import zipfile
from unittest.mock import patch


def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

here=Path(__file__).resolve().parent
fixture=load('signature_fixture',here/'corporate-registry-signature.py').SignatureTest
module=load('registry_zip',here.parent/'scripts/roadmap/verify-corporate-registry-zip.py')

class ZipTest(unittest.TestCase):
    setUpClass=classmethod(fixture.setUpClass.__func__)
    tearDownClass=classmethod(fixture.tearDownClass.__func__)
    setUp=fixture.setUp

    def archive(self,extra=None,missing=False):
        archive=self.path/'delivery.zip'
        with warnings.catch_warnings():
            warnings.simplefilter('ignore',UserWarning)
            with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
                z.write(self.path/'data.xml','data.xml')
                if not missing:z.write(self.path/'data.xml.asc','data.xml.asc')
                if extra:z.writestr(*extra)
        manifest={'archive':str(archive),'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'publicKey':self.manifest['publicKey'],'fingerprint':self.fingerprint,'source':self.manifest['source'],'expectedXmlParts':['data.xml']}
        p=self.path/'zip-input.json';p.write_text(json.dumps(manifest));return p

    def verify(self,p):
        # Tiny fixtures check the real extraction/signature path without requiring 34GiB on CI.
        with patch.object(module,'RESERVE',0):return module.verify(p,self.path/'out')

    def test_valid_complete_zip(self):
        p=self.archive();r=self.verify(p)
        self.assertTrue(r['allExpectedMembersVerified']);self.assertEqual(len(r['members']),2)
        self.assertEqual(r['parts'][0]['files']['file']['sha256'],self.manifest['sha256'])
        self.assertEqual(json.loads((self.path/'out/part-000-import.json').read_text())['part'],'data.xml')
        before=(self.path/'out/receipt.json').read_bytes()
        with self.assertRaises(FileExistsError):self.verify(p)
        self.assertEqual((self.path/'out/receipt.json').read_bytes(),before)

    def test_missing_signature(self):
        with self.assertRaises(ValueError):self.verify(self.archive(missing=True))
        self.assertFalse((self.path/'out').exists())

    def test_duplicate_member(self):
        with self.assertRaises(ValueError):self.verify(self.archive(('data.xml',b'other')))
        self.assertFalse((self.path/'out').exists())

    def test_unexpected_path(self):
        with self.assertRaises(ValueError):self.verify(self.archive(('../escape',b'no')))
        self.assertFalse((self.path/'escape').exists())

    def test_wrong_archive_hash(self):
        p=self.archive();m=json.loads(p.read_text());m['sha256']='0'*64;p.write_text(json.dumps(m))
        with self.assertRaises(ValueError):self.verify(p)

    def test_corrupt_signature_rolls_back(self):
        (self.path/'data.xml.asc').write_bytes(b'bad signature');p=self.archive()
        with self.assertRaises(module.signature.subprocess.SubprocessError):self.verify(p)
        self.assertFalse((self.path/'out').exists())

    def test_capacity_guard(self):
        p=self.archive()
        with patch.object(module.shutil,'disk_usage',return_value=type('Usage',(),{'free':0})()):
            with self.assertRaises(ValueError):module.verify(p,self.path/'out')
        self.assertFalse((self.path/'out').exists())

    def test_later_part_failure_rolls_back_all(self):
        p=self.archive();m=json.loads(p.read_text())
        archive=Path(m['archive'])
        with zipfile.ZipFile(archive,'a') as z:
            z.write(self.path/'data.xml','second.xml');z.writestr('second.xml.asc',b'bad')
        m['expectedXmlParts'].append('second.xml');m['sha256']=hashlib.sha256(archive.read_bytes()).hexdigest();p.write_text(json.dumps(m))
        with self.assertRaises(module.signature.subprocess.SubprocessError):self.verify(p)
        self.assertFalse((self.path/'out').exists())

    def test_oversized_directory_metadata(self):
        p=self.archive();m=json.loads(p.read_text());archive=Path(m['archive']);raw=bytearray(archive.read_bytes());offset=raw.rfind(b'PK\x05\x06')
        raw[offset+12:offset+16]=(5*1024**2).to_bytes(4,'little');archive.write_bytes(raw)
        m['sha256']=hashlib.sha256(raw).hexdigest();p.write_text(json.dumps(m))
        with self.assertRaises(ValueError):self.verify(p)
        self.assertFalse((self.path/'out').exists())

    def test_capacity_loss_during_extraction_rolls_back(self):
        p=self.archive()
        usage=lambda n:type('Usage',(),{'free':n})()
        with patch.object(module.shutil,'disk_usage',side_effect=[usage(10**15),usage(0)]):
            with self.assertRaises(ValueError):module.verify(p,self.path/'out')
        self.assertFalse((self.path/'out').exists())

    def test_declared_traversal_is_rejected(self):
        p=self.archive();m=json.loads(p.read_text());m['expectedXmlParts']=['../data.xml'];p.write_text(json.dumps(m))
        with self.assertRaises(ValueError):self.verify(p)
        self.assertFalse((self.path/'out').exists())


del fixture
if __name__=='__main__':unittest.main()
