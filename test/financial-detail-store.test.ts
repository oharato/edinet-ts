import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { FinancialDetailSqliteStore, BalanceSheetSqliteStore, createFinancialDetailSnapshot, screenFinancialDetailSnapshots,
    type FinancialDetailStoreInput, type FinancialDetailStoreCohort, type FinancialDetailScreeningOptions } from "../src/index";
import { Database } from "../src/db/node-sqlite";
import { instance, fact, standalone } from "./fixtures/metric-boundaries";
const cohort: FinancialDetailStoreCohort = { instant: "2025-03-31", scope: "Consolidated", accountingStandard: "J-GAAP", currency: "JPY", extractorVersion: "test-v1", mappingVersion: "3" };
const names = ["jppfs_cor:NoncurrentAssets", "jppfs_cor:NoncurrentLiabilities", "jppfs_cor:CashAndDeposits"];
function input(code = "1001", values = ["120", "40", "80"], instant = cohort.instant, scope: "Consolidated" | "NonConsolidated" = "Consolidated", extra = "", namespace?: string): FinancialDetailStoreInput {
    const context = `<xbrli:context id="current"><xbrli:entity><xbrli:identifier scheme="synthetic">A</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>${instant}</xbrli:instant></xbrli:period>${scope === "NonConsolidated" ? `<xbrli:scenario>${standalone}</xbrli:scenario>` : ""}</xbrli:context>`;
    let xml = instance(values.map((value, i) => value === "absent" ? "" : fact(value === "nil" ? "" : value, value === "nil" ? 'xsi:nil="true"' : "", names[i])).join("") + extra, context);
    if (namespace) xml = xml.replace("http://disclosure.edinet-fsa.go.jp/taxonomy/jppfs/2024-11-01/jppfs_cor", namespace);
    return { snapshot: createFinancialDetailSnapshot(xml, { secCode: code, docID: `SYNTHETIC-${code}-${instant}-${scope}`, period: { instant }, scope, accountingStandard: "J-GAAP", currency: "JPY" }),
        provenance: { extractorVersion: cohort.extractorVersion, mappingVersion: cohort.mappingVersion, sourceSha256: createHash("sha256").update(xml).digest("hex"), sourceCommit: "a".repeat(40) } };
}
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
function fixture(run: (path: string, dir: string) => void) { const dir = fs.mkdtempSync(join(tmpdir(), "financial-detail-store-")); try { run(join(dir, "details.sqlite"), dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); } }
function sql(path: string, text: string) { const db = new Database(path); try { db.exec(text); } finally { db.close(); } }
const hash = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const cases: FinancialDetailScreeningOptions[] = [{}, { limit: 0 }, { offset: 100 }, { metricIds: ["cashAndDeposits"], sortBy: "cashAndDeposits" },
    ...["noncurrentAssets", "noncurrentLiabilities", "cashAndDeposits"].flatMap(metric => ["gte", "lte", "gt", "lt", "eq"].flatMap(operator => [-1, 0, 40].map(value => ({ conditions: [{ metric, operator, value }] } as FinancialDetailScreeningOptions)))),
    ...["noncurrentAssets", "noncurrentLiabilities", "cashAndDeposits"].flatMap(sortBy => ["asc", "desc"].flatMap(order => [undefined, 0, 1].map(limit => ({ sortBy, order, limit, offset: limit === 1 ? 1 : 0 } as FinancialDetailScreeningOptions)))),
    { conditions: [{ metric: "cashAndDeposits", operator: "gte", value: 0 }, { metric: "noncurrentAssets", operator: "gte", value: 0 }], sortBy: "cashAndDeposits", order: "asc", offset: 1, limit: 2 }];

