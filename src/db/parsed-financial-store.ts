import {createHash} from 'node:crypto';
import type {SQLInputValue} from 'node:sqlite';
import {parseDocumentTimestamp} from '../document-timestamp';
import {DedicatedSqliteDatabase} from './dedicated-sqlite';
import {normalizeAutomaticFinancialDetailMetricIds, type AutomaticFinancialSnapshotOptions, type AutomaticFinancialSnapshots} from '../automatic-financial-snapshots';
import {toSafeMetricNumber, type FactSelectionResult} from '../metric-selection';
import {FINANCIAL_REPORTING_BASIS_VERSION} from '../financial-reporting-basis';
import {BALANCE_SHEET_REGISTRY, BALANCE_SHEET_REGISTRY_VERSION} from '../balance-sheet-registry';
import {FINANCIAL_DETAIL_REGISTRY, FINANCIAL_DETAIL_REGISTRY_VERSION} from '../financial-detail-registry';
import {IFRS_BALANCE_SHEET_REGISTRY, IFRS_BALANCE_SHEET_REGISTRY_VERSION} from '../ifrs-balance-sheet-registry';
import {IFRS_FINANCIAL_DETAIL_REGISTRY, IFRS_FINANCIAL_DETAIL_REGISTRY_VERSION} from '../ifrs-financial-detail-registry';

export const PARSED_FINANCIAL_STORE_VERSION = '1';
export const parsedFinancialMappingVersions = () => ({basis: FINANCIAL_REPORTING_BASIS_VERSION, balanceSheet: BALANCE_SHEET_REGISTRY_VERSION,
    details: FINANCIAL_DETAIL_REGISTRY_VERSION, ifrsBalanceSheet: IFRS_BALANCE_SHEET_REGISTRY_VERSION, ifrsDetails: IFRS_FINANCIAL_DETAIL_REGISTRY_VERSION});
export interface ParsedFinancialIdentity {
    docID: string;
    sourceSha256: string;
    extractorVersion: string;
    sourceCommit: string;
    mappingVersions: ReturnType<typeof parsedFinancialMappingVersions>;
    detailMetricIds?: AutomaticFinancialSnapshotOptions['detailMetricIds'];
}
export type ParsedFinancialOutcome = {status: 'completed'; result: AutomaticFinancialSnapshots} |
    {status: 'failed'; reason: 'parse-failed' | 'projection-failed'};
export interface ParsedFinancialExtraction {identity: ParsedFinancialIdentity; parsedAt: string; outcome: ParsedFinancialOutcome;}

