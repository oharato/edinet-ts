import importlib.util
import json
import io
import zipfile
from pathlib import Path
import unittest
from unittest.mock import patch


def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

here=Path(__file__).resolve().parent
acquisition=load('acquisition_fixture',here/'corporate-registry-acquisition.py')
module=load('registry_collection',here.parent/'scripts/roadmap/collect-corporate-registry-differences.py')

class CollectionTest(unittest.TestCase):
    setUpClass=classmethod(acquisition.AcquisitionTest.setUpClass.__func__)
    tearDownClass=classmethod(acquisition.AcquisitionTest.tearDownClass.__func__)
    fixture_set_up=acquisition.AcquisitionTest.fixture_set_up
    def setUp(self):
        # The shared acquisition setup creates a genuine ephemeral signing key and ZIP.
        acquisition.AcquisitionTest.setUp(self)
        self.collection=self.path/'collection'
        self.plan={'query':{'from':'2026-10-24','through':'2026-10-26','knownAt':'2026-10-30T01:00:00Z'},'calendar':{'observedAt':'2026-10-30T00:00:00Z'},'expectedDates':['2026-10-26'],'nonPublicationDays':[{'date':'2026-10-24','reason':'weekend'},{'date':'2026-10-25','reason':'weekend'}]}
        patch.object(module,'create_plan',return_value=self.plan).start()
        patch.object(module.daily.zip_audit,'RESERVE',0).start()
        self.openers=[]
    def opener(self,date):
        raw=io.BytesIO()
        with zipfile.ZipFile(raw,'w',zipfile.ZIP_DEFLATED) as z:
            name='diff_'+date.replace('-','')+'.xml';z.write(self.path/'data.xml',name);z.write(self.path/'data.xml.asc',name+'.asc')
        value=acquisition.Opener(raw.getvalue(),html=acquisition.HTML.replace('令和8年10月28日','令和8年'+str(int(date[5:7]))+'月'+str(int(date[8:]))+'日'));self.openers.append(value);return value
    def collect(self,budget=1):return module.collect(self.path/'calendar.json',self.path/'query.json',self.root/'key.asc',self.fingerprint,self.collection,budget,opener_factory=self.opener)

    def test_zero_budget_retains_closed_days_and_pending(self):
        result=self.collect(0);self.assertEqual(result['status'],'pending');self.assertEqual(result['pendingDates'],['2026-10-26']);self.assertEqual(result['requestsThisRun'],0);self.assertEqual(len(result['nonPublicationDays']),2);self.assertEqual(self.openers,[])

    def test_download_then_zero_network_revalidation(self):
        first=self.collect();self.assertEqual(first['status'],'complete');self.assertEqual(first['requestsThisRun'],2);self.assertEqual(first['downloadsThisRun'],1)
        second=self.collect(0);self.assertEqual(second['status'],'complete');self.assertEqual(second['requestsThisRun'],0);self.assertEqual(second['completed'][0]['status'],'retained')
        self.assertEqual(second['latestObservedAt'],first['latestObservedAt']);self.assertEqual(sum(len(v.calls) for v in self.openers),2)

    def test_failure_is_not_a_completed_or_closed_day(self):
        def failing(date):
            value=CollectionTest.opener(self,date);value.fail=True;return value
        self.opener=failing
        with self.assertRaises(ConnectionError):self.collect()
        status=json.loads((self.collection/'status.json').read_text());self.assertEqual(status['status'],'failed');self.assertEqual(status['pendingDates'],['2026-10-26']);self.assertEqual(status['requestsThisRun'],2);self.assertEqual(status['downloadsThisRun'],1)
        del self.opener
        self.assertEqual(self.collect()['status'],'complete')

    def test_changed_plan_stops_before_requests(self):
        self.collect(0);self.plan['query']['knownAt']='2026-10-30T02:00:00Z'
        with self.assertRaises(ValueError):self.collect()
        self.assertEqual(self.openers,[])

    def test_all_closed_has_no_fake_xml(self):
        self.plan['expectedDates']=[];self.plan['query']['through']='2026-10-25';result=self.collect(0);self.assertEqual(result['status'],'complete');self.assertEqual(result['completed'],[]);self.assertIsNone(result['latestObservedAt']);self.assertFalse((self.collection/'days').exists())

    def test_completed_receipt_tampering_does_not_download_replacement(self):
        self.collect();p=self.collection/'days/2026-10-26/attempt-0001/delivery.zip';p.write_bytes(p.read_bytes()+b'bad')
        with self.assertRaises(ValueError):self.collect(0)
        self.assertEqual(sum(len(v.calls) for v in self.openers),2);self.assertEqual(json.loads((self.collection/'status.json').read_text())['status'],'failed')

    def test_budgeted_multiple_runs_cover_every_expected_day(self):
        self.plan['query']['through']='2026-10-27';self.plan['expectedDates'].append('2026-10-27')
        first=self.collect(1);self.assertEqual(first['status'],'pending');self.assertEqual(first['pendingDates'],['2026-10-27']);self.assertEqual(first['requestsThisRun'],2)
        second=self.collect(1);self.assertEqual(second['status'],'complete');self.assertEqual(second['requestsThisRun'],2);self.assertEqual([v['date'] for v in second['completed']],['2026-10-26','2026-10-27'])
        third=self.collect(0);self.assertEqual(third['status'],'complete');self.assertEqual(third['requestsThisRun'],0);self.assertEqual(sum(len(v.calls) for v in self.openers),4)


if __name__=='__main__':unittest.main()
