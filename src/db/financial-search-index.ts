import {FINANCIAL_VERSION_POLICY,type FinancialVersionProof,type FinancialVersionDecision,type FinancialVersionRuntimeBinding} from '../financial-version-selection';
import type {SourceBackedArchivedFinancialSnapshots,SourceBackedArchivedFinancialSnapshotOptions} from './observed-financial-archive';
import type { FinancialReportingBasis } from "../financial-reporting-basis";
import { createHash } from "node:crypto";
import { parseDocumentTimestamp as timestamp } from "../document-timestamp";
import type { SQLInputValue } from "node:sqlite";
import { DedicatedSqliteDatabase } from "./dedicated-sqlite";
import { ObservedFinancialArchive, type ArchivedFinancialSnapshotOptions, type ArchivedFinancialSnapshots } from "./observed-financial-archive";
import { BALANCE_SHEET_REGISTRY, type BalanceSheetMetricId } from "../balance-sheet-registry";
import { FINANCIAL_DETAIL_REGISTRY, type FinancialDetailMetricId } from "../financial-detail-registry";
import { IFRS_FINANCIAL_DETAIL_REGISTRY, type IfrsFinancialDetailMetricId } from "../ifrs-financial-detail-registry";
import { toSafeMetricNumber, type FactSelectionResult } from "../metric-selection";
import type { FinancialPeriodType, ComparisonOperator, SortOrder } from "../financial-options";
import { IFRS_BALANCE_SHEET_REGISTRY, type IfrsBalanceSheetMetricId } from "../ifrs-balance-sheet-registry";
export const FINANCIAL_SEARCH_INDEX_VERSION = "1";
export type FinancialIndexMetricId = BalanceSheetMetricId | IfrsBalanceSheetMetricId | FinancialDetailMetricId | IfrsFinancialDetailMetricId;
export interface FinancialIndexCohort {
    generation: string;
    group: "balanceSheet" | "details";
    accountingStandard: "J-GAAP" | "IFRS";
    scope: "Consolidated" | "NonConsolidated";
    currency: "JPY";
    period: {
        instant: string;
        startDate?: never;
        endDate?: never;
    } | {
        startDate: string;
        endDate: string;
        instant?: never;
    };
    periodType?: FinancialPeriodType;
    docIDs?: readonly string[];
}
export interface FinancialIndexSearchOptions {
    metricIds: readonly FinancialIndexMetricId[];
    conditions?: readonly {
        metric: FinancialIndexMetricId;
        operator: ComparisonOperator;
        value: number;
    }[];
    sortBy?: FinancialIndexMetricId;
    order?: SortOrder;
    offset?: number;
    limit?: number;
}
export interface FinancialIndexRow {
    financialVersionDecisionSha256?:string;
    financialVersionEvidenceSha256?:string;
    group: "balanceSheet" | "details";
    rootDocID: string;
    edinetCode: string;
    knownAt: string;
    sourceSha256: string;
    chainDocIDs: string[];
    observationIds: string[];
    snapshot: {
        metadata: Omit<FinancialIndexCohort, "generation" | "group" | "docIDs"> & {
            docID: string;
            secCode: string;
        };
        selections: Partial<Record<FinancialIndexMetricId, FactSelectionResult<FinancialIndexMetricId>>>;
        /** 当期の単体IFRSだけに付く原本DEI証跡。 */
        reportingBasis?: FinancialReportingBasis;
    };
}
export interface FinancialIndexDiagnostic {
    secCode: string;
    docID: string;
    metric: FinancialIndexMetricId;
    reason: "missing" | "unsupported" | "ambiguous" | "unsafe-number";
    selectionReason: string;
    required: boolean;
}
export interface FinancialIndexSearchResult {
    rows: FinancialIndexRow[];
    total: number;
    excludedRows: number;
    filteredRows: number;
    diagnostics: FinancialIndexDiagnostic[];
    reasonCounts: Record<FinancialIndexDiagnostic["reason"], number>;
}
export interface FinancialIndexPopulation {
    asOf: string;
    observedAt: string;
    source: string;
    sourceSha256: string;
    edinetCodes: readonly string[];
}
export interface FinancialIndexAssembly {
    planSha256: string;
    archiveSha256: string;
    population: FinancialIndexPopulation;
    parts: {
        id: string;
        sha256: string;
    }[];
}
interface FinancialIndexGenerationBase {
    id: string;
    indexVersion: "1"|"2";
    assembly?: FinancialIndexAssembly;
    selection: ArchivedFinancialSnapshots["selection"];
    unavailableSources: ArchivedFinancialSnapshots["unavailableSources"];
    provenance: ArchivedFinancialSnapshots["provenance"];
    unresolvedRecords: ArchivedFinancialSnapshots["records"];
    unavailableGroups: {
        docID: string;
        group: string;
        reason: string;
    }[];
    rows: {
        id: string;
        metadata: SQLInputValue[];
        sha256: string;
        metrics: {
            id: string;
            sha256: string;
        }[];
    }[];
}
export interface FinancialIndexGenerationV1 extends FinancialIndexGenerationBase {indexVersion:"1";}
export interface FinancialIndexGenerationV2 extends FinancialIndexGenerationBase {
    indexVersion:"2";
    selectionMode:typeof FINANCIAL_VERSION_POLICY;
    metadataSelection:ArchivedFinancialSnapshots["selection"];
    financialVersionSelection:FinancialVersionDecision[];
    financialVersionProof:FinancialVersionProof;
    provenance:SourceBackedArchivedFinancialSnapshots["provenance"];
}
export type FinancialIndexGeneration=FinancialIndexGenerationV1|FinancialIndexGenerationV2;
export type FinancialIndexQualityState = "available" | "missing" | "unsupported" | "ambiguous" | "unsafe-number";
export type FinancialIndexQualityCounts = Record<FinancialIndexQualityState, number>;
export interface FinancialIndexCohortQuality {
    cohort: Omit<FinancialIndexCohort, "generation" | "docIDs">;
    rows: number;
    companies: number;
    documents: number;
    companiesWithUsableValues: number;
    duplicateCompanies: number;
    duplicateSecurityCodes: number;
    values: FinancialIndexQualityCounts;
    byMetric: {
        metric: FinancialIndexMetricId;
        values: FinancialIndexQualityCounts;
    }[];
}
export interface FinancialIndexQuality {
    financialVersionDecisions?:{selected:number;held:number};
    selectionDecisions: {
        selected: number;
        unresolved: number;
        unavailable: number;
    };
    generation: string;
    generationSha256: string;
    cutoff: string;
    population?: FinancialIndexPopulation;
    populationCompanies?: number;
    companiesWithSelectedDocuments: number;
    companiesWithRows: number;
    companiesWithUsableValues: number;
    companiesWithoutSelectedDocument?: number;
    selectedCompaniesWithoutRows: number;
    selectedDocuments: number;
    documentsWithRows: number;
    selectedDocumentsWithoutRows: number;
    rows: number;
    unavailableSources: {
        reason: string;
        documents: number;
    }[];
    unresolvedRecords: {
        reason: string;
        documents: number;
    }[];
    unavailableGroups: {
        group: string;
        reason: string;
        documents: number;
    }[];
    values: FinancialIndexQualityCounts;
    cohorts: FinancialIndexCohortQuality[];
}
const schema = {
    financial_index_format: "CREATE TABLE financial_index_format(kind TEXT NOT NULL)",
    financial_generations: "CREATE TABLE financial_generations(id TEXT PRIMARY KEY,body TEXT NOT NULL,sha256 TEXT NOT NULL)",
    financial_rows: "CREATE TABLE financial_rows(generation TEXT NOT NULL,row_id TEXT NOT NULL,group_id TEXT NOT NULL,standard TEXT NOT NULL,scope TEXT NOT NULL,currency TEXT NOT NULL,period_start TEXT NOT NULL,period_end TEXT NOT NULL,period_type TEXT NOT NULL,edinet_code TEXT NOT NULL,sec_code TEXT NOT NULL,doc_id TEXT NOT NULL,sha256 TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(generation,row_id))",
    financial_cohort: "CREATE INDEX financial_cohort ON financial_rows(generation,group_id,standard,scope,currency,period_start,period_end,period_type,sec_code,doc_id)",
    financial_values: "CREATE TABLE financial_values(generation TEXT NOT NULL,row_id TEXT NOT NULL,metric_id TEXT NOT NULL,available INTEGER NOT NULL,numeric_value REAL,raw_text TEXT,status TEXT NOT NULL,reason TEXT NOT NULL,failure_kind TEXT,metric_order INTEGER NOT NULL,PRIMARY KEY(generation,row_id,metric_id))",
    financial_metric_range: "CREATE INDEX financial_metric_range ON financial_values(generation,metric_id,available,numeric_value,row_id)"
};
const jsonPrimitive = (v:unknown) => v===null||v===undefined||typeof v==="string"||typeof v==="number"||typeof v==="boolean";
const jsonTuple = (v:unknown):v is unknown[] => Array.isArray(v)&&!("toJSON" in v)&&Array.prototype.every.call(v,jsonPrimitive);
const canonical = (v: unknown): string => {
    // SQL tuples have no object keys to sort; native stringify avoids a replacer per value.
    if(jsonTuple(v)||Array.isArray(v)&&!("toJSON" in v)&&Array.prototype.every.call(v,(x:unknown)=>jsonPrimitive(x)||jsonTuple(x)))return JSON.stringify(v);
    return JSON.stringify(v,(_k,x)=>{
        if(!x||typeof x!=="object"||Array.isArray(x))return x;
        const keys=Object.keys(x);
        if(keys.every((key,i)=>i===0||keys[i-1]<key))return x;
        return Object.fromEntries(keys.sort().map(k=>[k,x[k]]));
    });
};
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export const isFinancialIndexGenerationId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(v);
const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
function flat(v: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k)))
        throw new Error("未知または不正な財務索引入力です");
    return Object.fromEntries(Object.keys(v).map(k => [k, (v as Record<string, unknown>)[k]]));
}
function array<T>(v: readonly T[], max: number): T[] {
    if (!Array.isArray(v))
        throw new Error("配列が必要です");
    const length = v.length;
    if (!Number.isSafeInteger(length) || length < 0 || length > max)
        throw new Error("配列の件数上限を超えています");
    return Array.from({ length }, (_, i) => {
        if (!Object.hasOwn(v, i))
            throw new Error("疎配列は使えません");
        return v[i];
    });
}
const families = (c: Pick<FinancialIndexCohort, "group" | "accountingStandard">): string[] => c.group === "balanceSheet" ? Object.keys(c.accountingStandard === "IFRS" ? IFRS_BALANCE_SHEET_REGISTRY : BALANCE_SHEET_REGISTRY) : c.accountingStandard === "IFRS" ? Object.keys(IFRS_FINANCIAL_DETAIL_REGISTRY) : Object.keys(FINANCIAL_DETAIL_REGISTRY).filter(k => FINANCIAL_DETAIL_REGISTRY[k as FinancialDetailMetricId].periodType === "duration");
export function normalizeFinancialIndexSearch(cohort: FinancialIndexCohort, options: FinancialIndexSearchOptions) {
    const c = flat(cohort, ["generation", "group", "accountingStandard", "scope", "currency", "period", "periodType", "docIDs"]), p = flat(c.period, ["instant", "startDate", "endDate"]);
    if (!isFinancialIndexGenerationId(c.generation) || !["balanceSheet", "details"].includes(c.group as string) || !["J-GAAP", "IFRS"].includes(c.accountingStandard as string) || !["Consolidated", "NonConsolidated"].includes(c.scope as string) || c.currency !== "JPY")
        throw new Error("同一世代・基準・scope・JPYの比較条件が必要です");
    if (c.group === "balanceSheet" ? !date(p.instant) || p.startDate !== undefined || p.endDate !== undefined || c.periodType !== undefined : !date(p.startDate) || !date(p.endDate) || p.startDate > p.endDate || p.instant !== undefined || !["annual", "ytd", "quarterly"].includes(c.periodType as string))
        throw new Error("groupと期間/期間分類が一致しません");
    const docIDs = c.docIDs === undefined ? undefined : array(c.docIDs as string[], 1000);
    if (docIDs !== undefined && (!docIDs.length || new Set(docIDs).size !== docIDs.length || docIDs.some(d => typeof d !== "string" || !d.trim() || d !== d.trim() || d.length > 256 || /[\x00-\x1f\x7f-\x9f]/.test(d))))
        throw new Error("明示書類IDが不正/重複しています");
    const normalized = { ...c, period: p, ...(docIDs === undefined ? {} : { docIDs }) } as unknown as FinancialIndexCohort, known = families(normalized), o = flat(options, ["metricIds", "conditions", "sortBy", "order", "offset", "limit"]), metrics = array(o.metricIds as FinancialIndexMetricId[], 50);
    if (!metrics.length || new Set(metrics).size !== metrics.length || metrics.some(k => !known.includes(k)))
        throw new Error("既知の重複しない項目を明示してください");
    const conditions = array((o.conditions ?? []) as NonNullable<FinancialIndexSearchOptions["conditions"]>, 100).map(v => {
        const k = flat(v, ["metric", "operator", "value"]);
        if (!known.includes(k.metric as string) || !["gte", "lte", "gt", "lt", "eq"].includes(k.operator as string) || typeof k.value !== "number" || !Number.isFinite(k.value) || c.accountingStandard === "IFRS" && Math.abs(k.value) > Number.MAX_SAFE_INTEGER)
            throw new Error("不正な財務数値条件です");
        return k as unknown as {
            metric: FinancialIndexMetricId;
            operator: ComparisonOperator;
            value: number;
        };
    });
    if (o.sortBy !== undefined && !known.includes(o.sortBy as string) || o.order !== undefined && !["asc", "desc"].includes(o.order as string))
        throw new Error("不正な並び指定です");
    for (const v of [o.offset, o.limit])
        if (v !== undefined && (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0))
            throw new Error("ページ指定は0以上の安全な整数です");
    const required = new Set<FinancialIndexMetricId>([...conditions.map(c => c.metric), ...(o.sortBy ? [o.sortBy as FinancialIndexMetricId] : [])]);
    if ([...required].some(k => !metrics.includes(k)))
        throw new Error("条件/並び項目をmetricIdsへ明示してください");
    if (!required.size)
        metrics.forEach(k => required.add(k));
    return { cohort: normalized, metrics, conditions, sortBy: o.sortBy as FinancialIndexMetricId | undefined, order: o.order as SortOrder | undefined, offset: (o.offset ?? 0) as number, limit: o.limit as number | undefined, required };
}
/** 内部共有: 母集団を過去cutoffへ遡及させません。 */
export function normalizeFinancialIndexPopulation(input: FinancialIndexPopulation, cutoff: string): FinancialIndexPopulation {
    const p = flat(input, ["asOf", "observedAt", "source", "sourceSha256", "edinetCodes"]), observed = timestamp(p.observedAt, true), cut = timestamp(cutoff, true), codes = array(p.edinetCodes as string[], 100000);
    if (!date(p.asOf) || observed === undefined || cut === undefined || observed > cut || p.asOf > new Date(cut + 9 * 60 * 60 * 1000).toISOString().slice(0, 10) || typeof p.source !== "string" || !p.source.trim() || p.source.length > 2048 || /[\x00-\x1f\x7f]/.test(p.source) || typeof p.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(p.sourceSha256) || !codes.length || new Set(codes).size !== codes.length || codes.some(c => typeof c !== "string" || !/^E\d{5}$/.test(c)))
        throw new Error("母集団の基準日・実観測・出典/hash・会社指定が不正です");
    return { asOf: p.asOf, observedAt: new Date(observed).toISOString(), source: p.source, sourceSha256: p.sourceSha256, edinetCodes: codes.sort() };
}
export const financialIndexBuildPartId = (planSha256: string, code: string) => "buildpart:" + hash(canonical([planSha256, code]));
export const financialIndexGenerationSha256 = (report: FinancialIndexGeneration) => hash(canonical([report.id, canonical(report)]));
const rowColumns = ["generation", "row_id", "group_id", "standard", "scope", "currency", "period_start", "period_end", "period_type", "edinet_code", "sec_code", "doc_id"];
const valueColumns = ["generation", "row_id", "metric_id", "available", "numeric_value", "raw_text", "status", "reason", "failure_kind", "metric_order"];
function prepare(generation: string, row: FinancialIndexRow) {
    const m = row.snapshot.metadata, body = canonical(row), rowID = hash(canonical([m.docID, row.group])), metadata: SQLInputValue[] = [generation, rowID, row.group, m.accountingStandard, m.scope, m.currency, m.period.startDate ?? "", m.period.endDate ?? m.period.instant!, m.periodType ?? "", row.edinetCode, m.secCode, m.docID], digest = hash(canonical([metadata, body])), ordered = families({ group: row.group, accountingStandard: m.accountingStandard });
    const values = Object.entries(row.snapshot.selections).map(([metric, s]) => {
        if (!s || !ordered.includes(metric) || s.metricId !== metric || !["selected", "missing", "unsupported", "ambiguous"].includes(s.status) || typeof s.reason !== "string" || s.status === "selected" && s.safeNumber !== toSafeMetricNumber(s.raw))
            throw new Error("索引へ保存する直接選択値が不整合です");
        const failure = s.status !== "selected" ? s.status : s.safeNumber === undefined ? "unsafe-number" : null;
        return [generation, rowID, metric, failure === null ? 1 : 0, s.safeNumber ?? null, s.raw ?? null, s.status, s.reason, failure, ordered.indexOf(metric)] as SQLInputValue[];
    });
    return { rowID, metadata, body, digest, values };
}
export function projectFinancialIndexGeneration(generation: string, source: ArchivedFinancialSnapshots) {
    if (!isFinancialIndexGenerationId(generation)) throw new Error("固定世代IDが必要です");
    if ('selectionMode' in source || 'metadataSelection' in source || 'financialVersionProof' in source || 'financialVersionSelection' in source || 'financialVersion' in source.provenance || source.records.some(r=>'financialVersionDecisionSha256' in r || 'financialVersionEvidenceSha256' in r)) throw new Error("金融版の選択結果には専用の世代形式と検証が必要です");
    const projected=projectGeneration(generation,source);
    return {...projected,report:projected.report as FinancialIndexGenerationV1};
}
function projectGeneration(generation:string,source:ArchivedFinancialSnapshots|SourceBackedArchivedFinancialSnapshots){
        const rows: ReturnType<typeof prepare>[] = [], unresolvedRecords: ArchivedFinancialSnapshots["records"] = [], unavailableGroups: FinancialIndexGeneration["unavailableGroups"] = [];
        for (const record of source.records) {
            const r = record.result;
            if (r.status !== "resolved") {
                unresolvedRecords.push(record);
                continue;
            }
            for (const group of ["balanceSheet", "details"] as const) {
                const g = r[group];
                if (g.status !== "created") {
                    unavailableGroups.push({ docID: record.docID, group, reason: g.reason });
                    continue;
                }
                const snapshot = g.snapshot, m = r.basis.metadata, metadata: FinancialIndexRow["snapshot"]["metadata"] = { docID: record.docID, secCode: m.securityCode!, accountingStandard: m.accountingStandard, scope: m.scope, currency: "JPY", period: group === "balanceSheet" ? { instant: m.instant } : { ...m.period }, ...(group === "details" ? { periodType: m.periodType } : {}) };
                rows.push(prepare(generation, { group, rootDocID: record.rootDocID, edinetCode: m.edinetCode, knownAt: record.knownAt, sourceSha256: record.sourceSha256, chainDocIDs: [...record.chainDocIDs], observationIds: [...record.observationIds], ...("financialVersionDecisionSha256" in record ? {financialVersionDecisionSha256:record.financialVersionDecisionSha256,financialVersionEvidenceSha256:record.financialVersionEvidenceSha256}:{}), snapshot: { metadata, selections: snapshot.selections, ...(m.accountingStandard === "IFRS" && m.scope === "NonConsolidated" && "reportingBasis" in snapshot ? { reportingBasis: snapshot.reportingBasis } : {}) } }));
            }
        }
        const report: FinancialIndexGeneration = { id: generation, indexVersion: FINANCIAL_SEARCH_INDEX_VERSION, selection: source.selection, unavailableSources: source.unavailableSources, provenance: source.provenance, unresolvedRecords, unavailableGroups, rows: rows.map(r => ({ id: r.rowID, metadata: r.metadata, sha256: r.digest, metrics: r.values.map(v => ({ id: String(v[2]), sha256: hash(canonical(v)) })) })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
        if("selectionMode" in source){
            const typed:FinancialIndexGenerationV2={...report,indexVersion:"2",selectionMode:source.selectionMode,metadataSelection:source.metadataSelection,financialVersionSelection:source.financialVersionSelection,financialVersionProof:source.financialVersionProof,provenance:source.provenance};
            validateFinancialVersionGeneration(typed);return {report:typed,rows};
        }
        return {report, rows};
}
export function projectSourceBackedFinancialIndexGeneration(generation:string,source:SourceBackedArchivedFinancialSnapshots){
    if(!isFinancialIndexGenerationId(generation)||source.selectionMode!==FINANCIAL_VERSION_POLICY)throw Error("金融版の固定世代IDとpolicyが必要です");
    const projected=projectGeneration(generation,source);
    if(projected.report.indexVersion!=="2")throw Error("金融版の専用世代が必要です");
    return {...projected,report:projected.report};
}
const digestObject=(v:unknown)=>hash(canonical(v));
function validateFinancialVersionGeneration(report:FinancialIndexGeneration){
    if(report.indexVersion==="1"){
        if(['selectionMode','metadataSelection','financialVersionSelection','financialVersionProof'].some(k=>k in report)||'financialVersion' in report.provenance)throw Error("v1世代へ金融版証拠を混在できません");return;
    }
    const p=report.financialVersionProof, pin=report.provenance.financialVersion;
    if(!p||!pin||![p.sha256,p.observationsSha256,p.sourcesSha256,p.evidenceSha256,p.evidenceManifestSha256].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))||report.selectionMode!==FINANCIAL_VERSION_POLICY||p.policy!==report.selectionMode||p.version!=="1"||p.cutoff!==report.selection.cutoff||report.metadataSelection.cutoff!==p.cutoff)throw Error("金融版の形式/policy/cutoffが不一致です");
    const {sha256,...body}=p;
    if(!/^[a-f0-9]{64}$/.test(sha256)||digestObject(body)!==sha256||canonical(pin)!==canonical({policy:p.policy,evidenceManifestSha256:p.evidenceManifestSha256,proofSha256:sha256})||
       p.evidenceManifestSha256!==digestObject({cutoff:p.cutoff,observationsSha256:p.observationsSha256,sourcesSha256:p.sourcesSha256,evidenceSha256:p.evidenceSha256}))throw Error("金融版の証拠指紋が不一致です");
    const proofDecisions=new Map(p.decisions.map(d=>[d.rootDocID,d]));
    if(proofDecisions.size!==p.decisions.length||new Set(report.financialVersionSelection.map(d=>d.rootDocID)).size!==report.financialVersionSelection.length)throw Error("金融版の系列が重複しています");
    for(const d of report.financialVersionSelection){
        if(!['held','selected-source'].includes(d.status)||canonical(d)!==canonical(proofDecisions.get(d.rootDocID)))throw Error("金融版の部分選択と全証拠が不一致です");
        const metadata=report.metadataSelection.decisions.find(m=>m.rootDocID===d.rootDocID),original=p.metadataSelection.decisions.find(m=>m.rootDocID===d.rootDocID);
        if(!metadata||canonical(metadata)!==canonical(original))throw Error("元metadata選択を保持していません");
        if(d.status==='selected-source'){
            const {sha256,...decision}=d;
            if(digestObject(decision)!==sha256||metadata.status!=='unresolved'||metadata.reason!=='multiple-correction-leaves'||d.rootDocID!==d.selected.rootDocID||d.selectedDocID!==d.selected.observation.document.docID||canonical(d.chainDocIDs)!==canonical([d.rootDocID,d.selectedDocID])||canonical(d.selected.chainDocIDs)!==canonical(d.chainDocIDs)||canonical(d.selected.observationIds)!==canonical(d.observationIds)||timestamp(d.knownAt,true)===undefined||timestamp(d.knownAt,true)!>timestamp(p.cutoff,true)!||!d.sourceVersions.some(v=>v.docID===d.selectedDocID))throw Error("金融版の選択来歴が不一致です");
        }
    }
    const chosen=report.financialVersionSelection.filter((d):d is Extract<FinancialVersionDecision,{status:'selected-source'}>=>d.status==='selected-source');
    const expected=[...report.metadataSelection.selected,...chosen.map(d=>d.selected)].sort((a,b)=>a.rootDocID.localeCompare(b.rootDocID));
    const expectedDecisions=report.metadataSelection.decisions.map(original=>{
        const d=chosen.find(d=>d.rootDocID===original.rootDocID);
        return d?{rootDocID:d.rootDocID,status:'selected',reason:'selected',selectedDocID:d.selectedDocID,chainDocIDs:d.chainDocIDs,observationIds:d.observationIds,targetPeriod:d.selected.targetPeriod}:original;
    }).sort((a,b)=>a.rootDocID.localeCompare(b.rootDocID));
    if(canonical([...report.selection.decisions].sort((a,b)=>a.rootDocID.localeCompare(b.rootDocID)))!==canonical(expectedDecisions)||canonical(report.selection.ignored)!==canonical(report.metadataSelection.ignored))throw Error("金融版の有効選択と元metadataが不一致です");
    if(canonical([...report.selection.selected].sort((a,b)=>a.rootDocID.localeCompare(b.rootDocID)))!==canonical(expected))throw Error("金融版の採用集合が不一致です");
    const rootIDs=new Set(report.metadataSelection.decisions.filter(d=>d.status!=='selected'&&proofDecisions.has(d.rootDocID)).map(d=>d.rootDocID));
    if(canonical([...rootIDs].sort())!==canonical(report.financialVersionSelection.map(d=>d.rootDocID).sort()))throw Error("金融版の保留系列が欠落しています");
}
function validateFinancialVersionRow(report:FinancialIndexGeneration,row:FinancialIndexRow){
    if(report.indexVersion==='2'){
        const selected=report.selection.selected.find(s=>s.observation.document.docID===row.snapshot.metadata.docID);
        if(!selected||selected.rootDocID!==row.rootDocID||selected.observation.document.edinetCode!==row.edinetCode||canonical(selected.chainDocIDs)!==canonical(row.chainDocIDs)||canonical(selected.observationIds)!==canonical(row.observationIds))throw Error("財務行と有効な公式系列が不一致です");
    }
    const decision=report.indexVersion==='2'?report.financialVersionSelection.find(d=>d.rootDocID===row.rootDocID&&d.status==='selected-source'):undefined;
    if(!decision||decision.status!=='selected-source'){
        if(row.financialVersionDecisionSha256!==undefined||row.financialVersionEvidenceSha256!==undefined)throw Error("通常財務行に金融版証拠があります");return;
    }
    const source=decision.sourceVersions.find(s=>s.docID===decision.selectedDocID)!;
    const identity=source.identity,m=row.snapshot.metadata;
    const expectedPeriod=row.group==='balanceSheet'?{instant:identity.currentPeriod}:{startDate:identity.fiscalStart,endDate:identity.currentPeriod};
    if(m.accountingStandard!==identity.standard||m.scope!==identity.scope||m.secCode!==identity.security||row.edinetCode!==identity.issuer||m.currency!=='JPY'||canonical(m.period)!==canonical(expectedPeriod)||(row.group==='balanceSheet'?m.periodType!==undefined:m.periodType!==(identity.periodCode==='FY'?'annual':'ytd')))throw Error("財務行と認証済み原本の基準/期間が不一致です");
    if(report.indexVersion!=="2"||row.financialVersionDecisionSha256!==decision.sha256||row.financialVersionEvidenceSha256!==report.financialVersionProof.sha256||row.snapshot.metadata.docID!==decision.selectedDocID||row.edinetCode!==decision.selected.observation.document.edinetCode||row.sourceSha256!==source.sourceSha256||row.knownAt!==decision.knownAt||canonical(row.chainDocIDs)!==canonical(decision.chainDocIDs)||canonical(row.observationIds)!==canonical(decision.observationIds))throw Error("財務行と金融版証拠が不一致です");
}
export const financialIndexSqliteSchema = schema;
export const financialIndexRowColumns = rowColumns;
export const financialIndexValueColumns = valueColumns;
export interface FinancialReadRequest {sql:string;args:SQLInputValue[];}
export type FinancialReadQuery<T> = Generator<FinancialReadRequest,T,Record<string,unknown>[]>;
/** Internal shared validation and SQL for sync SQLite and async DuckDB readers. */
export class FinancialIndexReadQueries {
 constructor(private readonly projectionHeaderLimit:1000|4096=1000){
  if(projectionHeaderLimit!==1000&&projectionHeaderLimit!==4096)throw Error("Invalid financial projection batch size");
 }
 private *rows(sql:string,args:SQLInputValue[]=[]):FinancialReadQuery<Record<string,unknown>[]>{return yield {sql,args};}
    *projectionBatch(table:"financial_rows"|"financial_values",generation:string,columns:readonly string[],after="",metric=""):FinancialReadQuery<Record<string,unknown>[]> {
        // Compute byte lengths in SQL before materializing any large text payload.
        const values=table==="financial_values",fields=values?valueColumns.filter(k=>!["available","numeric_value","metric_order"].includes(k)):[...rowColumns,"sha256","body"],size=fields.map(k=>`edinet_text_bytes(${k})`).join("+"),order=values?"row_id,metric_id":"row_id";
        const headers=yield* this.rows(`SELECT substr(row_id,1,65) AS row_id${values?",substr(metric_id,1,257) AS metric_id":""},${size} AS bytes FROM ${table} WHERE generation=? AND ${values?"(row_id>? OR (row_id=? AND metric_id>?))":"row_id>?"} ORDER BY ${order} LIMIT ${this.projectionHeaderLimit}`,values?[generation,after,after,metric]:[generation,after]);
        if(!headers.length)return [];
        const chosen:Record<string,unknown>[]=[];let bytes=0;
        for(const h of headers){if(typeof h.row_id!=="string"||!/^[a-f0-9]{64}$/.test(h.row_id)||values&&(typeof h.metric_id!=="string"||h.metric_id.length>256)||typeof h.bytes!=="number"||!Number.isSafeInteger(h.bytes)||h.bytes<0||h.bytes>64*1024*1024)throw Error("財務監査の行容量・キーが不正です");if(chosen.length&&bytes+h.bytes>64*1024*1024)break;chosen.push(h);bytes+=h.bytes}
        const keys=values?"(row_id,metric_id)":"row_id",terms=chosen.map(()=>values?"(?,?)":"?").join(","),args=chosen.flatMap(h=>values?[h.row_id,h.metric_id]:[h.row_id]) as SQLInputValue[];
        const batch=yield* this.rows(`SELECT ${columns.join(",")} FROM ${table} WHERE generation=? AND ${keys} IN (${terms}) ORDER BY ${order}`,[generation,...args]);
        if(batch.length!==chosen.length)throw Error("財務監査中に件数が変化しました");return batch;
    }
    private *manifest(generation: string): FinancialReadQuery<FinancialIndexGeneration> {
        const sizes=yield* this.rows("SELECT edinet_text_bytes(body) AS bytes FROM financial_generations WHERE id=?",[generation]);
        if(sizes.length!==1||typeof sizes[0].bytes!=="number"||sizes[0].bytes>64*1024*1024)throw Error("世代が未収録または容量超過です");
        const stored = (yield* this.rows("SELECT * FROM financial_generations WHERE id=?", [generation]))[0];
        if (!stored || typeof stored.body !== "string" || hash(canonical([generation, stored.body])) !== stored.sha256)
            throw new Error("世代が未収録またはhash不一致です");
        const report = JSON.parse(stored.body) as FinancialIndexGeneration;
        if (report.id !== generation || !["1","2"].includes(report.indexVersion))
            throw new Error("世代IDが不整合です");
        validateFinancialVersionGeneration(report);
        return report;
    }
    *audit(generation: string): FinancialReadQuery<FinancialIndexGeneration> {
        const report=yield* this.manifest(generation);
        const expected = new Map(report.rows.map(r=>[r.id,r]));let rowCount=0,after="";
        if(expected.size!==report.rows.length)throw Error("世代の行IDが重複しています");
        for(;;){const rows=yield* this.projectionBatch("financial_rows",generation,[...rowColumns,"sha256",...(report.indexVersion==="2"?["body"]:[])],after);if(!rows.length)break;
            for(const row of rows){const e=expected.get(String(row.row_id));if(!e||canonical(e.metadata)!==canonical(rowColumns.map(c=>row[c]))||row.sha256!==e.sha256)throw Error("財務行の索引が不整合です");if(report.indexVersion==="2"){
                    if(typeof row.body!=="string"||hash(canonical([rowColumns.map(k=>row[k]),row.body]))!==row.sha256)throw Error("金融版財務本文のhash不一致です");
                    const parsed=JSON.parse(row.body) as FinancialIndexRow;validateFinancialVersionRow(report,parsed);const prepared=prepare(generation,parsed);
                    const metricHashes=new Map(e.metrics.map(m=>[m.id,m.sha256]));
                    if(prepared.digest!==row.sha256||metricHashes.size!==prepared.values.length||prepared.values.some(v=>metricHashes.get(String(v[2]))!==hash(canonical(v))))throw Error("金融版財務投影が不一致です");
                }rowCount++}after=String(rows.at(-1)!.row_id);
        }
        if(rowCount!==expected.size)throw Error("世代の行数が不整合です");
        yield* this.auditValues(report);
        return report;
    }
    private *auditValues(report:FinancialIndexGeneration):FinancialReadQuery<void> {
        const generation=report.id,metrics=new Map(report.rows.flatMap(r=>r.metrics.map(m=>[r.id+":"+m.id,m.sha256] as const)));let count=0,metric="",after="";
        if(metrics.size!==report.rows.reduce((n,r)=>n+r.metrics.length,0))throw Error("世代の指標IDが重複しています");
        for(;;){const values=yield* this.projectionBatch("financial_values",generation,valueColumns,after,metric);if(!values.length)break;
            for(const v of values){if(v.numeric_value!==null&&(typeof v.numeric_value!=="number"||!Number.isFinite(v.numeric_value)))throw Error("財務数値の索引が不整合です");if(hash(canonical(valueColumns.map(c=>v[c])))!==metrics.get(v.row_id+":"+v.metric_id))throw Error("財務数値の索引が不整合です");count++}const last=values.at(-1)!;after=String(last.row_id);metric=String(last.metric_id);
        }
        if(count!==metrics.size)throw Error("世代の選択値件数が不整合です");
    }

