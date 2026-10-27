import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createFinancialDetailSnapshot, screenFinancialDetailDocuments, FinancialDetailMetricId,
    FINANCIAL_DETAIL_REGISTRY, FINANCIAL_DETAIL_REGISTRY_VERSION, DEFAULT_FINANCIAL_DETAIL_METRICS,
    type FinancialDetailMetadata, type FinancialDetailDocument } from "../src/index";
import { instance, fact } from "./fixtures/metric-boundaries";

const mappings = [
    [FinancialDetailMetricId.GrossProfit, "GrossProfit"],
    [FinancialDetailMetricId.NonOperatingIncome, "NonOperatingIncome"],
    [FinancialDetailMetricId.NonOperatingExpenses, "NonOperatingExpenses"],
    [FinancialDetailMetricId.IncomeBeforeIncomeTaxes, "IncomeBeforeIncomeTaxes"],
    [FinancialDetailMetricId.IncomeTaxes, "IncomeTaxes"]
] as const;
const ids = mappings.map(([id]) => id);
const metadata = (code = "1001"): FinancialDetailMetadata => ({ secCode: code, docID: `SYNTHETIC${code}`,
    scope: "Consolidated", accountingStandard: "J-GAAP", currency: "JPY",
    period: { startDate: "2024-04-01", endDate: "2025-03-31" }, periodType: "annual" });
const context = `<xbrli:context id="duration"><xbrli:entity><xbrli:identifier scheme="synthetic">COMPANY</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2024-04-01</xbrli:startDate><xbrli:endDate>2025-03-31</xbrli:endDate></xbrli:period></xbrli:context>`;
const tagFact = (tag: string, raw = "120.5000", attrs = "") => fact(raw, attrs, `jppfs_cor:${tag}`, "duration");
const xml = (raw = "120.5000", omit?: string, extra = "") =>
    instance(mappings.filter(([, tag]) => tag !== omit).map(([, tag]) => tagFact(tag, raw)).join("") + extra, context,
        '<xbrli:unit id="money"><xbrli:measure>iso4217:JPY</xbrli:measure></xbrli:unit>');
const doc = (code: string, raw: string): FinancialDetailDocument => ({ xml: xml(raw), metadata: metadata(code) });

