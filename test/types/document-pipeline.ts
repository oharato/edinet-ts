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

import { extractLargeHoldingReport, searchLargeHoldingReports, LargeHoldingMetric, type LargeHoldingDocument, type LargeHoldingReport } from 'edinet-ts';
declare const largeDocument: LargeHoldingDocument;
const largeReport: LargeHoldingReport = extractLargeHoldingReport(largeDocument);
searchLargeHoldingReports([largeDocument],{cutoff:'2026-10-28T00:00:00Z',dutyDate:'2025-06-16',scope:'report',metric:LargeHoldingMetric.HoldingPercent});
void largeReport;

import {selectLargeHoldingReportVersions,searchObservedLargeHoldingReports,type ObservedLargeHoldingSource,type LargeHoldingVersionObservation} from "edinet-ts";
declare const holdingObservations: LargeHoldingVersionObservation[];
declare const holdingSources: ObservedLargeHoldingSource[];
const holdingVersions=selectLargeHoldingReportVersions(holdingObservations,"2026-10-28T00:00:00Z");
const observedHolding=searchObservedLargeHoldingReports(holdingObservations,holdingSources,{cutoff:"2026-10-28T00:00:00Z",dutyDate:"2025-06-16",scope:"report",metric:"holdingPercent"});
void [holdingVersions.selected,observedHolding.unavailableSources];

import {extractPolicyShareholdings,searchPolicyShareholdings,type PolicyShareholdingDocument} from "edinet-ts";
declare const policyDocument:PolicyShareholdingDocument;
const policyExtraction=extractPolicyShareholdings(policyDocument);
const policySearch=searchPolicyShareholdings([policyDocument],{kind:"specified",periodEnd:"2026-03-31",metric:"reportedAmount"});
void [policyExtraction.entries,policySearch.excluded];

import {extractOfficerDetails,searchOfficerDetails,type OfficerDocument} from "edinet-ts";
declare const officerDocument:OfficerDocument;
const officers=extractOfficerDetails(officerDocument);
const officerRows=searchOfficerDetails([officerDocument],{status:"as-filed",rosterDate:"2026-06-24",role:"named",metric:"record"});
void [officers.groups,officerRows.rows];

import {extractOfficerRemuneration,searchOfficerRemuneration,type RemunerationDocument} from "edinet-ts";
declare const remunerationDocument:RemunerationDocument;
const remuneration=extractOfficerRemuneration(remunerationDocument);
const remunerationRows=searchOfficerRemuneration([remunerationDocument],{kind:"individual",period:{startDate:"2023-04-01",endDate:"2024-03-31"},role:"detail",metric:"component",componentPath:["株式報酬"],companyContains:"原文"});
void [remuneration.entries,remunerationRows.excluded];

import {IfrsFinancialDetailMetricId,createIfrsFinancialDetailSnapshot,screenIfrsFinancialDetailDocuments,type IfrsFinancialDetailDocument} from "edinet-ts";
declare const ifrsDetail:IfrsFinancialDetailDocument;
const ifrsDetails=createIfrsFinancialDetailSnapshot(ifrsDetail.xml,ifrsDetail.metadata,[IfrsFinancialDetailMetricId.IncomeTaxesPaidCashFlow]);
const ifrsRows=screenIfrsFinancialDetailDocuments([ifrsDetail],{metricIds:["incomeTaxesPaidCashFlow"],conditions:[{metric:"incomeTaxesPaidCashFlow",operator:"lt",value:0}]});
void [ifrsDetails.selections,ifrsRows.diagnostics];

import {resolveFinancialReportingBasis,createAutomaticFinancialSnapshots} from "edinet-ts";
const basis=resolveFinancialReportingBasis(xml,"SAMPLE");
if(basis.status==="selected"){const standard:"J-GAAP"|"IFRS"=basis.metadata.accountingStandard;void standard;}
const automatic=createAutomaticFinancialSnapshots(xml,{docID:"SAMPLE"});
if(automatic.status==="resolved"&&automatic.accountingStandard==="IFRS"&&automatic.details.status==="created"){void automatic.details.snapshot.selections.incomeTaxExpense;}

import {createObservedFinancialSnapshots} from "edinet-ts";
const observedFinancial=createObservedFinancialSnapshots([],[],{cutoff:"2026-10-28T00:00:00Z"});
void observedFinancial.selection.selected.map(s=>s.observation.document.docID);
void observedFinancial.records.map(r=>r.result.status);

