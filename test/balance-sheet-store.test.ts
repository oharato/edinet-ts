import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Database } from "../src/db/node-sqlite";
import { BalanceSheetSqliteStore, createBalanceSheetSnapshot, screenBalanceSheetSnapshots,
    type BalanceSheetStoreInput, type BalanceSheetStoreCohort, type BalanceSheetScreeningOptions } from "../src/index";
import { instance, fact, standalone } from "./fixtures/metric-boundaries";
const cohort: BalanceSheetStoreCohort = { instant: "2025-03-31", scope: "Consolidated", accountingStandard: "J-GAAP", currency: "JPY", extractorVersion: "test-parser-v1", mappingVersion: "1" };
const keys = ["jppfs_cor:CurrentAssets", "jppfs_cor:CurrentLiabilities", "jppfs_cor:Liabilities"];
function input(code = "1001", values = ["120", "40", "80"], instant = cohort.instant, scope: "Consolidated" | "NonConsolidated" = "Consolidated", extra = ""): BalanceSheetStoreInput {
    const context = `<xbrli:context id="current"><xbrli:entity><xbrli:identifier scheme="synthetic">A</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>${instant}</xbrli:instant></xbrli:period>${scope === "NonConsolidated" ? `<xbrli:scenario>${standalone}</xbrli:scenario>` : ""}</xbrli:context>`;
    const xml = instance(values.map((value, i) => value === "absent" ? "" : value === "nil" ? fact("", 'xsi:nil="true"', keys[i]) : fact(value, "", keys[i])).join("") + extra, context);
    return { snapshot: createBalanceSheetSnapshot(xml, { secCode: code, docID: `SYNTHETIC-${code}-${instant}`, instant, scope, accountingStandard: "J-GAAP", currency: "JPY" }),
        provenance: { extractorVersion: cohort.extractorVersion, mappingVersion: "1", sourceSha256: createHash("sha256").update(xml).digest("hex"), sourceCommit: "a".repeat(40) } };
}
const json = (v: unknown) => JSON.parse(JSON.stringify(v));
function withDb(run: (path: string) => void) { const dir = mkdtempSync(join(tmpdir(), "bs-store-")); try { run(join(dir, "financial.sqlite")); } finally { rmSync(dir, { recursive: true, force: true }); } }
function exec(path: string, sql: string) { const db = new Database(path); try { db.exec(sql); } finally { db.close(); } }
const cases: BalanceSheetScreeningOptions[] = [{}, { limit: 0 }, { offset: 100 },
    ...["currentAssets", "currentLiabilities", "totalLiabilities", "currentRatio"].flatMap(metric => ["asc", "desc"].flatMap(order => [undefined, 0, 1].map(limit => ({ sortBy: metric, order, limit, offset: limit === 1 ? 1 : 0 } as BalanceSheetScreeningOptions)))),
    ...["currentAssets", "currentLiabilities", "totalLiabilities", "currentRatio"].flatMap(metric => ["gte", "lte", "gt", "lt", "eq"].flatMap(operator => [0, 2, 3].map(value => ({ conditions: [{ metric, operator, value }] } as BalanceSheetScreeningOptions)))),
    { conditions: [{ metric: "currentRatio", operator: "gte", value: 2 }, { metric: "currentAssets", operator: "gt", value: 3 }], sortBy: "currentRatio", order: "asc", offset: 1, limit: 2 }];

