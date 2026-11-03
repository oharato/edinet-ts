import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FinancialDetailGenerations, createFinancialDetailSnapshot, type FinancialDetailGenerationRecord } from "../src/index";
import { Database } from "../src/db/node-sqlite";
import { instance, fact } from "./fixtures/metric-boundaries";
const context = '<xbrli:context id="current"><xbrli:entity><xbrli:identifier scheme="synthetic">A</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2024-04-01</xbrli:startDate><xbrli:endDate>2025-03-31</xbrli:endDate></xbrli:period></xbrli:context>';
const record = (key = "one", raw = "-100"): FinancialDetailGenerationRecord => ({ key,
    snapshot: createFinancialDetailSnapshot(instance(fact(raw, "", "jppfs_cor:IncomeTaxesPaidOpeCF"), context), {
        docID: "DOC1", secCode: "1001", scope: "Consolidated", accountingStandard: "J-GAAP", currency: "JPY", periodType: "annual",
        period: { startDate: "2024-04-01", endDate: "2025-03-31" }
    }, ["incomeTaxesPaidCashFlow"]), provenance: { sourceSha256: "a".repeat(64), extractorVersion: "test", mappingVersion: "6" } });
const temporary = (test: (path: string) => void) => {
    const dir = mkdtempSync(join(tmpdir(), "edinet-generations-"));
    try { test(join(dir, "store.sqlite")); } finally { rmSync(dir, { recursive: true, force: true }); }
};
describe("期間明細の世代保存", () => {
    it("再openして未保存キーから再開し、完了後だけ公開・検索できる", () => temporary(path => {
        let store = new FinancialDetailGenerations(path);
        store.begin({ extractorVersion: "test", mappingVersion: "6", id: "v1", keys: ["two", "one"] }); store.put("v1", [record()]);
        expect(store.pending("v1")).toEqual(["two"]);
        expect(() => store.complete("v1")).toThrow(); expect(() => store.activate("v1")).toThrow();
        expect(() => store.screen("v1")).toThrow(); expect(store.active()).toBeUndefined(); store.close();
        store = new FinancialDetailGenerations(path);
        expect(store.pending("v1")).toEqual(["two"]); store.put("v1", [record("two")]);
        store.complete("v1"); store.activate("v1"); expect(store.active()).toBe("v1");
        expect(store.read("v1")[0]).toEqual(record());
        // 同じ会社の複数snapshotを自動的に最新へまとめない。
        expect(() => store.screen("v1")).toThrow(); store.close();
    }));
    it("PL/CFの符号・原値・証跡を保存し、既存メモリ検索を使う", () => temporary(path => {
        const store = new FinancialDetailGenerations(path), input = record();
        store.begin({ extractorVersion: "test", mappingVersion: "6", id: "v1", keys: ["one"] }); store.put("v1", [input]); store.complete("v1");
        expect(store.screen("v1", { metricIds: ["incomeTaxesPaidCashFlow"] }).rows[0].selections.incomeTaxesPaidCashFlow?.raw).toBe("-100");
        expect(() => store.put("v1", [input])).toThrow(); store.close();
    }));
    it("未公開世代を作っても現行を変えず、旧世代へ戻せる", () => temporary(path => {
        const store = new FinancialDetailGenerations(path);
        for (const id of ["old", "new"]) { store.begin({ extractorVersion: "test", mappingVersion: "6", id, keys: ["one"] }); store.put(id, [record("one", id === "old" ? "1" : "2")]); store.complete(id); }
        store.activate("old"); store.begin({ extractorVersion: "test", mappingVersion: "6", id: "pending", keys: ["one"] }); expect(store.active()).toBe("old");
        store.activate("new"); expect(store.active()).toBe("new"); store.activate("old"); expect(store.active()).toBe("old"); store.close();
    }));
    it("同じ計画・同じ内容は再実行でき、異なる内容のbatchは全体を戻す", () => temporary(path => {
        const store = new FinancialDetailGenerations(path);
        store.begin({ extractorVersion: "test", mappingVersion: "6", id: "v1", keys: ["one", "two"] }); store.begin({ extractorVersion: "test", mappingVersion: "6", id: "v1", keys: ["two", "one"] });
        expect(() => store.begin({ extractorVersion: "test", mappingVersion: "6", id: "v1", keys: ["one"] })).toThrow();
        store.put("v1", [record()]); store.put("v1", [record()]);
        expect(() => store.put("v1", [record("two"), record("one", "2")])).toThrow();
        expect(store.pending("v1")).toEqual(["two"]); store.close();
    }));
    it("計画外・偽造値・不正hashを拒否し、既存データを保持", () => temporary(path => {
        const store = new FinancialDetailGenerations(path); store.begin({ extractorVersion: "test", mappingVersion: "6", id: "v1", keys: ["one"] });
        expect(() => store.put("v1", [record("outside")])).toThrow();
        const forged = record(); forged.snapshot.selections.incomeTaxesPaidCashFlow!.safeNumber = 999;
        expect(() => store.put("v1", [forged])).toThrow();
        const bad = record(); bad.provenance.sourceSha256 = "bad"; expect(() => store.put("v1", [bad])).toThrow();
        const changed = record(); changed.provenance.mappingVersion = "7"; expect(() => store.put("v1", [changed])).toThrow();
        expect(store.pending("v1")).toEqual(["one"]); store.close();
    }));
    it("内容破損を検出して公開と検索を止める", () => temporary(path => {
        const store = new FinancialDetailGenerations(path); store.begin({ extractorVersion: "test", mappingVersion: "6", id: "v1", keys: ["one"] }); store.put("v1", [record()]); store.complete("v1");
        const db = new Database(path); db.exec("UPDATE generation_records SET body='{}'"); db.close();
        expect(() => store.activate("v1")).toThrow(); expect(() => store.screen("v1")).toThrow(); store.close();
    }));
    it("別用途DBへtableを追加しない", () => temporary(path => {
        let db = new Database(path); db.exec("CREATE TABLE original(value TEXT)"); db.close();
        expect(() => new FinancialDetailGenerations(path)).toThrow(); db = new Database(path);
        const q = db.prepare("SELECT name FROM sqlite_master WHERE type='table'"); expect(q.all()).toEqual([{ name: "original" }]); q.close(); db.close();
    }));
});
