import {createHash} from 'node:crypto';
import {DedicatedSqliteDatabase} from './dedicated-sqlite';
import {FACILITY_DETAILS_VERSION,extractFacilityDetails,projectFacilityDetails,screenParsedFacilityDetails,type FacilityDetailDocument,type FacilityDetailsExtraction,type FacilityScreeningOptions} from '../facility-details';
import {parseDisclosureTableFragment,DisclosureTableKind} from '../disclosure-tables';

export const FACILITY_DETAIL_STORE_VERSION='1';
const format=`edinet-ts-facility-${FACILITY_DETAILS_VERSION}-v1`;
const schema={
 facility_format:'CREATE TABLE facility_format(kind TEXT NOT NULL)',
 facility_snapshots:'CREATE TABLE facility_snapshots(id TEXT PRIMARY KEY,doc_id TEXT NOT NULL,context_ref TEXT NOT NULL,as_of_date TEXT NOT NULL,input_sha256 TEXT NOT NULL,body TEXT NOT NULL,content_sha256 TEXT NOT NULL)',
 facility_date:'CREATE INDEX facility_date ON facility_snapshots(as_of_date,doc_id,context_ref,id)',
 facility_values:`CREATE VIEW facility_values AS SELECT s.id snapshot_id,s.doc_id,s.context_ref,s.as_of_date,s.input_sha256,json_extract(r.value,'$.rowKey') row_key,json_extract(r.value,'$.tableIndex') table_index,json_extract(r.value,'$.rowIndex') row_index,json_extract(r.value,'$.organization') organization,json_extract(r.value,'$.siteAndLocation.raw') site_and_location,json_extract(r.value,'$.companyLabel.raw') company_label,json_extract(r.value,'$.segment.raw') segment,v.key field_id,json_extract(v.value,'$.cellIndex') cell_index,json_extract(v.value,'$.status') status,json_extract(v.value,'$.reason') reason,json_extract(v.value,'$.raw') raw_text,json_extract(v.value,'$.decimal') decimal_text,json_extract(v.value,'$.unit') unit,json_extract(v.value,'$.multiplier') multiplier FROM facility_snapshots s,json_each(s.body,'$.extraction.rows') r,json_each(r.value,'$.values') v`,
};
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const digest=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function fail():never {throw Error('設備Storeの形式・本文・宣言・索引を確認してください');}
const maximumBody=32*1024**2;
const columns=`id,doc_id,context_ref,as_of_date,input_sha256,CASE WHEN typeof(body)='text' AND length(CAST(body AS BLOB))<=${maximumBody} THEN body END AS body,content_sha256`;
type RecordBody={version:"2"|typeof FACILITY_DETAILS_VERSION;input:Omit<FacilityDetailDocument,'xml'>;extraction:FacilityDetailsExtraction};
const identity=(record:RecordBody)=>hash(canonical([record.version,record.input,record.extraction.source.inputXmlSha256]));
export interface FacilityDetailStoreAppendResult {snapshotIds:string[];inserted:number;}
export interface FacilityDetailStoreSearchOptions extends FacilityScreeningOptions {snapshotIds?:readonly string[];}
export type FacilityDetailStoreSearchResult=ReturnType<typeof screenParsedFacilityDetails>&{storage:{snapshotIds:string[];originalXmlStored:false;verification:'all-records'}};

