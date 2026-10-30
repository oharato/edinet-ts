import { describe, expect, it } from "vitest";
import { createFinancialDetailSnapshot, screenFinancialDetailDocuments, FinancialDetailMetricId,
    FINANCIAL_DETAIL_REGISTRY, FINANCIAL_DETAIL_REGISTRY_VERSION, DEFAULT_FINANCIAL_DETAIL_METRICS,
    type FinancialDetailMetadata, type FinancialDetailDocument } from "../src/index";
import { instance, fact, standalone } from "./fixtures/metric-boundaries";

const mappings = [
    [FinancialDetailMetricId.CommercialPapers, "CommercialPapersLiabilities"],
    [FinancialDetailMetricId.ShortTermBondsPayable, "ShortTermBondsPayable"],
    [FinancialDetailMetricId.ShortTermLoansPayable, "ShortTermLoansPayable"],
    [FinancialDetailMetricId.CurrentPortionOfLongTermLoansPayable, "CurrentPortionOfLongTermLoansPayable"],
    [FinancialDetailMetricId.LongTermLoansPayable, "LongTermLoansPayable"],
    [FinancialDetailMetricId.CurrentPortionOfBonds, "CurrentPortionOfBonds"],
    [FinancialDetailMetricId.BondsPayable, "BondsPayable"],
    [FinancialDetailMetricId.LeaseObligationsCL, "LeaseObligationsCL"],
    [FinancialDetailMetricId.LeaseObligationsNCL, "LeaseObligationsNCL"]
] as const;
const ids = mappings.map(([id]) => id);
const metadata = (code = "1001"): FinancialDetailMetadata => ({ secCode: code, docID: `SYNTHETIC${code}`,
    scope: "Consolidated", accountingStandard: "J-GAAP", currency: "JPY", period: { instant: "2025-03-31" } });
const context = (id = "instant", date = "2025-03-31", scenario = "") =>
    `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="synthetic">COMPANY</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>${date}</xbrli:instant></xbrli:period>${scenario ? `<xbrli:scenario>${scenario}</xbrli:scenario>` : ""}</xbrli:context>`;
const tagFact = (tag: string, raw = "120.5000", attrs = "", ref = "instant") => fact(raw, attrs, `jppfs_cor:${tag}`, ref);
const xml = (raw = "120.5000", omit?: string, extra = "", contexts = context()) =>
    instance(mappings.filter(([id]) => id !== omit).map(([, tag]) => tagFact(tag, raw)).join("") + extra, contexts);
const doc = (code: string, raw: string): FinancialDetailDocument => ({ xml: xml(raw), metadata: metadata(code) });

