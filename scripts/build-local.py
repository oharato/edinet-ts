#!/usr/bin/env python3
"""Build a fixed Git commit into a private local generation; never publish remotely."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import uuid
from artifact_store import activate, archive, digest, locked, publish, run

PIN = 'e673e8aa547be011056cfdb6bbe84d4d58e87e36'
EXPECTED = '6df0b746e9047ac51a2eaee526015dc2d1d1a04ce292a295048f257951b35cc1'
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--output', required=True, type=Path)
p.add_argument('--rollback', help='Verify and activate an existing generation basename')
p.add_argument('--dry-run', action='store_true')
a = p.parse_args()
repo = Path(__file__).resolve().parents[1]
root = a.output.resolve()
if root == repo or repo in root.parents or root in repo.parents:
    p.error('Output must be outside the source checkout')
if a.dry_run:
    print(json.dumps({'sourceCommit': PIN, 'output': str(root), 'network': 'offline npm cache only', 'fetchData': False, 'publish': False}))
    raise SystemExit(0)
if not a.rollback:
    # npm packの版差も固定hashへ影響するため、実行系も固定します。
    actual_node = subprocess.check_output(['node', '--version'], text=True).strip()
    actual_npm = subprocess.check_output(['npm', '--version'], text=True).strip()
    if actual_node != 'v26.12.1' or actual_npm != '12.2.1':
        raise RuntimeError('Use the pinned Node v26.12.1 and npm 12.2.1 toolchain')
with locked(root):
    if a.rollback:
        activate(root, a.rollback)
        raise SystemExit(0)
    if shutil.disk_usage(root).free < 2 * 1024**3:
        raise RuntimeError('At least 2 GiB of free space required')
    name = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
    stage = root / ('.staging-' + name)
    stage.mkdir()
    source = stage / 'source'
    archive(repo, PIN, source)
    lock_hash = digest(source / 'package-lock.json')
    # Every failure leaves current unchanged and retains this staging log.
    with open(stage / 'build.log', 'wb') as log:
        run(['npm', 'ci', '--offline', '--no-audit', '--no-fund'], source, log)
        run(['npm', 'run', 'build'], source, log)
        run(['npm', 'test', '--', '--maxWorkers=1', '--testTimeout=60000'], source, log)
        # Normalize package file modes to the reviewed archive. The containing
        # output/staging directories remain 0700; no user checkout is modified.
        for path in [source / 'LICENSE', source / 'README.md', source / 'package.json',
                     *[p for p in (source / 'dist').rglob('*') if p.is_file()]]:
            path.chmod(0o644)
        previous_umask = os.umask(0o022)
        try:
            run(['npm', 'pack', '--ignore-scripts', '--pack-destination', str(stage)], source, log)
        finally:
            os.umask(previous_umask)

    packages = list(stage.glob('*.tgz'))
    if len(packages) != 1 or digest(packages[0]) != EXPECTED:
        raise RuntimeError('Fixed-SHA package hash mismatch; current unchanged')
    artifact = stage / ('edinet-ts-' + PIN + '.tgz')
    packages[0].rename(artifact)
    metadata = {'sourceRepository': 'https://github.com/oharato/edinet-ts', 'sourceCommit': PIN,
                'packageLockSha256': lock_hash, 'artifactSha256': EXPECTED,
                'builderSha256': digest(Path(__file__)), 'storeSha256': digest(repo / 'scripts/artifact_store.py'),
                'node': subprocess.check_output(['node', '--version'], text=True).strip(),
                'npm': subprocess.check_output(['npm', '--version'], text=True).strip(),
                'createdAt': datetime.now(timezone.utc).isoformat()}
    # Delete only this run's disposable source/dependencies; retained generations are never pruned.
    shutil.rmtree(source)
    target = publish(root, stage, metadata)
    print(target)
