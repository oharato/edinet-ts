import {FinancialSearchIndex,normalizeFinancialIndexSearch,financialIndexGenerationSha256,type FinancialIndexCohort,type FinancialIndexSearchOptions,type FinancialIndexRow,type FinancialIndexDiagnostic} from './db/financial-search-index';
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
/** 固定した索引をEDINET IDで結合し、企業属性で絞ってからページを切ります。 */
export function screenCompanyFinancials(indexFile:string,snapshots:readonly CompanyMasterSnapshot[],options:CompanyFinancialScreeningOptions):CompanyFinancialScreeningResult {
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['cohort','company','search'].includes(k)))throw Error('財務集合・企業条件・検索条件を指定してください');
    const input=structuredClone(options),q=normalizeFinancialIndexSearch(input.cohort,input.search),company=input.company;
    if(!company||typeof company!=='object'||Array.isArray(company)||Object.hasOwn(company,'knownAt'))throw Error('企業条件のknownAtは財務世代へ固定します');
    const index=new FinancialSearchIndex(indexFile,{readOnly:true});
    try{
        const indexSha256=index.snapshotSha256(),generation=index.generation(q.cohort.generation),cutoff=generation.selection.cutoff;
        const master=queryCompanyMaster(snapshots,{...company,knownAt:cutoff});
        const base={cohort:q.cohort,cutoff,indexSha256,generationSha256:financialIndexGenerationSha256(generation)};
        let result:CompanyFinancialScreeningResult;
        if(master.status==='unavailable')result={...base,master:{status:'unavailable',reason:'no-observation'},rows:[],total:0,excludedRows:0,diagnostics:[]};
        else{
            const members=new Map(master.rows.map(r=>[r.edinetCode,r]));
            const financial=index.screen(q.cohort,{metricIds:q.metrics,conditions:q.conditions,sortBy:q.sortBy,order:q.order});
            const matched=financial.rows.flatMap(row=>{const company=members.get(row.edinetCode);return company?[{company,financial:row}]:[]});
            const owners=new Map(generation.selection.selected.map(s=>[s.observation.document.docID,s.observation.document.edinetCode]));
            const diagnostics=financial.diagnostics.flatMap(d=>{
                const owner=owners.get(d.docID);if(!owner)throw Error('財務診断の発行体が未記録です');
                const company=members.get(owner);return company?[{...d,company}]:[];
            });
            result={...base,master:{status:'available',asOf:master.asOf,observedAt:master.observedAt,sourceUrl:master.sourceUrl,sourceSha256:master.sourceSha256,total:master.total},
                rows:matched.slice(q.offset,q.limit===undefined?undefined:q.offset+q.limit),total:matched.length,
                excludedRows:new Set(diagnostics.filter(d=>d.required).map(d=>d.docID)).size,diagnostics};
        }
        if(index.snapshotSha256()!==indexSha256)throw Error('比較中に固定索引が変更されました');
        return result;
    }finally{index.close()}
}
