#!/usr/bin/env python3
"""Audit one retained XML/signature ZIP and prepare verified Store imports offline."""
import argparse
from contextlib import ExitStack
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import struct
import tempfile
import zipfile

spec = importlib.util.spec_from_file_location('registry_signature', Path(__file__).with_name('verify-corporate-registry-signature.py'))
signature = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signature)
RESERVE = 34 * 1024**3


def central_directory(fd, size):
    # Bound ZIP metadata before ZipFile allocates its member list; ZIP64 end records are not accepted.
    tail = os.pread(fd, min(size, 65557), max(0, size - 65557))
    offset = tail.rfind(b'PK\x05\x06')
    if offset < 0 or len(tail) - offset < 22:
        raise ValueError('missing ZIP directory')
    _, disk, directory_disk, count_disk, count, length, start, comment = struct.unpack('<4s4H2IH', tail[offset:offset+22])
    end = size - len(tail) + offset
    if disk or directory_disk or count != count_disk or not 2 <= count <= 200 or length > 4*1024**2 or start+length != end or offset+22+comment != len(tail):
        raise ValueError('unsupported ZIP directory')


def validate_members(members, names):
    if not 1 <= len(names) <= 100 or any(not isinstance(n, str) or not n.endswith('.xml') or '\\' in n or '\x00' in n or PurePosixPath(n).is_absolute() or any(p in {'', '.', '..'} for p in n.split('/')) for n in names) or len(set(names)) != len(names):
        raise ValueError('invalid expected XML part names')
    expected_names = set(names) | {n+'.asc' for n in names}
    if len(members) != len(expected_names) or {v.filename for v in members} != expected_names:
        raise ValueError('ZIP has missing, duplicate or unexpected members')
    for member in members:
        limit = 1024**2 if member.filename.endswith('.asc') else 8*1024**3
        mode = member.external_attr >> 16
        if member.flag_bits & 1 or member.is_dir() or (mode & 0o170000) not in {0, 0o100000} or not 0 < member.file_size <= limit:
            raise ValueError('unsupported ZIP member')


def extract_member(z, original, target):
    member = z.getinfo(original)
    written = 0
    sha = signature.hashlib.sha256()
    with z.open(member) as source, target.open('xb') as dest:
        while chunk := source.read(65536):
            written += len(chunk)
            if written > member.file_size or shutil.disk_usage(target.parent).free < RESERVE + len(chunk):
                raise ValueError('expanded member or capacity limit reached')
            sha.update(chunk)
            dest.write(chunk)
    if written != member.file_size or shutil.disk_usage(target.parent).free < RESERVE:
        raise ValueError('incomplete member or free space reserve reached')
    return {'entry': original, 'path': str(target), 'bytes': written, 'crc32': f'{member.CRC:08x}', 'sha256':sha.hexdigest()}


