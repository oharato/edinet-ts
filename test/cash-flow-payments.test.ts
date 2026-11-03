import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { FinancialDetailMetricId as M, FINANCIAL_DETAIL_REGISTRY as R, createFinancialDetailSnapshot,
    normalizeFinancialDetailSnapshot, screenFinancialDetailDocuments, screenFinancialDetailSnapshots, type FinancialDetailMetadata } from "../src/index";
import { instance, fact, context, period, standalone } from "./fixtures/metric-boundaries";
const mappings = [[M.IncomeTaxesPaidCashFlow, "IncomeTaxesPaidOpeCF"], [M.CashDividendsPaidCashFlow, "CashDividendsPaidFinCF"],
    [M.LongTermLoansRepaymentCashFlow, "RepaymentOfLongTermLoansPayableFinCF"]] as const;
const ids = mappings.map(([id]) => id);
const meta = (code = "1001"): FinancialDetailMetadata => ({ secCode: code, docID: `SYNTHETIC${code}`, scope: "Consolidated", accountingStandard: "J-GAAP", currency: "JPY", period, periodType: "annual" });
const xml = (raw = "-100") => instance(mappings.map(([, tag]) => fact(raw, "", `jppfs_cor:${tag}`)).join(""));
const row = (input = xml(), code = "1001") => createFinancialDetailSnapshot(input, meta(code), ids);
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
describe("CF支払・返済の直接3項目", () => {
    it.each(mappings)("%sは%sだけを読み、符号・元値・単位・期間を保持", (id, tag) => {
        expect(row().selections[id]).toMatchObject({ status: "selected", raw: "-100", safeNumber: -100, source: { key: `jppfs_cor:${tag}`, unit: "iso4217:JPY", period } });
        expect(json(normalizeFinancialDetailSnapshot(json(row())))).toEqual(json(row()));
        expect(R[id].periodType).toBe("duration");
    });
    it("法人税費用・還付・純額・非支配株主配当・短期返済を代用しない", () => {
        const tags = ["IncomeTaxes", "IncomeTaxesRefundOpeCF", "IncomeTaxesPaidRefundOpeCF", "DividendsPaidToNonControllingInterestsFinCF", "DecreaseInShortTermLoansPayableFinCF"];
        for (const selection of Object.values(row(instance(tags.map(tag => fact("10", "", `jppfs_cor:${tag}`)).join(""))).selections))
            expect(selection).toMatchObject({ status: "missing", reason: "tag-absent" });
    });
    it.each(["0", "-0", "10", "-10", "9007199254740993"])("raw%sを反転/丸めず保持", raw => {
        const selected = row(xml(raw));
        for (const id of ids) expect(selected.selections[id]).toMatchObject({ status: "selected", raw, safeNumber: raw === "9007199254740993" ? undefined : Number(raw) });
        expect(json(normalizeFinancialDetailSnapshot(json(selected)))).toEqual(json(selected));
    });
    it.each(mappings)("%sのnilは欠損、完全一致重複だけを採用する", (id, tag) => {
        const f = (attrs = "") => fact("", attrs, `jppfs_cor:${tag}`);
        expect(row(instance(f('xsi:nil="true"'))).selections[id]).toMatchObject({ status: "missing", reason: "nil" });
        const duplicate = row(instance(fact("10", "", `jppfs_cor:${tag}`) + fact("10", "", `jppfs_cor:${tag}`)));
        expect(duplicate.selections[id]).toMatchObject({ status: "selected", reason: "selected-identical-duplicates" });
        const conflict=row(instance(fact("10", "", `jppfs_cor:${tag}`) + fact("11", "", `jppfs_cor:${tag}`)));
        expect(conflict.selections[id]).toMatchObject({status:"ambiguous",reason:"multiple-facts"});
        expect(json(normalizeFinancialDetailSnapshot(duplicate))).toEqual(json(duplicate));
    });
    it.each(["scope", "period", "currency", "namespace", "dimensions", "standard"])("%sが違う値を採用しない", kind => {
        let input = xml(); const metadata = meta();
        if (kind === "scope") input = instance(mappings.map(([, tag]) => fact("-100", "", `jppfs_cor:${tag}`)).join(""), context("current", standalone));
        if (kind === "period") metadata.period = { startDate: "2023-04-01", endDate: "2024-03-31" };
        if (kind === "currency") input = input.replace("iso4217:JPY", "iso4217:USD");
        if (kind === "namespace") input = input.replace("taxonomy/jppfs/2024-11-01/jppfs_cor", "invalid");
        if (kind === "dimensions") input = input.replace("</xbrli:context>", '<xbrli:scenario><xbrldi:explicitMember dimension="extension:Axis">extension:Member</xbrldi:explicitMember></xbrli:scenario></xbrli:context>');
        if (kind === "standard") metadata.accountingStandard = "IFRS";
        const snapshot = createFinancialDetailSnapshot(input, metadata, ids);
        for (const value of Object.values(snapshot.selections)) expect(value.status).not.toBe("selected");
        expect(json(normalizeFinancialDetailSnapshot(json(snapshot)))).toEqual(json(snapshot));
    });
    it.each(["gte", "lte", "gt", "lt", "eq"] as const)("%sでXML/JSONの条件・両順・ページを一致", operator => {
        const docs = ["-100", "0", "100"].map((raw, index) => ({ xml: xml(raw), metadata: meta(`100${index + 1}`) }));
        docs.push({ xml: instance(), metadata: meta("1004") });
        const saved = docs.map(d => json(createFinancialDetailSnapshot(d.xml, d.metadata, ids)));
        for (const order of ["asc", "desc"] as const) {
            const options = { metricIds: ids, conditions: [{ metric: ids[0], operator, value: 0 }], sortBy: ids[1], order, offset: 1, limit: 1 };
            expect(json(screenFinancialDetailSnapshots(saved, options))).toEqual(json(screenFinancialDetailDocuments(docs, options)));
        }
    });
    it("CLIの明示projectionとJSON往復・検索で原本不変", () => {
        const dir = mkdtempSync(join(tmpdir(), "cf-payments-"));
        try {
            const input = xml(), saved = JSON.stringify([row()]);
            writeFileSync(join(dir, "source.xbrl"), input); writeFileSync(join(dir, "rows.json"), saved);
            writeFileSync(join(dir, "files.json"), JSON.stringify([{ file: "source.xbrl", metadata: meta() }]));
            const run = (args: string[]) => spawnSync(process.execPath, ["--import", resolve("node_modules/tsx/dist/loader.mjs"), resolve("src/cli.ts"), ...args, "--metrics", ids.join(","), "--sort-by", ids[1]], { cwd: "/tmp", encoding: "utf8" });
            const fromXml = run(["screen-details", "--manifest", join(dir, "files.json")]), fromJson = run(["screen-details-json", "--file", join(dir, "rows.json")]);
            expect(fromXml.status, fromXml.stderr).toBe(0); expect(fromJson.status, fromJson.stderr).toBe(0);
            expect(JSON.parse(fromJson.stdout)).toEqual(JSON.parse(fromXml.stdout));
            expect(Object.keys(JSON.parse(fromXml.stdout).rows[0].selections)).toEqual(ids);
            expect(readFileSync(join(dir, "source.xbrl"), "utf8")).toBe(input); expect(readFileSync(join(dir, "rows.json"), "utf8")).toBe(saved);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
});
