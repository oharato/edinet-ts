import { AccountingStandard, MetricId, type EdinetXbrlObject, type MetricSelectionOptions } from "../../src/index";

declare const object: EdinetXbrlObject;
const options = {
    accountingStandard: AccountingStandard.JGAAP,
    scope: "Consolidated",
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