const maximumBodyBytes = 64 * 1024 * 1024;
const schema = {
    parsed_format: 'CREATE TABLE parsed_format(kind TEXT NOT NULL)',
    parsed_extractions: 'CREATE TABLE parsed_extractions(id TEXT PRIMARY KEY,doc_id TEXT NOT NULL,source_sha256 TEXT NOT NULL,state TEXT NOT NULL,parsed_at TEXT NOT NULL,body TEXT NOT NULL,sha256 TEXT NOT NULL)',
    parsed_by_source: 'CREATE INDEX parsed_by_source ON parsed_extractions(doc_id,source_sha256,id)',
    parsed_rows: 'CREATE TABLE parsed_rows(extraction TEXT NOT NULL,row_id TEXT NOT NULL,group_id TEXT NOT NULL,edinet_code TEXT NOT NULL,sec_code TEXT NOT NULL,standard TEXT NOT NULL,scope TEXT NOT NULL,currency TEXT NOT NULL,period_start TEXT NOT NULL,period_end TEXT NOT NULL,period_type TEXT NOT NULL,amendment_target TEXT,body TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(extraction,row_id))',
    parsed_values: 'CREATE TABLE parsed_values(extraction TEXT NOT NULL,row_id TEXT NOT NULL,metric_id TEXT NOT NULL,metric_order INTEGER NOT NULL,available INTEGER NOT NULL,numeric_value REAL,raw_text TEXT,status TEXT NOT NULL,reason TEXT NOT NULL,failure_kind TEXT,unit TEXT,decimals TEXT,body TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(extraction,row_id,metric_id))'
};
const rowColumns = ['extraction','row_id','group_id','edinet_code','sec_code','standard','scope','currency','period_start','period_end','period_type','amendment_target','body','sha256'];
const valueColumns = ['extraction','row_id','metric_id','metric_order','available','numeric_value','raw_text','status','reason','failure_kind','unit','decimals','body','sha256'];
const compare = (a: unknown,b: unknown) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const isSha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim() === v && !!v.length && v.length <= 256 && !/[\x00-\x1f\x7f-\x9f]/.test(v);
function object(v: unknown): Record<string, unknown> {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('解析済みデータにはobjectが必要です');
    return v as Record<string, unknown>;
}
function keys(v: unknown, allowed: string[]) {
    const record = object(v);
    if (Object.keys(record).some(k => !allowed.includes(k))) throw new Error('未知の解析済みデータ属性です');
    return record;
}
function canonical(v: unknown): string {
    return JSON.stringify(v, (_k, x) => {
        if (typeof x === 'number' && !Number.isFinite(x)) throw new Error('非有限の保存値です');
        return x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x;
    });
}
export function normalizeParsedFinancialIdentity(input: ParsedFinancialIdentity): ParsedFinancialIdentity {
    const v = keys(input, ['docID','sourceSha256','extractorVersion','sourceCommit','mappingVersions','detailMetricIds']);
    if (!text(v.docID) || !isSha(v.sourceSha256) || !text(v.extractorVersion) || typeof v.sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(v.sourceCommit)) throw new Error('書類ID・原本hash・解析版・source commitが不正です');
    const mapping = keys(v.mappingVersions, Object.keys(parsedFinancialMappingVersions()));
    if (Object.keys(mapping).length !== Object.keys(parsedFinancialMappingVersions()).length || Object.values(mapping).some(v => !text(v))) throw new Error('対応表版が不正です');
    const metrics = normalizeAutomaticFinancialDetailMetricIds(v.detailMetricIds as ParsedFinancialIdentity['detailMetricIds']);
    return {docID: v.docID, sourceSha256: v.sourceSha256, extractorVersion: v.extractorVersion, sourceCommit: v.sourceCommit,
        mappingVersions: {...mapping} as ParsedFinancialIdentity['mappingVersions'], ...(metrics ? {detailMetricIds: [...metrics].sort()} : {})};
}
export function parsedFinancialExtractionId(input: ParsedFinancialIdentity): string {return sha(canonical([PARSED_FINANCIAL_STORE_VERSION, normalizeParsedFinancialIdentity(input)]));}
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
function prepare(input: ParsedFinancialExtraction) {
    keys(input, ['identity','parsedAt','outcome']);
    const parsedAt = parseDocumentTimestamp(input.parsedAt,true);
    if (parsedAt === undefined) throw new Error('解析時刻にはtimezone付き日時が必要です');
    const normalizedIdentity = normalizeParsedFinancialIdentity(input.identity), id = parsedFinancialExtractionId(normalizedIdentity);
    const encoded = canonical({identity: normalizedIdentity, parsedAt: new Date(parsedAt).toISOString(), outcome: input.outcome});
    if (Buffer.byteLength(encoded) > maximumBodyBytes) throw new Error('一解析結果は64MiB以下です');
    const normalized = JSON.parse(encoded) as ParsedFinancialExtraction, outcome = normalized.outcome;
    keys(outcome, outcome.status === 'completed' ? ['status','result'] : ['status','reason']);
    const rows: SQLInputValue[][] = [], values: SQLInputValue[][] = [];
    if (outcome.status === 'failed') {
        if (!['parse-failed','projection-failed'].includes(outcome.reason)) throw new Error('未知の解析失敗です');
    } else if (outcome.status === 'completed') {
        const result = outcome.result;
        if (result.inputXmlSha256 !== normalizedIdentity.sourceSha256 || result.targetCurrency !== 'JPY' || result.basis.docID !== normalizedIdentity.docID ||
            result.basis.inputXmlSha256 !== normalizedIdentity.sourceSha256 || result.basis.version !== normalizedIdentity.mappingVersions.basis || !['resolved','unresolved'].includes(result.status)) throw new Error('原本・basis・解析結果が不一致です');
        if (result.status === 'resolved') {
            const basis = result.basis.metadata;
            if (result.basis.status !== 'selected' || basis.accountingStandard !== result.accountingStandard || !/^E\d{5}$/.test(basis.edinetCode) || !basis.securityCode) throw new Error('確定した財務基準が必要です');
            for (const group of ['balanceSheet','details'] as const) {
                const item = result[group];
                if (item.status === 'unavailable') {
                    if (!['current-period-context-absent','duplicate-current-period-context'].includes(item.reason)) throw new Error('未知のgroup保留理由です');
                    continue;
                }
                if (item.status !== 'created') throw new Error('不正な財務groupです');
                const snapshot = item.snapshot;
                if ('inputXmlSha256' in snapshot && snapshot.inputXmlSha256 !== normalizedIdentity.sourceSha256) throw new Error('snapshotの原本hashが不一致です');
                const metadata = 'metadata' in snapshot ? snapshot.metadata : snapshot;
                const period = group === 'balanceSheet' ? {instant: 'instant' in metadata ? metadata.instant : undefined} : 'period' in metadata ? metadata.period : {};
                const start = 'startDate' in period ? period.startDate : '', end = 'instant' in period ? period.instant : 'endDate' in period ? period.endDate : undefined;
                if (!date(end) || group === 'details' && (!date(start) || start > end) || metadata.docID !== normalizedIdentity.docID || metadata.secCode !== basis.securityCode ||
                    metadata.scope !== basis.scope || metadata.accountingStandard !== basis.accountingStandard || metadata.currency !== 'JPY' ||
                    (group === 'balanceSheet' ? end !== basis.instant : start !== basis.period.startDate || end !== basis.period.endDate || !('periodType' in metadata) || metadata.periodType !== basis.periodType)) throw new Error('財務行とbasisの期間・会社・範囲が不一致です');
                const periodType = group === 'balanceSheet' ? '' : basis.periodType;
                const rowId = sha(canonical([group, metadata]));
                const body = canonical(snapshot);
                const row: SQLInputValue[] = [id,rowId,group,basis.edinetCode,metadata.secCode,basis.accountingStandard,basis.scope,'JPY',start ?? '',end,periodType,basis.amendmentTargetDocID ?? null,body];
                rows.push([...row,sha(canonical(row))]);
                const registry = group === 'balanceSheet' ? basis.accountingStandard === 'IFRS' ? IFRS_BALANCE_SHEET_REGISTRY : BALANCE_SHEET_REGISTRY : basis.accountingStandard === 'IFRS' ? IFRS_FINANCIAL_DETAIL_REGISTRY : FINANCIAL_DETAIL_REGISTRY;
                const selections = snapshot.selections as Record<string, FactSelectionResult<string>>;
                if (!Object.keys(selections).length) throw new Error('指標選択がありません');
                if (group === 'details' && normalizedIdentity.detailMetricIds && canonical(Object.keys(selections).sort()) !== canonical(normalizedIdentity.detailMetricIds)) throw new Error('明示項目と保存結果が不一致です');
                for (const metric of Object.keys(selections).sort()) {
                    const selection = selections[metric];
                    if (!Object.hasOwn(registry,metric) || !selection || selection.metricId !== metric || !['selected','missing','unsupported','ambiguous'].includes(selection.status) ||
                        typeof selection.reason !== 'string' || !Array.isArray(selection.evidence)) throw new Error('指標選択が不正です');
                    const selected = selection.status === 'selected';
                    if (selected && (typeof selection.raw !== 'string' || selection.safeNumber !== toSafeMetricNumber(selection.raw) || !selection.source || selection.source.raw !== selection.raw ||
                        !selection.evidence.some(e => canonical(e) === canonical(selection.source)))) throw new Error('原値・検索値・根拠が不一致です');
                    if (!selected && ('raw' in selection || 'safeNumber' in selection || 'source' in selection)) throw new Error('未採用値を補完できません');
                    const failure = !selected ? selection.status : selection.safeNumber === undefined ? 'unsafe-number' : null;
                    const value: SQLInputValue[] = [id,rowId,metric,Object.keys(registry).indexOf(metric),failure === null ? 1 : 0,selection.safeNumber ?? null,selection.raw ?? null,
                        selection.status,selection.reason,failure,selected ? selection.source.unit ?? null : null,selected ? selection.source.decimals ?? null : null,canonical(selection)];
                    values.push([...value,sha(canonical(value))]);
                }
            }
        } else if (!['basis-unresolved','security-code-unavailable','unsupported-ifrs-scope'].includes(result.reason)) throw new Error('未知の解析保留理由です');
    } else throw new Error('未知の解析状態です');
    rows.sort((a,b) => compare(a[1],b[1]));
    values.sort((a,b) => compare(a[1],b[1]) || compare(a[2],b[2]));
    const header: SQLInputValue[] = [id,normalizedIdentity.docID,normalizedIdentity.sourceSha256,outcome.status,normalized.parsedAt,encoded];
    return {id,normalized,rows,values,header: [...header,sha(canonical(header))]};
}