    *auditSnapshot(id:string):FinancialReadQuery<{generation:FinancialIndexGeneration;quality:FinancialIndexQuality}> {
        if(!isFinancialIndexGenerationId(id))throw Error("世代IDが不正です");
        const generation=yield* this.manifest(id),quality=yield* this.qualityReport(generation);
        yield* this.auditValues(generation);
        return {generation,quality};
    }

 *generation(id:string):FinancialReadQuery<FinancialIndexGeneration>{if(!isFinancialIndexGenerationId(id))throw new Error("世代IDが不正です");return (yield* this.audit(id));}
    *quality(id: string): FinancialReadQuery<FinancialIndexQuality> {
        if (!isFinancialIndexGenerationId(id))
            throw new Error("世代IDが不正です");

        const report=yield* this.audit(id);
        return yield* this.qualityReport(report);
    }
    private *qualityReport(report:FinancialIndexGeneration):FinancialReadQuery<FinancialIndexQuality> {
            const id=report.id,population = report.assembly?.population, owners = population ? new Set(population.edinetCodes) : undefined;
            const selected = report.selection.selected.filter(s => owners === undefined || owners.has(s.observation.document.edinetCode!)), selectedDocs = new Set(selected.map(s => s.observation.document.docID)), selectedCompanies = new Set(selected.map(s => s.observation.document.edinetCode!));
            const empty = (): FinancialIndexQualityCounts => ({ available: 0, missing: 0, unsupported: 0, ambiguous: 0, "unsafe-number": 0 });
            const selectionDecisions = { selected: 0, unresolved: 0, unavailable: 0 };
            for (const d of (report.indexVersion==="2"?report.metadataSelection:report.selection).decisions)
                selectionDecisions[d.status]++;
            const manifests = new Map(report.rows.map(r => [r.id, {metadata:r.metadata,sha256:r.sha256,metrics:new Map(r.metrics.map(m => [m.id, m.sha256]))}]));
            if(manifests.size!==report.rows.length)throw Error("世代の行IDが重複しています");
            const values = empty(), companies = new Set<string>(), usableCompanies = new Set<string>(), documents = new Set<string>();
            const cohorts = new Map<string, {
                cohort: FinancialIndexCohortQuality['cohort'];
                rows: number;
                companies: Map<string, number>;
                securities: Map<string, number>;
                documents: Set<string>;
                usable: Set<string>;
                values: FinancialIndexQualityCounts;
                metrics: Map<FinancialIndexMetricId, FinancialIndexQualityCounts>;
            }>();
            let after = "", rows = 0;
            for (;;) {
                const batch = (yield* this.projectionBatch("financial_rows",id,[...rowColumns,"sha256","body"],after));
                for (const stored of batch) {
                    const manifest = manifests.get(String(stored.row_id));
                    if(!manifest||stored.sha256!==manifest.sha256||canonical(rowColumns.map(k=>stored[k]))!==canonical(manifest.metadata))throw Error("財務行の索引が不整合です");
                    if(typeof stored.body!=="string")throw new Error("品質検査する財務本文のhash不一致です");
                    let row:FinancialIndexRow,prepared:ReturnType<typeof prepare>;
                    try{row=JSON.parse(stored.body) as FinancialIndexRow;prepared=prepare(id,row)}catch{throw new Error("品質検査する財務本文が不正です")}
                    // Exact canonical bytes let the prepared digest also authenticate the stored body.
                    if(prepared.body!==stored.body)throw new Error("品質検査する財務本文のhash不一致です");
                    if(report.indexVersion==="2")validateFinancialVersionRow(report,row);
                    if (!selectedDocs.has(row.snapshot.metadata.docID))
                        throw new Error("財務行が選択書類に含まれていません");
                    if (canonical(prepared.metadata) !== canonical(rowColumns.map(k => stored[k])) || prepared.digest !== stored.sha256)
                        throw new Error("財務本文と索引が不整合です");
                    if (manifest.metrics.size !== prepared.values.length || prepared.values.some(v => manifest.metrics.get(String(v[2])) !== hash(canonical(v))))
                        throw new Error("財務本文と値索引が不整合です");
                    if (owners && !owners.has(row.edinetCode))
                        throw new Error("財務行が固定母集団の対象外です");
                    const { docID, secCode, ...metadata } = row.snapshot.metadata, cohort = { group: row.group, ...metadata }, key = canonical(cohort);
                    let group = cohorts.get(key);
                    if (!group) {
                        group = { cohort, rows: 0, companies: new Map(), securities: new Map(), documents: new Set(), usable: new Set(), values: empty(), metrics: new Map() };
                        cohorts.set(key, group);
                    }
                    rows++;
                    companies.add(row.edinetCode);
                    documents.add(docID);
                    group.rows++;
                    group.companies.set(row.edinetCode, (group.companies.get(row.edinetCode) ?? 0) + 1);
                    group.securities.set(secCode, (group.securities.get(secCode) ?? 0) + 1);
                    group.documents.add(docID);
                    for (const value of prepared.values) {
                        const metric = String(value[2]) as FinancialIndexMetricId, state = (value[8] ?? "available") as FinancialIndexQualityState;
                        if (!Object.hasOwn(values, state))
                            throw new Error("品質分類が不正です");
                        values[state]++;
                        group.values[state]++;
                        const metricCounts = group.metrics.get(metric) ?? empty();
                        metricCounts[state]++;
                        group.metrics.set(metric, metricCounts);
                        if (state === 'available') {
                            usableCompanies.add(row.edinetCode);
                            group.usable.add(row.edinetCode);
                        }
                    }
                }
                if (!batch.length)
                    break;
                after = String(batch.at(-1)!.row_id);
            }
            if(rows!==report.rows.length)throw Error("世代の行数が不整合です");
            const countReasons = (input: {
                reason: string;
                docID: string;
            }[]) => {
                const groups = new Map<string, Set<string>>();
                for (const r of input) {
                    const docs = groups.get(r.reason) ?? new Set<string>();
                    docs.add(r.docID);
                    groups.set(r.reason, docs);
                }
                return [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([reason, docs]) => ({ reason, documents: docs.size }));
            };
            const groups = new Map<string, {
                group: string;
                reason: string;
                docs: Set<string>;
            }>();
            for (const r of report.unavailableGroups) {
                const key = canonical([r.group, r.reason]), bucket = groups.get(key) ?? { group: r.group, reason: r.reason, docs: new Set<string>() };
                bucket.docs.add(r.docID);
                groups.set(key, bucket);
            }
            return { selectionDecisions, ...(report.indexVersion==="2"?{financialVersionDecisions:{selected:report.financialVersionSelection.filter(d=>d.status==='selected-source').length,held:report.financialVersionSelection.filter(d=>d.status==='held').length}}:{}), generation: id, generationSha256: financialIndexGenerationSha256(report), cutoff: report.selection.cutoff, ...(population ? { population, populationCompanies: population.edinetCodes.length, companiesWithoutSelectedDocument: population.edinetCodes.length - selectedCompanies.size } : {}), companiesWithSelectedDocuments: selectedCompanies.size, companiesWithRows: companies.size, companiesWithUsableValues: usableCompanies.size, selectedCompaniesWithoutRows: [...selectedCompanies].filter(c => !companies.has(c)).length, selectedDocuments: selectedDocs.size, documentsWithRows: documents.size, selectedDocumentsWithoutRows: [...selectedDocs].filter(d => !documents.has(d)).length, rows, unavailableSources: countReasons(report.unavailableSources.filter(r => selectedDocs.has(r.docID))), unresolvedRecords: countReasons(report.unresolvedRecords.map(r => ({ docID: r.docID, reason: r.result.status === 'unresolved' ? r.result.reason : r.result.status }))), unavailableGroups: [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, g]) => ({ group: g.group, reason: g.reason, documents: g.docs.size })), values, cohorts: [...cohorts].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, g]) => ({ cohort: g.cohort, rows: g.rows, companies: g.companies.size, documents: g.documents.size, companiesWithUsableValues: g.usable.size, duplicateCompanies: [...g.companies.values()].filter(n => n > 1).length, duplicateSecurityCodes: [...g.securities.values()].filter(n => n > 1).length, values: g.values, byMetric: [...g.metrics].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([metric, counts]) => ({ metric, values: counts })) })) };

    }

    *screen(cohort: FinancialIndexCohort, options: FinancialIndexSearchOptions): FinancialReadQuery<FinancialIndexSearchResult> {
        const q = normalizeFinancialIndexSearch(cohort, options), c = q.cohort, p = c.period;

            (yield* this.audit(c.generation));
            const clause = "r.generation=? AND r.group_id=? AND r.standard=? AND r.scope=? AND r.currency=? AND r.period_start=? AND r.period_end=? AND r.period_type=?" + (c.docIDs ? ` AND r.doc_id IN (${c.docIDs.map(() => "?").join(",")})` : ""), params: SQLInputValue[] = [c.generation, c.group, c.accountingStandard, c.scope, c.currency, p.startDate ?? "", p.endDate ?? p.instant!, c.periodType ?? "", ...(c.docIDs ?? [])];
            const cohortRows = (yield* this.rows(`SELECT r.row_id,r.edinet_code,r.sec_code,r.doc_id FROM financial_rows r WHERE ${clause}`, params)), codes = new Set<string>(), issuers = new Set<string>();
            if (c.docIDs && cohortRows.length !== c.docIDs.length)
                throw new Error("明示書類が対象cohortに保存されていません");
            for (const row of cohortRows) {
                if (codes.has(String(row.sec_code)) || issuers.has(String(row.edinet_code)))
                    throw new Error("同一企業の複数書類は自動選択しません");
                codes.add(String(row.sec_code));
                issuers.add(String(row.edinet_code));
            }
            const marks = q.metrics.map(() => "?").join(","), diagnostics: FinancialIndexDiagnostic[] = [], reasonCounts: FinancialIndexSearchResult["reasonCounts"] = { missing: 0, unsupported: 0, ambiguous: 0, "unsafe-number": 0 };
            const values = (yield* this.rows(`SELECT r.row_id,r.sec_code,r.doc_id,v.metric_id,v.failure_kind,v.reason FROM financial_rows r JOIN financial_values v ON v.generation=r.generation AND v.row_id=r.row_id WHERE ${clause} AND v.metric_id IN (${marks}) ORDER BY r.sec_code,r.doc_id,v.metric_order`, [...params, ...q.metrics]));
            if (values.length !== cohortRows.length * q.metrics.length)
                throw new Error("要求項目の選択記録が保存されていません");
            for (const v of values)
                if (v.failure_kind !== null) {
                    const reason = v.failure_kind as FinancialIndexDiagnostic["reason"];
                    reasonCounts[reason]++;
                    diagnostics.push({ secCode: String(v.sec_code), docID: String(v.doc_id), metric: v.metric_id as FinancialIndexMetricId, reason, selectionReason: String(v.reason), required: q.required.has(v.metric_id as FinancialIndexMetricId) });
                }
            const required = [...q.required], usable = `NOT EXISTS(SELECT 1 FROM financial_values req WHERE req.generation=r.generation AND req.row_id=r.row_id AND req.metric_id IN (${required.map(() => "?").join(",")}) AND req.available=0)`, operators = { gte: ">=", lte: "<=", gt: ">", lt: "<", eq: "=" };
            const predicates = q.conditions.map(condition => `r.row_id IN (SELECT row_id FROM financial_values INDEXED BY financial_metric_range WHERE generation=? AND metric_id=? AND available=1 AND numeric_value ${operators[condition.operator]} ?)`), conditionParams: SQLInputValue[] = q.conditions.flatMap(condition => [c.generation, condition.metric, condition.value]);
            const where = `${clause} AND ${usable}` + (predicates.length ? " AND " + predicates.join(" AND ") : ""), args = [...params, ...required, ...conditionParams], matched = Number((yield* this.rows(`SELECT COUNT(*) AS n FROM financial_rows r WHERE ${where}`, args))[0].n), usableCount = Number((yield* this.rows(`SELECT COUNT(*) AS n FROM financial_rows r WHERE ${clause} AND ${usable}`, [...params, ...required]))[0].n);
            const join = q.sortBy ? " JOIN financial_values ordering ON ordering.generation=r.generation AND ordering.row_id=r.row_id AND ordering.metric_id=?" : "", order = q.sortBy ? `ordering.numeric_value ${q.order === "asc" ? "ASC" : "DESC"},` : "", selected = (yield* this.rows(`SELECT r.* FROM financial_rows r${join} WHERE ${where} ORDER BY ${order}r.sec_code ASC,r.doc_id ASC LIMIT ? OFFSET ?`, [...(q.sortBy ? [q.sortBy] : []), ...args, q.limit ?? -1, q.offset]));
            const rows = selected.map(stored => {
                if (typeof stored.body !== "string" || hash(canonical([rowColumns.map(k => stored[k]), stored.body])) !== stored.sha256)
                    throw new Error("返却する財務本文のhash不一致です");
                const row = JSON.parse(stored.body) as FinancialIndexRow;
                const prepared = prepare(c.generation, row);
                if (canonical(prepared.metadata) !== canonical(rowColumns.map(k => stored[k])) || prepared.digest !== stored.sha256)
                    throw new Error("財務本文と索引の対応が不整合です");
                return { ...row, snapshot: { ...row.snapshot, selections: Object.fromEntries(q.metrics.map(k => [k, row.snapshot.selections[k]])) } };
            });
            return { rows, total: matched, excludedRows: cohortRows.length - usableCount, filteredRows: usableCount - matched, diagnostics, reasonCounts };

    }
}
/** 観測アーカイブを入力に、固定世代の直接財務値をSQLで検索する専用DB。 */
export class FinancialSearchIndex extends DedicatedSqliteDatabase {
    constructor(file: string, options: {
        readOnly?: boolean;
    } = {}) { super(file, options, { table: "financial_index_format", kind: "edinet-ts-financial-search-index-v1", schema }); }
    /** readOnly私有コピーの指紋。書込可能DBとclose後は受け付けません。 */
    snapshotSha256(): string { return this.readOnlySnapshotSha256(); }
    materialize(generation: string, archive: ObservedFinancialArchive, options: ArchivedFinancialSnapshotOptions): FinancialIndexGenerationV1 {
        if (this.closed || this.readOnly)
            throw new Error("close済み/readOnlyの財務索引です");
        if (!isFinancialIndexGenerationId(generation) || !(archive instanceof ObservedFinancialArchive))
            throw new Error("固定世代IDと観測アーカイブが必要です");
        const {report,rows} = projectFinancialIndexGeneration(generation, archive.createSnapshots(options));
        return this.transaction(() => this.writeGeneration(report, rows)) as FinancialIndexGenerationV1;
    }
    materializeSourceBacked(generation:string,archive:ObservedFinancialArchive,options:SourceBackedArchivedFinancialSnapshotOptions,binding:FinancialVersionRuntimeBinding):FinancialIndexGenerationV2 {
        if(this.closed||this.readOnly||!isFinancialIndexGenerationId(generation)||!(archive instanceof ObservedFinancialArchive))throw Error("書込可能な索引と固定世代ID/原本が必要です");
        const {report,rows}=projectSourceBackedFinancialIndexGeneration(generation,archive.createSourceBackedSnapshots(options,binding));
        return this.transaction(()=>this.writeGeneration(report,rows)) as FinancialIndexGenerationV2;
    }
    private writeGeneration(report: FinancialIndexGeneration, rows: ReturnType<typeof prepare>[]): FinancialIndexGeneration {
        const body = canonical(report), digest = financialIndexGenerationSha256(report), generation = report.id;
        const old = this.rows("SELECT * FROM financial_generations WHERE id=?", [generation]);
        if (old.length) {
            this.audit(generation);
            if (old[0].body !== body)
                throw new Error("完了世代の内容は変更できません。別IDを指定してください");
            return JSON.parse(body);
        }
        this.run("INSERT INTO financial_generations VALUES(?,?,?)", [generation, body, digest]);
        for (const r of rows) {
            this.run(`INSERT INTO financial_rows VALUES(${Array.from({ length: 14 }, () => "?").join(",")})`, [...r.metadata, r.digest, r.body]);
            for (const v of r.values)
                this.run(`INSERT INTO financial_values VALUES(${valueColumns.map(() => "?").join(",")})`, v);
        }
        this.audit(generation);
        return JSON.parse(body);
    }
    /** 完了済みの会社別世代を、入力と母集団を固定した一世代へ集約します。 */
    combine(generation: string, partIDs: readonly string[], context: Omit<FinancialIndexAssembly, "parts">): FinancialIndexGeneration {
        if (!isFinancialIndexGenerationId(generation))
            throw new Error("集約世代IDが不正です");
        const parts = array(partIDs, 100000), c = flat(context, ["planSha256", "archiveSha256", "population"]);
        if (!parts.length || new Set(parts).size !== parts.length || parts.some(p => !isFinancialIndexGenerationId(p) || p === generation) || typeof c.planSha256 !== "string" || !/^[a-f0-9]{64}$/.test(c.planSha256) || typeof c.archiveSha256 !== "string" || !/^[a-f0-9]{64}$/.test(c.archiveSha256))
            throw new Error("集約元・計画/原本指紋が不正です");
        const planSha256 = c.planSha256, archiveSha256 = c.archiveSha256;
        return this.transaction(() => {
            const reports = parts.map(id => this.audit(id)), first = reports[0], population = normalizeFinancialIndexPopulation(c.population as FinancialIndexPopulation, first.selection.cutoff), codes = new Set<string>(), owners = new Map<string, string>(), base = ({ edinetCodes: _codes, ...p }: FinancialIndexGeneration["provenance"]) => p;
            const merge = <T>(lists: T[][], key: (v: T) => string): T[] => {
                const map = new Map<string, T>();
                for (const list of lists)
                    for (const item of list) {
                        const k = key(item), old = map.get(k);
                        if (old !== undefined && canonical(old) !== canonical(item))
                            throw new Error("集約元の観測/財務記録が矛盾しています");
                        map.set(k, item);
                    }
                return [...map].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, v]) => v);
            };
            for (let i = 0; i < reports.length; i++) {
                const r = reports[i], owner = r.provenance.edinetCodes;
                if (r.indexVersion!==first.indexVersion || r.assembly || !owner || owner.length !== 1 || codes.has(owner[0]) || parts[i] !== financialIndexBuildPartId(planSha256, owner[0]) || r.selection.cutoff !== first.selection.cutoff || canonical(base(r.provenance)) !== canonical(base(first.provenance)))
                    throw new Error("会社別世代の範囲・cutoff・版が一致しません");
                codes.add(owner[0]);
                owners.set(parts[i], owner[0]);
            }
            if (canonical([...codes].sort()) !== canonical(population.edinetCodes))
                throw new Error("母集団の完了世代が揃っていません");
            const rows: ReturnType<typeof prepare>[] = [];
            for (const part of parts)
                for (const stored of this.rows("SELECT * FROM financial_rows WHERE generation=? ORDER BY row_id", [part])) {
                    if (typeof stored.body !== "string" || hash(canonical([rowColumns.map(k => stored[k]), stored.body])) !== stored.sha256)
                        throw new Error("集約元の財務本文hashが不一致です");
                    const row = JSON.parse(stored.body) as FinancialIndexRow;
                    if (row.edinetCode !== owners.get(part))
                        throw new Error("会社別世代に対象外の財務行があります");
                    rows.push(prepare(generation, row));
                }
            if (new Set(rows.map(r => r.rowID)).size !== rows.length)
                throw new Error("会社別財務行が重複しています");
            const report: FinancialIndexGeneration = { id: generation, indexVersion: FINANCIAL_SEARCH_INDEX_VERSION, assembly: { planSha256, archiveSha256, population, parts: reports.map(r => ({ id: r.id, sha256: financialIndexGenerationSha256(r) })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) },
                selection: { cutoff: first.selection.cutoff, decisions: merge(reports.map(r => r.selection.decisions), r => r.rootDocID), selected: merge(reports.map(r => r.selection.selected), r => r.rootDocID), ignored: merge(reports.map(r => r.selection.ignored), r => r.observationId), financialValuesMerged: false, reconstructedUnobservedHistory: false },
                provenance: { ...first.provenance, edinetCodes: [...population.edinetCodes] }, unavailableSources: merge(reports.map(r => r.unavailableSources), r => r.docID), unresolvedRecords: merge(reports.map(r => r.unresolvedRecords), r => r.docID), unavailableGroups: merge(reports.map(r => r.unavailableGroups), r => r.docID + ":" + r.group),
                rows: rows.map(r => ({ id: r.rowID, metadata: r.metadata, sha256: r.digest, metrics: r.values.map(v => ({ id: String(v[2]), sha256: hash(canonical(v)) })) })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
            if(first.indexVersion==="2"){
                const typedReports=reports as FinancialIndexGenerationV2[];
                if(typedReports.some(r=>canonical(r.financialVersionProof)!==canonical(first.financialVersionProof)))throw Error("金融版の集約証拠が一致しません");
                const typed:FinancialIndexGenerationV2={...report,indexVersion:"2",selectionMode:first.selectionMode,financialVersionProof:first.financialVersionProof,
                    metadataSelection:{...first.metadataSelection,decisions:merge(typedReports.map(r=>r.metadataSelection.decisions),d=>d.rootDocID),selected:merge(typedReports.map(r=>r.metadataSelection.selected),d=>d.rootDocID),ignored:merge(typedReports.map(r=>r.metadataSelection.ignored),d=>d.observationId)},
                    financialVersionSelection:merge(typedReports.map(r=>r.financialVersionSelection),d=>d.rootDocID),provenance:{...first.provenance,edinetCodes:[...population.edinetCodes]}};
                return this.writeGeneration(typed,rows);
            }
            return this.writeGeneration(report, rows);
        });
    }
    /** 集約世代だけを空の利用側DBへ複製し、会社別世代とcheckpointは元DBに保持します。 */
    exportGenerationTo(generation: string, target: FinancialSearchIndex): FinancialIndexGeneration {
        if (!isFinancialIndexGenerationId(generation) || !(target instanceof FinancialSearchIndex) || target === this)
            throw new Error("集約世代IDと別の空の財務索引が必要です");
        // 本文・値索引・母集団を検証してから、同じ世代IDと来歴を保持して転送します。
        this.quality(generation);
        return this.transaction(() => {
            const report = this.audit(generation);
            if (!report.assembly) throw new Error("利用側DBへ転送できるのは集約世代だけです");
            return target.transaction(() => {
                if (target.rows("SELECT id FROM financial_generations LIMIT 1").length ||
                    target.rows("SELECT row_id FROM financial_rows LIMIT 1").length ||
                    target.rows("SELECT row_id FROM financial_values LIMIT 1").length)
                    throw new Error("転送先の財務索引は空でなければなりません");
                const body = canonical(report);
                target.run("INSERT INTO financial_generations VALUES(?,?,?)", [generation, body, financialIndexGenerationSha256(report)]);
                let after = "";
                for (;;) {
                    const batch = this.rows("SELECT * FROM financial_rows WHERE generation=? AND row_id>? ORDER BY row_id LIMIT 100", [generation, after]);
                    for (const stored of batch) {
                        if (typeof stored.body !== "string" || hash(canonical([rowColumns.map(key => stored[key]), stored.body])) !== stored.sha256)
                            throw new Error("転送元の財務本文hashが不一致です");
                        target.run(`INSERT INTO financial_rows VALUES(${Array.from({ length: 14 }, () => "?").join(",")})`,
                            [...rowColumns.map(key => stored[key]), stored.sha256, stored.body] as SQLInputValue[]);
                        for (const value of this.rows(`SELECT ${valueColumns.join(",")} FROM financial_values WHERE generation=? AND row_id=? ORDER BY metric_order`, [generation, String(stored.row_id)]))
                            target.run(`INSERT INTO financial_values VALUES(${valueColumns.map(() => "?").join(",")})`, valueColumns.map(key => value[key]) as SQLInputValue[]);
                    }
                    if (batch.length < 100) break;
                    after = String(batch[batch.length - 1].row_id);
                }
                return target.audit(generation);
            });
        }, false);
    }
    private read<T>(query:FinancialReadQuery<T>):T {
        let step=query.next();while(!step.done)step=query.next(this.rows(step.value.sql.replace(/edinet_text_bytes\((\w+)\)/g,"length(CAST(coalesce($1,'') AS BLOB))"),step.value.args));return step.value;
    }
    private audit(generation:string):FinancialIndexGeneration{return this.read(new FinancialIndexReadQueries().audit(generation));}
    generation(id:string):FinancialIndexGeneration{return this.transaction(()=>this.read(new FinancialIndexReadQueries().generation(id)),false);}
    quality(id:string):FinancialIndexQuality{return this.transaction(()=>this.read(new FinancialIndexReadQueries().quality(id)),false);}
    screen(cohort:FinancialIndexCohort,options:FinancialIndexSearchOptions):FinancialIndexSearchResult{return this.transaction(()=>this.read(new FinancialIndexReadQueries().screen(cohort,options)),false);}

}
