import {createHash} from 'node:crypto';
import {DedicatedSqliteDatabase} from './dedicated-sqlite';
import {queryCompanyMaster, type CompanyMasterSnapshot, type CompanyMasterQuery} from '../company-master';
import {compareCompanyMasterSnapshots} from '../company-master-changes';
const schema = {
    master_format: 'CREATE TABLE master_format(kind TEXT NOT NULL)',
    master_observations: 'CREATE TABLE master_observations(id TEXT PRIMARY KEY,source_url TEXT NOT NULL,as_of TEXT NOT NULL,observed_ms INTEGER NOT NULL,body TEXT NOT NULL,sha256 TEXT NOT NULL)',
    master_by_time: 'CREATE INDEX master_by_time ON master_observations(source_url,as_of,observed_ms)'
};
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const canonical = (v: unknown): string => JSON.stringify(v, (_k,x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k,x[k]])) : x);
function source(value: unknown): string {
    if (typeof value !== 'string') throw Error('出典URLが必要です');
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('認証情報のないHTTPS出典が必要です');
    return url.href;
}
function normalize(input: CompanyMasterSnapshot): CompanyMasterSnapshot {
    const s = structuredClone(input);
    if (!s || typeof s !== 'object' || Array.isArray(s) || Object.keys(s).some(k => !['asOf','observedAt','sourceUrl','sourceSha256','archiveSha256','originalCsvSha256','records'].includes(k)) || !Array.isArray(s.records) || s.records.length > 100000) throw Error('完全な企業マスター観測が必要です');
    for (const row of s.records) if (!row || Object.keys(row).some(k => !['entityId','edinetCode','securityCode','corporateNumber','name','filerType','listingStatus','industry','fiscalYearEndRaw','fiscalYearEndMonth'].includes(k))) throw Error('企業マスターの列が不正です');
    for (const value of [s.archiveSha256,s.originalCsvSha256]) if (value !== undefined && (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) throw Error('元ファイルhashが不正です');
    s.sourceUrl = source(s.sourceUrl);
    const result = queryCompanyMaster([s],{asOf:s.asOf,knownAt:s.observedAt});
    if (result.status !== 'available') throw Error('企業マスター観測を確定できません');
    const normalized = {...s,observedAt:new Date(s.observedAt).toISOString(),records:result.rows};
    if (Buffer.byteLength(canonical(normalized)) > 64*1024*1024) throw Error('企業マスター観測は64MiB以下です');
    return normalized;
}
const identity = (s: CompanyMasterSnapshot) => hash(canonical([s.sourceUrl,s.asOf,Date.parse(s.observedAt)]));
export interface CompanyMasterObservation {
    id: string; asOf: string; observedAt: string; sourceUrl: string; sourceSha256: string;
    archiveSha256?: string; originalCsvSha256?: string; snapshotSha256: string; records: number;
}
/** 完全リストの観測を追記保存。法的イベントの発生日は再構成しません。 */
export class CompanyMasterStore extends DedicatedSqliteDatabase {
    constructor(file: string, options: {readOnly?: boolean} = {}) {
        super(file,options,{table:'master_format',kind:'edinet-ts-company-master-v1',schema});
    }
    private decode(row: Record<string,unknown>): CompanyMasterSnapshot {
        if (typeof row.body !== 'string' || Buffer.byteLength(row.body)>64*1024*1024 || hash(row.body)!==row.sha256) throw Error('企業マスター本文のhashが不一致です');
        const s = normalize(JSON.parse(row.body));
        if (canonical(s)!==row.body || identity(s)!==row.id || s.sourceUrl!==row.source_url || s.asOf!==row.as_of || Date.parse(s.observedAt)!==row.observed_ms) throw Error('企業マスター本文/索引が不一致です');
        return s;
    }
    private verifyIndex() {
        for (const row of this.rows('SELECT id,source_url,as_of,observed_ms FROM master_observations')) {
            if (typeof row.source_url!=='string' || source(row.source_url)!==row.source_url || typeof row.as_of!=='string' || !Number.isSafeInteger(row.observed_ms) || hash(canonical([row.source_url,row.as_of,row.observed_ms]))!==row.id) throw Error('企業マスター観測索引が不正です');
        }
    }
    private *snapshotsForSource(url: string) {
        // 年単位の履歴でも、検査用に全本文を同時に保持しない。
        for (const row of this.rows('SELECT id FROM master_observations WHERE source_url=? ORDER BY as_of,observed_ms,id',[url])) {
            yield this.decode(this.rows('SELECT * FROM master_observations WHERE id=?',[row.id as string])[0]);
        }
    }
    private observation(s: CompanyMasterSnapshot): CompanyMasterObservation {
        const {records,...provenance}=s;
        return {...provenance,id:identity(s),snapshotSha256:hash(canonical(s)),records:records.length};
    }
    put(input: CompanyMasterSnapshot): {status:'inserted'|'unchanged';observation:CompanyMasterObservation} {
        const s=normalize(input),id=identity(s),body=canonical(s);
        return this.transaction(()=>{
            this.verifyIndex();
            const existing=this.rows('SELECT * FROM master_observations WHERE id=?',[id]);
            if(existing.length){const previous=this.decode(existing[0]);if(canonical(previous)!==body)throw Error('同時点の企業マスター観測が競合しています');return{status:'unchanged',observation:this.observation(previous)};}
            // 同一CSV hashを別の会社集合/基準日へ付け替えない。
            for(const previous of this.snapshotsForSource(s.sourceUrl)) {
                if(previous.sourceSha256===s.sourceSha256){const [a,b]=Date.parse(previous.observedAt)<=Date.parse(s.observedAt)?[previous,s]:[s,previous];compareCompanyMasterSnapshots(a,b);}
            }
            this.run('INSERT INTO master_observations VALUES(?,?,?,?,?,?)',[id,s.sourceUrl,s.asOf,Date.parse(s.observedAt),body,hash(body)]);
            return{status:'inserted',observation:this.observation(s)};
        });
    }
    snapshot(id: string): CompanyMasterSnapshot {
        if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw Error('観測IDが不正です');
        return this.transaction(()=>{this.verifyIndex();const rows=this.rows('SELECT * FROM master_observations WHERE id=?',[id]);if(rows.length!==1)throw Error('企業マスター観測がありません');return this.decode(rows[0]);},false);
    }
    history(sourceUrl: string): CompanyMasterObservation[] {
        const url=source(sourceUrl);
        return this.transaction(()=>{this.verifyIndex();return Array.from(this.snapshotsForSource(url),s=>this.observation(s));},false);
    }
    query(input: CompanyMasterQuery & {sourceUrl:string}) {
        if(!input||typeof input!=='object'||Array.isArray(input))throw Error('企業マスター検索条件が必要です');
        const {sourceUrl,...query}=structuredClone(input),url=source(sourceUrl);
        queryCompanyMaster([],query);
        return this.transaction(()=>{
            this.verifyIndex();
            const rows=this.rows('SELECT * FROM master_observations WHERE source_url=? AND as_of<=? AND observed_ms<=? ORDER BY as_of DESC,observed_ms DESC LIMIT 1',[url,query.asOf,Date.parse(query.knownAt)]);
            return queryCompanyMaster(rows.map(r=>this.decode(r)),query);
        },false);
    }
    compare(previousId:string,currentId:string) {
        return compareCompanyMasterSnapshots(this.snapshot(previousId),this.snapshot(currentId));
    }
}
