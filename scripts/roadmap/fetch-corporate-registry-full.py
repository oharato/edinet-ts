#!/usr/bin/env python3
"""Retain the official national XML baseline ZIPs; expand only with reserved capacity."""
import argparse
import http.cookiejar
from contextlib import ExitStack
import datetime as dt
from html.parser import HTMLParser
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import urllib.parse
import urllib.request

spec=importlib.util.spec_from_file_location('registry_daily',Path(__file__).with_name('fetch-corporate-registry-diff.py'))
daily=importlib.util.module_from_spec(spec);spec.loader.exec_module(daily)
audit=daily.zip_audit
BASE='https://www.houjin-bangou.nta.go.jp/download/zenken/'
MAX_ZIP=2*1024**3


class FullListing(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.forms=0;self.form=False;self.fields={};self.section='';self.sections=0;self.text=[];self.group=None;self.in_name=False;self.link=None;self.national=[]
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='form' and a.get('id')=='appForm':
            self.forms+=1;self.form=True
            if a.get('action')!='/download/zenken/index.html' or a.get('method','').lower()!='post':raise ValueError('changed full form')
        if self.form and tag=='input' and a.get('type')=='hidden' and 'name' in a:
            if a['name'] in self.fields:raise ValueError('duplicate form field')
            self.fields[a['name']]=a.get('value','')
        if tag=='h2':
            self.section=a.get('id','')
            if self.section=='xml-unicode':self.sections+=1
        if self.section!='xml-unicode':return
        if tag=='dl':
            if self.group is not None:raise ValueError('nested download group')
            self.group={'name':'','links':[]}
        if tag=='dt' and self.group is not None:self.in_name=True
        if tag=='a' and self.group is not None:
            match=re.fullmatch(r'\s*return\s+doDownload\((\d+)\);?\s*',a.get('onclick',''))
            if match:self.link={'fileId':match[1],'label':''}
    def handle_data(self,data):
        if self.section=='xml-unicode':self.text.append(data)
        if self.in_name and self.group is not None:self.group['name']+=data
        if self.link is not None:self.link['label']+=data
    def handle_endtag(self,tag):
        if tag=='form':self.form=False
        if tag=='dt':self.in_name=False
        if tag=='a' and self.link is not None:
            self.group['links'].append(self.link);self.link=None
        if tag=='dl' and self.group is not None:
            if re.sub(r'\s+','',self.group['name'])=='全国':self.national.append(self.group['links'])
            self.group=None
    def select(self,date):
        matches=re.findall(r'令和(元|[0-9]+)年([0-9]+)月([0-9]+)日更新',re.sub(r'\s+','',''.join(self.text)))
        if self.forms!=1 or self.sections!=1 or self.group is not None or len(matches)!=1 or len(self.national)!=1 or self.fields.get('event')!='download' or 'selDlFileNo' not in self.fields:raise ValueError('ambiguous national XML listing')
        y,m,d=matches[0];observed_date=dt.date(2018+(1 if y=='元' else int(y)),int(m),int(d)).isoformat()
        if observed_date!=date:raise ValueError('baseline date differs from published update')
        links=self.national[0]
        if not 1<=len(links)<=100 or len({v['fileId'] for v in links})!=len(links):raise ValueError('invalid national split count')
        result=[]
        for i,link in enumerate(links):
            label=re.sub(r'\s+','',link['label']);match=re.fullmatch(r'(?:分割([0-9]+))?zip([0-9]+)(KB|MB|GB)',label)
            if not match or (len(links)>1 and match[1]!=str(i+1)) or (len(links)==1 and match[1] not in {None,'1'}):raise ValueError('missing national split sequence')
            result.append({'fileId':link['fileId'],'label':label})
        return {'dataDate':date,'scope':'national','format':'XML-Unicode','zips':result}


def parse_listing(file,date):
    parser=FullListing();parser.feed(daily.small_bytes(file).decode('utf-8'));return parser,parser.select(date)


def retained_archive(directory,receipt,selected,file_id):
    if receipt['selected']!=selected or receipt['fileId']!=file_id:raise ValueError('retained national part differs')
    attempt=directory/receipt['attempt']
    if attempt.is_symlink() or not re.fullmatch('attempt-[0-9]{4}',attempt.name):raise ValueError('invalid national attempt')
    for name,metadata in [('listing.html',receipt['listing']),('delivery.zip',receipt['download'])]:
        with ExitStack() as stack:
            fd,before=daily.sig.regular(stack,str(attempt/name),MAX_ZIP)
            if daily.sig.digest(fd,before.st_size)!=metadata['sha256'] or before.st_size!=metadata['bytes']:raise ValueError('national original changed')
    _,actual=parse_listing(attempt/'listing.html',selected['dataDate'])
    if actual!=selected or receipt['listing']['url']!=BASE or receipt['download']['url']!=BASE+'index.html':raise ValueError('national selection or URL changed')
    return attempt


def fetch(date,key,fingerprint,output,max_zips=1,opener_factory=None):
    if dt.date.fromisoformat(date).isoformat()!=date or date>dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date().isoformat() or not re.fullmatch('[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64}',fingerprint) or type(max_zips) is not int or not 0<=max_zips<=100:raise ValueError('invalid national query or budget')
    key=Path(key).absolute();root=Path(output).absolute();requests=0;downloads=0;initial=None
    opener_factory=opener_factory or (lambda:urllib.request.build_opener(daily.NoRedirect(),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())))
    with ExitStack() as stack:
        kfd,ks=daily.sig.regular(stack,str(key),1024**2);query={'dataDate':date,'fingerprint':fingerprint.upper(),'publicKeySha256':daily.sig.digest(kfd,ks.st_size)}
        root.mkdir(mode=0o700,parents=True,exist_ok=True)
        if root.is_symlink():raise ValueError('output is a symlink')
        lock=os.open(root/'.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600);stack.callback(os.close,lock)
        info=os.fstat(lock)
        if not daily.sig.stat.S_ISREG(info.st_mode) or info.st_nlink!=1:raise ValueError('invalid national lock')
        daily.fcntl.flock(lock,daily.fcntl.LOCK_EX|daily.fcntl.LOCK_NB)
        def next_attempt(parent):
            parent.mkdir(mode=0o700,exist_ok=True)
            number=1+max([int(p.name[-4:]) for p in parent.glob('attempt-[0-9][0-9][0-9][0-9]')],default=0)
            if number>9999:raise ValueError('attempt budget exceeded')
            path=parent/f'attempt-{number:04d}';path.mkdir(mode=0o700);return path
        def listing(parent):
            nonlocal requests
            attempt=next_attempt(parent);opener=opener_factory();requests+=1
            receipt=daily.download(opener,urllib.request.Request(BASE),attempt/'listing.html',2*1024**2)
            parser,selected=parse_listing(attempt/'listing.html',date)
            return attempt,opener,receipt,parser,selected
        if (root/'plan.json').exists():
            plan=daily.load(root/'plan.json')
            if plan['query']!=query:raise ValueError('national resume plan differs')
        else:
            attempt,opener,receipt,parser,selected=listing(root/'catalog')
            plan={'query':query,'selected':selected,'catalog':{'file':str(attempt/'listing.html'),'receipt':receipt}}
            daily.atomic_json(root/'plan.json',plan);initial=(opener,receipt,parser,selected,attempt/'listing.html')
        daily.atomic_json(root/'status.json',{'status':'checking','dataDate':date,'signaturesVerified':False,'materialized':False})
        _,selected=parse_listing(Path(plan['catalog']['file']),date)
        if selected!=plan['selected'] or daily.hashlib.sha256(daily.small_bytes(Path(plan['catalog']['file']))).hexdigest()!=plan['catalog']['receipt']['sha256']:raise ValueError('national catalog changed')
        parts=[];pending=[]
        for i,link in enumerate(selected['zips']):
            directory=root/f'part-{i:03d}';directory.mkdir(mode=0o700,exist_ok=True)
            if not (directory/'acquisition.json').exists():
                if downloads>=max_zips:pending.append(link['fileId']);continue
                if shutil.disk_usage(root).free<audit.RESERVE+MAX_ZIP:raise ValueError('national download capacity')
                if initial:
                    opener,listed,parser,current,catalog=initial;initial=None;attempt=next_attempt(directory);shutil.copyfile(catalog,attempt/'listing.html')
                else:
                    attempt,opener,listed,parser,current=listing(directory)
                if current!=selected:raise ValueError('national catalog changed before download')
                requests+=1;downloads+=1
                downloaded=daily.download(opener,urllib.request.Request(BASE+'index.html',data=urllib.parse.urlencode({**parser.fields,'selDlFileNo':link['fileId']}).encode(),headers={'Referer':BASE}),attempt/'delivery.zip',MAX_ZIP)
                daily.atomic_json(directory/'acquisition.json',{'selected':selected,'fileId':link['fileId'],'attempt':attempt.name,'listing':listed,'download':downloaded})
            receipt=daily.load(directory/'acquisition.json');attempt=retained_archive(directory,receipt,selected,link['fileId'])
            inventory=audit.inspect_archive(attempt/'delivery.zip',receipt['download']['sha256']);parts.append((directory,attempt,receipt,inventory))
            if sum(len(v[3]['expectedXmlParts']) for v in parts)>100:raise ValueError('national XML part count')
        status={'dataDate':date,'scope':'national','requestsThisRun':requests,'downloadsThisRun':downloads,'pendingFileIds':pending,'parts':[{'fileId':v[2]['fileId'],'archive':str(v[1]/'delivery.zip'),**v[3]} for v in parts],'signaturesVerified':False,'materialized':False}
        if pending:status['status']='pending'
        else:
            required=sum(v[3]['expandedBytes'] for v in parts if not (v[0]/'verified/receipt.json').exists());free=shutil.disk_usage(root).free
            status.update({'requiredExpandedBytes':required,'freeBytes':free,'reserveBytes':audit.RESERVE})
            if free<audit.RESERVE+required:
                largest=max((max(m['bytes'] for m in v[3]['members'] if m['entry'].endswith('.xml'))+1024**2 for v in parts),default=0)
                status['requiredTemporaryBytes']=largest
                if free<audit.RESERVE+largest:status['status']='pending-capacity'
                else:
                    proofs=[];count=0
                    for directory,attempt,receipt,inventory in parts:
                        manifest={'archive':str(attempt/'delivery.zip'),'sha256':receipt['download']['sha256'],'publicKey':str(key),'fingerprint':fingerprint,'source':{'sourceUrl':BASE,'observedAt':receipt['download']['observedAt'],'dataDate':date,'kind':'full','purpose':'download'},'expectedXmlParts':inventory['expectedXmlParts']}
                        daily.atomic_json(directory/'archive-verification-input.json',manifest)
                        proof=audit.verify_archive_parts(directory/'archive-verification-input.json')
                        count+=len(proof['parts'])
                        if count>100:raise ValueError('national XML part count')
                        number=1+max([int(p.stem[-4:]) for p in directory.glob('archive-verification-[0-9][0-9][0-9][0-9].json')],default=0)
                        if number>9999:raise ValueError('verification receipt count')
                        target=directory/f'archive-verification-{number:04d}.json';daily.atomic_json(target,proof);proofs.append(str(target))
                    for part_status in status['parts']:part_status['signaturesVerified']=True
                    status.update({'status':'verified-archive','signaturesVerified':True,'expectedParts':count,'archiveVerifications':proofs,'materialized':False})
            else:
                imports=[]
                for directory,attempt,receipt,inventory in parts:
                    manifest={'archive':str(attempt/'delivery.zip'),'sha256':receipt['download']['sha256'],'publicKey':str(key),'fingerprint':fingerprint,'source':{'sourceUrl':BASE,'observedAt':receipt['download']['observedAt'],'dataDate':date,'kind':'full','purpose':'download'},'expectedXmlParts':inventory['expectedXmlParts']}
                    if not (directory/'verified/receipt.json').exists():
                        if (directory/'verified').exists():(directory/'verified').rename(directory/('verified-incomplete-'+attempt.name))
                        daily.atomic_json(directory/'zip-input.json',manifest);audit.verify(directory/'zip-input.json',directory/'verified')
                    verified=daily.load(directory/'verified/receipt.json')
                    if len(verified['parts'])!=len(inventory['expectedXmlParts']) or verified['archive']['sha256']!=manifest['sha256']:raise ValueError('verified archive mismatch')
                    for j,part in enumerate(verified['parts']):
                        actual=daily.sig.verify(directory/f'verified/part-{j:03d}-input.json')
                        if actual['importManifest']['part']!=inventory['expectedXmlParts'][j] or actual['files']['file']['path']!=str(directory/f'verified/part-{j:03d}.xml'):raise ValueError('national part membership mismatch')
                        if actual['files']!=part['files'] or actual['importManifest']!=part['importManifest'] or actual['trustedFingerprint']!=query['fingerprint'] or actual['files']['publicKey']['sha256']!=query['publicKeySha256'] or actual['importManifest']['source']!=manifest['source']:raise ValueError('verified national part changed')
                        import_file=directory/f'verified/part-{j:03d}-import.json'
                        if daily.load(import_file)!=actual['importManifest']:raise ValueError('national import changed')
                        imports.append(str(import_file))
                if not 1<=len(imports)<=100:raise ValueError('national XML part count')
                for part_status in status['parts']:part_status['signaturesVerified']=True
                status.update({'status':'complete','signaturesVerified':True,'materialized':True,'expectedParts':len(imports),'importManifests':imports})
        daily.atomic_json(root/'status.json',status);return status


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['date','public-key','fingerprint','out']:parser.add_argument('--'+name,required=True)
    parser.add_argument('--max-zips',type=int,default=1);args=parser.parse_args()
    print(json.dumps(fetch(args.date,args.public_key,args.fingerprint,args.out,args.max_zips),ensure_ascii=False))


if __name__=='__main__':
    try:main()
    except (ValueError,OSError,TypeError,KeyError,audit.zipfile.BadZipFile,daily.sig.subprocess.SubprocessError):
        raise SystemExit('National acquisition stopped; retained originals are preserved. Check catalog/date, plan, signatures and reserved capacity.')