import {ObservedFinancialArchive} from "edinet-ts";
const archive=new ObservedFinancialArchive(":memory:");
archive.append([],[]);
void archive.createSnapshots({cutoff:"2026-10-28T00:00:00Z",extractorVersion:"example-1"}).provenance.mappingVersions.ifrsDetails;
archive.close();

import {FinancialSearchIndex, type FinancialIndexSearchResult} from "edinet-ts";
const financialIndex=new FinancialSearchIndex(":memory:");
const indexSource=new ObservedFinancialArchive(":memory:");
financialIndex.materialize("example",indexSource,{cutoff:"2026-10-28T00:00:00Z",extractorVersion:"example"});
const indexed:FinancialIndexSearchResult=financialIndex.screen({generation:"example",group:"details",accountingStandard:"IFRS",scope:"Consolidated",currency:"JPY",period:{startDate:"2025-04-01",endDate:"2026-03-31"},periodType:"annual"},{metricIds:["costOfSales"]});
void indexed.reasonCounts.missing;financialIndex.close();indexSource.close();

import {FinancialIndexBuild,type FinancialIndexBuildInput,type FinancialIndexBuildProgress} from "edinet-ts";
declare const buildInput:FinancialIndexBuildInput;
const buildState=new FinancialIndexBuild(":memory:");
const buildProgress:FinancialIndexBuildProgress=buildState.begin(buildInput);
void buildProgress.plan.population.edinetCodes;void buildProgress.tasks[0]?.partSha256;buildState.close();
const sourcePlan=archive.planSourceAcquisition({cutoff:"2026-10-28T00:00:00Z",edinetCodes:["E12345"]});
const sourceItems:import("edinet-ts").FinancialSourceAcquisitionItem[]=sourcePlan.items;
const acquired:Promise<import("edinet-ts").FinancialSourceAcquisitionResult>=archive.acquireSources({cutoff:"2026-10-28T00:00:00Z"},async(_id,request)=>{request.signal?.throwIfAborted();return "<x/>";},{limit:1});
void sourceItems;void acquired;
import {FinancialSourceJob,type FinancialSourceJobInput,type FinancialSourceJobProgress} from 'edinet-ts';
const sourceJob=new FinancialSourceJob(':memory:');
const sourceJobInput:FinancialSourceJobInput={id:'job',cutoff:'2026-10-28T00:00:00Z',population:buildInput.population};
const sourceJobPlan:FinancialSourceJobProgress=sourceJob.begin(sourceJobInput,indexSource);
const sourceJobRun:Promise<FinancialSourceJobProgress&{aborted:boolean}>=sourceJob.runNext('job',indexSource,async()=>'<x/>');
void sourceJobPlan;void sourceJobRun;
import {backfillFinancialDocumentLists,archiveFinancialDocumentObservations,type FinancialListBackfillResult,type FinancialObservationTransferResult} from 'edinet-ts';
import {EdinetRepository} from 'edinet-ts';
const listRepository=new EdinetRepository(':memory:');
const backed:Promise<FinancialListBackfillResult>=backfillFinancialDocumentLists(listRepository,async()=>[],{startDate:'2026-06-24',endDate:'2026-06-25'});
const transferred:FinancialObservationTransferResult=archiveFinancialDocumentObservations(listRepository,archive,{sourceId:'source'});
void backed;void transferred;
const indexQuality:import('edinet-ts').FinancialIndexQuality=financialIndex.quality('generation');
void indexQuality;
import {FinancialIndexPublication,type FinancialIndexPublicationCandidate} from 'edinet-ts';
const publication=new FinancialIndexPublication(':memory:');
const candidate:FinancialIndexPublicationCandidate=publication.prepare('candidate',financialIndex,'generation');
publication.activate(candidate.id,financialIndex,{expectedActive:null});
const resolved:FinancialIndexPublicationCandidate|undefined=publication.resolve(financialIndex);
void resolved;
import {PublishedFinancialIndex,type PublishedFinancialIndexSearchResult,type PublishedFinancialIndexSnapshot} from 'edinet-ts';
const published=new PublishedFinancialIndex('catalog.sqlite','index.sqlite');
const publishedSnapshot:PublishedFinancialIndexSnapshot=published.snapshot();
const publishedResult:PublishedFinancialIndexSearchResult=published.screen({group:'balanceSheet',accountingStandard:'J-GAAP',scope:'Consolidated',currency:'JPY',period:{instant:'2026-03-31'}},{metricIds:['currentAssets']});
void publishedSnapshot;void publishedResult;