describe("PL追加明細5項目（売上総利益・営業外収益/費用・税引前・法人税等）", () => {
    it("辞書v6でも既定5項目は不変で、新5項目は明示時だけ返す", () => {
        expect(FINANCIAL_DETAIL_REGISTRY_VERSION).toBe("7");
        expect(DEFAULT_FINANCIAL_DETAIL_METRICS).toEqual(["noncurrentAssets", "noncurrentLiabilities", "cashAndDeposits", "costOfSales", "sellingGeneralAndAdministrativeExpenses"]);
        expect(Object.keys(createFinancialDetailSnapshot(xml(), metadata()).selections).sort()).toEqual(["costOfSales", "sellingGeneralAndAdministrativeExpenses"]);
        expect(Object.keys(createFinancialDetailSnapshot(xml(), metadata(), ids).selections).sort()).toEqual([...ids].sort());
    });
    it.each(mappings)("%sは同名の直接タグから原値・単位・出典を返す", (id, tag) => {
        const result = createFinancialDetailSnapshot(xml(), metadata(), [id]).selections[id];
        expect(result).toMatchObject({ status: "selected", raw: "120.5000", safeNumber: 120.5,
            source: { key: `jppfs_cor:${tag}`, unit: "iso4217:JPY", scope: "Consolidated", period: { startDate: "2024-04-01", endDate: "2025-03-31" } } });
        expect(FINANCIAL_DETAIL_REGISTRY[id]).toMatchObject({ id, periodType: "duration", unit: "JPY", candidates: [{ key: `jppfs_cor:${tag}`, standard: "J-GAAP", supported: true }] });
    });
    it("営業利益・経常利益・特別損益・当期純利益で代用しない", () => {
        const substitutes = xml("120", undefined, "")
            .replace(/<jppfs_cor:(GrossProfit|NonOperatingIncome|NonOperatingExpenses|IncomeBeforeIncomeTaxes|IncomeTaxes) /g, "<jppfs_cor:REMOVED ");
        const withSubs = instance(
            tagFact("OperatingIncome", "999") + tagFact("OrdinaryIncome", "888") + tagFact("ExtraordinaryIncome", "777") + tagFact("ProfitLoss", "666"),
            context, '<xbrli:unit id="money"><xbrli:measure>iso4217:JPY</xbrli:measure></xbrli:unit>');
        void substitutes;
        const result = createFinancialDetailSnapshot(withSubs, metadata(), ids);
        for (const id of ids) expect(result.selections[id]?.status).toBe("missing");
    });
    it("法人税等の負値（還付等）も原値のまま保持し、nilは0にしない", () => {
        const taxes = createFinancialDetailSnapshot(xml("-30"), metadata(), [FinancialDetailMetricId.IncomeTaxes]).selections.incomeTaxes;
        expect(taxes).toMatchObject({ status: "selected", raw: "-30", safeNumber: -30 });
        const nil = createFinancialDetailSnapshot(xml("120", "GrossProfit", tagFact("GrossProfit", "", 'xsi:nil="true"')), metadata(), ids).selections.grossProfit;
        expect(nil).toMatchObject({ status: "missing", reason: "nil" });
    });
    it("同値でも複数factは財務明細では曖昧のまま（税引前だけを除く）", () => {
        const dup = xml("120", undefined, tagFact("GrossProfit", "120"));
        expect(createFinancialDetailSnapshot(dup, metadata(), [FinancialDetailMetricId.GrossProfit]).selections.grossProfit)
            .toMatchObject({ status: "ambiguous", reason: "multiple-facts" });
    });
    it("明示複数社検索の条件・並び・ページ", () => {
        const documents = [doc("1003", "300"), doc("1002", "200"), doc("1001", "200"), doc("1004", "50")];
        const id = FinancialDetailMetricId.GrossProfit;
        expect(screenFinancialDetailDocuments(documents, { metricIds: [id], conditions: [{ metric: id, operator: "gte", value: 200 }] }))
            .toMatchObject({ total: 3, excludedRows: 0, filteredRows: 1 });
        expect(screenFinancialDetailDocuments(documents, { metricIds: [id], sortBy: id, order: "asc", offset: 1, limit: 1 }))
            .toMatchObject({ total: 4, rows: [{ metadata: { secCode: "10010" } }] });
        expect(() => screenFinancialDetailDocuments(documents, { sortBy: id })).toThrow(/metricIds/);
    });
});

describe("実原本fixture（3031ラクーン連結・2024年4月期）でのPL追加明細", () => {
    const xmlText = readFileSync(new URL("./test_data/3031_raccoon.xbrl", import.meta.url), "utf8");
    const meta: FinancialDetailMetadata = { secCode: "3031", docID: "SYNTHETIC-RACCOON", scope: "Consolidated", accountingStandard: "J-GAAP", currency: "JPY",
        period: { startDate: "2023-05-01", endDate: "2024-04-30" }, periodType: "annual" };
    it("売上総利益・営業外収益/費用・法人税等を実値で選ぶ", () => {
        const snapshot = createFinancialDetailSnapshot(xmlText, meta, ids);
        expect(snapshot.selections.grossProfit).toMatchObject({ status: "selected", raw: "4613314000" });
        expect(snapshot.selections.nonOperatingIncome).toMatchObject({ status: "selected", raw: "17817000" });
        expect(snapshot.selections.nonOperatingExpenses).toMatchObject({ status: "selected", raw: "48918000" });
        expect(snapshot.selections.incomeTaxes).toMatchObject({ status: "selected", raw: "209878000" });
    });
    it("税引前はPLとCFの完全一致重複を証跡付きで採用", () => {
        const result = createFinancialDetailSnapshot(xmlText, meta, [FinancialDetailMetricId.IncomeBeforeIncomeTaxes]).selections.incomeBeforeIncomeTaxes!;
        expect(result).toMatchObject({ status: "selected", reason: "selected-identical-duplicates", raw: "535861000" });
        expect(result.evidence.filter(e => e.raw === "535861000").length).toBeGreaterThanOrEqual(2);
    });
});