describe("財務時点3項目のSQLite再open・JSON検索同等性", () => {
    const inputs = [input(), input("1002", ["0", "-1", "0"]), input("1003", ["-0", "40", "80"]), input("1004", ["120", "absent", "40"]),
        input("1005", ["120", "40", "nil"]), input("1006", ["120", "40", "9007199254740993"]),
        input("1007", ["120", "40", "80"], cohort.instant, cohort.scope, fact("80", "", names[2])), input("1008", ["120", "40", "80"], cohort.instant, cohort.scope, "", "https://example.test/fake")];
    it.each(cases)("再open後の検索%jがJSON版と一致", options => fixture(path => {
        let store = new FinancialDetailSqliteStore(path); store.putMany(inputs); store.close(); store = new FinancialDetailSqliteStore(path, { readOnly: true });
        try { expect(json(store.screen(cohort, options))).toEqual(json(screenFinancialDetailSnapshots(inputs.map(row => row.snapshot), options))); } finally { store.close(); }
    }));
    it("2社2期2scopeを分離し、元の数値/source/evidence/版と-0を保持", () => fixture(path => {
        const rows = ["1001", "1002"].flatMap(code => ["2024-03-31", "2025-03-31"].flatMap(instant => ["Consolidated", "NonConsolidated"].map(scope => input(code, ["-0", "40.00", "80"], instant, scope as any))));
        let store = new FinancialDetailSqliteStore(path); const saved = store.putMany(rows); store.close(); store = new FinancialDetailSqliteStore(path, { readOnly: true });
        try {
            saved.ids.forEach((id, i) => { const actual = store.get(id)!; expect(json(actual)).toEqual(json({ id, ...rows[i] })); expect(Object.is(actual.snapshot.selections.noncurrentAssets!.safeNumber, -0)).toBe(true); });
            for (const instant of ["2024-03-31", "2025-03-31"]) for (const scope of ["Consolidated", "NonConsolidated"] as const) expect(store.screen({ ...cohort, instant, scope }).total).toBe(2);
        } finally { store.close(); }
    }));
    it("小数/極小値/最大安全整数付近と巨大unsafeをSQLで丸めて採用しない", () => fixture(path => {
        const tiny = `0.${"0".repeat(323)}5`, rows = [input("1001", ["0.3", "40", tiny]), input("1002", ["9007199254740991", "40", "9007199254740990"]), input("1003", ["9007199254740993", "40", "80"])];
        const store = new FinancialDetailSqliteStore(path); try {
            store.putMany(rows);
            for (const value of [Number.MIN_VALUE, 0.3, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, 1e308]) for (const operator of ["gte", "lte", "gt", "lt", "eq"] as const) {
                const options = { conditions: [{ metric: "noncurrentAssets" as const, operator, value }], sortBy: "cashAndDeposits" as const };
                expect(json(store.screen(cohort, options))).toEqual(json(screenFinancialDetailSnapshots(rows.map(row => row.snapshot), options)));
            }
        } finally { store.close(); }
    }));
});

