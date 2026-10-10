"""Local, immutable build generations. No remote upload or automatic deletion."""
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import uuid


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def files(root):
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise RuntimeError(f'Symlinks are not accepted in artifacts: {path}')
        if path.is_file():
            yield path


@contextlib.contextmanager
def locked(root):
    os.umask(0o077)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if root.stat().st_mode & 0o077:
        raise RuntimeError('Output root must be private (mode 0700)')
    with open(root / '.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def run(args, cwd, log):
    log.write(('\n$ ' + ' '.join(map(str, args)) + '\n').encode())
    log.flush()
    subprocess.run(args, cwd=cwd, stdout=log, stderr=subprocess.STDOUT, check=True)


def archive(repo, sha, dest):
    dest.mkdir()
    # git produces the archive; no downloaded/untrusted tar paths are extracted.
    tar = dest.parent / 'source.tar'
    subprocess.run(['git', '-C', str(repo), 'archive', '--format=tar', '-o', str(tar), sha], check=True)
    subprocess.run(['tar', '-xf', str(tar), '-C', str(dest)], check=True)
    tar.unlink()


def activate(root, name):
    if not name or Path(name).name != name or name.startswith('.'):
        raise ValueError('Expected a generation basename')
    target = root / 'generations' / name
    if target.is_symlink() or not target.is_dir():
        raise RuntimeError('Generation is missing or is a symlink')
    manifest = json.loads((target / 'manifest.json').read_text())
    actual = {str(p.relative_to(target)): digest(p) for p in files(target) if p != target / 'manifest.json'}
    if actual != manifest['sha256']:
        raise RuntimeError('Generation hash verification failed; current unchanged')
    link = root / ('.current-' + uuid.uuid4().hex)
    link.symlink_to(Path('generations') / name)
    os.replace(link, root / 'current')


def publish(root, stage, metadata):
    metadata['sha256'] = {str(p.relative_to(stage)): digest(p) for p in files(stage)}
    (stage / 'manifest.json').write_text(json.dumps(metadata, indent=2) + '\n')
    generations = root / 'generations'
    generations.mkdir(exist_ok=True)
    target = generations / stage.name.removeprefix('.staging-')
    os.rename(stage, target)
    activate(root, target.name)
    return target
