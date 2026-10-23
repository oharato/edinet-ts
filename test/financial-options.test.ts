import { describe, expect, it } from "vitest";
import { AccountingStandard, ComparisonOperator, ConsolidationScope, EdinetXbrlParser, FinancialPeriodType, MetricId, SortOrder,
    screenFinancialSnapshots, type FinancialSnapshot } from "../src/index";
import { context, instance, period, standalone } from "./fixtures/metric-boundaries";

describe("公開APIの補完用入力定数", () => {
    it("既存のJSON値を維持し、定数を変更できない", () => {
        expect(Object.values(ConsolidationScope)).toEqual(["Consolidated", "NonConsolidated"]);
        expect(Object.values(ComparisonOperator)).toEqual(["gte", "lte", "gt", "lt", "eq"]);
        expect(Object.values(SortOrder)).toEqual(["asc", "desc"]);
        expect(Object.values(FinancialPeriodType)).toEqual(["annual", "ytd", "quarterly"]);
        for (const values of [ConsolidationScope, ComparisonOperator, SortOrder, FinancialPeriodType]) expect(Object.isFrozen(values)).toBe(true);
    });
    it("連結/単体の明示指定を補完用定数で選択できる", () => {
        for (const scope of Object.values(ConsolidationScope)) {
            const object = new EdinetXbrlParser().parse(instance(undefined, context("current", scope === ConsolidationScope.NonConsolidated ? standalone : "")));
            expect(object.selectMetric(MetricId.NetSales, { accountingStandard: AccountingStandard.JGAAP, scope, period })).toMatchObject({ status: "selected", source: { scope } });
        }
    });
    const rows: FinancialSnapshot[] = [100, 200].map((netSales, i) => ({
        secCode: `100${i}`, docID: `SYNTHETIC${i}`, docTypeCode: "120", periodEnd: "2025-03-31", submitDate: "2025-06-01",
        periodType: FinancialPeriodType.Annual, metrics: { netSales }
    }));
    it("すべての比較定数で既存の条件と同じ結果になる", () => {
        const expected = [2, 1, 1, 0, 1];
        Object.values(ComparisonOperator).forEach((operator, i) => {
            expect(screenFinancialSnapshots(rows, { conditions: [{ metric: MetricId.NetSales, operator, value: 100 }] })).toHaveLength(expected[i]);
        });
    });
    it("並び順と期間分類の定数も既存の比較規則を維持する", () => {
        expect(screenFinancialSnapshots(rows, { sortBy: MetricId.NetSales, order: SortOrder.Ascending }).map(r => r.metrics.netSales)).toEqual([100, 200]);
        expect(screenFinancialSnapshots(rows, { sortBy: MetricId.NetSales, order: SortOrder.Descending }).map(r => r.metrics.netSales)).toEqual([200, 100]);
        expect(() => screenFinancialSnapshots([rows[0], { ...rows[1], periodType: FinancialPeriodType.YearToDate }])).toThrow("通期・YTD・単四半期");
    });
});