describe("財務SQLiteの再open・メモリ検索との同等性", () => {
    const rows = [input(), input("1002", ["1", "3", "4"]), input("1003", ["0.3", "0.1", "absent"]),
        input("1004", ["nil", "2", "5"]), input("1005", ["1", "0", "3"]), input("1006", ["-1", "2", "5"]),
        input("1007", ["9007199254740993", "1", "2"]), input("1008", ["2", "absent", "3"]),
        input("1009", ["4", "2", "7"], cohort.instant, "Consolidated", fact("4", "", keys[0]))];
    it.each(cases)("再open後も条件%jが一致する", options => withDb(path => {
        let db = new BalanceSheetSqliteStore(path); db.putMany(rows); db.close(); db = new BalanceSheetSqliteStore(path, { readOnly: true });
        try { expect(json(db.search(cohort, options))).toEqual(json(screenBalanceSheetSnapshots(rows.map(r => r.snapshot), options))); } finally { db.close(); }
    }));
    it("原値・出典・精度・版・hashと-0を失わず、入力の古い計算値は保存しない", () => withDb(path => {
        const row = input("1001", ["-0", "40.00", "80"]); (row.snapshot as any).derivedMetrics = { currentRatio: { value: 999 } };
        let db = new BalanceSheetSqliteStore(path); const saved = db.putMany([row]); db.close(); db = new BalanceSheetSqliteStore(path);
        try {
            const got = db.get(saved.ids[0])!; expect(got.provenance).toEqual(row.provenance);
            expect(got.snapshot).not.toHaveProperty("derivedMetrics"); expect(got.snapshot.selections.currentLiabilities.raw).toBe("40.00");
            expect(Object.is(got.snapshot.selections.currentAssets.safeNumber, -0)).toBe(true);
            expect(json(got.snapshot.selections)).toEqual(json(row.snapshot.selections));
        } finally { db.close(); }
    }));
    it("1/3の表示近似と0.3/0.1の正確な境界を同じように判定する", () => withDb(path => {
        const data = [input("1001", ["1", "3", "4"]), input("1002", ["0.3", "0.1", "4"])];const db = new BalanceSheetSqliteStore(path);
        try {
            db.putMany(data);
            for (const value of [1 / 3, 3, 1e-7, Number.MIN_VALUE]) for (const operator of ["eq", "lt", "gt"] as const) {
                const options: BalanceSheetScreeningOptions = { conditions: [{ metric: "currentRatio", operator, value }] };
                expect(json(db.search(cohort, options))).toEqual(json(screenBalanceSheetSnapshots(data.map(r => r.snapshot), options)));
            }
        } finally { db.close(); }
    }));
    it("交差積が64bitを超え、表示値が同じでも順序とページを保持する", () => withDb(path => {
        const data = [input("1002", ["9007199254740991", "9007199254740990", "1"]), input("1001", ["9007199254740990", "9007199254740989", "1"])];
        const db = new BalanceSheetSqliteStore(path); try { db.putMany(data);
            const result = db.search(cohort, { sortBy: "currentRatio", order: "asc", limit: 1 });
            expect(result.total).toBe(2); expect(result.rows[0].secCode).toBe("10020");
            expect(json(result)).toEqual(json(screenBalanceSheetSnapshots(data.map(r => r.snapshot), { sortBy: "currentRatio", order: "asc", limit: 1 })));
        } finally { db.close(); }
    }));
    it("分子・分母が極小でもSQL JSONの値と厳密な分数を維持する", () => withDb(path => {
        const tiny = `0.${"0".repeat(323)}5`; const data = [input("1001", [tiny, "1", "1"]), input("1002", [tiny, "9007199254740991", "1"])];
        const db = new BalanceSheetSqliteStore(path); try { db.putMany(data);
            const options: BalanceSheetScreeningOptions = { conditions: [{ metric: "currentRatio", operator: "gte", value: Number.MIN_VALUE }], sortBy: "currentRatio" };
            expect(json(db.search(cohort, options))).toEqual(json(screenBalanceSheetSnapshots(data.map(r => r.snapshot), options)));
        } finally { db.close(); }
    }));
});

