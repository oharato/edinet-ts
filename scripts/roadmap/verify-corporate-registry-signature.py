#!/usr/bin/env python3
"""Verify retained NTA XML offline, then emit a SHA-pinned Store import manifest."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
from contextlib import ExitStack


def regular(stack, path, maximum):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    stack.callback(os.close, fd)
    before = os.fstat(fd)
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or not 0 < before.st_size <= maximum:
        raise ValueError('expected a bounded, single-link regular file')
    return fd, before


def identity(s):
    return s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_nlink


def digest(fd, maximum):
    os.lseek(fd, 0, os.SEEK_SET)
    h = hashlib.sha256()
    size = 0
    while chunk := os.read(fd, 65536):
        size += len(chunk)
        if size > maximum:
            raise ValueError('input grew during verification')
        h.update(chunk)
    os.lseek(fd, 0, os.SEEK_SET)
    return h.hexdigest()


def verify(manifest):
    base = Path(manifest).absolute().parent
    with ExitStack() as stack:
        mfd, _ = regular(stack, str(Path(manifest).absolute()), 2 * 1024**2)
        m = json.loads(os.read(mfd, 2 * 1024**2).decode('utf-8'))
        if set(m) != {'file', 'signature', 'publicKey', 'fingerprint', 'sha256', 'source', 'part'}:
            raise ValueError('invalid manifest fields')
        if not re.fullmatch('[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64}', m['fingerprint']) or not re.fullmatch('[a-f0-9]{64}', m['sha256']):
            raise ValueError('expected full fingerprint and XML SHA-256')
        if not isinstance(m['part'], str) or not m['part'].strip() or not isinstance(m['source'], dict):
            raise ValueError('invalid source or part')
        opened = {}
        for name, limit in [('file', 8 * 1024**3), ('signature', 1024**2), ('publicKey', 1024**2)]:
            if not isinstance(m[name], str) or not m[name].strip():
                raise ValueError('invalid input path')
            path = os.path.abspath(base / m[name])
            fd, before = regular(stack, path, limit)
            opened[name] = (path, fd, before, digest(fd, before.st_size))
        if opened['file'][3] != m['sha256']:
            raise ValueError('XML differs from acquisition hash')
        with tempfile.TemporaryDirectory(prefix='edinet-registry-gpg-') as home:
            command = ['gpg', '--no-options', '--homedir', home, '--batch', '--no-auto-key-retrieve', '--no-auto-key-import']
            fds = tuple(v[1] for v in opened.values())
            def run(args):
                return subprocess.run(command + args, pass_fds=fds, capture_output=True, timeout=120, check=True)
            run(['--import', '/proc/self/fd/' + str(opened['publicKey'][1])])
            status = run(['--status-fd', '1', '--verify', '/proc/self/fd/' + str(opened['signature'][1]), '/proc/self/fd/' + str(opened['file'][1])]).stdout.decode('ascii')
            lines = [line.split() for line in status.splitlines() if line.startswith('[GNUPG:] VALIDSIG ')]
            bad = {'BADSIG', 'ERRSIG', 'EXPSIG', 'EXPKEYSIG', 'REVKEYSIG', 'KEYEXPIRED', 'SIGEXPIRED', 'KEYREVOKED'}
            if len(lines) != 1 or any(line.split()[1] in bad for line in status.splitlines() if line.startswith('[GNUPG:] ')):
                raise ValueError('signature is not uniquely valid')
            valid = lines[0]
            version = run(['--version']).stdout.decode().splitlines()[0]
            if valid[9] not in {'8', '9', '10', '11'}:
                raise ValueError('signature requires a SHA-2 digest')
            if m['fingerprint'].upper() != valid[2] and m['fingerprint'].upper() != valid[-1]:
                raise ValueError('signer differs from trusted fingerprint')
        for path, fd, before, expected in opened.values():
            if digest(fd, before.st_size) != expected or identity(os.fstat(fd)) != identity(before) or identity(os.lstat(path)) != identity(before):
                raise ValueError('input changed during verification')
        return {
            'format': 'edinet-ts-corporate-registry-signature-v1',
            'verifiedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'trustedFingerprint': m['fingerprint'].upper(),
            'gpgVersion': version,
            'verificationStatus': status,
            'signingFingerprint': valid[2],
            'signatureCreatedAt': valid[3],
            'files': {k: {'path': v[0], 'sha256': v[3], 'bytes': v[2].st_size} for k, v in opened.items()},
            'importManifest': {'file': opened['file'][0], 'sha256': m['sha256'], 'source': m['source'], 'part': m['part']},
            'networkRequested': False,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--out', required=True, help='New directory; never overwrites retained evidence')
    args = parser.parse_args()
    receipt = verify(args.manifest)
    # Publish the import input only after the signature, hashes and retained paths agree.
    out = Path(args.out)
    out.mkdir(mode=0o700)
    try:
        (out / 'receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
        (out / 'import.json').write_text(json.dumps(receipt['importManifest'], ensure_ascii=False, indent=2) + '\n')
    except BaseException:
        for name in ['receipt.json', 'import.json']:
            (out / name).unlink(missing_ok=True)
        out.rmdir()
        raise
    print(json.dumps({'verified': True, 'receipt': str(out / 'receipt.json'), 'importManifest': str(out / 'import.json')}))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, TypeError, subprocess.SubprocessError):
        raise SystemExit('Signature verification failed; check retained files, acquisition hash and trusted fingerprint.')