describe("借入・社債・リースの直接9残高", () => {
    it("辞書v6でも既定5項目の集合を維持する", () => {
        expect(FINANCIAL_DETAIL_REGISTRY_VERSION).toBe("9");
        expect(DEFAULT_FINANCIAL_DETAIL_METRICS).toEqual(["noncurrentAssets", "noncurrentLiabilities", "cashAndDeposits", "costOfSales", "sellingGeneralAndAdministrativeExpenses"]);
        const oldFacts = ["NoncurrentAssets", "NoncurrentLiabilities", "CashAndDeposits"].map(tag => tagFact(tag, "10")).join("");
        const input = xml("100", undefined, oldFacts);
        expect(Object.keys(createFinancialDetailSnapshot(input, metadata()).selections)).toEqual(["noncurrentAssets", "noncurrentLiabilities", "cashAndDeposits"]);
        const result = screenFinancialDetailDocuments([{ xml: input, metadata: metadata() }]);
        expect(result.total).toBe(1);
        expect(Object.keys(result.rows[0].selections)).toHaveLength(3);
        expect(() => screenFinancialDetailDocuments([doc("1001", "100")], { sortBy: ids[0] })).toThrow("metricIds");
    });
    it.each(mappings)("%sは同名の直接タグから原文・単位・出典を返す", (id, tag) => {
        const result = createFinancialDetailSnapshot(xml(), metadata(), [id]).selections[id];
        expect(result).toMatchObject({ status: "selected", raw: "120.5000", safeNumber: 120.5,
            source: { key: `jppfs_cor:${tag}`, namespaceURI: "http://disclosure.edinet-fsa.go.jp/taxonomy/jppfs/2024-11-01/jppfs_cor",
                contextRef: "instant", period: { instant: "2025-03-31" }, entity: { identifier: "COMPANY", scheme: "synthetic" }, unit: "iso4217:JPY" } });
        expect(FINANCIAL_DETAIL_REGISTRY[id]).toMatchObject({ valueType: "decimal", unit: "JPY", periodType: "instant",
            candidates: [{ key: `jppfs_cor:${tag}`, standard: "J-GAAP", supported: true }] });
        expect(result?.evidence).toHaveLength(1);
        expect(Object.isFrozen(FINANCIAL_DETAIL_REGISTRY[id].candidates)).toBe(true);
    });
    it.each(mappings)("%sを残る6項目・関係会社借入・負債合計で代用しない", (id) => {
        const extras = ["ShortTermLoansPayableToSubsidiariesAndAffiliates", "LongTermLoansPayableToSubsidiariesAndAffiliates", "Liabilities", "Borrowings"].map(tag => tagFact(tag, "999")).join("");
        const result = createFinancialDetailSnapshot(xml("120", id, extras), metadata(), ids);
        expect(result.selections[id]).toMatchObject({ status: "missing", reason: "tag-absent" });
        expect(ids.filter(other => other !== id).every(other => result.selections[other]?.status === "selected")).toBe(true);
    });
    it.each(mappings)("%sの0・負数を保存し、unsafe数値は原文だけ保持", (id) => {
        for (const raw of ["0", "-10.25", "9007199254740993"]) {
            expect(createFinancialDetailSnapshot(xml(raw), metadata(), [id]).selections[id]).toMatchObject({ status: "selected", raw,
                safeNumber: raw === "9007199254740993" ? undefined : Number(raw) });
        }
        const result = screenFinancialDetailDocuments([doc("1001", "9007199254740993")], { metricIds: [id], sortBy: id });
        expect(result).toMatchObject({ total: 0, excludedRows: 1, reasonCounts: { "unsafe-number": 1 } });
    });
    it.each(mappings)("%sのnil・未知namespace・重複contextを拒否し、完全一致候補は採用する", (id, tag) => {
        const nil = instance(tagFact(tag, "", 'xsi:nil="true"'), context());
        expect(createFinancialDetailSnapshot(nil, metadata(), [id]).selections[id]).toMatchObject({ status: "missing", reason: "nil" });
        const unknown = xml().replace("http://disclosure.edinet-fsa.go.jp/taxonomy/jppfs/2024-11-01/jppfs_cor", "urn:unknown");
        expect(createFinancialDetailSnapshot(unknown, metadata(), [id]).selections[id]).toMatchObject({ status: "unsupported", reason: "unknown-namespace" });
        expect(createFinancialDetailSnapshot(xml("120", undefined, tagFact(tag, "120")), metadata(), [id]).selections[id]).toMatchObject({ status: "selected", reason: "selected-identical-duplicates" });
        expect(createFinancialDetailSnapshot(xml("120", undefined, "", context().repeat(2)), metadata(), [id]).selections[id]).toMatchObject({ status: "ambiguous", reason: "duplicate-context" });
    });
    it.each(mappings)("%sで連結単体・時点・期間・基準・通貨を代用しない", (id, tag) => {
        const standaloneXml = xml("120", undefined, "", context("instant", "2025-03-31", standalone));
        expect(createFinancialDetailSnapshot(standaloneXml, metadata(), [id]).selections[id]?.status).toBe("missing");
        expect(createFinancialDetailSnapshot(standaloneXml, { ...metadata(), scope: "NonConsolidated" }, [id]).selections[id]?.status).toBe("selected");
        expect(createFinancialDetailSnapshot(xml(), { ...metadata(), period: { instant: "2024-03-31" } }, [id]).selections[id]?.status).toBe("missing");
        const duration = context().replace("<xbrli:instant>2025-03-31</xbrli:instant>", "<xbrli:startDate>2024-04-01</xbrli:startDate><xbrli:endDate>2025-03-31</xbrli:endDate>");
        expect(createFinancialDetailSnapshot(instance(tagFact(tag), duration), metadata(), [id]).selections[id]?.status).toBe("missing");
        expect(createFinancialDetailSnapshot(xml(), { ...metadata(), accountingStandard: "IFRS" }, [id]).selections[id]).toMatchObject({ status: "unsupported", reason: "unsupported-standard" });
        expect(createFinancialDetailSnapshot(xml().replace("iso4217:JPY", "iso4217:USD"), metadata(), [id]).selections[id]).toMatchObject({ status: "unsupported", reason: "unsupported-unit" });
    });
});

