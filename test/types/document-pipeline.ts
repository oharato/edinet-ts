import { FinancialDetailGenerations, selectDocumentVersions, measureFinancialDetailCoverage, selectLocalClosingPrice, AuditFeeMetricId, createAuditFeeSnapshot, screenAuditFeeDocuments,
    type FinancialDetailSnapshot, type FinancialDetailGenerationPlan } from "edinet-ts";

declare const snapshot: FinancialDetailSnapshot;
const plan: FinancialDetailGenerationPlan = { id: "verified-v1", keys: ["doc-period"], extractorVersion: "v1", mappingVersion: "6" };
const store = new FinancialDetailGenerations(":memory:");
store.begin(plan);
store.put(plan.id, [{ key: "doc-period", snapshot, provenance: { extractorVersion: "v1", mappingVersion: "6", sourceSha256: "a".repeat(64) } }]);
const remaining: string[] = store.pending(plan.id);
const selection = selectDocumentVersions([], "2026-10-28T00:00:00+09:00");
const coverage = measureFinancialDetailCoverage({ population: { asOf: "2026-10-28", source: "explicit", edinetCodes: [] },
    metadataWindow: { startDate: "2026-10-27", endDate: "2026-10-27", completedDates: [] },
    cohort: { scope: "Consolidated", accountingStandard: "J-GAAP", currency: "JPY", period: { instant: "2026-03-31" } },
    metricIds: ["cashAndDeposits"], documents: [] });
void [remaining, selection.decisions, coverage.counts];
store.close();

const price = selectLocalClosingPrice([], { secCode: "14170", asOf: "2026-10-28", knownAt: "2026-10-28T12:00:00+09:00", source: { name: "explicit", sha256: "a".repeat(64), observedAt: "2026-10-28T11:00:00+09:00" } });
if (price.status === "available") { const value: number = price.close; void value; }

declare const xml: string;
const feeDocument = { xml, metadata: { secCode: "1001", docID: "synthetic", scope: "Consolidated", accountingStandard: "J-GAAP", currency: "JPY", periodType: "annual", period: { startDate: "2024-04-01", endDate: "2025-03-31" } } } as const;
const fee = createAuditFeeSnapshot(feeDocument, AuditFeeMetricId.AuditTotal);
const fees = screenAuditFeeDocuments([feeDocument], AuditFeeMetricId.AuditTotal, { order: "asc" });
void [fee.selection, fees.rows];

import { extractSubsidiaryHumanCapitalMetrics, screenSubsidiaryHumanCapitalMetrics, SubsidiaryHumanCapitalMetricId, type SubsidiaryHumanCapitalMetricDocument } from "edinet-ts";
declare const subsidiary: SubsidiaryHumanCapitalMetricDocument;
extractSubsidiaryHumanCapitalMetrics(subsidiary.xml, subsidiary.metadata);
const subsidiaryRows = screenSubsidiaryHumanCapitalMetrics([subsidiary], SubsidiaryHumanCapitalMetricId.FemaleManagerRatio);
const parsedLabel: string | undefined = subsidiaryRows.rows[0]?.label.parsedLabel;
void parsedLabel;
// @ts-expect-error 提出会社の給与を子会社比率IDへ代用しない
screenSubsidiaryHumanCapitalMetrics([subsidiary], "averageAnnualSalary");