/** 原本とは別の追記Store。通常の読取・転記はXMLを必要としません。 */
export class ParsedFinancialStore extends DedicatedSqliteDatabase {
    constructor(file: string, options: {readOnly?: boolean} = {}) {super(file, options, {table:'parsed_format',kind:'edinet-ts-parsed-financial-v1',schema});}
    private checked(id: string): ParsedFinancialExtraction | undefined {
        if (!isSha(id)) throw new Error('不正な解析IDです');
        const size = this.rows('SELECT length(CAST(body AS BLOB)) AS bytes FROM parsed_extractions WHERE id=?',[id])[0];
        if (size && (typeof size.bytes !== 'number' || size.bytes > maximumBodyBytes)) throw new Error('保存解析結果の容量が不正です');
        const stored = size ? this.rows('SELECT * FROM parsed_extractions WHERE id=?',[id])[0] : undefined;
        if (!stored) {
            if (this.rows('SELECT extraction FROM parsed_rows WHERE extraction=? UNION ALL SELECT extraction FROM parsed_values WHERE extraction=? LIMIT 1',[id,id]).length) throw new Error('解析記録のない子テーブルです');
            return undefined;
        }
        const expected = prepare(JSON.parse(String(stored.body)));
        const columns = ['id','doc_id','source_sha256','state','parsed_at','body','sha256'];
        if (expected.id !== id || canonical(columns.map(k => stored[k])) !== canonical(expected.header)) throw new Error('解析記録のhash・索引が不整合です');
        for (const [table,count] of [['parsed_rows',expected.rows.length],['parsed_values',expected.values.length]] as const) {
            const size = this.rows(`SELECT count(*) AS n,coalesce(sum(length(CAST(body AS BLOB))),0) AS bytes FROM ${table} WHERE extraction=?`,[id])[0];
            if (size.n !== count || typeof size.bytes !== 'number' || size.bytes > maximumBodyBytes) throw new Error('解析済みテーブルの件数・容量が不整合です');
        }
        const rows = this.rows('SELECT * FROM parsed_rows WHERE extraction=? ORDER BY row_id',[id]);
        const values = this.rows('SELECT * FROM parsed_values WHERE extraction=? ORDER BY row_id,metric_id',[id]);
        if (canonical(rows.map(r => rowColumns.map(k => r[k]))) !== canonical(expected.rows) || canonical(values.map(r => valueColumns.map(k => r[k]))) !== canonical(expected.values)) throw new Error('解析済みテーブルが不整合です');
        return expected.normalized;
    }
    put(input: ParsedFinancialExtraction): {id: string; inserted: boolean} {
        const prepared = prepare(input);
        return this.transaction(() => {
            const old = this.checked(prepared.id);
            if (old) {
                if (canonical({...old,parsedAt:null}) !== canonical({...prepared.normalized,parsedAt:null})) throw new Error('同じ原本・版・条件の解析結果が異なります');
                return {id: prepared.id, inserted: false};
            }
            this.run('INSERT INTO parsed_extractions VALUES(?,?,?,?,?,?,?)',prepared.header);
            for (const [table,rows] of [['parsed_rows',prepared.rows],['parsed_values',prepared.values]] as const)
                for (const row of rows) this.run(`INSERT INTO ${table} VALUES(${row.map(()=>'?').join(',')})`,row);
            this.checked(prepared.id);
            return {id: prepared.id, inserted: true};
        });
    }
    get(id: string): ParsedFinancialExtraction | undefined {return this.transaction(() => this.checked(id),false);}
    page(options: {afterId?: string; limit?: number} = {}) {
        keys(options,['afterId','limit']);
        const {afterId,limit=100} = options;
        if (afterId !== undefined && !isSha(afterId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('解析結果のcursor・上限が不正です');
        return this.transaction(() => {
            const ids = this.rows('SELECT id,length(CAST(body AS BLOB)) AS bytes FROM parsed_extractions WHERE id>? ORDER BY id LIMIT ?',[afterId ?? '',limit+1]);
            const records: ({id: string} & ParsedFinancialExtraction)[] = [];
            let bytes = 0;
            for (const row of ids.slice(0,limit)) {
                if (typeof row.bytes !== 'number' || row.bytes > maximumBodyBytes) throw new Error('保存解析結果の容量が不正です');
                if (records.length && bytes + row.bytes > maximumBodyBytes) break;
                records.push({id:String(row.id),...this.checked(String(row.id))!});
                bytes += row.bytes;
            }
            const complete = ids.length <= records.length;
            return {records,complete,...(!complete ? {nextAfterId: records.at(-1)!.id} : {})};
        },false);
    }
    snapshotSha256(): string {return this.readOnlySnapshotSha256();}
}
