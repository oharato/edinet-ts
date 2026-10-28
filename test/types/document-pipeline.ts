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


import { extractDisclosureTables, searchDisclosureTableCells, DisclosureTableKind } from "../../src/index";
const rawTables = extractDisclosureTables("xml", { docID: "SAMPLE", kind: DisclosureTableKind.Facilities, contextRef: "filing" });
const rawTableText: string = rawTables.parsedText;
// @ts-expect-error 本文セルを金額へ昇格させない
const unconfirmedAmount: number = rawTables.tables[0].cells[0].value;
searchDisclosureTableCells([], { contains: rawTableText, offset: 0, limit: 100 });

import { extractFacilityDetails, FacilityField, type FacilityDetailDocument } from "../../src/index";
const facilityDocument: FacilityDetailDocument = { xml: "xml", accountingStandard: "J-GAAP", selection: { docID: "SAMPLE", contextRef: "filing", kind: DisclosureTableKind.Facilities }, declarations: [{ tableIndex: 1, asOfDate: "2026-03-31", organization: "reporting-company", rawSha256: "hash" }] };
const facilityValue = extractFacilityDetails(facilityDocument).rows[0].values[FacilityField.TotalBookValueJPY];
if (facilityValue.status === "numeric") { const exactDecimal: string = facilityValue.decimal; }
// @ts-expect-error 非数値の設備欄にdecimalを仮定しない
if (facilityValue.status === "unavailable") { const absentDecimal: string = facilityValue.decimal; }

import { extractMainCustomerDetails, searchMainCustomerDetails, type MainCustomerDocument } from "../../src/index";
const mainCustomerDocument: MainCustomerDocument = { xml: "xml", selection: { docID: "SAMPLE", kind: DisclosureTableKind.MainCustomers, contextRef: "current" }, accountingStandard: "J-GAAP", scope: "Consolidated", proof: { rawSha256: "hash" } };
const customerValue = extractMainCustomerDetails(mainCustomerDocument).rows[0].revenueJPY;
if (customerValue.status === "numeric") { const yenDecimal: string = customerValue.decimal; }
// @ts-expect-error 非数値を売上高0へ補わない
if (customerValue.status === "unavailable") { const missingRevenue: string = customerValue.decimal; }
searchMainCustomerDetails([mainCustomerDocument], { period: { startDate: "2025-04-01", endDate: "2026-03-31" }, scope: "Consolidated" });

import { extractSegmentDetails, searchSegmentDetails, SegmentMetric, type SegmentDetailDocument } from "../../src/index";
const segmentDocument: SegmentDetailDocument = { xml: "xml", selection: { docID: "SAMPLE", kind: DisclosureTableKind.Segments, contextRef: "current" }, accountingStandard: "J-GAAP", declarations: [{ period: { startDate: "2025-04-01", endDate: "2026-03-31" }, tableIndexes: [0, 1], rawSha256: "hash" }] };
const segmentProfit = extractSegmentDetails(segmentDocument).groups[0].columns[0].values[SegmentMetric.ProfitJPY];
if (segmentProfit.status === "numeric") { const profitDecimal: string = segmentProfit.decimal; }
// @ts-expect-error 欠損した行のdecimalを存在すると仮定しない
if (segmentProfit.status === "missing") { const absentProfit: string = segmentProfit.decimal; }
searchSegmentDetails([segmentDocument], { period: { startDate: "2025-04-01", endDate: "2026-03-31" }, role: "reported-segment" });
// @ts-expect-error セグメントと集計の役割を未指定で混ぜない
searchSegmentDetails([segmentDocument], { period: { startDate: "2025-04-01", endDate: "2026-03-31" } });

import { extractAffiliatedCompanies, searchAffiliatedCompanies, AffiliatedRelationship, type AffiliatedCompanyDocument } from "../../src/index";
const affiliateInput: AffiliatedCompanyDocument = { xml: "xml", selection: { docID: "SAMPLE", kind: DisclosureTableKind.AffiliatedEntities, contextRef: "filing" }, reportingPeriodEnd: "2026-03-31", accountingStandard: "J-GAAP", proof: { rawSha256: "hash", indirectIncluded: true }, tables: [{ tableIndex: 0 }] };
const relatedCapital = extractAffiliatedCompanies(affiliateInput).rows[0].capital;
if (relatedCapital.currency !== null && relatedCapital.amount.status === "numeric") { const exactCapital: string = relatedCapital.amount.decimal; }
// @ts-expect-error 未確認の通貨/値をJPYへ置換しない
if (relatedCapital.currency === null) { const unknownAmount = relatedCapital.amount.decimal; }
searchAffiliatedCompanies([affiliateInput], { reportingPeriodEnd: "2026-03-31", relationship: AffiliatedRelationship.Parent, entryKind: "named" });
// @ts-expect-error 関係会社区分と集計/個別を未指定で混ぜない
searchAffiliatedCompanies([affiliateInput], { reportingPeriodEnd: "2026-03-31" });

import { extractOrderDetails, searchOrderDetails, OrderMetric, type OrderDetailDocument, type OrderDetailExtraction } from '../../src/index';
declare const orderDocument: OrderDetailDocument;
const orderExtraction: OrderDetailExtraction = extractOrderDetails(orderDocument);
searchOrderDetails([orderDocument], { period: {startDate:'2025-04-01',endDate:'2026-03-31'}, scope:'NonConsolidated', role:'detail', metric:OrderMetric.OrdersReceivedJPY });
void orderExtraction;

import { extractShareholderCategories, searchShareholderCategories, ShareholderCategory, ShareholderCategoryMetric, type ShareholderCategoryDocument, type ShareholderCategoryExtraction } from 'edinet-ts';
declare const shareholderDocument: ShareholderCategoryDocument;
const shareholderExtraction: ShareholderCategoryExtraction = extractShareholderCategories(shareholderDocument);
searchShareholderCategories([shareholderDocument], {asOf:'2026-03-31',category:ShareholderCategory.ForeignNonIndividuals,metric:ShareholderCategoryMetric.OwnershipPercent});
void shareholderExtraction;

import { extractMajorShareholderDetails, searchMajorShareholderDetails, MajorShareholderTableKind, type MajorShareholderDocument, type MajorShareholderExtraction } from 'edinet-ts';
declare const majorDocument: MajorShareholderDocument;
const majorExtraction: MajorShareholderExtraction = extractMajorShareholderDetails(majorDocument);
searchMajorShareholderDetails([majorDocument],{kind:MajorShareholderTableKind.MajorShareholders,date:{basis:'holding-as-of',value:'2026-03-31'},role:'named',metric:'holdingPercent'});
void majorExtraction;
