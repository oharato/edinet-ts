import { AccountingStandard, ComparisonOperator, ConsolidationScope, FinancialPeriodType, MetricId, SortOrder,
    screenFinancialSnapshots, type EdinetXbrlObject, type FinancialCondition, type FinancialScreeningOptions, type FinancialSnapshot, type MetricSelectionOptions } from "../../src/index";

declare const object: EdinetXbrlObject;
const options = {
    accountingStandard: AccountingStandard.JGAAP,
    scope: ConsolidationScope.Consolidated,
    period: { startDate: "2024-04-01", endDate: "2025-03-31" }
} satisfies MetricSelectionOptions;

object.selectMetric(MetricId.NetSales, options);
object.selectMetric("netSales", { ...options, accountingStandard: "J-GAAP" });
const metric: MetricId = MetricId.NetSales;
const standard: AccountingStandard = AccountingStandard.IFRS;
object.selectMetric(metric, { ...options, accountingStandard: standard });

// 補完候補の綴り誤りは型エラーになることを固定します。
// @ts-expect-error 存在しない定数member
MetricId.NetSale;
// @ts-expect-error 存在しない会計基準member
AccountingStandard.JGAAPP;
// @ts-expect-error 既存の文字列指定でも誤字を拒否
object.selectMetric("netSale", options);
// @ts-expect-error 会計基準文字列の誤字を拒否
object.selectMetric(MetricId.NetSales, { ...options, accountingStandard: "JGAAP" });

const condition: FinancialCondition = { metric: MetricId.NetSales, operator: ComparisonOperator.GreaterThanOrEqual, value: 0 };
const search: FinancialScreeningOptions = { conditions: [condition], order: SortOrder.Descending };
const periodType: FinancialSnapshot["periodType"] = FinancialPeriodType.YearToDate;
const inferredOptions = {
    conditions: [{ metric: MetricId.NetSales, operator: ComparisonOperator.GreaterThanOrEqual, value: 0 }],
    order: SortOrder.Descending
};
screenFinancialSnapshots([], inferredOptions);
object.selectMetric(MetricId.NetSales, { ...options, scope: ConsolidationScope.NonConsolidated });
// 既存の文字列指定も互換です。
object.selectMetric("netSales", { ...options, scope: "Consolidated" });
// @ts-expect-error 補完用scope memberの誤字
ConsolidationScope.Consolided;
// @ts-expect-error scope文字列の誤字
object.selectMetric(MetricId.NetSales, { ...options, scope: "Consolided" });
// @ts-expect-error 未知の比較演算子
const badCondition: FinancialCondition = { ...condition, operator: "greater" };
// @ts-expect-error 未知の並び順
const badOrder: FinancialScreeningOptions = { ...search, order: "descending" };
// @ts-expect-error 未知の期間分類
const badPeriod: FinancialSnapshot["periodType"] = "yearly";

import { BalanceSheetScreeningMetric, calculateCurrentRatio, screenBalanceSheetSnapshots, type BalanceSheetSnapshot, type BalanceSheetCondition } from "../../src/index";
declare const balanceSheet: BalanceSheetSnapshot;
const currentRatioCondition: BalanceSheetCondition = { metric: BalanceSheetScreeningMetric.CurrentRatio, operator: ComparisonOperator.GreaterThanOrEqual, value: 2 };
screenBalanceSheetSnapshots([balanceSheet], { conditions: [currentRatioCondition], sortBy: BalanceSheetScreeningMetric.CurrentRatio, order: SortOrder.Descending });
const ratio = calculateCurrentRatio(balanceSheet);
if (ratio.status === "calculated") { const value: number = ratio.value; const exact: string = ratio.exact.numerator; }
// @ts-expect-error 計算指標の補完memberの誤字
BalanceSheetScreeningMetric.CurrentRation;
// @ts-expect-error 百分率の別metricや誤字は受け付けない
const wrongRatioCondition: BalanceSheetCondition = { ...currentRatioCondition, metric: "currentRatioPct" };
// @ts-expect-error 計算値を直接factの取得APIへ渡さない
object.selectBalanceSheetMetric(BalanceSheetScreeningMetric.CurrentRatio, { accountingStandard: AccountingStandard.JGAAP, scope: ConsolidationScope.Consolidated, period: { instant: "2025-03-31" } });