def verify(manifest, output):
    base = Path(manifest).absolute().parent
    out = Path(output).absolute()
    with ExitStack() as stack:
        fd, _ = signature.regular(stack, str(Path(manifest).absolute()), 2*1024**2)
        m = json.loads(os.read(fd, 2*1024**2).decode('utf-8'))
        if set(m) != {'archive', 'sha256', 'publicKey', 'fingerprint', 'source', 'expectedXmlParts'}:
            raise ValueError('invalid ZIP manifest')
        names = m['expectedXmlParts']
        if not isinstance(names, list):raise ValueError('invalid XML part list')
        archive = os.path.abspath(base / m['archive'])
        afd, before = signature.regular(stack, archive, 2*1024**3)
        expected = signature.digest(afd, before.st_size)
        if expected != m['sha256']:
            raise ValueError('ZIP differs from acquisition hash')
        central_directory(afd, before.st_size)
        raw = stack.enter_context(os.fdopen(os.dup(afd), 'rb'))
        z = stack.enter_context(zipfile.ZipFile(raw))
        members = z.infolist()
        validate_members(members, names)
        required = sum(v.file_size for v in members)
        if shutil.disk_usage(out.parent).free < RESERVE + required:
            raise ValueError('insufficient free space with 34GiB reserve')
        out.mkdir(mode=0o700)
        try:
            receipts = []
            inventory = []
            imports = []
            for i, name in enumerate(names):
                xml = out / f'part-{i:03d}.xml'
                for original, target in [(name, xml), (name+'.asc', Path(str(xml)+'.asc'))]:
                    inventory.append(extract_member(z, original, target))
                part = {'file':str(xml), 'signature':str(xml)+'.asc', 'sha256':inventory[-2]['sha256'],
                        'publicKey':os.path.abspath(base / m['publicKey']), 'fingerprint':m['fingerprint'], 'source':m['source'], 'part':name}
                input_path = out / f'part-{i:03d}-input.json'
                input_path.write_text(json.dumps(part))
                receipt = signature.verify(input_path)
                receipts.append(receipt)
                imports.append({'manifest': f'part-{i:03d}-import.json', 'input':receipt['importManifest']})
            if signature.digest(afd, before.st_size) != expected or signature.identity(os.fstat(afd)) != signature.identity(before) or signature.identity(os.lstat(archive)) != signature.identity(before):
                raise ValueError('ZIP changed during verification')
            receipt = {'format':'edinet-ts-corporate-registry-zip-v1','archive':{'path':archive,'sha256':expected,'bytes':before.st_size},'source':m['source'],'members':inventory,'parts':receipts,'imports':imports,'allExpectedMembersVerified':True,'networkRequested':False}
            for i, part in enumerate(receipts):
                (out/f'part-{i:03d}-receipt.json').write_text(json.dumps(part,ensure_ascii=False,indent=2)+'\n')
            for item in imports:
                (out/item['manifest']).write_text(json.dumps(item['input'],ensure_ascii=False,indent=2)+'\n')
            (out/'receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
            return receipt
        except BaseException:
            shutil.rmtree(out)
            raise


def inspect_archive(file, expected_sha256):
    """Inspect retained ZIP metadata without expanding XML or claiming signature verification."""
    with ExitStack() as stack:
        fd, before = signature.regular(stack, str(file), 2*1024**3)
        if signature.digest(fd, before.st_size) != expected_sha256:
            raise ValueError('ZIP differs from acquisition hash')
        central_directory(fd, before.st_size)
        raw = stack.enter_context(os.fdopen(os.dup(fd), 'rb'))
        z = stack.enter_context(zipfile.ZipFile(raw))
        members = z.infolist()
        names = [m.filename for m in members if m.filename.endswith('.xml')]
        validate_members(members, names)
        if signature.digest(fd, before.st_size) != expected_sha256 or signature.identity(os.fstat(fd)) != signature.identity(before) or signature.identity(os.lstat(file)) != signature.identity(before):
            raise ValueError('ZIP changed during inspection')
        return {'sha256': expected_sha256, 'bytes': before.st_size, 'expectedXmlParts': names,
                'expandedBytes': sum(m.file_size for m in members),
                'members': [{'entry':m.filename,'bytes':m.file_size,'compressedBytes':m.compress_size,'crc32':f'{m.CRC:08x}'} for m in members],
                'signaturesVerified': False}


def verify_archive_parts(manifest):
    """Verify every XML with one temporary expansion at a time; retain the original ZIP."""
    base = Path(manifest).absolute().parent
    with ExitStack() as stack:
        mfd, ms = signature.regular(stack, str(manifest), 2*1024**2)
        m = json.loads(os.read(mfd, ms.st_size).decode('utf-8'))
        if set(m) != {'archive', 'sha256', 'publicKey', 'fingerprint', 'source', 'expectedXmlParts'}:
            raise ValueError('invalid archive verification manifest')
        archive = os.path.abspath(base / m['archive'])
        fd, before = signature.regular(stack, archive, 2*1024**3)
        if signature.digest(fd, before.st_size) != m['sha256']:
            raise ValueError('ZIP differs from acquisition hash')
        central_directory(fd, before.st_size)
        raw = stack.enter_context(os.fdopen(os.dup(fd), 'rb'))
        z = stack.enter_context(zipfile.ZipFile(raw))
        names = m['expectedXmlParts']
        if not isinstance(names, list):raise ValueError('invalid XML parts')
        validate_members(z.infolist(), names)
        receipts = []
        for name in names:
            required = z.getinfo(name).file_size + z.getinfo(name+'.asc').file_size
            if shutil.disk_usage(base).free < RESERVE + required:
                raise ValueError('single XML exceeds reserved capacity')
            with tempfile.TemporaryDirectory(prefix='registry-xml-verification-', dir=base) as temporary:
                directory = Path(temporary)
                xml = extract_member(z, name, directory/'input.xml')
                detached = extract_member(z, name+'.asc', directory/'input.xml.asc')
                input_manifest = directory/'input.json'
                input_manifest.write_text(json.dumps({'file':xml['path'],'signature':detached['path'],'sha256':xml['sha256'],'publicKey':os.path.abspath(base/m['publicKey']),'fingerprint':m['fingerprint'],'source':m['source'],'part':name}))
                result = signature.verify(input_manifest)
                receipts.append({'entry':name,'xmlSha256':xml['sha256'],'xmlBytes':xml['bytes'],'signatureEntry':name+'.asc','signatureSha256':detached['sha256'],
                                 'trustedFingerprint':result['trustedFingerprint'],'signingFingerprint':result['signingFingerprint'],'signatureCreatedAt':result['signatureCreatedAt'],'verifiedAt':result['verifiedAt'],
                                 'gpgVersion':result['gpgVersion'],'verificationStatus':result['verificationStatus'],'publicKey':result['files']['publicKey']})
        if signature.digest(fd, before.st_size) != m['sha256'] or signature.identity(os.fstat(fd)) != signature.identity(before) or signature.identity(os.lstat(archive)) != signature.identity(before):
            raise ValueError('ZIP changed during verification')
        return {'format':'edinet-ts-corporate-registry-verified-archive-v1','archive':{'path':archive,'sha256':m['sha256'],'bytes':before.st_size},'source':m['source'],
                'parts':receipts,'signaturesVerified':True,'materialized':False,'networkRequested':False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    result = verify(args.manifest, args.out)
    print(json.dumps({'verified':True,'parts':len(result['parts']),'receipt':str(Path(args.out)/'receipt.json')}))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, TypeError, KeyError, zipfile.BadZipFile, signature.subprocess.SubprocessError):
        raise SystemExit('ZIP verification failed; check acquisition hash, exact part list, signatures and free space.')
