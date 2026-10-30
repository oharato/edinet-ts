#!/usr/bin/env python3
"""Preserve exact stopped SQLite bytes in verified gzip cold storage, with guarded restore."""
import argparse
from contextlib import contextmanager
import datetime
import gzip
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import stat
import tempfile
import zlib

RESERVE=34*1024**3


def identity(s):return [s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_nlink]
def sha():return hashlib.sha256()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()


@contextmanager
def regular(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        s=os.fstat(fd)
        if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1 or s.st_size<1:raise ValueError('single-link regular file required')
        yield fd,s
    finally:os.close(fd)


def unchanged(path,fd,before):
    if identity(os.fstat(fd))!=identity(before) or identity(os.lstat(path))!=identity(before):raise ValueError('file changed during operation')


def stopped(path):
    for suffix in ['-wal','-shm','-journal']:
        if os.path.lexists(str(path)+suffix):raise ValueError('SQLite sidecar present')


def digest(fd,size):
    os.lseek(fd,0,os.SEEK_SET);h=sha();count=0
    while chunk:=os.read(fd,65536):
        count+=len(chunk)
        if count>size:raise ValueError('file grew')
        h.update(chunk)
    if count!=size:raise ValueError('short file')
    os.lseek(fd,0,os.SEEK_SET);return h.hexdigest()


def atomic(path,value):
    fd,name=tempfile.mkstemp(prefix='.pending-',dir=path.parent)
    try:
        with os.fdopen(fd,'w') as f:json.dump(value,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
        os.link(name,path);os.unlink(name)
        directory=os.open(path.parent,os.O_RDONLY)
        try:os.fsync(directory)
        finally:os.close(directory)
    finally:
        if os.path.exists(name):os.unlink(name)


def load(path):
    with regular(path) as (fd,before):
        if before.st_size>1024**2:raise ValueError('receipt too large')
        raw=os.read(fd,before.st_size);unchanged(path,fd,before);return json.loads(raw.decode())


class GuardedWriter:
    def __init__(self,file,directory):self.file=file;self.directory=directory
    def write(self,chunk):
        if shutil.disk_usage(self.directory).free<RESERVE+len(chunk):raise ValueError('free space reserve reached')
        return self.file.write(chunk)
    def flush(self):return self.file.flush()
    def tell(self):return self.file.tell()


def verify_payload(path,source_bytes,source_sha256,expected_archive=None):
    with regular(path) as (fd,before):
        if expected_archive is not None and before.st_size!=expected_archive['bytes']:raise ValueError('compressed size changed')
        compressed_sha=digest(fd,before.st_size)
        if expected_archive is not None and compressed_sha!=expected_archive['sha256']:raise ValueError('compressed hash changed')
        h=sha();count=0
        with os.fdopen(os.dup(fd),'rb') as stream, gzip.GzipFile(fileobj=stream,mode='rb') as decoded:
            while chunk:=decoded.read(65536):
                count+=len(chunk)
                if count>source_bytes:raise ValueError('decoded data exceeds original size')
                h.update(chunk)
        if count!=source_bytes or h.hexdigest()!=source_sha256:raise ValueError('cold archive differs from original')
        unchanged(path,fd,before)
        return {'path':str(path),'bytes':before.st_size,'sha256':compressed_sha}


def pack(source,output,expected_sha256):
    if not isinstance(expected_sha256,str) or not re.fullmatch('[a-f0-9]{64}',expected_sha256):raise ValueError('pinned SHA-256 required')
    source=Path(source).absolute();out=Path(output).absolute();stopped(source)
    with regular(source) as (fd,before):
        if before.st_size>1024**4:raise ValueError('SQLite source exceeds 1TiB')
        if os.read(fd,16)!=b'SQLite format 3\x00':raise ValueError('SQLite header required')
        os.lseek(fd,0,os.SEEK_SET);out.mkdir(mode=0o700);partial=out/'payload.partial.gz'
        try:
            h=sha();remaining=before.st_size
            with partial.open('xb') as target:
                guarded=GuardedWriter(target,out)
                with gzip.GzipFile(filename='',fileobj=guarded,mode='wb',compresslevel=6,mtime=0) as encoded:
                    while remaining:
                        chunk=os.read(fd,min(65536,remaining))
                        if not chunk:raise ValueError('short SQLite source')
                        remaining-=len(chunk);h.update(chunk);encoded.write(chunk)
                target.flush();os.fsync(target.fileno())
            if h.hexdigest()!=expected_sha256:raise ValueError('original SHA-256 differs')
            unchanged(source,fd,before);stopped(source)
            archive=verify_payload(partial,before.st_size,expected_sha256)
            unchanged(source,fd,before);stopped(source)
            partial.rename(out/'payload.gz');archive['path']=str(out/'payload.gz')
            receipt={'format':'edinet-ts-cold-sqlite-v1','source':{'path':str(source),'bytes':before.st_size,'sha256':expected_sha256,'identity':[str(v) for v in identity(before)]},'archive':archive,'verifiedAt':now(),'method':'full-gzip-roundtrip-sha256','sourceRetainedAtPack':True}
            atomic(out/'receipt.json',receipt);return receipt
        except BaseException:
            # Only newly generated output is removed; the source is never modified by pack.
            shutil.rmtree(out);raise


def open_descriptors(source,allowed_fd):
    s=os.stat(source);matches=[];opaque=[]
    for process in Path('/proc').iterdir():
        if not process.name.isdecimal():continue
        try:
            if process.stat().st_uid!=os.getuid():continue
            files=list((process/'fd').iterdir())
        except FileNotFoundError:continue
        except PermissionError:opaque.append(process.name);continue
        for file in files:
            if int(process.name)==os.getpid() and file.name==str(allowed_fd):continue
            try:
                current=file.stat()
                if (current.st_dev,current.st_ino)==(s.st_dev,s.st_ino):matches.append({'pid':process.name,'fd':file.name})
            except FileNotFoundError:pass
            except PermissionError:opaque.append(process.name)
    return {'openDescriptors':matches,'opaqueOwnedProcesses':sorted(set(opaque))}


def capture_receipt(output):
    out=Path(output).absolute();receipt=load(out/'receipt.json')
    if receipt['format']!='edinet-ts-cold-sqlite-v1' or receipt['archive']['path']!=str(out/'payload.gz'):raise ValueError('invalid cold archive receipt')
    source=receipt['source'];archive=receipt['archive']
    if type(source['bytes']) is not int or not 16<=source['bytes']<=1024**4 or type(archive['bytes']) is not int or archive['bytes']<1 or not re.fullmatch('[a-f0-9]{64}',source['sha256']) or not re.fullmatch('[a-f0-9]{64}',archive['sha256']):raise ValueError('invalid source or compressed fingerprint')
    if not isinstance(source['identity'],list) or len(source['identity'])!=6 or source['identity'][2]!=str(source['bytes']):raise ValueError('invalid original identity')
    return out,receipt


def read_receipt(output):
    out,receipt=capture_receipt(output)
    archive=verify_payload(out/'payload.gz',receipt['source']['bytes'],receipt['source']['sha256'],receipt['archive'])
    if archive!=receipt['archive']:raise ValueError('compressed archive changed')
    return out,receipt


def usage_audit(out,source,fd,phase):
    audit=open_descriptors(source,fd)
    number=1+max([int(p.stem[-4:]) for p in out.glob('retire-check-[0-9][0-9][0-9][0-9].json')],default=0)
    if number>9999:raise ValueError('audit count exceeded')
    path=out/f'retire-check-{number:04d}.json'
    value={'checkedAt':now(),'phase':phase,**audit}
    atomic(path,value)
    return {'auditPath':str(path),**value}


def audit_usage(output):
    out,receipt=capture_receipt(output);source=Path(receipt['source']['path']);stopped(source)
    with regular(source) as (fd,before):
        if before.st_uid!=os.getuid() or [str(v) for v in identity(before)]!=receipt['source']['identity']:raise ValueError('original owner or identity changed')
        audit=usage_audit(out,source,fd,'audit-only');unchanged(source,fd,before);stopped(source)
        return {'status':'blocked' if audit['openDescriptors'] or audit['opaqueOwnedProcesses'] else 'no-open-readers-observed','sourceRetained':True,**audit}


def retire(output):
    out,receipt=capture_receipt(output)
    source=Path(receipt['source']['path']);stopped(source)
    with regular(source) as (fd,before):
        if before.st_uid!=os.getuid():raise ValueError('only the source owner may retire it')
        if [str(v) for v in identity(before)]!=receipt['source']['identity']:raise ValueError('original changed since cold archive')
        def check_processes(phase):
            audit=usage_audit(out,source,fd,phase)
            if audit['openDescriptors'] or audit['opaqueOwnedProcesses']:raise ValueError('source use cannot be ruled out; original retained')
        check_processes('before-verification')
        _,verified=read_receipt(out)
        if verified!=receipt or digest(fd,before.st_size)!=receipt['source']['sha256']:raise ValueError('original or receipt changed')
        check_processes('before-retirement');unchanged(source,fd,before);stopped(source)
        # The verified gzip preserves every original byte; callers stop future consumers first.
        source.unlink();directory=os.open(source.parent,os.O_RDONLY)
        try:os.fsync(directory)
        finally:os.close(directory)
        atomic(out/'retired.json',{'retiredAt':now(),'source':receipt['source'],'archive':receipt['archive']})
    return {'status':'retired','receipt':str(out/'receipt.json')}


def restore(output,target=None):
    out,receipt=capture_receipt(output);source=receipt['source'];target=Path(target or source['path']).absolute();stopped(target)
    if os.path.lexists(target):raise ValueError('restore never overwrites an existing path')
    if shutil.disk_usage(target.parent).free<RESERVE+source['bytes']:raise ValueError('restore capacity with reserve is insufficient')
    archive=out/'payload.gz'
    with regular(archive) as (archive_fd,before):
        if before.st_size!=receipt['archive']['bytes'] or digest(archive_fd,before.st_size)!=receipt['archive']['sha256']:raise ValueError('compressed archive changed')
        fd,name=tempfile.mkstemp(prefix='.sqlite-restore-',dir=target.parent)
        try:
            h=sha();count=0
            with os.fdopen(fd,'wb') as dest, os.fdopen(os.dup(archive_fd),'rb') as raw, gzip.GzipFile(fileobj=raw,mode='rb') as stream:
                writer=GuardedWriter(dest,target.parent)
                while chunk:=stream.read(65536):
                    count+=len(chunk)
                    if count>source['bytes']:raise ValueError('restore exceeds original size')
                    h.update(chunk);writer.write(chunk)
                dest.flush();os.fsync(dest.fileno())
            if count!=source['bytes'] or h.hexdigest()!=source['sha256']:raise ValueError('restored bytes differ')
            unchanged(archive,archive_fd,before);stopped(target);os.link(name,target);os.unlink(name)
            directory=os.open(target.parent,os.O_RDONLY)
            try:os.fsync(directory)
            finally:os.close(directory)
            return {'status':'restored','path':str(target),'bytes':count,'sha256':h.hexdigest()}
        finally:
            if os.path.exists(name):os.unlink(name)


def main():
    parser=argparse.ArgumentParser(description=__doc__);commands=parser.add_subparsers(dest='command',required=True)
    packing=commands.add_parser('pack');packing.add_argument('--source',required=True);packing.add_argument('--out',required=True);packing.add_argument('--expected-sha256',required=True)
    checking=commands.add_parser('audit');checking.add_argument('--archive',required=True)
    retiring=commands.add_parser('retire');retiring.add_argument('--archive',required=True)
    restoring=commands.add_parser('restore');restoring.add_argument('--archive',required=True);restoring.add_argument('--target')
    args=parser.parse_args()
    if args.command=='pack':result=pack(args.source,args.out,args.expected_sha256)
    elif args.command=='retire':result=retire(args.archive)
    elif args.command=='audit':result=audit_usage(args.archive)
    else:result=restore(args.archive,args.target)
    print(json.dumps(result))


if __name__=='__main__':
    try:main()
    except (ValueError,OSError,KeyError,TypeError,EOFError,zlib.error):
        raise SystemExit('Cold archive operation stopped. Originals and existing outputs are not overwritten; check hashes, sidecars, process audit and reserved capacity.')
