import hashlib
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
module=load('registry_fetch',here.parent/'scripts/roadmap/fetch-corporate-registry-diff.py')
HTML='''<form id="appForm" action="/download/sabun/index.html" method="post"><input type="hidden" name="token" value="private"><input type="hidden" name="event" value="download"><input type="hidden" name="selDlFileNo" value=""><h2 id="csv-sjis">CSV</h2><tr class="type0_corpHistory1"><td>令和8年10月28日</td><td><a onclick="return doDownload(11);">CSV</a></td></tr><h2 id="xml-unicode">XML</h2><tr class="type2_corpHistory1"><td>令和8年10月28日</td><td><a onclick="return doDownload(33);">XML</a></td></tr></form>'''

class Response(io.BytesIO):
    def __init__(self,body,url):super().__init__(body);self.url=url;self.status=200;self.headers={'Content-Length':str(len(body))}
    def geturl(self):return self.url

class Opener:
    def __init__(self,body,html=HTML,fail=False):self.body=body;self.html=html;self.calls=[];self.fail=fail
    def open(self,request,timeout):
        self.calls.append(request)
        if request.data is not None:
            if self.fail:raise ConnectionError('interrupted request')
            return Response(self.body,request.full_url)
        return Response(self.html.encode(),request.full_url)

class AcquisitionTest(unittest.TestCase):
    setUpClass=classmethod(fixture.setUpClass.__func__)
    tearDownClass=classmethod(fixture.tearDownClass.__func__)
    fixture_set_up=fixture.setUp
    def setUp(self):
        self.fixture_set_up()
        archive=self.path/'signed.zip'
        with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
            z.write(self.path/'data.xml','diff_20261028.xml');z.write(self.path/'data.xml.asc','diff_20261028.xml.asc')
        self.body=archive.read_bytes();self.out=self.path/'download'
        self.addCleanup(patch.stopall);patch.object(module.zip_audit,'RESERVE',0).start()

    def fetch(self,opener,**kwargs):
        return module.fetch(kwargs.get('date','2026-10-28'),self.root/'key.asc',kwargs.get('fingerprint',self.fingerprint),self.out,opener)

    def test_download_then_verified_offline_resume(self):
        opener=Opener(self.body);result=self.fetch(opener)
        self.assertEqual(result['status'],'downloaded');self.assertEqual(len(opener.calls),2)
        fields=module.urllib.parse.parse_qs(opener.calls[1].data.decode());self.assertEqual(fields['selDlFileNo'],['33'])
        self.assertEqual(result['acquisition']['download']['sha256'],hashlib.sha256(self.body).hexdigest())
        self.assertNotEqual(result['acquisition']['download']['observedAt'],self.manifest['source']['observedAt'])
        retained=Opener(b'bad');self.assertEqual(self.fetch(retained)['status'],'retained');self.assertEqual(retained.calls,[])

    def test_missing_date_is_not_empty_delivery(self):
        opener=Opener(self.body,html=HTML.replace('令和8年10月28日','令和8年10月27日'))
        with self.assertRaises(ValueError):self.fetch(opener)
        self.assertEqual(len(opener.calls),1);self.assertFalse((self.out/'complete.json').exists())
        self.assertTrue((self.out/'attempt-0001/failure.json').exists())

    def test_failed_attempt_retained_then_restart(self):
        with self.assertRaises(ConnectionError):self.fetch(Opener(self.body,fail=True))
        before=(self.out/'attempt-0001/listing.html').read_bytes()
        result=self.fetch(Opener(self.body));self.assertEqual(result['attempt'],'attempt-0002')
        self.assertEqual((self.out/'attempt-0001/listing.html').read_bytes(),before)

    def test_plan_mismatch_no_network(self):
        self.fetch(Opener(self.body));opener=Opener(self.body)
        with self.assertRaises(ValueError):self.fetch(opener,fingerprint='0'*40)
        self.assertEqual(opener.calls,[])

    def test_tampered_retained_archive_rejected(self):
        self.fetch(Opener(self.body));p=self.out/'attempt-0001/delivery.zip';p.write_bytes(p.read_bytes()+b'changed')
        opener=Opener(self.body)
        with self.assertRaises(ValueError):self.fetch(opener)
        self.assertEqual(opener.calls,[])

    def test_recover_completed_attempt_without_root_marker(self):
        self.fetch(Opener(self.body));(self.out/'complete.json').unlink();opener=Opener(self.body)
        self.assertEqual(self.fetch(opener)['status'],'recovered');self.assertEqual(opener.calls,[])

    def test_csv_only_and_ambiguous_xml_rejected(self):
        for html in [HTML.replace('xml-unicode','other'),HTML.replace('</form>',HTML[HTML.index('<tr class="type2'):HTML.index('</form>')]+'</form>')]:
            parser=module.Listing();parser.feed(html)
            with self.assertRaises(ValueError):parser.select('2026-10-28')

    def test_incomplete_download_has_no_completion(self):
        opener=Opener(self.body)
        original=opener.open
        def short(request,timeout):
            response=original(request,timeout)
            if request.data is not None:response.headers['Content-Length']=str(len(self.body)+1)
            return response
        opener.open=short
        with self.assertRaises(ValueError):self.fetch(opener)
        self.assertFalse((self.out/'complete.json').exists())

    def test_competing_writer_is_rejected(self):
        self.out.mkdir();lock=(self.out/'.lock').open('w')
        try:
            module.fcntl.flock(lock,module.fcntl.LOCK_EX|module.fcntl.LOCK_NB)
            opener=Opener(self.body)
            with self.assertRaises(BlockingIOError):self.fetch(opener)
            self.assertEqual(opener.calls,[])
        finally:lock.close()

    def test_changed_import_manifest_is_not_reused(self):
        self.fetch(Opener(self.body));p=self.out/'attempt-0001/verified/part-000-import.json';m=json.loads(p.read_text());m['sha256']='0'*64;p.write_text(json.dumps(m));opener=Opener(self.body)
        with self.assertRaises(ValueError):self.fetch(opener)
        self.assertEqual(opener.calls,[])

    def test_unexpected_final_url_is_rejected(self):
        opener=Opener(self.body);original=opener.open
        def redirected(request,timeout):
            response=original(request,timeout);response.url='https://example.invalid/';return response
        opener.open=redirected
        with self.assertRaises(ValueError):self.fetch(opener)
        self.assertFalse((self.out/'complete.json').exists())

    def test_capacity_guard_before_network(self):
        opener=Opener(self.body)
        with patch.object(module.shutil,'disk_usage',return_value=type('Usage',(),{'free':0})()):
            with self.assertRaises(ValueError):self.fetch(opener)
        self.assertEqual(opener.calls,[])

    def test_future_date_rejected_before_network(self):
        opener=Opener(self.body)
        with self.assertRaises(ValueError):self.fetch(opener,date='2099-01-01')
        self.assertEqual(opener.calls,[]);self.assertFalse(self.out.exists())


del fixture
if __name__=='__main__':unittest.main()
