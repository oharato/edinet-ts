"""Compare fixed financial SQL projections; run with duckdb==2.0.0 via uv."""
import argparse
import hashlib
import json
import math
import os
import platform
import sqlite3
import statistics
import time
from pathlib import Path
import duckdb

SOURCE = Path('data/roadmap/daily-financial-compressed-v2/2026-10-30/candidate/reconstructed/index.sqlite')
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output-directory', type=Path, default=Path('data/benchmarks/duckdb-2-production'))
args = parser.parse_args()
OUT = args.output_directory
OUT.mkdir(parents=True, exist_ok=True)

def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def elapsed(start):
    return (time.perf_counter() - start) * 1000

def same(a, b):
    assert len(a) == len(b), (len(a), len(b))
    for x, y in zip(a, b):
        assert len(x) == len(y)
        for v, w in zip(x, y):
            if isinstance(v, (int, float)) and isinstance(w, (int, float)):
                assert math.isclose(v, w, rel_tol=1e-12, abs_tol=1e-6), (v, w)
            else:
                assert v == w, (v, w)

before = digest(SOURCE)
src = sqlite3.connect(SOURCE.resolve().as_uri() + '?mode=ro', uri=True)
assert not any(Path(str(SOURCE) + s).exists() for s in ('-journal', '-wal', '-shm')), 'Source must be stopped'
generation = src.execute('SELECT id FROM financial_generations ORDER BY length(body) DESC LIMIT 1').fetchone()[0]
# Refuse to overwrite previous benchmark evidence.
sqlpath, duckpath = OUT / 'projection.sqlite', OUT / 'projection.duckdb'
assert not sqlpath.exists() and not duckpath.exists(), 'Use a fresh output directory'
start = time.perf_counter()
sql = sqlite3.connect(sqlpath)
counts = {}
for table in ('financial_rows', 'financial_values'):
    ddl = src.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()[0]
    sql.execute(ddl)
    cursor = src.execute(f'SELECT * FROM {table} WHERE generation=?', (generation,))
    count = 0
    while batch := cursor.fetchmany(2000):
        sql.executemany(f'INSERT INTO {table} VALUES ({",".join("?" for _ in batch[0])})', batch)
        count += len(batch)
    counts[table] = count
    for (ddl,) in src.execute("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL", (table,)):
        sql.execute(ddl)
