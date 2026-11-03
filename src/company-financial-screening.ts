import {FinancialSearchIndex,normalizeFinancialIndexSearch,financialIndexGenerationSha256,type FinancialIndexCohort,type FinancialIndexSearchOptions,type FinancialIndexRow,type FinancialIndexDiagnostic,type FinancialIndexGeneration,type FinancialIndexSearchResult} from './db/financial-search-index';
import {DuckFinancialSearchIndex} from './db/duck-financial-search-index';
import {queryCompanyMaster,type CompanyMasterSnapshot,type CompanyMasterQuery,type CompanyMasterRecord} from './company-master';
export interface CompanyFinancialScreeningOptions {
    cohort:FinancialIndexCohort;
    /** knownAtは財務世代のcutoffへ固定。業種名はEDINETの原表記を指定します。 */
    company:Omit<CompanyMasterQuery,'knownAt'>;
    search:FinancialIndexSearchOptions;
}
export interface CompanyFinancialScreeningRow {company:CompanyMasterRecord;financial:FinancialIndexRow;}
export interface CompanyFinancialScreeningResult {
    cohort:FinancialIndexCohort;cutoff:string;indexSha256:string;generationSha256:string;
    master:{status:'available';asOf:string;observedAt:string;sourceUrl:string;sourceSha256:string;total:number}|{status:'unavailable';reason:'no-observation'};
    rows:CompanyFinancialScreeningRow[];total:number;excludedRows:number;
    diagnostics:(FinancialIndexDiagnostic&{company:CompanyMasterRecord})[];
}
type NormalizedScreening=ReturnType<typeof normalizeFinancialIndexSearch>;
type MasterSelection=ReturnType<typeof queryCompanyMaster>;
function normalizeScreening(options:CompanyFinancialScreeningOptions){
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['cohort','company','search'].includes(k)))throw Error('財務集合・企業条件・検索条件を指定してください');
    const input=structuredClone(options),q=normalizeFinancialIndexSearch(input.cohort,input.search),company=input.company;
    if(!company||typeof company!=='object'||Array.isArray(company)||Object.hasOwn(company,'knownAt'))throw Error('企業条件のknownAtは財務世代へ固定します');
    return {q,company};
}
function assemble(indexSha256:string,generation:FinancialIndexGeneration,financial:FinancialIndexSearchResult|undefined,master:MasterSelection,q:NormalizedScreening):CompanyFinancialScreeningResult{
    const base={cohort:q.cohort,cutoff:generation.selection.cutoff,indexSha256,generationSha256:financialIndexGenerationSha256(generation)};
    if(master.status==='unavailable')return {...base,master:{status:'unavailable',reason:'no-observation'},rows:[],total:0,excludedRows:0,diagnostics:[]};
    if(!financial)throw Error('財務検索結果がありません');
    const members=new Map(master.rows.map(r=>[r.edinetCode,r]));
    const matched=financial.rows.flatMap(row=>{const company=members.get(row.edinetCode);return company?[{company,financial:row}]:[]});
    const owners=new Map(generation.selection.selected.map(s=>[s.observation.document.docID,s.observation.document.edinetCode]));
    const diagnostics=financial.diagnostics.flatMap(d=>{
        const owner=owners.get(d.docID);if(!owner)throw Error('財務診断の発行体が未記録です');
        const company=members.get(owner);return company?[{...d,company}]:[];
    });
    return {...base,master:{status:'available',asOf:master.asOf,observedAt:master.observedAt,sourceUrl:master.sourceUrl,sourceSha256:master.sourceSha256,total:master.total},
        rows:matched.slice(q.offset,q.limit===undefined?undefined:q.offset+q.limit),total:matched.length,
        excludedRows:new Set(diagnostics.filter(d=>d.required).map(d=>d.docID)).size,diagnostics};
}
/** 固定した索引をEDINET IDで結合し、企業属性で絞ってからページを切ります。 */
export function screenCompanyFinancials(indexFile:string,snapshots:readonly CompanyMasterSnapshot[],options:CompanyFinancialScreeningOptions):CompanyFinancialScreeningResult {
    const {q,company}=normalizeScreening(options);
    const index=new FinancialSearchIndex(indexFile,{readOnly:true});
    try{
        const indexSha256=index.snapshotSha256(),generation=index.generation(q.cohort.generation);
        const master=queryCompanyMaster(snapshots,{...company,knownAt:generation.selection.cutoff});
        const financial=master.status==='available'?index.screen(q.cohort,{metricIds:q.metrics,conditions:q.conditions,sortBy:q.sortBy,order:q.order}):undefined;
        const result=assemble(indexSha256,generation,financial,master,q);
        if(index.snapshotSha256()!==indexSha256)throw Error('比較中に固定索引が変更されました');
        return result;
    }finally{index.close()}
}
/** 検査済みDuckDB候補をEDINET IDで結合します。同期版と同じ入力・返却形を使用します。 */
export async function screenDuckCompanyFinancials(indexFile:string,snapshots:readonly CompanyMasterSnapshot[],options:CompanyFinancialScreeningOptions):Promise<CompanyFinancialScreeningResult>{
    const {q,company}=normalizeScreening(options);
    if(!Array.isArray(snapshots))throw Error('比較集合・企業条件・検索条件を指定してください');
    const index=await DuckFinancialSearchIndex.open(indexFile);
    try{
        const indexSha256=await index.snapshotSha256(),generation=await index.generation(q.cohort.generation);
        const master=queryCompanyMaster(snapshots,{...company,knownAt:generation.selection.cutoff});
        const financial=master.status==='available'?await index.screen(q.cohort,{metricIds:q.metrics,conditions:q.conditions,sortBy:q.sortBy,order:q.order}):undefined;
        const result=assemble(indexSha256,generation,financial,master,q);
        if(await index.snapshotSha256()!==indexSha256)throw Error('比較中に固定索引が変更されました');
        return result;
    }finally{await index.close()}
}
