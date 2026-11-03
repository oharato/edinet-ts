import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createFinancialDetailSnapshot, normalizeFinancialDetailSnapshot, screenFinancialDetailDocuments,
    screenFinancialDetailSnapshots, type FinancialDetailMetadata } from "../src/index";
import { instance, fact, context, period } from "./fixtures/metric-boundaries";
const id = "incomeBeforeIncomeTaxes" as const;
const meta = (code = "1001"): FinancialDetailMetadata => ({ secCode: code, docID: `SYNTHETIC${code}`,
    scope: "Consolidated", accountingStandard: "J-GAAP", currency: "JPY", period, periodType: "annual" });
const f = (raw = "100", attrs = "", ctx = "current") => fact(raw, attrs, "jppfs_cor:IncomeBeforeIncomeTaxes", ctx);
const snapshot = (xml = instance(f() + f()), code = "1001") => createFinancialDetailSnapshot(xml, meta(code), [id]);
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe("財務明細の完全一致重複を採用し、保存証跡と旧判定を保持", () => {
    it.each(["100", "-100", "0", "-0", "9007199254740993"])("原値%sを合算せず保持してJSON往復", raw => {
        const row = snapshot(instance(f(raw) + f(raw))), selected = row.selections[id]!;
        expect(selected).toMatchObject({ status: "selected", reason: "selected-identical-duplicates", raw, evidence: [{ reason: raw === "9007199254740993" ? "selected-raw-only" : "selected" }, {}] });
        expect(selected.evidence).toHaveLength(2);
        expect(selected.safeNumber).toBe(raw === "9007199254740993" ? undefined : Number(raw));
        expect(json(normalizeFinancialDetailSnapshot(json(row)))).toEqual(json(row));
    });
    it("旧JSONの曖昧は読み込み・検索でも昇格させない", () => {
        const current = snapshot();
        const legacy = { metadata: current.metadata, selections: { [id]: { metricId: id,
            status: "ambiguous" as const, reason: "multiple-facts" as const, evidence: current.selections[id]!.evidence } } };
        const before = JSON.stringify(legacy);
        expect(normalizeFinancialDetailSnapshot(legacy)).toEqual(legacy);
        expect(screenFinancialDetailSnapshots([legacy], { metricIds: [id] })).toMatchObject({ total: 0, excludedRows: 1, reasonCounts: { ambiguous: 1 } });
        expect(JSON.stringify(legacy)).toBe(before);
    });
    it.each([
        ["異値", instance(f() + f("101"))],
        ["別表記", instance(f() + f("100.0"))],
        ["精度差", instance(f() + f().replace('decimals="INF"', 'decimals="0"'))],
        ["nil混在", instance(f() + f("", 'xsi:nil="true"'))],
        ["未定義単位", instance(f() + f().replace('unitRef="money"', 'unitRef="unknown"'))],
        ["重複context", instance(f() + f(), context() + context())],
        ["別taxonomyの同名タグ", instance(f() + f("100", 'xmlns:jppfs_cor="http://disclosure.edinet-fsa.go.jp/taxonomy/jppfs/2023-12-01/jppfs_cor"'))],
        ["未知namespace", instance(f() + f()).replace('taxonomy/jppfs/2024-11-01/jppfs_cor', 'invalid')]
    ])("%sを先頭採用しない", (_name, xml) => {
        const row = snapshot(xml);
        expect(row.selections[id]!.status).not.toBe("selected");
        expect(json(normalizeFinancialDetailSnapshot(json(row)))).toEqual(json(row));
    });
    it("別期間を採用候補へ混ぜない", () => {
        const row = snapshot(instance(f() + f("101", "", "prior"), context() + context("prior", "", { startDate: "2023-04-01", endDate: "2024-03-31" })));
        expect(row.selections[id]).toMatchObject({ status: "selected", reason: "selected", raw: "100" });
        expect(json(normalizeFinancialDetailSnapshot(row))).toEqual(json(row));
    });
    it.each(["candidate-raw", "candidate-decimals", "candidate-unit", "source", "raw", "reason", "single", "nil", "duplicate-context"])("偽造した%sの採用を拒否", field => {
        const row: any = json(snapshot()), selected = row.selections[id];
        if (field === "candidate-raw") selected.evidence[1].raw = "101";
        if (field === "candidate-decimals") selected.evidence[1].decimals = "0";
        if (field === "candidate-unit") selected.evidence[1].unit = "iso4217:USD";
        if (field === "source") selected.source.contextRef = "missing";
        if (field === "raw") selected.raw = "101";
        if (field === "reason") selected.reason = "selected";
        if (field === "single") selected.evidence.pop();
        if (field === "nil") selected.evidence[1].nil = true;
        if (field === "duplicate-context") selected.evidence[1].reason = "duplicate-context";
        expect(() => normalizeFinancialDetailSnapshot(row)).toThrow();
        expect(() => screenFinancialDetailSnapshots([row], { metricIds: [id] })).toThrow();
    });
    it("他の明細も完全一致だけ採用し、旧JSONの曖昧判定を保持する", () => {
        const row = createFinancialDetailSnapshot(instance(fact("100", "", "jppfs_cor:GrossProfit") + fact("100", "", "jppfs_cor:GrossProfit")), meta(), ["grossProfit"]);
        expect(row.selections.grossProfit).toMatchObject({status:"selected",reason:"selected-identical-duplicates"});
        expect(json(normalizeFinancialDetailSnapshot(row))).toEqual(json(row));
        const legacy:any=json(row);legacy.selections.grossProfit={metricId:"grossProfit",status:"ambiguous",reason:"multiple-facts",evidence:legacy.selections.grossProfit.evidence};
        expect(json(normalizeFinancialDetailSnapshot(legacy))).toEqual(legacy);
        const forged:any=json(row);forged.selections.grossProfit.evidence[1].raw="101";
        expect(() => normalizeFinancialDetailSnapshot(forged)).toThrow();
    });
    it.each(["gte", "lte", "gt", "lt", "eq"] as const)("%sのXML/JSON条件・両順・ページ・欠損を一致", operator => {
        const docs = ["-10", "0", "100"].map((raw, index) => ({ xml: instance(f(raw) + f(raw)), metadata: meta(`100${index + 1}`) }));
        docs.push({ xml: instance(), metadata: meta("1004") });
        const saved = docs.map(d => json(createFinancialDetailSnapshot(d.xml, d.metadata, [id])));
        for (const order of ["asc", "desc"] as const) {
            const options = { metricIds: [id], conditions: [{ metric: id, operator, value: 0 }], sortBy: id, order, offset: 1, limit: 1 };
            expect(json(screenFinancialDetailSnapshots(saved, options))).toEqual(json(screenFinancialDetailDocuments(docs, options)));
        }
    });
    it("XML/保存JSONのCLIを通し、入力は不変", () => {
        const dir = mkdtempSync(join(tmpdir(), "tax-duplicates-"));
        try {
            const xml = instance(f() + f()); writeFileSync(join(dir, "source.xbrl"), xml);
            writeFileSync(join(dir, "files.json"), JSON.stringify([{ file: "source.xbrl", metadata: meta() }]));
            const saved = JSON.stringify([snapshot(xml)]); writeFileSync(join(dir, "rows.json"), saved);
            const run = (args: string[]) => spawnSync(process.execPath, ["--import", resolve("node_modules/tsx/dist/loader.mjs"), resolve("src/cli.ts"), ...args, "--metrics", id, "--sort-by", id], { cwd: "/tmp", encoding: "utf8" });
            const xmlResult = run(["screen-details", "--manifest", join(dir, "files.json")]);
            const jsonResult = run(["screen-details-json", "--file", join(dir, "rows.json")]);
            expect(xmlResult.status, xmlResult.stderr).toBe(0); expect(jsonResult.status, jsonResult.stderr).toBe(0);
            expect(JSON.parse(jsonResult.stdout)).toEqual(JSON.parse(xmlResult.stdout));
            expect(JSON.parse(jsonResult.stdout).total).toBe(1);
            expect(readFileSync(join(dir, "source.xbrl"), "utf8")).toBe(xml);
            expect(readFileSync(join(dir, "rows.json"), "utf8")).toBe(saved);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
});
