import { BalanceSheetSqliteStore, BalanceSheetScreeningMetric, ComparisonOperator, SortOrder,
    type BalanceSheetSnapshot, type BalanceSheetStoreCohort, type BalanceSheetStoreInput } from "../../src/index";
declare const store: BalanceSheetSqliteStore;
declare const snapshot: BalanceSheetSnapshot;
const input: BalanceSheetStoreInput = { snapshot, provenance: { extractorVersion: "v1", mappingVersion: "1", sourceSha256: "a".repeat(64) } };
const saved = store.putMany([input]);
const cohort = { instant: "2025-03-31", scope: "Consolidated", accountingStandard: "J-GAAP", currency: "JPY", extractorVersion: "v1", mappingVersion: "1" } satisfies BalanceSheetStoreCohort;
store.search({ ...cohort, snapshotIds: saved.ids }, { conditions: [{ metric: BalanceSheetScreeningMetric.CurrentRatio, operator: ComparisonOperator.GreaterThanOrEqual, value: 2 }], order: SortOrder.Descending });
const row = store.get(saved.ids[0]);
if (row) { const raw: string | undefined = row.snapshot.selections.currentAssets.raw; }
// @ts-expect-error 未対応会計基準をDBで混ぜない
store.search({ ...cohort, accountingStandard: "IFRS" });
// @ts-expect-error 単位を推測変換しない
store.search({ ...cohort, currency: "USD" });
// @ts-expect-error 抽出器バージョンは必須
store.putMany([{ snapshot, provenance: { mappingVersion: "1", sourceSha256: "a".repeat(64) } }]);
// @ts-expect-error 検索項目の綴り誤り
store.search(cohort, { sortBy: "currentRation" });

import { planBalanceSheetImport, importBalanceSheets, BalanceSheetImportStatus, type BalanceSheetImportSource } from "../../src/index";
const source: BalanceSheetImportSource = { metadata: { secCode: "1001", docID: "SYNTHETIC1", instant: cohort.instant,
    scope: cohort.scope, accountingStandard: cohort.accountingStandard, currency: cohort.currency }, provenance: input.provenance };
const plan = planBalanceSheetImport(store, [source]);
const status: BalanceSheetImportStatus = plan.items[0].status;
if (status === BalanceSheetImportStatus.Changed) { const ids: string[] = plan.items[0].previousIds; }
const imported = importBalanceSheets(store, [source], () => new Uint8Array());
store.putMany([], { expectedInventoryFingerprint: store.inventory().fingerprint });
// @ts-expect-error 原本はbyte列で渡す
importBalanceSheets(store, [source], () => "XML");
// @ts-expect-error 解析版は必須
planBalanceSheetImport(store, [{ metadata: source.metadata, provenance: { mappingVersion: "1", sourceSha256: "a".repeat(64) } }]);
// @ts-expect-error ステータスの綴り誤り
const invalidStatus: BalanceSheetImportStatus = "change";
