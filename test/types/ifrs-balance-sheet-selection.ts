import { EdinetXbrlObject, AccountingStandard, IFRS_BALANCE_SHEET_REGISTRY, IFRS_BALANCE_SHEET_REGISTRY_VERSION, IfrsBalanceSheetMetricId, type FactSelectionResult } from "../../src/index";
function select(object: EdinetXbrlObject) {
    const result: FactSelectionResult<IfrsBalanceSheetMetricId> = object.selectIfrsBalanceSheetMetric(IfrsBalanceSheetMetricId.CurrentLiabilities, {
        accountingStandard: AccountingStandard.IFRS, scope: "Consolidated", period: { instant: "2026-03-31" }
    });
    if (result.status === "selected") { const raw: string = result.raw; void raw; }
    return result;
}
const candidate: string = IFRS_BALANCE_SHEET_REGISTRY.currentLiabilities.candidates[0].key;
const version: string = IFRS_BALANCE_SHEET_REGISTRY_VERSION;
void candidate; void version; void select;
function invalid(object: EdinetXbrlObject) {
    // @ts-expect-error IFRS直接項目以外のIDは指定できない
    object.selectIfrsBalanceSheetMetric("netSales", { accountingStandard: "IFRS", scope: "Consolidated", period: { instant: "2026-03-31" } });
}
void invalid;
