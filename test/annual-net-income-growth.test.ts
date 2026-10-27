import { describe, it, expect } from "vitest";
import { calculateAnnualNetIncomeGrowth, screenAnnualNetIncomeGrowth, type AnnualNetIncomePair } from "../src/index";
import { instance, fact, context } from "./fixtures/metric-boundaries";
function pair(previous = "100", current = "120", code = "1001"): AnnualNetIncomePair {
    const point = (raw: string, startDate: string, endDate: string) => ({
        xml: instance(fact(raw, "", "jppfs_cor:ProfitLossAttributableToOwnersOfParent"), context("current", "", { startDate, endDate })),
        metadata: { secCode: code, docID: `${code}-${endDate}`, accountingStandard: "J-GAAP" as const, scope: "Consolidated" as const, currency: "JPY" as const, periodType: "annual" as const, period: { startDate, endDate } }
    });
    return { previous: point(previous, "2023-04-01", "2024-03-31"), current: point(current, "2024-04-01", "2025-03-31") };
}
describe("親会社株主利益の前年比", () => {
    it("出典付きの別IDで正確な分数を返す", () => expect(calculateAnnualNetIncomeGrowth(pair())).toMatchObject({ metricId: "netIncomeGrowth", status: "calculated", exact: { numerator: "1", denominator: "5" } }));
    it.each([["0", "zero-base"], ["-10", "negative-base"], ["9007199254740993", "unsafe-input"]])("前年%sは%s", (raw, reason) => expect(calculateAnnualNetIncomeGrowth(pair(raw)).reason).toBe(reason));
    it("赤字への変化は符号を保持する", () => expect(calculateAnnualNetIncomeGrowth(pair("100", "-20"))).toMatchObject({ value: -1.2, exact: { numerator: "-6", denominator: "5" } }));
    it("検索・順序・ページ・除外を既存と同じ厳密基盤で処理", () => {
        const result = screenAnnualNetIncomeGrowth([pair("100", "120", "1001"), pair("100", "150", "1002"), pair("0", "100", "1003")], { conditions: [{ metric: "netIncomeGrowth", operator: "gte", value: 0.2 }], order: "desc", limit: 1 });
        expect(result).toMatchObject({ total: 2, excludedRows: 1, rows: [{ current: { metadata: { secCode: "10020" } } }] });
    });
});