describe("7残高を明示した企業比較", () => {
    const operators = [{ operator: "gte", codes: ["10020", "10030"] }, { operator: "gt", codes: ["10030"] },
        { operator: "lte", codes: ["10010", "10020"] }, { operator: "lt", codes: ["10010"] }, { operator: "eq", codes: ["10020"] }] as const;
    it.each(ids.flatMap(id => operators.map(operator => ({ id, ...operator }))))("$id $operatorの境界", ({ id, operator, codes }) => {
        const result = screenFinancialDetailDocuments([doc("1003", "200"), doc("1001", "50"), doc("1002", "100")], {
            metricIds: [id], conditions: [{ metric: id, operator, value: 100 }] });
        expect(result.rows.map(row => row.metadata.secCode)).toEqual(codes);
        expect(result.total + result.filteredRows).toBe(3);
        expect(result.excludedRows).toBe(0);
    });
    it.each(ids)("%sの並び・ページ・返却項目と欠損除外を保つ", id => {
        const documents = [doc("1003", "200"), doc("1001", "50"), doc("1002", "100")];
        for (const order of ["asc", "desc"] as const) {
            const result = screenFinancialDetailDocuments(documents, { metricIds: [id], sortBy: id, order, offset: 1, limit: 1 });
            expect(result.total).toBe(3);
            expect(result.rows.map(row => row.metadata.secCode)).toEqual(["10020"]);
            expect(Object.keys(result.rows[0].selections)).toEqual([id]);
            const complete = screenFinancialDetailDocuments(documents, { metricIds: [id], sortBy: id, order });
            expect(complete.rows.map(row => row.metadata.secCode)).toEqual(order === "asc" ? ["10010", "10020", "10030"] : ["10030", "10020", "10010"]);
        }
        const missing: FinancialDetailDocument = { xml: xml("120", id), metadata: metadata("1004") };
        const result = screenFinancialDetailDocuments([...documents, missing], { metricIds: [id], conditions: [{ metric: id, operator: "gte", value: 0 }] });
        expect(result).toMatchObject({ total: 3, excludedRows: 1, reasonCounts: { missing: 1 } });
        expect(result.diagnostics).toMatchObject([{ metric: id, reason: "missing", selectionReason: "tag-absent", required: true }]);
    });
    it("0と負数の条件を数値として比較し、合計を生成しない", () => {
        const result = screenFinancialDetailDocuments([doc("1001", "-5"), doc("1002", "0"), doc("1003", "5")], {
            metricIds: ids, conditions: [{ metric: ids[0], operator: "lte", value: 0 }], sortBy: ids[0], order: "asc" });
        expect(result.rows.map(row => row.metadata.secCode)).toEqual(["10010", "10020"]);
        expect(Object.keys(result.rows[0].selections)).toEqual(ids);
    });
});