describe("保存の重複・原子性・混在・DB保護", () => {
    it("同一内容を繰り返しても増えず、返却値の変更がDBへ戻らない", () => withDb(path => {
        const row = input(); const db = new BalanceSheetSqliteStore(path);try {
            const first = db.putMany([row]); expect(first).toMatchObject({ inserted: 1, unchanged: 0 });
            expect(db.putMany([structuredClone(row), row])).toMatchObject({ inserted: 0, unchanged: 2, ids: [first.ids[0], first.ids[0]] });
            const got = db.get(first.ids[0])!; got.snapshot.selections.currentAssets.evidence[0].reason = "nil";
            expect(db.get(first.ids[0])!.snapshot.selections.currentAssets.evidence[0].reason).toBe("selected");
        } finally { db.close(); }
    }));
    it("同じ原本hash・抽出版の内容衝突で直前の追加も戻す", () => withDb(path => {
        const a = input(), b = input("1002"), conflict = input("1001", ["999", "40", "80"]);conflict.provenance = a.provenance;
        const db = new BalanceSheetSqliteStore(path);try { db.putMany([a]); expect(() => db.putMany([b, conflict])).toThrow(/異なる内容/);
            expect(db.search(cohort).total).toBe(1); expect(db.putMany([b]).inserted).toBe(1);
        } finally { db.close(); }
    }));
    it("後半の不正入力・SQL失敗のどちらでもバッチを残さない", () => withDb(path => {
        const db = new BalanceSheetSqliteStore(path);try {
            const bad = input("1002");bad.provenance.sourceSha256 = "invalid";
            expect(() => db.putMany([input(), bad])).toThrow();expect(db.search(cohort).total).toBe(0);
            exec(path, "CREATE TRIGGER fail_insert BEFORE INSERT ON financial_snapshots WHEN NEW.sec_code='10020' BEGIN SELECT RAISE(ABORT,'fixture'); END;");
            expect(() => db.putMany([input(), input("1002")])).toThrow(/fixture/);expect(db.search(cohort).total).toBe(0);
            exec(path, "DROP TRIGGER fail_insert");expect(db.putMany([input(), input("1002")]).inserted).toBe(2);
        } finally { db.close(); }
    }));
    it("busyでBEGINが失敗しても解放後に再開できる", () => withDb(path => {
        const db = new BalanceSheetSqliteStore(path, { timeout: 5 });const lock = new Database(path);lock.exec("BEGIN IMMEDIATE");
        try { expect(() => db.putMany([input()])).toThrow();lock.exec("ROLLBACK");expect(db.putMany([input()]).inserted).toBe(1); }
        finally { lock.close();db.close(); }
    }));
    it("別用途の既存DB・未対応schemaを変更しない", () => withDb(path => {
        exec(path, "CREATE TABLE documents (id TEXT); INSERT INTO documents VALUES('keep');");const before = readFileSync(path);
        expect(() => new BalanceSheetSqliteStore(path)).toThrow(/別用途/);expect(readFileSync(path)).toEqual(before);
    }));
    it("readOnly・close・不明IDの契約を保つ", () => withDb(path => {
        const writer = new BalanceSheetSqliteStore(path);writer.close();const db = new BalanceSheetSqliteStore(path, { readOnly: true });
        expect(db.get("a".repeat(64))).toBeUndefined();expect(() => db.get("bad")).toThrow();expect(() => db.putMany([input()])).toThrow(/readOnly/);
        db.close();db.close();expect(() => db.search(cohort)).toThrow(/close/);
        exec(path, "UPDATE financial_store_meta SET schema_version=2");expect(() => new BalanceSheetSqliteStore(path)).toThrow(/未対応/);
    }));
    it("複数版の会社・docID重複を条件適用前に拒否し、明示IDなら選べる", () => withDb(path => {
        const a = input(), b = structuredClone(a);b.provenance.sourceSha256 = "b".repeat(64);const db = new BalanceSheetSqliteStore(path);
        try { const ids = db.putMany([a, b]).ids;
            expect(() => db.search(cohort, { conditions: [{ metric: "currentAssets", operator: "gt", value: 999 }] })).toThrow(/複数版/);
            expect(db.search({ ...cohort, snapshotIds: [ids[0]] }).total).toBe(1);
            expect(db.search({ ...cohort, snapshotIds: [] }).total).toBe(0);
            expect(() => db.search({ ...cohort, snapshotIds: [ids[0], ids[0]] })).toThrow(/重複/);
        } finally { db.close(); }
    }));
    it("別日・別scope・抽出版は保存できるが明示IDの混在は拒否する", () => withDb(path => {
        const a = input(), b = input("1002", undefined, "2024-03-31"), c = input("1003", undefined, cohort.instant, "NonConsolidated"), d = input("1004");d.provenance.mappingVersion = "2";
        const db = new BalanceSheetSqliteStore(path);try {
            const saved = db.putMany([a, b, c, d]);expect(db.search(cohort).total).toBe(1);
            for (const id of saved.ids.slice(1)) expect(() => db.search({ ...cohort, snapshotIds: [saved.ids[0], id] })).toThrow(/混在/);
            expect(() => db.search({ ...cohort, snapshotIds: ["c".repeat(64)] })).toThrow(/不明/);
            expect(() => db.search({ ...cohort, instant: "2025-02-30" })).toThrow();
            expect(db.search({ ...cohort, extractorVersion: "x' OR 1=1 --" }).total).toBe(0);
        } finally { db.close(); }
    }));
    it("破損projectionを条件で隠さず、getも失敗する", () => withDb(path => {
        const db = new BalanceSheetSqliteStore(path);const saved = db.putMany([input()]);
        try { exec(path, "UPDATE financial_snapshots SET projection_json=json_set(projection_json,'$.currentAssets.value',0)");
            expect(() => db.search(cohort, { conditions: [{ metric: "currentAssets", operator: "gt", value: 100 }] })).toThrow(/ハッシュ/);
            expect(() => db.get(saved.ids[0])).toThrow(/ハッシュ/);
        } finally { db.close(); }
    }));
    it("疎配列やJSONへ保存できない来歴を拒否する", () => withDb(path => {
        const db = new BalanceSheetSqliteStore(path);try {
            const row = input();(row.snapshot.selections.currentAssets.evidence as any).length += 1;
            expect(() => db.putMany([row])).toThrow();expect(db.search(cohort).total).toBe(0);
        } finally { db.close(); }
    }));
    it.each(["array", "hash-array", "commit-array"])("不正provenance %sは保存前に拒否する", mode => withDb(path => {
        const row = input();
        if (mode === "array") row.provenance = Object.assign([], row.provenance) as any;
        if (mode === "hash-array") row.provenance.sourceSha256 = [row.provenance.sourceSha256] as any;
        if (mode === "commit-array") row.provenance.sourceCommit = [row.provenance.sourceCommit] as any;
        const db = new BalanceSheetSqliteStore(path); try { expect(() => db.putMany([row])).toThrow(); expect(db.search(cohort).total).toBe(0); } finally { db.close(); }
    }));
    it("配列の追加属性をJSON化で黙って失わない", () => withDb(path => {
        const row = input(); (row.snapshot.selections.currentAssets.evidence as any).extra = "keep";
        const db = new BalanceSheetSqliteStore(path); try { expect(() => db.putMany([row])).toThrow(/追加属性/); } finally { db.close(); }
    }));
    it("標準SQLiteから原数値・分数・近似値を読め、アプリ関数はその接続には無い", () => withDb(path => {
        const db = new BalanceSheetSqliteStore(path);db.putMany([input("1001", ["1", "3", "4"])]);db.close();
        const sql = new Database(path, { readOnly: true });try {
            const stmt = sql.prepare("SELECT raw_text FROM financial_metric_values WHERE metric_id='currentAssets'");try { expect(stmt.get()!.raw_text).toBe("1"); } finally { stmt.close(); }
            const ratio = sql.prepare("SELECT numerator,denominator FROM financial_metric_values WHERE metric_id='currentRatio'");try { expect({ ...ratio.get() }).toEqual({ numerator: "1", denominator: "3" }); } finally { ratio.close(); }
            expect(() => sql.prepare("SELECT edinet_fraction_compare('1','3','1','2')")).toThrow();
        } finally { sql.close(); }
    }));
});
