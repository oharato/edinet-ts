"""Isolated archive/storage validation. uv run --with duckdb==2.0.0 --with pyarrow==26.0.0 python scripts/validate-duckdb-acquisition.py"""
import argparse
import gzip
import hashlib
import json
import os
import pickle
import platform
import re
import signal
import sqlite3
import statistics
import subprocess
import sys
import time
from pathlib import Path
import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

BASE = Path('data/roadmap/daily-financial-compressed-v2/2026-10-30/candidate')
TABLES = ('archive_format', 'archive_observations', 'archive_sources', 'archive_contents', 'archive_extractions', 'source_job_format', 'source_job_plans', 'source_job_tasks', 'source_job_attempts')
WRITE_TABLES = ('archive_contents', 'archive_sources', 'source_job_tasks', 'source_job_attempts')
TYPES = {'TEXT': pa.string(), 'INTEGER': pa.int64(), 'REAL': pa.float64(), 'BLOB': pa.binary()}

def sha_file(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def ms(start):
    return (time.perf_counter() - start) * 1000

def open_db(engine, path):
    if engine == 'sqlite':
        c = sqlite3.connect(path)
        c.execute('PRAGMA synchronous=FULL')
        return c
    c = duckdb.connect(str(path))
    c.execute("SET threads=1; SET memory_limit='512MB'")
    return c

def create_schema(c, engine, schema):
    for ddl in schema['tables'].values():
        if engine == 'duckdb':
            ddl = re.sub(r'\bTEXT\b', 'VARCHAR', ddl)
            ddl = re.sub(r'\bINTEGER\b', 'BIGINT', ddl)
        c.execute(ddl)
    for ddl in schema['indexes']:
        c.execute(ddl)
    if engine == 'sqlite':
        c.commit()

def arrow_schema(schema, table):
    return pa.schema([(col['name'], TYPES[col['type']]) for col in schema['columns'][table]])

def insert_items(c, engine, items, schema, bulk=False):
    for table in WRITE_TABLES:
        rows = [item[table] for item in items]
        placeholders = ','.join('?' for _ in rows[0])
        sql = f'INSERT INTO {table} VALUES ({placeholders}) ON CONFLICT DO NOTHING'
        if bulk and engine == 'duckdb':
            cols = [col['name'] for col in schema['columns'][table]]
            batch = pa.Table.from_pylist([dict(zip(cols, row)) for row in rows], schema=arrow_schema(schema, table))
            c.register('incoming', batch)
            c.execute(f'INSERT INTO {table} SELECT * FROM incoming ON CONFLICT DO NOTHING')
            c.unregister('incoming')
        elif bulk:
            c.executemany(sql, rows)
        else:
            for row in rows:
                c.execute(sql, row)

def transaction(c, engine, items, schema, bulk=False):
    c.execute('BEGIN IMMEDIATE' if engine == 'sqlite' else 'BEGIN')
    try:
        insert_items(c, engine, items, schema, bulk)
        c.execute('COMMIT')
    except BaseException:
        c.execute('ROLLBACK')
        raise

def assert_items(c, items):
    for table in WRITE_TABLES:
        expected = {tuple(item[table]) for item in items}
        actual = {tuple(row) for row in c.execute(f'SELECT * FROM {table}').fetchall()}
        assert actual == expected, (table, len(actual), len(expected))

def worker(args):
    schema, items = pickle.loads(Path(args.payload).read_bytes())
    c = open_db(args.engine, Path(args.db))
    if args.engine == 'sqlite':
        c.execute('PRAGMA cache_size=16')
    c.execute('BEGIN IMMEDIATE' if args.engine == 'sqlite' else 'BEGIN')
    insert_items(c, args.engine, items[8:12], schema)
    if args.phase == 'after':
        c.execute('COMMIT')
    ready = Path(args.ready)
    with ready.open('x') as f:
        f.write('ready')
        f.flush()
        os.fsync(f.fileno())
    while True:
        time.sleep(0.1)

def main(args):
    out = Path(args.output_directory)
    assert not out.exists() or args.resume_built, 'Use a fresh output directory'
    out.mkdir(parents=True, exist_ok=args.resume_built)
    sources = [BASE / 'archive.sqlite', BASE / 'source-job.sqlite']
    before = {}
    for path in sources:
        assert not any(Path(str(path) + suffix).exists() for suffix in ('-wal', '-shm', '-journal')), 'Source must be stopped'
        before[str(path)] = sha_file(path)
    connections = [sqlite3.connect(p.resolve().as_uri() + '?mode=ro', uri=True) for p in sources]
    schema = {'tables': {}, 'indexes': [], 'columns': {}}
    owners = {}
    for c in connections:
        for name, ddl in c.execute("SELECT name,sql FROM sqlite_master WHERE type='table'"):
            assert name in TABLES
            schema['tables'][name] = ddl
            owners[name] = c
            schema['columns'][name] = [{'name': row[1], 'type': row[2], 'pk': row[5]} for row in c.execute(f'PRAGMA table_info({name})')]
        schema['indexes'] += [row[0] for row in c.execute("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")]
    assert set(schema['tables']) == set(TABLES)
    (out / 'schema.json').write_text(json.dumps(schema, indent=2))
    if args.resume_built:
        sqlpath, duckpath = out / 'archive.sqlite', out / 'archive.duckdb'
        counts = {table: owners[table].execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] for table in TABLES}
        sqlite_build_ms = checkpoint_ms = None
        parquet_ms, imports = {}, {}
    else:
        # A unified SQLite baseline has the same tables, primary keys, and secondary indexes.
        sqlpath = out / 'archive.sqlite'
        start = time.perf_counter()
        baseline = sqlite3.connect(sqlpath)
        connections[0].backup(baseline)
        for name in TABLES:
            if name.startswith('source_job_'):
                baseline.execute(schema['tables'][name])
                rows = owners[name].execute(f'SELECT * FROM {name}').fetchall()
                baseline.executemany(f'INSERT INTO {name} VALUES ({",".join("?" for _ in schema["columns"][name])})', rows)
        for ddl in schema['indexes']:
            if 'source_job_' in ddl:
                baseline.execute(ddl)
        baseline.commit()
        baseline.close()
        sqlite_build_ms = ms(start)
        parquet_ms, counts = {}, {}
        for table in TABLES:
            start = time.perf_counter()
            cursor = owners[table].execute(f'SELECT * FROM {table}')
            cols = [col['name'] for col in schema['columns'][table]]
            count = 0
            with pq.ParquetWriter(out / (table + '.parquet'), arrow_schema(schema, table), compression='NONE') as writer:
                while rows := cursor.fetchmany(8 if table == 'archive_contents' else 1000):
                    batch = pa.Table.from_pylist([dict(zip(cols, row)) for row in rows], schema=arrow_schema(schema, table))
                    writer.write_table(batch)
                    count += len(rows)
            counts[table] = count
            parquet_ms[table] = ms(start)
            print('exported', table, count, flush=True)
        duckpath = out / 'archive.duckdb'
        duck = open_db('duckdb', duckpath)
        create_schema(duck, 'duckdb', schema)
        imports = {}
        for table in TABLES:
            start = time.perf_counter()
            duck.execute(f'INSERT INTO {table} SELECT * FROM read_parquet(?)', [str(out / (table + '.parquet'))])
            imports[table] = ms(start)
            print('imported', table, round(imports[table]), 'ms', flush=True)
        start = time.perf_counter()
        duck.execute('CHECKPOINT')
        checkpoint_ms = ms(start)
        duck.close()
    sql = sqlite3.connect(sqlpath.resolve().as_uri() + '?mode=ro', uri=True)
    duck = duckdb.connect(str(duckpath), read_only=True)
    duck.execute("SET threads=1; SET memory_limit='512MB'")
    verified, raw_bytes = {}, 0
    for table in TABLES:
        if table == 'archive_contents':
            # Audit BLOBs once without sorting; verify keys against both SQLite copies.
            duck.execute("SET memory_limit='1GB'")
            right = duck.cursor().execute('SELECT sha256,xml FROM archive_contents')
            seen = set()
            while rows := right.fetchmany(8):
                for content_hash, compressed in rows:
                    assert content_hash not in seen
                    seen.add(content_hash)
                    for baseline in (sql, owners[table]):
                        assert baseline.execute('SELECT xml FROM archive_contents WHERE sha256=?', (content_hash,)).fetchone() == (compressed,)
                    raw = gzip.decompress(compressed)
                    assert hashlib.sha256(raw).hexdigest() == content_hash
                    raw_bytes += len(raw)
                if len(seen) % 1000 == 0:
                    print('XML hashes', len(seen), flush=True)
            right.close()
            duck.execute("SET memory_limit='512MB'")
            assert len(seen) == counts[table]
            verified[table] = len(seen)
            print('verified', table, len(seen), flush=True)
            continue
        order = ','.join(col['name'] for col in sorted(schema['columns'][table], key=lambda x: x['pk']) if col['pk']) or ','.join(col['name'] for col in schema['columns'][table])
        left = sql.execute(f'SELECT * FROM {table} ORDER BY {order}')
        right = duck.cursor().execute(f'SELECT * FROM {table} ORDER BY {order}')
        original_rows = owners[table].execute(f'SELECT * FROM {table} ORDER BY {order}')
        count = 0
        while rows := left.fetchmany(8 if table == 'archive_contents' else 1000):
            assert rows == original_rows.fetchmany(len(rows)), ('SQLite baseline differs from original', table)
            copied = right.fetchmany(len(rows))
            assert rows == copied, (table, count)
            count += len(rows)
        assert not original_rows.fetchone()
        if right is not None:
            assert not right.fetchone()
            right.close()
        assert duck.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == count
        assert count == counts[table]
        verified[table] = count
        print('verified', table, count, flush=True)
    duck.close()
    # Real acquisition records with attempt history, loaded before the write timers start.
    jobs = connections[1]
    attempts = jobs.execute('SELECT * FROM source_job_attempts ORDER BY doc_id,number LIMIT 100').fetchall()
    items = []
    for attempt in attempts:
        task = jobs.execute('SELECT * FROM source_job_tasks WHERE job=? AND doc_id=?', attempt[:2]).fetchone()
        source = connections[0].execute('SELECT * FROM archive_sources WHERE doc_id=? ORDER BY available_ms DESC,id DESC LIMIT 1', (attempt[1],)).fetchone()
        content_hash = json.loads(source[3])['sourceSha256']
        content = connections[0].execute('SELECT * FROM archive_contents WHERE sha256=?', (content_hash,)).fetchone()
        items.append(dict(zip(WRITE_TABLES, [content, source, task, attempt])))
    assert len(items) == 100 and len({item['archive_sources'][0] for item in items}) == 100
    payload = out / 'payload.pickle'
    payload.write_bytes(pickle.dumps((schema, items)))
    sql.close()
    timings = {}
    for repetition in range(3):
        for engine in (('sqlite', 'duckdb') if repetition % 2 == 0 else ('duckdb', 'sqlite')):
            for batch_size in (1, 100):
                path = out / f'write-{engine}-{batch_size}-{repetition}.db'
                c = open_db(engine, path)
                create_schema(c, engine, schema)
                samples = []
                start = time.perf_counter()
                for offset in range(0, len(items), batch_size):
                    now = time.perf_counter()
                    transaction(c, engine, items[offset:offset + batch_size], schema, bulk=batch_size > 1)
                    samples.append(ms(now))
                total_ms = ms(start)
                assert_items(c, items)
                if engine == 'duckdb':
                    c.execute('CHECKPOINT')
                c.close()
                entry = {'totalMs': total_ms, 'transactionMedianMs': statistics.median(samples), 'transactionP95Ms': sorted(samples)[int((len(samples)-1)*.95)], 'samplesMs': samples, 'bytes': path.stat().st_size}
                timings.setdefault(f'{engine}/batch={batch_size}', []).append(entry)
                print('write', engine, batch_size, repetition, round(total_ms), 'ms', flush=True)
    recovery = []
    for engine in ('sqlite', 'duckdb'):
        for phase in ('before', 'after'):
            path = out / f'crash-{engine}-{phase}.db'
            c = open_db(engine, path)
            create_schema(c, engine, schema)
            transaction(c, engine, items[:8], schema)
            c.close()
            ready = out / f'{engine}-{phase}.ready'
            child = subprocess.Popen([sys.executable, __file__, '--worker', '--engine', engine, '--phase', phase, '--db', str(path), '--ready', str(ready), '--payload', str(payload)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            deadline = time.monotonic() + 60
            while not ready.exists():
                if child.poll() is not None:
                    raise RuntimeError(child.communicate())
                if time.monotonic() > deadline:
                    child.kill()
                    child.communicate()
                    raise RuntimeError('Crash worker timeout')
                time.sleep(.02)
            sidecars = {suffix: Path(str(path)+suffix).stat().st_size for suffix in ('.wal', '-journal', '-wal') if Path(str(path)+suffix).exists()}
            child.kill()
            child.communicate(timeout=10)
            assert child.returncode == -signal.SIGKILL
            start = time.perf_counter()
            c = open_db(engine, path)
            assert_items(c, items[:8 if phase == 'before' else 12])
            reopen_ms = ms(start)
            # Replay includes already committed items. Must not duplicate or lose records.
            transaction(c, engine, items[:32], schema, bulk=True)
            transaction(c, engine, items[:32], schema, bulk=True)
            assert_items(c, items[:32])
            c.close()
            c = open_db(engine, path)
            assert_items(c, items[:32])
            c.close()
            recovery.append({'engine': engine, 'killed': 'before-commit' if phase == 'before' else 'after-commit', 'sidecarsAtKill': sidecars, 'reopenAndVerifyMs': reopen_ms, 'committedRecordsPreserved': 8 if phase == 'before' else 12, 'resumedRecords': 32, 'exactContentAndHistory': True, 'idempotentReplay': True})
            print('recovery', engine, phase, 'OK', flush=True)
    for c in connections:
        c.close()
    after = {str(p): sha_file(p) for p in sources}
    assert before == after
    report = {'duckdb': duckdb.__version__, 'sqlite': sqlite3.sqlite_version, 'pyarrow': pa.__version__, 'platform': platform.platform(), 'sourceHashes': before, 'sourcesUnchanged': True, 'counts': counts, 'allColumnsExactlyEqual': verified, 'allRawXmlHashesVerified': counts['archive_contents'], 'rawXmlBytes': raw_bytes, 'bytes': {'originalArchive': sources[0].stat().st_size, 'originalSourceJob': sources[1].stat().st_size, 'unifiedSqlite': sqlpath.stat().st_size, 'duckdb': duckpath.stat().st_size}, 'buildMs': {'sqliteBackupAndJobCopy': sqlite_build_ms, 'sqliteToParquet': parquet_ms, 'parquetToDuckdb': imports, 'duckdbCheckpoint': checkpoint_ms}, 'writePayload': {'records': len(items), 'compressedXmlBytes': sum(len(item['archive_contents'][1]) for item in items), 'tablesPerTransaction': list(WRITE_TABLES)}, 'writes': timings, 'recovery': recovery, 'maxRssKiB': __import__('resource').getrusage(__import__('resource').RUSAGE_SELF).ru_maxrss}
    (out / 'results.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({'bytes': report['bytes'], 'rawXmlBytes': raw_bytes, 'recovery': recovery}, indent=2), flush=True)

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output-directory', default='data/benchmarks/duckdb-acquisition-20261031')
parser.add_argument('--worker', action='store_true')
parser.add_argument('--resume-built', action='store_true', help='Verify existing full copies against originals; no rebuild')
for field in ('engine', 'phase', 'db', 'ready', 'payload'):
    parser.add_argument('--'+field)
args = parser.parse_args()
if args.worker:
    worker(args)
else:
    main(args)
