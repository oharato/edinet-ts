import { describe, it, expect } from "vitest";
import { measureFinancialDetailCoverage, createFinancialDetailSnapshot, type FinancialDetailCoverageInput, type CoverageDocument } from "../src/index";
import { instance, fact } from "./fixtures/metric-boundaries";
const cohort = { scope: "Consolidated" as const, accountingStandard: "J-GAAP" as const, currency: "JPY" as const, period: { instant: "2025-03-31" } };
const context = '<xbrli:context id="current"><xbrli:entity><xbrli:identifier scheme="synthetic">A</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2025-03-31</xbrli:instant></xbrli:period></xbrli:context>';
const snapshot = (raw = "100", extra = "") => createFinancialDetailSnapshot(instance(fact(raw, "", "jppfs_cor:CashAndDeposits") + extra, context), { ...cohort, secCode: "1001", docID: "DOC1" }, ["cashAndDeposits"]);
const input = (documents: CoverageDocument[] = []): FinancialDetailCoverageInput => ({
    population: { asOf: "2026-10-27", source: "synthetic", edinetCodes: ["E00001", "E00002"] },
    metadataWindow: { startDate: "2025-06-23", endDate: "2025-06-24", completedDates: ["2025-06-23", "2025-06-24"] },
    cohort: { ...cohort, period: { ...cohort.period } }, metricIds: ["cashAndDeposits"], documents
});
describe("財務明細の母集団付き充足率", () => {
    it("未取得の一覧と対象窓に書類がないことを区別", () => {
        expect(measureFinancialDetailCoverage(input())).toMatchObject({ cells: 2, counts: { "no-document-in-window": 2 }, metadataWindow: { complete: true } });
        const partial = input(); partial.metadataWindow.completedDates = [];
        expect(measureFinancialDetailCoverage(partial)).toMatchObject({ counts: { "metadata-incomplete": 2 }, metadataWindow: { complete: false } });
    });
    it.each(["not-downloaded", "download-failed", "xbrl-unavailable", "withdrawn", "non-disclosed", "unresolved-document", "parse-failed"] as const)("工程%sを財務欠損と混同しない", state => {
        expect(measureFinancialDetailCoverage(input([{ edinetCode: "E00001", docID: "DOC1", state }])).rows[0].state).toBe(state);
    });
    it("保存済みの値を0件の母集団や一覧欠損で消さず、比較条件を返す", () => {
        const request = input([{ edinetCode: "E00001", docID: "DOC1", state: "parsed", snapshot: snapshot() }]); request.metadataWindow.completedDates = [];
        const result = measureFinancialDetailCoverage(request);
        expect(result).toMatchObject({ counts: { available: 1, "metadata-incomplete": 1 }, population: { companies: 2 }, metadataWindow: { complete: false } });
        request.cohort.period.instant = "2024-03-31";
        expect(result.cohort.period.instant).toBe("2025-03-31");
        request.cohort.period.instant = "2025-03-31";
    });
    it.each(["missing", "ambiguous", "unsafe-number", "not-extracted", "incomparable"])("%sを区別する", state => {
        let row = snapshot();
        if (state === "missing") row = createFinancialDetailSnapshot(instance("", context), { ...cohort, secCode: "1001", docID: "DOC1" }, ["cashAndDeposits"]);
        if (state === "ambiguous") row = snapshot("100", fact("100", "", "jppfs_cor:CashAndDeposits"));
        if (state === "unsafe-number") row = snapshot("9007199254740993");
        if (state === "not-extracted") row = createFinancialDetailSnapshot(instance("", context), { ...cohort, secCode: "1001", docID: "DOC1" }, ["noncurrentAssets"]);
        if (state === "incomparable") row = createFinancialDetailSnapshot(instance("", context), { ...cohort, scope: "NonConsolidated", secCode: "1001", docID: "DOC1" }, ["cashAndDeposits"]);
        expect(measureFinancialDetailCoverage(input([{ edinetCode: "E00001", docID: "DOC1", state: "parsed", snapshot: row }])).rows[0].state).toBe(state);
    });
    it("複数候補を最新と推測せず、重複/母集団外/偽造を拒否", () => {
        const docs: CoverageDocument[] = [{ edinetCode: "E00001", docID: "DOC1", state: "not-downloaded" }, { edinetCode: "E00001", docID: "DOC2", state: "not-downloaded" }];
        expect(measureFinancialDetailCoverage(input(docs)).counts["multiple-documents"]).toBe(1);
        expect(() => measureFinancialDetailCoverage(input([docs[0], docs[0]]))).toThrow();
        expect(() => measureFinancialDetailCoverage(input([{ ...docs[0], edinetCode: "E99999" }]))).toThrow();
        const parsed = snapshot(); parsed.selections.cashAndDeposits!.safeNumber = 999;
        expect(() => measureFinancialDetailCoverage(input([{ ...docs[0], state: "parsed", snapshot: parsed }]))).toThrow();
    });
    it("空母集団は0社とし、欠損を0値や100%へ変えない", () => {
        const request = input(); request.population.edinetCodes = [];
        expect(measureFinancialDetailCoverage(request)).toMatchObject({ cells: 0, population: { companies: 0 }, counts: {}, rows: [] });
    });
});
