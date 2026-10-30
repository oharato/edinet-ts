#!/usr/bin/env python3
"""Stream one retained ZIP XML to stdout; bind bytes to a prior verification receipt.

This checks byte integrity and archive immutability, not PGP trust on its own.
"""
import argparse
from contextlib import ExitStack
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import zipfile

spec = importlib.util.spec_from_file_location('registry_zip', Path(__file__).with_name('verify-corporate-registry-zip.py'))
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)


def stream(receipt_path, entry, output):
    with ExitStack() as stack:
        receipt_fd, receipt_before = archive.signature.regular(stack, receipt_path, 2*1024**2)
        receipt = json.loads(os.read(receipt_fd, receipt_before.st_size+1))
        if receipt.get('format') != 'edinet-ts-corporate-registry-verified-archive-v1' or receipt.get('signaturesVerified') is not True:
            raise ValueError('a prior verified archive receipt is required')
        parts = receipt['parts']
        names = [p['entry'] for p in parts]
        matching = [p for p in parts if p['entry'] == entry]
        if len(matching) != 1:
            raise ValueError('entry missing or duplicated in receipt')
        part = matching[0]
        expected = part['xmlSha256']
        if not isinstance(expected, str) or len(expected) != 64 or any(c not in '0123456789abcdef' for c in expected):
            raise ValueError('invalid XML hash')
        info = receipt['archive']
        fd, before = archive.signature.regular(stack, info['path'], 2*1024**3)
        if before.st_size != info['bytes'] or archive.signature.digest(fd, before.st_size) != info['sha256']:
            raise ValueError('archive differs from receipt')
        archive.central_directory(fd, before.st_size)
        raw = stack.enter_context(os.fdopen(os.dup(fd), 'rb'))
        z = stack.enter_context(zipfile.ZipFile(raw))
        archive.validate_members(z.infolist(), names)
        member = z.getinfo(entry)
        if member.file_size != part['xmlBytes']:
            raise ValueError('entry size differs from receipt')
        sha, size = hashlib.sha256(), 0
        with z.open(member) as source:
            while chunk := source.read(65536):
                size += len(chunk)
                if size > part['xmlBytes']:
                    raise ValueError('expanded XML exceeded receipt')
                sha.update(chunk)
                output.write(chunk)
        if size != part['xmlBytes'] or sha.hexdigest() != expected:
            raise ValueError('XML differs from receipt')
        if archive.signature.digest(fd, before.st_size) != info['sha256'] or archive.signature.identity(os.fstat(fd)) != archive.signature.identity(before) or archive.signature.identity(os.lstat(info['path'])) != archive.signature.identity(before):
            raise ValueError('archive changed during stream')
        if archive.signature.identity(os.fstat(receipt_fd)) != archive.signature.identity(receipt_before) or archive.signature.identity(os.lstat(receipt_path)) != archive.signature.identity(receipt_before):
            raise ValueError('receipt changed during stream')
        output.flush()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--receipt', required=True)
    parser.add_argument('--entry', required=True)
    args = parser.parse_args()
    stream(str(Path(args.receipt).absolute()), args.entry, sys.stdout.buffer)


if __name__ == '__main__':
    main()