/** 原表本文と根拠付き明細を保存。原XMLは既存の原本保管先へ保持します。 */
export class FacilityDetailStore extends DedicatedSqliteDatabase {
 private verified=false;
 constructor(file:string,options:{readOnly?:boolean}={}){
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='readOnly'))throw Error('専用DBパスとreadOnlyを指定してください');
  const readOnly=options.readOnly;
  super(file,{readOnly},{table:'facility_format',kind:format,schema,...(readOnly?{compatibleKinds:['edinet-ts-facility-2-v1']}:{})});
 }
 private read<T>(fn:()=>T){if(this.closed)fail();const before=this.readOnly?this.readOnlySnapshotSha256():undefined;const result=this.transaction(fn,false);if(before!==undefined&&before!==this.readOnlySnapshotSha256())fail();return result;}
 private decode(row:Record<string,unknown>,deep=true):RecordBody{
  if(typeof row.body!=='string'||!digest(row.id)||!digest(row.input_sha256)||!digest(row.content_sha256))fail();
  const record=JSON.parse(row.body) as RecordBody;
  if(!record||record.version!==(this.rows('SELECT kind FROM facility_format')[0]?.kind==='edinet-ts-facility-2-v1'?'2':FACILITY_DETAILS_VERSION)||!record.input||!record.extraction||canonical(record)!==row.body||hash(canonical([row.id,row.doc_id,row.context_ref,row.as_of_date,row.input_sha256,row.body]))!==row.content_sha256||identity(record)!==row.id)fail();
  const {input,extraction}=record,source=extraction.source;
  if(input.accountingStandard!=='J-GAAP'||input.selection?.kind!==DisclosureTableKind.Facilities||input.selection.docID!==row.doc_id||input.selection.contextRef!==row.context_ref||!Array.isArray(input.declarations)||!input.declarations.length||input.declarations.some(d=>d.asOfDate!==row.as_of_date)||source?.inputXmlSha256!==row.input_sha256||source.source?.docID!==row.doc_id||source.source.contextRef!==row.context_ref||source.source.kind!==DisclosureTableKind.Facilities)fail();
  if(deep){
   if(source.status==='selected'){
    const raw=source.source.rawFragment;if(typeof raw!=='string'||hash(raw)!==source.source.rawSha256)fail();
    const parsed=parseDisclosureTableFragment(raw);
    if(canonical(parsed.tables)!==canonical(source.tables)||parsed.parsedText!==source.parsedText||parsed.outsideTableText!==source.outsideTableText)fail();
   }
   if(canonical(projectFacilityDetails(source,input,record.version))!==canonical(extraction))fail();
   screenParsedFacilityDetails([extraction],{asOfDate:String(row.as_of_date)});
  }
  return record;
 }
 private verifyAll(){
  if(this.readOnly&&this.verified)return;const statement=this.db.prepare('SELECT '+columns+' FROM facility_snapshots ORDER BY id');
  try{for(const row of statement.iterate())this.decode(row);}finally{statement.close();}
  if(this.readOnly)this.verified=true;
 }
 append(documents:readonly FacilityDetailDocument[]):FacilityDetailStoreAppendResult{
  const captured=structuredClone(documents);if(!Array.isArray(captured)||captured.length>100||captured.some(d=>!d||typeof d.xml!=='string'||Buffer.from(d.xml).toString('utf8')!==d.xml||Buffer.byteLength(d.xml)>64*1024**2)||captured.reduce((n,d)=>n+Buffer.byteLength(d.xml),0)>256*1024**2)fail();
  const records:{id:string;body:string;values:string[]}[]=[];let storedBytes=0;
  for(const document of captured as readonly FacilityDetailDocument[]){
   const original=extractFacilityDetails(document),{selection,accountingStandard}=document;
   for(const asOfDate of new Set(document.declarations.map(d=>d.asOfDate))){
    if(records.length>=100)throw Error('設備Storeの一投入は100snapshot以下です。対象を分けてください');
    const declarations=document.declarations.filter(d=>d.asOfDate===asOfDate).map(d=>({...d}));
    const input={selection:{docID:selection.docID,contextRef:selection.contextRef,kind:selection.kind},accountingStandard,declarations};
    const extraction=projectFacilityDetails(original.source,input);screenParsedFacilityDetails([extraction],{asOfDate});
    const record:RecordBody={version:FACILITY_DETAILS_VERSION,input,extraction};
    const id=identity(record),body=canonical(record);if(Buffer.byteLength(body)>maximumBody)fail();
    const values=[id,selection.docID,selection.contextRef,asOfDate,extraction.source.inputXmlSha256!,body];
    if((storedBytes+=Buffer.byteLength(body))>256*1024**2)throw Error('設備Storeの一投入の保存本文は256MiB以下です。対象を分けてください');
    records.push({id,body,values});
   }
  }
  return this.transaction(()=>{
   this.verifyAll();let inserted=0;
   for(const record of records){const existing=this.rows('SELECT '+columns+' FROM facility_snapshots WHERE id=?',[record.id])[0];
    if(existing){if(canonical(this.decode(existing))!==record.body)fail();continue;}
    this.run('INSERT INTO facility_snapshots VALUES(?,?,?,?,?,?,?)',[...record.values,hash(canonical(record.values))]);inserted++;
   }
   return {snapshotIds:records.map(r=>r.id),inserted};
  });
 }
 search(options:FacilityDetailStoreSearchOptions):FacilityDetailStoreSearchResult{
  const captured=structuredClone(options);if(!captured||typeof captured!=='object'||Array.isArray(captured)||Object.keys(captured).some(k=>!['asOfDate','conditions','contains','organization','sort','offset','limit','snapshotIds'].includes(k)))fail();
  const {snapshotIds,...query}=captured;screenParsedFacilityDetails([],query);
  if(snapshotIds!==undefined&&(!Array.isArray(snapshotIds)||snapshotIds.length>100||snapshotIds.some(id=>!digest(id))||new Set(snapshotIds).size!==snapshotIds.length))fail();
  return this.read(()=>{
   this.verifyAll();const records=snapshotIds===undefined?this.rows('SELECT '+columns+' FROM facility_snapshots WHERE as_of_date=? ORDER BY doc_id,context_ref,id LIMIT 101',[query.asOfDate]):snapshotIds.map(id=>{const row=this.rows('SELECT '+columns+' FROM facility_snapshots WHERE id=?',[id])[0];if(!row||row.as_of_date!==query.asOfDate)fail();return row;}).sort((a,b)=>(String(a.doc_id)<String(b.doc_id)?-1:String(a.doc_id)>String(b.doc_id)?1:String(a.context_ref)<String(b.context_ref)?-1:String(a.context_ref)>String(b.context_ref)?1:0));
   records.sort((a,b)=>String(a.doc_id)<String(b.doc_id)?-1:String(a.doc_id)>String(b.doc_id)?1:String(a.context_ref)<String(b.context_ref)?-1:String(a.context_ref)>String(b.context_ref)?1:0);
   if(records.length>100)throw Error('設備Storeの一検索は100原本以下です。snapshotIdsで対象を指定してください');
   if(records.reduce((n,r)=>n+Buffer.byteLength(String(r.body)),0)>256*1024**2)fail();
   const result=screenParsedFacilityDetails(records.map(row=>this.decode(row,!this.readOnly).extraction),query);
   return {...result,storage:{snapshotIds:records.map(row=>String(row.id)),originalXmlStored:false as const,verification:'all-records' as const}};
  });
 }
 audit(){return this.read(()=>{this.verifyAll();return {snapshots:Number(this.rows('SELECT COUNT(*) n FROM facility_snapshots')[0].n),verification:'all-records' as const,originalXmlStored:false as const};});}
}