describe("専用DBの再投入・版・原子性・同書類保護", () => {
    it("同原本/版/内容の再投入は増えず、返却値の変更はDBに戻らない", () => fixture(path => {
        const store = new FinancialDetailSqliteStore(path); const row = input(); try {
            const first = store.putMany([row]); expect(store.putMany([json(row), row])).toMatchObject({ inserted: 0, unchanged: 2, ids: [first.ids[0], first.ids[0]] });
            store.get(first.ids[0])!.snapshot.selections.cashAndDeposits!.evidence[0].raw = "modified";
            expect(store.get(first.ids[0])!.snapshot.selections.cashAndDeposits!.raw).toBe("80");
        } finally { store.close(); }
    }));
    it("同原本の別版は旧版を保持し、同cohortの複数候補はIDsで選ぶ", () => fixture(path => {
        const store = new FinancialDetailSqliteStore(path), a = input(), b = structuredClone(a); b.provenance.sourceCommit = "b".repeat(40);
        try {
            const saved = store.putMany([a, b]); expect(saved.inserted).toBe(2); expect(store.get(saved.ids[0])!.provenance.sourceCommit).toBe("a".repeat(40));
            expect(() => store.screen(cohort, { conditions: [{ metric: "cashAndDeposits", operator: "gt", value: 999999 }] })).toThrow(/複数版/);
            expect(store.screen({ ...cohort, snapshotIds: [saved.ids[1]] }).total).toBe(1);
            const c = structuredClone(a); c.provenance.extractorVersion = "test-v2"; const updated = store.putMany([c]);
            expect(store.screen({ ...cohort, extractorVersion: "test-v2", snapshotIds: updated.ids }).total).toBe(1);
            expect(() => store.screen({ ...cohort, snapshotIds: updated.ids })).toThrow(/異なる/);
        } finally { store.close(); }
    }));
    it("同一ID異内容がbatch後半にある場合、先行追加もrollback", () => fixture(path => {
        const store = new FinancialDetailSqliteStore(path), original = input(); try {
            const id = store.putMany([original]).ids[0]; const conflict = input("1001", ["121", "40", "80"]); conflict.provenance = { ...original.provenance };
            expect(() => store.putMany([input("1002"), conflict])).toThrow(/内容が異なります/);
            expect(store.get(id)!.snapshot.selections.noncurrentAssets!.raw).toBe("120"); expect(store.screen(cohort).total).toBe(1);
        } finally { store.close(); }
    }));
    it.each(["hash", "company"])("same-doc %s矛盾は更新せず後半で全rollback", kind => fixture(path => {
        const store = new FinancialDetailSqliteStore(path), original = input(), changed = input("1003"); changed.snapshot.metadata.docID = original.snapshot.metadata.docID;
        if (kind === "hash") { changed.snapshot.metadata.secCode = original.snapshot.metadata.secCode; changed.provenance.sourceSha256 = "b".repeat(64); }
        try { store.putMany([original]); expect(() => store.putMany([input("1002"), changed])).toThrow(/矛盾/); expect(store.screen(cohort).total).toBe(1); } finally { store.close(); }
    }));
    it("同じ原本の別期末/scopeを保持し、非対応triggerを形式拒否する", () => fixture(path => {
        const store = new FinancialDetailSqliteStore(path), a = input(), b = input("1001", ["120", "40", "80"], "2024-03-31", "NonConsolidated");
        b.snapshot.metadata.docID = a.snapshot.metadata.docID; b.provenance = { ...a.provenance };
        try {
            store.putMany([a, b]); sql(path, "CREATE TRIGGER fail_second BEFORE INSERT ON detail_snapshots WHEN NEW.sec_code='10030' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
            expect(() => store.putMany([input("1002"), input("1003")])).toThrow(/固定schema1/);
            sql(path, "DROP TRIGGER fail_second;"); expect(store.screen(cohort).total).toBe(1); expect(store.putMany([input("1002"), input("1003")]).inserted).toBe(2);
        } finally { store.close(); }
    }));
    it("不正入力/非JSON/getterは書込前に拒否し、後半不正も一部保存しない", () => fixture(path => {
        const store = new FinancialDetailSqliteStore(path); let calls = 0; const bad: any = input(); Object.defineProperty(bad.provenance, "sourceSha256", { get() { calls++; return "a".repeat(64); }, enumerable: true });
        try { expect(() => store.putMany([input("1002"), bad])).toThrow(); expect(calls).toBe(0); expect(store.screen(cohort).total).toBe(0); expect(() => store.putMany(Array(1))).toThrow(); } finally { store.close(); }
    }));
    it.each(["duration", "extra-metric", "partial", "standard", "currency", "version", "hash", "commit"])("%sを専用3項目DBへ混ぜない", kind => fixture(path => {
        const store = new FinancialDetailSqliteStore(path), row: any = input();
        if (kind === "duration") row.snapshot = createFinancialDetailSnapshot(instance(), { ...row.snapshot.metadata, period: { startDate: "2024-04-01", endDate: "2025-03-31" }, periodType: "annual" });
        if (kind === "extra-metric") row.snapshot = createFinancialDetailSnapshot(instance(), row.snapshot.metadata, ["noncurrentAssets", "noncurrentLiabilities", "cashAndDeposits", "shortTermLoansPayable"]);
        if (kind === "partial") delete row.snapshot.selections.noncurrentAssets;
        if (kind === "standard") row.snapshot = createFinancialDetailSnapshot(instance(), { ...row.snapshot.metadata, accountingStandard: "IFRS" });
        if (kind === "currency") row.snapshot.metadata.currency = "USD";
        if (kind === "version") row.provenance.extractorVersion = " ";
        if (kind === "hash") row.provenance.sourceSha256 = "NOT-A-HASH";
        if (kind === "commit") row.provenance.sourceCommit = "main";
        try { expect(() => store.putMany([row])).toThrow(); expect(store.screen(cohort).total).toBe(0); } finally { store.close(); }
    }));
});

describe("SQL cache・metadata・所有DB・readOnlyの保護", () => {
    it.each(["missing-pk", "nullable-column", "wrong-type"])("%sの偽schema1をコピーprobeで拒否し元bytesを保つ", kind => fixture((path, dir) => {
        const good = new FinancialDetailSqliteStore(path); good.close();
        const reader = new Database(path), definitions = reader.prepare("SELECT name,sql FROM sqlite_master WHERE name IN ('detail_store_meta','detail_snapshots','detail_cohort','detail_metric_values')");
        const ddl = Object.fromEntries((definitions.all() as any[]).map(row => [row.name, row.sql])) as Record<string, string>;
        definitions.close(); reader.close();
        const fakePath = join(dir, "fake.sqlite"), fake = new Database(fakePath);
        let table = ddl.detail_snapshots;
        if (kind === "missing-pk") table = table.replace("id TEXT PRIMARY KEY NOT NULL", "id TEXT NOT NULL");
        if (kind === "nullable-column") table = table.replace("record_json TEXT NOT NULL", "record_json TEXT");
        if (kind === "wrong-type") table = table.replace("record_json TEXT NOT NULL", "record_json BLOB NOT NULL");
        fake.exec(ddl.detail_store_meta + "; INSERT INTO detail_store_meta VALUES('edinet-ts-financial-detail-instant',1);" + table + ";" + ddl.detail_cohort + ";" + ddl.detail_metric_values + ";");
        fake.close(); const before = hash(fakePath), files = fs.readdirSync(dir).sort();
        for (const readOnly of [false, true]) expect(() => new FinancialDetailSqliteStore(fakePath, { readOnly })).toThrow(/schema1|列/);
        expect(hash(fakePath)).toBe(before); expect(fs.readdirSync(dir).sort()).toEqual(files);
    }));
    it.each(["view", "index", "extra-index", "after-trigger"])("%sの変更済み形式を拒否し、元DBを更新しない", kind => fixture((path, dir) => {
        const store = new FinancialDetailSqliteStore(path); store.close();
        if (kind === "view") sql(path, "DROP VIEW detail_metric_values; CREATE VIEW detail_metric_values AS SELECT 'WRONG' id,'WRONG' sec_code,'WRONG' doc_id,'WRONG' instant,'WRONG' scope,'WRONG' accounting_standard,'WRONG' currency,'WRONG' extractor_version,'WRONG' mapping_version,'WRONG' source_sha256,'WRONG' metric_id,1 available,999 numeric_value,'WRONG' raw_text,'selected' status,'selected' reason,'WRONG' unit,'{}' source_json;");
        if (kind === "index") sql(path, "DROP INDEX detail_cohort; CREATE INDEX detail_cohort ON detail_snapshots(doc_id,sec_code);");
        if (kind === "extra-index") sql(path, "CREATE INDEX extra_detail ON detail_snapshots(doc_id);");
        if (kind === "after-trigger") sql(path, "CREATE TRIGGER poison AFTER INSERT ON detail_snapshots BEGIN UPDATE detail_snapshots SET projection_json='{}' WHERE id=NEW.id; END;");
        const before = hash(path), files = fs.readdirSync(dir).sort();
        for (const readOnly of [false, true]) expect(() => new FinancialDetailSqliteStore(path, { readOnly })).toThrow(/固定schema1/);
        expect(hash(path)).toBe(before); expect(fs.readdirSync(dir).sort()).toEqual(files);
    }));
    it("open後のAFTER triggerも実行前に拒否し、破損行をCOMMITしない", () => fixture(path => {
        const store = new FinancialDetailSqliteStore(path);
        try {
            sql(path, "CREATE TRIGGER poison AFTER INSERT ON detail_snapshots BEGIN UPDATE detail_snapshots SET projection_json='{}' WHERE id=NEW.id; END;");
            expect(() => store.putMany([input()])).toThrow(/固定schema1/);
            sql(path, "DROP TRIGGER poison;"); expect(store.screen(cohort).total).toBe(0); expect(store.putMany([input()]).inserted).toBe(1);
        } finally { store.close(); }
    }));
    it.each(["cache-corruption", "sql-failure"])("COMMIT前の%sは全batchをrollbackし再開可能", fault => fixture(path => {
        const store = new FinancialDetailSqliteStore(path), internal = store as any, original = internal.verifyAll.bind(store); let checks = 0;
        internal.verifyAll = () => {
            if (++checks === 2) {
                if (fault === "cache-corruption") internal.db.exec("UPDATE detail_snapshots SET projection_json='{}';");
                else internal.db.exec("INSERT INTO detail_snapshots(id) VALUES('synthetic-invalid');");
            }
            return original();
        };
        try {
            expect(() => store.putMany([input(), input("1002")])).toThrow(); expect(checks).toBe(2);
            internal.verifyAll = original; expect(store.screen(cohort).total).toBe(0); expect(store.putMany([input()]).inserted).toBe(1);
        } finally { internal.verifyAll = original; store.close(); }
    }));
    it("新schema1のIDはPRIMARY KEY/NOT NULL、独立SQLiteでも重複/NULLを拒否", () => fixture(path => {
        const store = new FinancialDetailSqliteStore(path); const id = store.putMany([input()]).ids[0]; store.close();
        const db = new Database(path); try {
            const info = db.prepare("PRAGMA table_info(detail_snapshots)"), row = (info.all() as any[]).find(column => column.name === "id"); info.close();
            expect(row).toMatchObject({ type: "TEXT", notnull: 1, pk: 1 });
            expect(() => db.exec("INSERT INTO detail_snapshots SELECT * FROM detail_snapshots;")).toThrow();
            const update = db.prepare("UPDATE detail_snapshots SET id=NULL WHERE id=?"); try { expect(() => update.run(id)).toThrow(); } finally { update.close(); }
        } finally { db.close(); }
    }));

    it.each(["projection", "record", "metadata", "format"])("%s破損は条件外でも拒否", kind => fixture(path => {
        const store = new FinancialDetailSqliteStore(path), id = store.putMany([input()]).ids[0];
        if (kind === "projection") sql(path, "UPDATE detail_snapshots SET projection_json=json_set(projection_json,'$.cashAndDeposits.numeric',999);");
        if (kind === "record") sql(path, "UPDATE detail_snapshots SET record_json='{}';");
        if (kind === "metadata") sql(path, "UPDATE detail_snapshots SET instant='2020-03-31';");
        if (kind === "format") sql(path, "UPDATE detail_store_meta SET schema_version=2;");
        try { expect(() => store.get(id)).toThrow(); expect(() => store.screen(cohort, { limit: 0 })).toThrow(); expect(() => store.putMany([input("1002")])).toThrow(); } finally { store.close(); }
    }));
    it("cacheだけを偽のcontent hashで覆ってもsnapshot再投影が拒否", () => fixture(path => {
        const store = new FinancialDetailSqliteStore(path), id = store.putMany([input()]).ids[0], db = new Database(path);
        try {
            db.exec("UPDATE detail_snapshots SET projection_json=json_set(projection_json,'$.cashAndDeposits.numeric',999);");
            const read = db.prepare("SELECT * FROM detail_snapshots"); const row = read.all()[0] as any; read.close();
            const columns = ["id", "record_json", "projection_json", "sec_code", "doc_id", "instant", "scope", "accounting_standard", "currency", "extractor_version", "mapping_version", "source_sha256"];
            const checksum = createHash("sha256").update(JSON.stringify(columns.map(column => row[column]))).digest("hex");
            const update = db.prepare("UPDATE detail_snapshots SET content_sha256=?"); update.run(checksum); update.close();
            expect(() => store.get(id)).toThrow(/不整合/);
        } finally { db.close(); store.close(); }
    }));
    it.each(["empty", "source", "foreign", "foreign-wal", "bs3", "symlink", "directory", "sidecar", "wrong-version"])("%s DBを初期化・recover・変更しない", kind => fixture((path, dir) => {
        if (kind === "empty") fs.writeFileSync(path, "");
        if (kind === "source") fs.writeFileSync(path, "<synthetic-original/>");
        if (kind === "foreign" || kind === "foreign-wal") { const db = new Database(path); db.exec("CREATE TABLE unrelated(x TEXT);"); if (kind === "foreign-wal") db.exec("PRAGMA journal_mode=WAL;"); db.close(); }
        if (kind === "bs3") { const db = new BalanceSheetSqliteStore(path); db.close(); }
        if (kind === "symlink") { fs.writeFileSync(join(dir, "source.xbrl"), "<synthetic-original/>"); fs.symlinkSync(join(dir, "source.xbrl"), path); }
        if (kind === "directory") fs.mkdirSync(path);
        if (kind === "sidecar" || kind === "wrong-version") { const db = new FinancialDetailSqliteStore(path); db.close(); if (kind === "sidecar") fs.writeFileSync(path + "-journal", "synthetic-preserve"); else sql(path, "UPDATE detail_store_meta SET schema_version=99;"); }
        const before = fs.statSync(path).isFile() ? hash(path) : undefined, files = fs.readdirSync(dir).sort();
        for (const readOnly of [false, true]) expect(() => new FinancialDetailSqliteStore(path, { readOnly })).toThrow();
        if (before) expect(hash(path)).toBe(before); expect(fs.readdirSync(dir).sort()).toEqual(files);
    }));
    it("readOnlyはcold WALでも元DB/元directoryを変更せず、固定コピーを読む", () => fixture((path, dir) => {
        const writer = new FinancialDetailSqliteStore(path), first = writer.putMany([input()]); writer.close(); sql(path, "PRAGMA journal_mode=WAL;");
        const before = hash(path), files = fs.readdirSync(dir).sort(), reader = new FinancialDetailSqliteStore(path, { readOnly: true });
        try { expect(reader.get(first.ids[0])).toBeDefined(); expect(reader.screen(cohort).total).toBe(1); expect(() => reader.putMany([])).toThrow(/readOnly/); expect(hash(path)).toBe(before); expect(fs.readdirSync(dir).sort()).toEqual(files); } finally { reader.close(); }
        expect(hash(path)).toBe(before); expect(fs.readdirSync(dir).sort()).toEqual(files);
    }));
    it("readOnlyコピーは外部更新を追随せず、再open時に新しい状態を見る", () => fixture(path => {
        const writer = new FinancialDetailSqliteStore(path); writer.putMany([input()]); const reader = new FinancialDetailSqliteStore(path, { readOnly: true });
        try { writer.putMany([input("1002")]); expect(reader.screen(cohort).total).toBe(1); } finally { reader.close(); writer.close(); }
        const reopened = new FinancialDetailSqliteStore(path, { readOnly: true }); try { expect(reopened.screen(cohort).total).toBe(2); } finally { reopened.close(); }
    }));
    it("busy BEGIN失敗後のstatement/transactionが残らず再開できる", () => fixture(path => {
        const store = new FinancialDetailSqliteStore(path, { timeout: 0 }), lock = new Database(path); lock.exec("BEGIN IMMEDIATE");
        try { expect(() => store.putMany([input()])).toThrow(); lock.exec("ROLLBACK"); expect(store.putMany([input()]).inserted).toBe(1); expect(store.screen(cohort).total).toBe(1); } finally { lock.close(); store.close(); }
    }));
    it("普通のSQLite接続でviewのraw/status/unit/source/version/numericを読める", () => fixture(path => {
        const store = new FinancialDetailSqliteStore(path); store.putMany([input("1001", ["-0", "nil", "9007199254740993"])]); store.close();
        const db = new Database(path, { readOnly: true }); try {
            const statement = db.prepare("SELECT metric_id,raw_text,numeric_value,available,status,reason,unit,source_json,extractor_version FROM detail_metric_values ORDER BY metric_id"); const rows = statement.all() as any[]; statement.close();
            expect(rows).toHaveLength(3); const rawOnly = rows.find(row => row.metric_id === "cashAndDeposits"); expect(rawOnly).toMatchObject({ raw_text: "9007199254740993", numeric_value: null, available: 0, status: "selected", unit: "iso4217:JPY", extractor_version: cohort.extractorVersion });
            expect(JSON.parse(rawOnly.source_json).key).toBe("jppfs_cor:CashAndDeposits"); expect(rows.find(row => row.metric_id === "noncurrentAssets").raw_text).toBe("-0"); expect(rows.find(row => row.metric_id === "noncurrentLiabilities").status).toBe("missing");
        } finally { db.close(); }
    }));
    it("閉じたStore/不正ID/mixedID/不正設定と未対応検索を拒否", () => fixture(path => {
        const store = new FinancialDetailSqliteStore(path), saved = store.putMany([input()]);
        expect(store.get("0".repeat(64))).toBeUndefined(); expect(() => store.get("bad")).toThrow();
        expect(store.screen({ ...cohort, snapshotIds: [] }).total).toBe(0); expect(() => store.screen({ ...cohort, snapshotIds: [...saved.ids, ...saved.ids] })).toThrow();
        expect(() => store.screen({ ...cohort, snapshotIds: ["0".repeat(64)] })).toThrow(); expect(() => store.screen({ ...cohort, scope: "NonConsolidated", snapshotIds: saved.ids })).toThrow();
        for (const options of [{ sortBy: "costOfSales" }, { metricIds: ["shortTermLoansPayable"] }, { conditions: [{ metric: "cashAndDeposits", operator: "eq", value: NaN }] }, { offset: -1 }, { limit: 0.5 }, { extra: 1 }]) expect(() => store.screen(cohort, options as any)).toThrow();
        store.close(); store.close(); expect(() => store.get(saved.ids[0])).toThrow(/close/); expect(() => store.putMany([])).toThrow(/close/); expect(() => store.screen(cohort)).toThrow(/close/);
    }));
});
