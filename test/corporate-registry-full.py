import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import zipfile


def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

here=Path(__file__).resolve().parent
fixture=load('signature_fixture',here/'corporate-registry-signature.py').SignatureTest
module=load('registry_full',here.parent/'scripts/roadmap/fetch-corporate-registry-full.py')
acquisition=load('acquisition_fixture',here/'corporate-registry-acquisition.py')
HTML='''<form id="appForm" action="/download/zenken/index.html" method="post"><input type="hidden" name="event" value="download"><input type="hidden" name="selDlFileNo"><h2 id="csv-unicode">CSV</h2><p>令和8年10月30日更新</p><dl><dt>全国</dt><dd><a onclick="return doDownload(11);">zip 100MB</a></dd></dl><h2 id="xml-unicode">XML</h2><p>令和8年10月30日更新</p><dl><dt>全国</dt><dd><a onclick="return doDownload(33);">zip 364MB</a></dd></dl><dl><dt>東京都</dt><dd><a onclick="return doDownload(44);">zip 11MB</a></dd></dl></form>'''

class FullTest(unittest.TestCase):
    setUpClass=classmethod(fixture.setUpClass.__func__)
    tearDownClass=classmethod(fixture.tearDownClass.__func__)
    fixture_set_up=fixture.setUp
    def setUp(self):
        self.fixture_set_up();self.out=self.path/'full';raw=io.BytesIO()
        with zipfile.ZipFile(raw,'w',zipfile.ZIP_DEFLATED) as z:
            z.write(self.path/'data.xml','00_zenkoku_all_20261030.xml');z.write(self.path/'data.xml.asc','00_zenkoku_all_20261030.xml.asc')
        self.raw=raw.getvalue();self.openers=[]
        self.addCleanup(patch.stopall);patch.object(module.audit,'RESERVE',0).start()
    def opener(self):
        value=acquisition.Opener(self.raw,html=HTML);self.openers.append(value);return value
    def fetch(self,budget=1):return module.fetch('2026-10-30',self.root/'key.asc',self.fingerprint,self.out,budget,opener_factory=self.opener)

    def test_national_xml_not_prefecture_or_csv(self):
        result=self.fetch();self.assertEqual(result['status'],'complete');self.assertTrue(result['signaturesVerified']);self.assertTrue(result['materialized']);self.assertTrue(result['parts'][0]['signaturesVerified']);self.assertEqual(result['expectedParts'],1);self.assertEqual(result['requestsThisRun'],2)
        fields=module.urllib.parse.parse_qs(self.openers[0].calls[1].data.decode());self.assertEqual(fields['selDlFileNo'],['33'])
        original=json.loads(Path(result['importManifests'][0]).read_text());self.assertEqual(original['source']['kind'],'full');self.assertEqual(original['part'],'00_zenkoku_all_20261030.xml')
        again=self.fetch(0);self.assertEqual(again['status'],'complete');self.assertEqual(again['requestsThisRun'],0);self.assertEqual(original,json.loads(Path(again['importManifests'][0]).read_text()))

    def test_wrong_date_and_missing_national_rejected(self):
        for html in [HTML.replace('令和8年10月30日更新','令和8年10月29日更新'),HTML.replace('<dt>全国</dt>','<dt>北海道</dt>')]:
            parser=module.FullListing();parser.feed(html)
            with self.assertRaises(ValueError):parser.select('2026-10-30')

    def test_ambiguous_national_and_noncontiguous_splits_rejected(self):
        for html in [HTML.replace('</form>','<dl><dt>全国</dt><dd><a onclick="return doDownload(77);">zip 1MB</a></dd></dl></form>'),HTML.replace('zip 364MB</a>','分割1 zip 11MB</a><a onclick="return doDownload(34);">分割3 zip 5MB</a>')]:
            parser=module.FullListing();parser.feed(html)
            with self.assertRaises(ValueError):parser.select('2026-10-30')

    def test_capacity_block_preserves_archive_without_import_manifest(self):
        original=module.audit.inspect_archive
        def large(*args):
            result=original(*args);result['expandedBytes']=10**15;result['members'][0]['bytes']=10**15;return result
        with patch.object(module.audit,'inspect_archive',side_effect=large):result=self.fetch()
        self.assertEqual(result['status'],'pending-capacity');self.assertFalse(result['signaturesVerified']);self.assertNotIn('importManifests',result)
        self.assertTrue(Path(result['parts'][0]['archive']).exists());self.assertFalse((self.out/'part-000/verified').exists())
        again=self.fetch(0);self.assertEqual(again['status'],'complete');self.assertEqual(again['requestsThisRun'],0)

    def test_zero_zip_budget_only_observes_catalog(self):
        result=self.fetch(0);self.assertEqual(result['status'],'pending');self.assertEqual(result['pendingFileIds'],['33']);self.assertEqual(result['requestsThisRun'],1)
        result=self.fetch(0);self.assertEqual(result['requestsThisRun'],0)

    def test_tampered_archive_is_not_overwritten(self):
        result=self.fetch();p=Path(result['parts'][0]['archive']);p.write_bytes(p.read_bytes()+b'bad')
        before=sum(len(o.calls) for o in self.openers)
        with self.assertRaises(ValueError):self.fetch(0)
        self.assertEqual(sum(len(o.calls) for o in self.openers),before);self.assertEqual(json.loads((self.out/'status.json').read_text())['status'],'checking')

    def test_signature_failure_never_completes(self):
        raw=io.BytesIO()
        with zipfile.ZipFile(raw,'w') as z:z.write(self.path/'data.xml','full.xml');z.writestr('full.xml.asc',b'bad')
        self.raw=raw.getvalue()
        with self.assertRaises(module.daily.sig.subprocess.SubprocessError):self.fetch()
        self.assertFalse((self.out/'part-000/verified').exists());self.assertTrue((self.out/'part-000/acquisition.json').exists())

    def test_split_budget_and_offline_resume(self):
        html=HTML.replace('zip 364MB</a>','分割1 zip 11MB</a><a onclick="return doDownload(34);">分割2 zip 5MB</a>')
        def split_opener():
            value=acquisition.Opener(self.raw,html=html);self.openers.append(value);return value
        self.opener=split_opener
        first=self.fetch(1);self.assertEqual(first['status'],'pending');self.assertEqual(first['pendingFileIds'],['34'])
        second=self.fetch(1);self.assertEqual(second['status'],'complete');self.assertEqual(second['expectedParts'],2);self.assertTrue(all(p['signaturesVerified'] for p in second['parts']))
        third=self.fetch(0);self.assertEqual(third['requestsThisRun'],0);self.assertEqual(sum(len(o.calls) for o in self.openers),4)

    def test_verify_without_retaining_all_expanded_xml(self):
        original=module.audit.inspect_archive
        def large_total(*args):
            result=original(*args);result['expandedBytes']=10**15;return result
        with patch.object(module.audit,'inspect_archive',side_effect=large_total):result=self.fetch()
        self.assertEqual(result['status'],'verified-archive');self.assertTrue(result['signaturesVerified']);self.assertFalse(result['materialized']);self.assertNotIn('importManifests',result)
        proof=json.loads(Path(result['archiveVerifications'][0]).read_text());self.assertEqual(proof['parts'][0]['entry'],'00_zenkoku_all_20261030.xml');self.assertEqual(proof['parts'][0]['xmlSha256'],self.manifest['sha256'])
        self.assertFalse((self.out/'part-000/verified').exists());self.assertEqual(list((self.out/'part-000').glob('registry-xml-verification-*')),[])

    def test_later_signature_failure_cleans_temporary_expansions(self):
        raw=io.BytesIO()
        with zipfile.ZipFile(raw,'w') as z:
            for name in ['first.xml','second.xml']:z.write(self.path/'data.xml',name)
            z.write(self.path/'data.xml.asc','first.xml.asc');z.writestr('second.xml.asc',b'bad')
        self.raw=raw.getvalue();original=module.audit.inspect_archive
        def large_total(*args):
            result=original(*args);result['expandedBytes']=10**15;return result
        with patch.object(module.audit,'inspect_archive',side_effect=large_total):
            with self.assertRaises(module.daily.sig.subprocess.SubprocessError):self.fetch()
        part=self.out/'part-000'
        self.assertEqual(list(part.glob('registry-xml-verification-*')),[])
        self.assertEqual(list(part.glob('archive-verification-[0-9]*.json')),[])
        self.assertTrue((part/'acquisition.json').exists());self.assertEqual(json.loads((self.out/'status.json').read_text())['status'],'checking')

    def test_total_xml_part_limit_precedes_verification(self):
        html=HTML.replace('zip 364MB</a>','分割1 zip 11MB</a><a onclick="return doDownload(34);">分割2 zip 5MB</a>')
        self.opener=lambda:acquisition.Opener(self.raw,html=html)
        original=module.audit.inspect_archive
        def many(*args):
            result=original(*args);result['expectedXmlParts']=[f'part-{i}.xml' for i in range(60)];return result
        with patch.object(module.audit,'inspect_archive',side_effect=many):
            with self.assertRaisesRegex(ValueError,'part count'):self.fetch(2)
        self.assertFalse((self.out/'part-000/verified').exists());self.assertFalse((self.out/'part-001/verified').exists())


del fixture
if __name__=='__main__':unittest.main()
