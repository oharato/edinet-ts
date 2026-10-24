import { FinancialDetailSqliteStore, FinancialDetailMetricId, ConsolidationScope, AccountingStandard, ComparisonOperator, SortOrder,
    type FinancialDetailSnapshot, type FinancialDetailStoreInput, type FinancialDetailStoreCohort } from "../../src/index";
declare const snapshot: FinancialDetailSnapshot;
const store = new FinancialDetailSqliteStore(":memory:");
const input: FinancialDetailStoreInput = { snapshot, provenance: { extractorVersion: "tested-v1", mappingVersion: "3", sourceSha256: "a".repeat(64) } };
const saved = store.putMany([input]);
const cohort: FinancialDetailStoreCohort = { instant: "2025-03-31", scope: ConsolidationScope.Consolidated, accountingStandard: AccountingStandard.JGAAP,
    currency: "JPY", extractorVersion: input.provenance.extractorVersion, mappingVersion: input.provenance.mappingVersion, snapshotIds: saved.ids };
const result = store.screen(cohort, { metricIds: [FinancialDetailMetricId.CashAndDeposits], conditions: [{ metric: FinancialDetailMetricId.CashAndDeposits, operator: ComparisonOperator.GreaterThanOrEqual, value: 0 }], sortBy: FinancialDetailMetricId.CashAndDeposits, order: SortOrder.Descending });
const raw: string | undefined = result.rows[0]?.selections.cashAndDeposits?.raw;
const stored = store.get(saved.ids[0]);
// @ts-expect-error 保存検索に期間項目のmetadataは渡さない
store.screen({ ...cohort, period: { startDate: "2024-04-01", endDate: "2025-03-31" } });
// @ts-expect-error 対応会計基準を推定しない
store.screen({ ...cohort, accountingStandard: AccountingStandard.IFRS });
// @ts-expect-error JPY以外は推定変換しない
store.screen({ ...cohort, currency: "USD" });
// @ts-expect-error 解析版は必須
store.putMany([{ snapshot, provenance: { mappingVersion: "3", sourceSha256: "a".repeat(64) } }]);
// @ts-expect-error IDは文字列
store.get(123);
store.close();