sql.commit()
sql.close()
sqlite_export_ms = elapsed(start)
src.close()
start = time.perf_counter()
sql = sqlite3.connect(sqlpath.resolve().as_uri() + '?mode=ro', uri=True)
sqlite_open_ms = elapsed(start)
start = time.perf_counter()
duck = duckdb.connect(str(duckpath))
duck.execute('SET threads=1')
for table in counts:
    info = sql.execute(f'PRAGMA table_info({table})').fetchall()
    mapping = {'TEXT': 'VARCHAR', 'INTEGER': 'BIGINT', 'REAL': 'DOUBLE'}
    duck.execute(f'CREATE TABLE {table} (' + ','.join(f'"{col[1]}" {mapping[col[2]]}' for col in info) + ')')
    cursor = sql.execute(f'SELECT * FROM {table}')
    # COPY CSV avoids timing one Python call per value as engine import cost.
    import csv
    csvpath = OUT / (table + '.csv')
    with csvpath.open('w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow([col[1] for col in info])
        while batch := cursor.fetchmany(2000):
            writer.writerows(tuple('__EDINET_NULL__' if v is None else v for v in row) for row in batch)
    duck.execute(f"COPY {table} FROM '{csvpath}' (HEADER, NULLSTR '__EDINET_NULL__')")
    csvpath.unlink()
duck.execute('CHECKPOINT')
duck.close()
duckdb_import_ms = elapsed(start)
start = time.perf_counter()
duck = duckdb.connect(str(duckpath), read_only=True)
duckdb_open_ms = elapsed(start)
for table, count in counts.items():
    left = sql.execute(f'SELECT * FROM {table} ORDER BY generation,row_id' + (',metric_id' if table == 'financial_values' else '')).fetchall()
    right = duck.execute(f'SELECT * FROM {table} ORDER BY generation,row_id' + (',metric_id' if table == 'financial_values' else '')).fetchall()
    assert left == right, f"Imported columns differ: {table}"
    assert len(right) == count
    del left, right

queries = {
    'ranking': "SELECT r.edinet_code,r.doc_id,v.numeric_value FROM financial_rows r JOIN financial_values v ON r.generation=v.generation AND r.row_id=v.row_id WHERE v.metric_id='totalLiabilities' AND v.available=1 ORDER BY v.numeric_value DESC,r.row_id LIMIT 100",
    'multi_metric': "SELECT r.row_id,r.edinet_code FROM financial_rows r WHERE r.row_id IN (SELECT row_id FROM financial_values v WHERE v.generation='{GENERATION}' AND v.metric_id='currentAssets' AND v.available=1 AND v.numeric_value>10000000000) AND r.row_id IN (SELECT row_id FROM financial_values v WHERE v.generation='{GENERATION}' AND v.metric_id='currentLiabilities' AND v.available=1 AND v.numeric_value>1000000000) ORDER BY r.row_id",
    'quality': 'SELECT r.standard,r.period_type,v.metric_id,v.status,v.reason,COUNT(*) FROM financial_rows r JOIN financial_values v ON r.generation=v.generation AND r.row_id=v.row_id GROUP BY r.standard,r.period_type,v.metric_id,v.status,v.reason ORDER BY 1,2,3,4,5',
    'period_aggregate': 'SELECT r.period_end,v.metric_id,COUNT(*),SUM(v.numeric_value),AVG(v.numeric_value) FROM financial_rows r JOIN financial_values v ON r.generation=v.generation AND r.row_id=v.row_id WHERE v.available=1 GROUP BY r.period_end,v.metric_id ORDER BY 1,2',
    'cross_metric': "SELECT r.standard,COUNT(*),SUM(a.numeric_value-b.numeric_value) FROM financial_rows r JOIN financial_values a ON a.generation=r.generation AND a.row_id=r.row_id JOIN financial_values b ON b.generation=r.generation AND b.row_id=r.row_id WHERE a.metric_id='currentAssets' AND b.metric_id='currentLiabilities' AND a.available=1 AND b.available=1 GROUP BY r.standard ORDER BY 1",
}
# Match production's fixed-generation predicate so SQLite can use its index prefix.
quoted_generation = generation.replace("'", "''")
for name, query in list(queries.items()):
    condition = f"r.generation='{quoted_generation}'"
    query = query.replace('{GENERATION}', quoted_generation)
    queries[name] = query.replace(' WHERE ', f' WHERE {condition} AND ', 1) if ' WHERE ' in query else query.replace(' GROUP BY ', f' WHERE {condition} GROUP BY ', 1)
results = {}
for threads in (1, min(4, os.cpu_count() or 1)):
    duck.execute(f'SET threads={threads}')
    for name, query in queries.items():
        expected = sql.execute(query).fetchall()
        same(expected, duck.execute(query).fetchall())
        samples = {'sqlite': [], 'duckdb': []}
        for repetition in range(7):
            engines = [('sqlite', sql), ('duckdb', duck)]
            if repetition % 2:
                engines.reverse()
            for engine, connection in engines:
                start = time.perf_counter()
                rows = connection.execute(query).fetchall()
                samples[engine].append(elapsed(start))
                same(expected, rows)
        medians = {k: statistics.median(v) for k, v in samples.items()}
        results[f'{name}/threads={threads}'] = {'rows': len(expected), 'medianMs': medians, 'sqliteOverDuckdb': medians['sqlite']/medians['duckdb'], 'samplesMs': samples}
        print(name, threads, medians, flush=True)
sql.close()
duck.close()
assert digest(SOURCE) == before, 'Source changed'
report = {'duckdb': duckdb.__version__, 'sqlite': sqlite3.sqlite_version, 'platform': platform.platform(), 'cpu': platform.processor(), 'source': str(SOURCE), 'sourceSha256': before, 'sourceUnchanged': True, 'allColumnsMatched': True, 'allQueryResultsMatched': True, 'generation': generation, 'counts': counts, 'bytes': {'originalMultiGeneration': SOURCE.stat().st_size, 'sqliteSingleGeneration': sqlpath.stat().st_size, 'duckdbSingleGeneration': duckpath.stat().st_size}, 'sqliteExportMs': sqlite_export_ms, 'duckdbImportViaCsvMs': duckdb_import_ms, 'openMs': {'sqlite': sqlite_open_ms, 'duckdb': duckdb_open_ms}, 'queries': queries, 'results': results}
(OUT/'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
print(json.dumps({k:v for k,v in report.items() if k not in ('queries','results')}, indent=2))
