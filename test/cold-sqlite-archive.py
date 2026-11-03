import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('cold_archive',Path(__file__).resolve().parents[1]/'scripts/roadmap/cold-sqlite-archive.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class ColdArchiveTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name);self.source=self.root/'source.sqlite';self.out=self.root/'cold'
        db=sqlite3.connect(self.source);db.execute('create table example(value text)');db.executemany('insert into example values (?)',[('保存する原文'+str(i),) for i in range(30)]);db.commit();db.close()
        self.raw=self.source.read_bytes();self.sha=hashlib.sha256(self.raw).hexdigest()
        self.reserve=patch.object(module,'RESERVE',0);self.reserve.start();self.addCleanup(self.reserve.stop)
    def pack(self):return module.pack(self.source,self.out,self.sha)

    def test_exact_archive_and_restore_to_new_path(self):
        result=self.pack();self.assertEqual(self.source.read_bytes(),self.raw);self.assertEqual(gzip.decompress((self.out/'payload.gz').read_bytes()),self.raw)
        restored=self.root/'restored.sqlite';value=module.restore(self.out,restored);self.assertEqual(value['sha256'],self.sha);self.assertEqual(restored.read_bytes(),self.raw)
        db=sqlite3.connect(restored);self.assertEqual(db.execute('select count(*) from example').fetchone()[0],30);db.close()
        self.assertEqual(result['source']['sha256'],self.sha)

    def test_source_and_archive_never_overwritten(self):
        self.pack();before=(self.out/'receipt.json').read_bytes()
        with self.assertRaises(FileExistsError):self.pack()
        with self.assertRaises(ValueError):module.restore(self.out)
        self.assertEqual((self.out/'receipt.json').read_bytes(),before);self.assertEqual(self.source.read_bytes(),self.raw)

    def test_wrong_pinned_hash_removes_only_generated_output(self):
        with self.assertRaises(ValueError):module.pack(self.source,self.out,'0'*64)
        self.assertFalse(self.out.exists());self.assertEqual(self.source.read_bytes(),self.raw)

    def test_sidecar_and_symlink_refused(self):
        (self.root/'source.sqlite-journal').touch()
        with self.assertRaises(ValueError):self.pack()
        (self.root/'source.sqlite-journal').unlink();alias=self.root/'alias.sqlite';alias.symlink_to(self.source)
        with self.assertRaises(OSError):module.pack(alias,self.out,self.sha)
        self.assertEqual(self.source.read_bytes(),self.raw)

    def test_corrupt_compressed_data_never_retires_original(self):
        self.pack();p=self.out/'payload.gz';raw=bytearray(p.read_bytes());raw[len(raw)//2]^=1;p.write_bytes(raw)
        with patch.object(module,'open_descriptors',return_value={'openDescriptors':[],'opaqueOwnedProcesses':[]}):
            with self.assertRaises((ValueError,OSError,EOFError)):module.retire(self.out)
        self.assertEqual(self.source.read_bytes(),self.raw)

    def test_opaque_process_or_open_reader_blocks_retirement(self):
        self.pack()
        for audit in [{'openDescriptors':[],'opaqueOwnedProcesses':['123']},{'openDescriptors':[{'pid':'123','fd':'3'}],'opaqueOwnedProcesses':[]}]:
            with patch.object(module,'open_descriptors',return_value=audit):
                with self.assertRaises(ValueError):module.retire(self.out)
            self.assertEqual(self.source.read_bytes(),self.raw)
        self.assertEqual(len(list(self.out.glob('retire-check-*.json'))),2)

    def test_retire_and_restore_preserve_every_byte(self):
        self.pack()
        with patch.object(module,'open_descriptors',return_value={'openDescriptors':[],'opaqueOwnedProcesses':[]}):self.assertEqual(module.retire(self.out)['status'],'retired')
        self.assertFalse(self.source.exists());self.assertTrue((self.out/'retired.json').exists())
        self.assertEqual(module.restore(self.out)['status'],'restored');self.assertEqual(self.source.read_bytes(),self.raw)

    def test_capacity_guard_protects_source_and_restore(self):
        with patch.object(module.shutil,'disk_usage',return_value=type('Usage',(),{'free':0})()):
            with self.assertRaises(ValueError):self.pack()
        self.assertEqual(self.source.read_bytes(),self.raw);self.pack()
        with patch.object(module.shutil,'disk_usage',return_value=type('Usage',(),{'free':0})()):
            with self.assertRaises(ValueError):module.restore(self.out,self.root/'restored.sqlite')
        self.assertFalse((self.root/'restored.sqlite').exists())

    def test_changed_source_after_pack_is_not_retired(self):
        self.pack();self.source.write_bytes(self.raw+b'newer data')
        with patch.object(module,'open_descriptors',return_value={'openDescriptors':[],'opaqueOwnedProcesses':[]}):
            with self.assertRaises(ValueError):module.retire(self.out)
        self.assertEqual(self.source.read_bytes(),self.raw+b'newer data')

    def test_new_reader_before_unlink_blocks_retirement(self):
        self.pack();audits=[{'openDescriptors':[],'opaqueOwnedProcesses':[]},{'openDescriptors':[{'pid':'123','fd':'7'}],'opaqueOwnedProcesses':[]}]
        with patch.object(module,'open_descriptors',side_effect=audits):
            with self.assertRaises(ValueError):module.retire(self.out)
        self.assertEqual(self.source.read_bytes(),self.raw);self.assertFalse((self.out/'retired.json').exists())

    def test_real_descriptor_audit_finds_own_additional_reader(self):
        with self.source.open('rb') as reader:
            audit=module.open_descriptors(self.source,-1)
            self.assertIn({'pid':str(os.getpid()),'fd':str(reader.fileno())},audit['openDescriptors'])

    def test_audit_reports_unknown_process_without_retiring_source(self):
        self.pack()
        with patch.object(module,'open_descriptors',return_value={'openDescriptors':[],'opaqueOwnedProcesses':['123']}):result=module.audit_usage(self.out)
        self.assertEqual(result['status'],'blocked');self.assertTrue(result['sourceRetained']);self.assertTrue(Path(result['auditPath']).exists());self.assertEqual(self.source.read_bytes(),self.raw)

    def test_restore_rejects_alias_or_fifo_archive(self):
        self.pack();payload=self.out/'payload.gz';saved=self.out/'retained.gz';target=self.root/'restored.sqlite'
        for replacement in ['symlink','fifo']:
            payload.rename(saved)
            if replacement=='symlink':payload.symlink_to(saved)
            else:os.mkfifo(payload)
            with self.assertRaises((OSError,ValueError)):module.restore(self.out,target)
            self.assertFalse(target.exists());payload.unlink();saved.rename(payload)

    def test_restore_detects_replacement_after_its_pinned_read(self):
        self.pack();payload=self.out/'payload.gz';original=module.digest;swapped=False
        def swap_after_hash(fd,size):
            nonlocal swapped
            result=original(fd,size)
            if not swapped:
                swapped=True;payload.rename(self.out/'retained.gz');payload.write_bytes(b'replacement')
            return result
        with patch.object(module,'digest',side_effect=swap_after_hash):
            with self.assertRaises(ValueError):module.restore(self.out,self.root/'restored.sqlite')
        self.assertFalse((self.root/'restored.sqlite').exists());self.assertEqual(self.source.read_bytes(),self.raw)

if __name__=='__main__':unittest.main()
