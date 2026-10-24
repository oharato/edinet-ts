/** 合成入力・一時DBだけの再現用測定。実DB/キャッシュやネットワークには触れません。 */
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir, cpus } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { BalanceSheetSqliteStore, createBalanceSheetSnapshot, screenBalanceSheetSnapshots,
    type BalanceSheetStoreInput, type BalanceSheetScreeningOptions } from "../src/index";
import { Database } from "../src/db/node-sqlite";
const sizes = process.argv.slice(2).map(Number);
if (!sizes.length) sizes.push(100, 500, 1000);
if (sizes.some(n => !Number.isSafeInteger(n) || n < 1 || n > 8000)) throw new Error("合成件数は1〜8000です");
const cohort = { instant: "2025-03-31", scope: "Consolidated" as const, accountingStandard: "J-GAAP" as const, currency: "JPY" as const, extractorVersion: "benchmark-v1", mappingVersion: "1" };
const normalize = (v: unknown) => JSON.parse(JSON.stringify(v));
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const report: unknown[] = [];
for (const size of sizes) {
    const dir = mkdtempSync(join(tmpdir(), "bs-store-benchmark-"));
    const path = join(dir, "financial.sqlite"); let store: BalanceSheetSqliteStore | undefined;
    try {
        const generationStart = performance.now(); const entries: BalanceSheetStoreInput[] = [];
        for (let i = 0; i < size; i++) {
            const code = String(1000 + i);
            const xml = `<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:jppfs_cor="http://disclosure.edinet-fsa.go.jp/taxonomy/jppfs/2024-11-01/jppfs_cor"><xbrli:context id="current"><xbrli:entity><xbrli:identifier scheme="synthetic">A</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2025-03-31</xbrli:instant></xbrli:period></xbrli:context><xbrli:unit id="money"><xbrli:measure>iso4217:JPY</xbrli:measure></xbrli:unit>${["CurrentAssets", "CurrentLiabilities", "Liabilities"].map((key, j) => `<jppfs_cor:${key} contextRef="current" unitRef="money" decimals="INF">${[100 + i, 40 + i % 7, 80 + i][j]}</jppfs_cor:${key}>`).join("")}</xbrli:xbrl>`;
            const { extractorVersion, mappingVersion, ...metadata } = cohort;
            entries.push({ snapshot: createBalanceSheetSnapshot(xml, { ...metadata, secCode: code, docID: `SYNTHETIC-${code}` }), provenance: { extractorVersion, mappingVersion, sourceSha256: createHash("sha256").update(xml).digest("hex") } });
        }
        const generationMs = performance.now() - generationStart;
        store = new BalanceSheetSqliteStore(path); const ingestionStart = performance.now();store.putMany(entries);const ingestionMs = performance.now() - ingestionStart; store.close();
        const reopenStart = performance.now();store = new BalanceSheetSqliteStore(path, { readOnly: true });const reopenMs = performance.now() - reopenStart;
        const memory = entries.map(e => e.snapshot);
        const scenarios: Record<string, BalanceSheetScreeningOptions> = {
            money: { conditions: [{ metric: "currentAssets", operator: "gte", value: 100 + Math.floor(size / 2) }], sortBy: "currentAssets", order: "desc", limit: 20 },
            ratio: { conditions: [{ metric: "currentRatio", operator: "gte", value: (100 + Math.floor(size / 2)) / 43 }], sortBy: "currentRatio", order: "desc", limit: 20 }
        };
        const measurements: Record<string, unknown> = {};
        for (const [name, options] of Object.entries(scenarios)) {
            assert.deepStrictEqual(normalize(store.search(cohort, options)), normalize(screenBalanceSheetSnapshots(memory, options)));
            const storedMs: number[] = [], memoryMs: number[] = [];
            for (let sample = 0; sample < 5; sample++) {
                let start = performance.now(); store.search(cohort, options);storedMs.push(performance.now() - start);
                start = performance.now();screenBalanceSheetSnapshots(memory, options);memoryMs.push(performance.now() - start);
            }
            measurements[name] = { storedMedianMs: median(storedMs), memoryMedianMs: median(memoryMs), storedMs, memoryMs };
        }
        store.close();store = undefined;
        const sql = new Database(path, { readOnly: true });let queryPlan: unknown;
        try { const statement = sql.prepare("EXPLAIN QUERY PLAN SELECT id FROM financial_snapshots WHERE instant=? AND scope=? AND accounting_standard=? AND currency=? AND extractor_version=? AND mapping_version=?");
            try { queryPlan = statement.all(cohort.instant, cohort.scope, cohort.accountingStandard, cohort.currency, cohort.extractorVersion, cohort.mappingVersion); } finally { statement.close(); }
        } finally { sql.close(); }
        report.push({ size, generationMs, ingestionMs, reopenMs, databaseBytes: statSync(path).size, rssAfterBytes: process.memoryUsage().rss, measurements, queryPlan });
    } finally { store?.close();rmSync(dir, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ environment: { node: process.version, sqlite: process.versions.sqlite, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model }, methodology: "one warmup, five samples per scenario, median; one process, memory inputs retained; query includes integrity checks and returned-page validation; temporary files deleted", report }, null, 2));
