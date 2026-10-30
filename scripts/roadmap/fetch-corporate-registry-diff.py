#!/usr/bin/env python3
"""Fetch one dated NTA XML difference ZIP, retain evidence, and verify all signatures."""
import argparse
from contextlib import ExitStack
import datetime as dt
import fcntl
import hashlib
from html.parser import HTMLParser
import http.cookiejar
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import time
import urllib.parse
import urllib.request

spec=importlib.util.spec_from_file_location('registry_zip',Path(__file__).with_name('verify-corporate-registry-zip.py'))
zip_audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(zip_audit)
sig=zip_audit.signature
BASE='https://www.houjin-bangou.nta.go.jp/download/sabun/'
MAX_ZIP=64*1024**2


class Listing(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.forms=0;self.form=False;self.fields={};self.section='';self.row=None;self.entries=[]

    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='form' and a.get('id')=='appForm':
            self.forms+=1;self.form=True
            if a.get('action')!='/download/sabun/index.html' or a.get('method','').lower()!='post':raise ValueError('changed form')
        if self.form and tag=='input' and a.get('type')=='hidden' and 'name' in a:
            if a['name'] in self.fields:raise ValueError('duplicate form input')
            self.fields[a['name']]=a.get('value','')
        if tag=='h2':self.section=a.get('id','')
        if tag=='tr' and self.section=='xml-unicode' and re.fullmatch(r'type2_corpHistory\d+',a.get('class','')):
            if self.row is not None:raise ValueError('nested XML row')
            self.row={'text':'','ids':[]}
        if tag=='a' and self.row is not None:
            match=re.fullmatch(r'\s*return\s+doDownload\((\d+)\);?\s*',a.get('onclick',''))
            if match:self.row['ids'].append(match[1])

    def handle_data(self,data):
        if self.row is not None:self.row['text']+=data

    def handle_endtag(self,tag):
        if tag=='form':self.form=False
        if tag=='tr' and self.row is not None:
            text=re.sub(r'\s+','',self.row['text']);match=re.search(r'令和(元|[0-9]+)年([0-9]+)月([0-9]+)日',text)
            if not match or len(self.row['ids'])!=1:raise ValueError('invalid XML date row')
            year=2018+(1 if match[1]=='元' else int(match[1]));date=dt.date(year,int(match[2]),int(match[3])).isoformat()
            self.entries.append({'dataDate':date,'fileId':self.row['ids'][0]});self.row=None

    def select(self,date):
        matches=[v for v in self.entries if v['dataDate']==date]
        if self.forms!=1 or self.row is not None or self.fields.get('event')!='download' or 'selDlFileNo' not in self.fields or len(matches)!=1:
            raise ValueError('date absent, ambiguous, or unsupported listing')
        return matches[0]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        raise ValueError('unexpected HTTP redirect')


def atomic_json(path,value):
    fd,name=tempfile.mkstemp(prefix='.pending-',dir=path.parent)
    try:
        with os.fdopen(fd,'w') as f:
            json.dump(value,f,ensure_ascii=False,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
        os.replace(name,path)
    finally:
        if os.path.exists(name):os.unlink(name)


def small_bytes(path):
    with ExitStack() as stack:
        fd,before=sig.regular(stack,str(path),2*1024**2)
        chunks=[];size=0
        while chunk:=os.read(fd,65536):
            size+=len(chunk)
            if size>before.st_size:raise ValueError('receipt grew')
            chunks.append(chunk)
        if sig.identity(os.fstat(fd))!=sig.identity(before) or sig.identity(os.lstat(path))!=sig.identity(before):raise ValueError('changed receipt')
        return b''.join(chunks)


def load(path):
    return json.loads(small_bytes(path).decode('utf-8'))


def download(opener,request,target,limit):
    start=time.monotonic();h=hashlib.sha256();size=0
    with opener.open(request,timeout=60) as response, target.open('xb') as f:
        if response.geturl()!=request.full_url or response.status!=200:raise ValueError('unexpected response')
        length=response.headers.get('Content-Length')
        if length is not None and (not length.isdecimal() or int(length)>limit):raise ValueError('oversized response')
        while chunk:=response.read(65536):
            size+=len(chunk)
            if size>limit or time.monotonic()-start>120 or shutil.disk_usage(target.parent).free<zip_audit.RESERVE+len(chunk):raise ValueError('response budget or free space exceeded')
            f.write(chunk);h.update(chunk)
        if not size or (length is not None and size!=int(length)):raise ValueError('incomplete response')
        f.flush();os.fsync(f.fileno())
    return {'url':request.full_url,'bytes':size,'sha256':h.hexdigest(),'observedAt':dt.datetime.now(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')}


def validate_complete(root,receipt,plan):
    if set(receipt)!={'format','plan','attempt','acquisition','verifiedReceipt','importManifest'}:raise ValueError('invalid completion receipt')
    attempt=root/receipt['attempt']
    if receipt['plan']!=plan or attempt.parent!=root or not re.fullmatch(r'attempt-\d{4}',attempt.name):raise ValueError('completion plan mismatch')
    if receipt['format']!='edinet-ts-corporate-registry-acquisition-v1' or receipt['verifiedReceipt']!=str(attempt/'verified/receipt.json') or receipt['importManifest']!=str(attempt/'verified/part-000-import.json'):raise ValueError('completion output mismatch')
    if attempt.is_symlink():raise ValueError('attempt directory is a symlink')
    acquisition=load(attempt/'acquisition.json')
    if acquisition!=receipt['acquisition']:raise ValueError('acquisition receipt mismatch')
    with ExitStack() as stack:
        for name,expected in [('listing.html',acquisition['listing']),('delivery.zip',acquisition['download'])]:
            fd,before=sig.regular(stack,str(attempt/name),MAX_ZIP)
            if before.st_size!=expected['bytes'] or sig.digest(fd,before.st_size)!=expected['sha256']:raise ValueError('retained acquisition changed')
    listing_bytes=small_bytes(attempt/'listing.html')
    if hashlib.sha256(listing_bytes).hexdigest()!=acquisition['listing']['sha256']:raise ValueError('listing changed')
    parser=Listing();parser.feed(listing_bytes.decode('utf-8'));selected=parser.select(plan['dataDate'])
    if selected!=acquisition['selected']:raise ValueError('listing selection mismatch')
    archive=load(attempt/'verified/receipt.json')
    if acquisition['listing']['url']!=BASE or acquisition['download']['url']!=BASE+'index.html' or archive['archive']['path']!=str(attempt/'delivery.zip'):raise ValueError('acquisition URL or path mismatch')
    if archive['archive']['sha256']!=acquisition['download']['sha256'] or len(archive['parts'])!=1:raise ValueError('archive receipt mismatch')
    expected_source={'sourceUrl':BASE,'observedAt':acquisition['download']['observedAt'],'dataDate':plan['dataDate'],'kind':'diff','purpose':'download'}
    if archive['source']!=expected_source or archive['parts'][0]['trustedFingerprint']!=plan['fingerprint']:raise ValueError('source or trust mismatch')
    part=sig.verify(attempt/'verified/part-000-input.json')
    if part['trustedFingerprint']!=plan['fingerprint'] or part['importManifest']['source']!=expected_source or part['importManifest']['part']!='diff_'+plan['dataDate'].replace('-','')+'.xml' or part['files']['file']['path']!=str(attempt/'verified/part-000.xml') or part['files']['signature']['path']!=str(attempt/'verified/part-000.xml.asc'):raise ValueError('part source or path mismatch')
    if part['importManifest']!=archive['parts'][0]['importManifest'] or part['files']!=archive['parts'][0]['files'] or part['files']['publicKey']['sha256']!=plan['publicKeySha256']:raise ValueError('verified part changed')
    if load(attempt/'verified/part-000-import.json')!=part['importManifest']:raise ValueError('import manifest changed')
    return receipt


def fetch(date,key,fingerprint,output,opener=None):
    if dt.date.fromisoformat(date).isoformat()!=date or dt.date.fromisoformat(date)>dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date():raise ValueError('invalid or future date')
    if not re.fullmatch('[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64}',fingerprint):raise ValueError('full trusted fingerprint required')
    key=Path(key).absolute();root=Path(output).absolute()
    with ExitStack() as stack:
        kfd,ks=sig.regular(stack,str(key),1024**2);key_sha=sig.digest(kfd,ks.st_size)
        root.mkdir(mode=0o700,parents=True,exist_ok=True)
        if root.is_symlink() or not root.is_dir():raise ValueError('output must be a directory, not a symlink')
        lock_fd=os.open(root/'.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600);stack.callback(os.close,lock_fd)
        lock_stat=os.fstat(lock_fd)
        if not sig.stat.S_ISREG(lock_stat.st_mode) or lock_stat.st_nlink!=1:raise ValueError('invalid lock file')
        fcntl.flock(lock_fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        plan={'dataDate':date,'sourceUrl':BASE,'fingerprint':fingerprint.upper(),'publicKeySha256':key_sha}
        if (root/'plan.json').exists():
            if load(root/'plan.json')!=plan:raise ValueError('resume plan differs')
        else:atomic_json(root/'plan.json',plan)
        if (root/'complete.json').exists():return {'status':'retained','networkRequested':False,'requestCount':0,**validate_complete(root,load(root/'complete.json'),plan)}
        for previous in sorted(root.glob('attempt-????'),reverse=True):
            if (previous/'complete.json').exists():
                receipt=validate_complete(root,load(previous/'complete.json'),plan);atomic_json(root/'complete.json',receipt);return {'status':'recovered','networkRequested':False,'requestCount':0,**receipt}
        number=1+max([int(v.name[-4:]) for v in root.glob("attempt-[0-9][0-9][0-9][0-9]")],default=0)
        if number>9999:raise ValueError("attempt limit exceeded")
        attempt=root/f"attempt-{number:04d}"
        attempt.mkdir(mode=0o700)
        try:
            if shutil.disk_usage(root).free<zip_audit.RESERVE+MAX_ZIP:raise ValueError('free space reserve')
            opener=opener or urllib.request.build_opener(NoRedirect(),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
            listing=download(opener,urllib.request.Request(BASE),attempt/'listing.html',2*1024**2)
            parser=Listing();parser.feed(small_bytes(attempt/'listing.html').decode('utf-8'));selected=parser.select(date)
            fields={**parser.fields,'selDlFileNo':selected['fileId']}
            request=urllib.request.Request(BASE+'index.html',data=urllib.parse.urlencode(fields).encode(),headers={'Referer':BASE})
            downloaded=download(opener,request,attempt/'delivery.zip',MAX_ZIP)
            acquisition={'listing':listing,'download':downloaded,'selected':selected};atomic_json(attempt/'acquisition.json',acquisition)
            source={'sourceUrl':BASE,'observedAt':downloaded['observedAt'],'dataDate':date,'kind':'diff','purpose':'download'}
            manifest={'archive':str(attempt/'delivery.zip'),'sha256':downloaded['sha256'],'publicKey':str(key),'fingerprint':fingerprint,'source':source,'expectedXmlParts':['diff_'+date.replace('-','')+'.xml']}
            atomic_json(attempt/'zip-input.json',manifest);zip_audit.verify(attempt/'zip-input.json',attempt/'verified')
            receipt={'format':'edinet-ts-corporate-registry-acquisition-v1','plan':plan,'attempt':attempt.name,'acquisition':acquisition,'verifiedReceipt':str(attempt/'verified/receipt.json'),'importManifest':str(attempt/'verified/part-000-import.json')}
            validate_complete(root,receipt,plan);atomic_json(attempt/'complete.json',receipt);atomic_json(root/'complete.json',receipt)
            return {'status':'downloaded','networkRequested':True,'requestCount':2,**receipt}
        except BaseException as error:
            atomic_json(attempt/'failure.json',{'errorType':type(error).__name__,'failedAt':dt.datetime.now(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')})
            raise


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['date','public-key','fingerprint','out']:parser.add_argument('--'+name,required=True)
    args=parser.parse_args();print(json.dumps(fetch(args.date,args.public_key,args.fingerprint,args.out),ensure_ascii=False))


if __name__=='__main__':
    try:main()
    except (ValueError,OSError,TypeError,KeyError,zip_audit.zipfile.BadZipFile,sig.subprocess.SubprocessError):
        raise SystemExit('Acquisition failed; retained attempts are preserved. Check date, listing, signatures, plan and capacity.')
