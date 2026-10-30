import importlib.util
import io
import json
import hashlib
from pathlib import Path
import tempfile
import unittest
import zipfile
import os

spec=importlib.util.spec_from_file_location('member_stream',Path('scripts/roadmap/stream-corporate-registry-member.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
sha=lambda b:hashlib.sha256(b).hexdigest()
class StreamChecks(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.archive=self.root/'source.zip';self.receipt=self.root/'receipt.json';self.xml=b'<corporations/>';self.entry='part.xml';self.make()
 def tearDown(self):self.temp.cleanup()
 def make(self):
  with zipfile.ZipFile(self.archive,'w',compression=zipfile.ZIP_STORED) as z:z.writestr(self.entry,self.xml);z.writestr(self.entry+'.asc',b'synthetic signature fixture only')
  self.data={'format':'edinet-ts-corporate-registry-verified-archive-v1','signaturesVerified':True,'archive':{'path':str(self.archive),'sha256':sha(self.archive.read_bytes()),'bytes':self.archive.stat().st_size},'parts':[{'entry':self.entry,'xmlSha256':sha(self.xml),'xmlBytes':len(self.xml)}]};self.save()
 def save(self):self.receipt.write_text(json.dumps(self.data))
 def read(self,output=None):
  out=io.BytesIO() if output is None else output;module.stream(str(self.receipt),self.entry,out);return out
 def test_exact_bytes_and_original_unchanged(self):
  before=self.archive.read_bytes();self.assertEqual(self.read().getvalue(),self.xml);self.assertEqual(self.archive.read_bytes(),before)
 def test_archive_hash(self):
  self.data['archive']['sha256']='0'*64;self.save();out=io.BytesIO()
  with self.assertRaises(ValueError):self.read(out)
  self.assertEqual(out.getvalue(),b'')
 def test_xml_hash(self):
  self.data['parts'][0]['xmlSha256']='0'*64;self.save()
  with self.assertRaises(ValueError):self.read()
 def test_missing_signature_member(self):
  with zipfile.ZipFile(self.archive,'w') as z:z.writestr(self.entry,self.xml)
  self.data['archive'].update(sha256=sha(self.archive.read_bytes()),bytes=self.archive.stat().st_size);self.save()
  with self.assertRaises(ValueError):self.read()
 def test_crc_even_with_updated_archive_hash(self):
  raw=self.archive.read_bytes().replace(self.xml,b'<corporations >',1);self.archive.write_bytes(raw);self.data['archive'].update(sha256=sha(raw),bytes=len(raw));self.save()
  with self.assertRaises(zipfile.BadZipFile):self.read()
 def test_hardlink(self):
  os.link(self.archive,self.root/'alias.zip')
  with self.assertRaises(ValueError):self.read()
 def test_original_changed_during_output(self):
  archive=self.archive
  class Mutating(io.BytesIO):
   def write(self,chunk):
    with archive.open('ab') as out:out.write(b'changed')
    return super().write(chunk)
  with self.assertRaises(ValueError):self.read(Mutating())
 def test_receipt_changed_during_output(self):
  receipt=self.receipt
  class Mutating(io.BytesIO):
   def write(self,chunk):
    with receipt.open('ab') as out:out.write(b' ')
    return super().write(chunk)
  with self.assertRaises(ValueError):self.read(Mutating())

if __name__=='__main__':unittest.main()
