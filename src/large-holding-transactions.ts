import {createHash} from 'node:crypto';
import {EdinetXbrlParser} from './edinet-xbrl-parser';
import {parseDisclosureTableFragment,type DisclosureTableCell} from './disclosure-tables';
import {parseReportedTableNumber} from './reported-table-number';
import {parseDocumentTimestamp} from './document-timestamp';
import type {LargeHoldingDocument,LargeHoldingMetadata} from './large-holding-report';
export const LARGE_HOLDING_TRANSACTIONS_VERSION='1';
const NS='http://disclosure.edinet-fsa.go.jp/taxonomy/jplvh/2014-07-31/jplvh_cor',TAG='DetailsOfAcquisitionsAndDisposalsOfStocksEtcIssuedByIssuerOfSaidStocksEtcDuringLast60DaysTextBlock';
const HEADER=['年月日','株券等の種類','数量','割合','市場内外取引の別','取得又は処分の別','単価'];
const hash=(s:string)=>createHash('sha256').update(s).digest('hex'),compact=(s:string)=>s.replace(/[\s\u3000]/g,'');
const date=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
function reportedDate(raw:string):string|undefined {const s=compact(raw),m=/^(?:(\d{4})年|令和([1-9]\d?)年)(\d{1,2})月(\d{1,2})日$/.exec(s);if(!m)return;const value=`${m[1]??String(Number(m[2])+2018)}-${m[3].padStart(2,'0')}-${m[4].padStart(2,'0')}`;return date(value)?value:undefined;}
/** Decimal is the displayed number only. No shares/percent/currency/denominator is inferred. */
export type LargeHoldingTransactionNumber={raw:string;unit:'not-stated';multiplier:1}&({status:'numeric';decimal:string}|{status:'missing'|'unsupported';reason:string});
export interface LargeHoldingTransactionRow {rowKey:string;contextRef:string;tableIndex:number;rowIndex:number;cells:DisclosureTableCell[];reportedDate:{raw:string;iso?:string};instrument:{raw:string;kind?:'ordinary-shares'|'share-acquisition-rights'};quantity:LargeHoldingTransactionNumber;ratio:LargeHoldingTransactionNumber;market:{raw:string;kind?:'on-market'|'off-market'};action:{raw:string;kind?:'acquisition'|'disposal'};price:LargeHoldingTransactionNumber;status:'selected'|'unsupported';reason?:string;}
export interface LargeHoldingTransactionSource {contextRef:string;key?:string;namespaceURI?:string;rawSha256?:string;candidates:{key:string;namespaceURI?:string;unitRef:string;nil:boolean;rawSha256?:string}[];status:'selected'|'missing'|'unsupported'|'ambiguous';reason:string;blankRows:number;}
export interface LargeHoldingTransactions {version:typeof LARGE_HOLDING_TRANSACTIONS_VERSION;metadata:LargeHoldingMetadata;inputXmlSha256:string;sourceScope:'provided-xbrl-only';dateSemantics:'reported-calendar-only';numberSemantics:'displayed-values-only';reconstruction:'not-performed';holderIdentity:'not-established';status:'selected'|'unsupported';rows:LargeHoldingTransactionRow[];sources:LargeHoldingTransactionSource[];diagnostics:{reason:string;contextRef?:string}[];}
function number(raw:string,integer=false):LargeHoldingTransactionNumber {const base={raw,unit:'not-stated' as const,multiplier:1 as const};if(!raw.trim())return {...base,status:'missing',reason:'blank'};const n=parseReportedTableNumber(raw,1);if(n.status!=='numeric')return {...base,status:['blank','dash'].includes(n.reason)?'missing':'unsupported',reason:n.reason};if(n.decimal.startsWith('-')||integer&&!/^\d+$/.test(n.decimal))return {...base,status:'unsupported',reason:'unsupported-reported-number'};return {...base,status:'numeric',decimal:n.decimal};}
/** Source-bound table only. Metadata/knownAt are caller-supplied, not authenticated against official observations. The title does not certify actual dates or units. */
export function extractLargeHoldingTransactions(document:LargeHoldingDocument):LargeHoldingTransactions {
 if(!document)throw Error('大量保有取引の原本が必要です');const xml=document.xml,suppliedMetadata=document.metadata,metadata=suppliedMetadata?structuredClone(suppliedMetadata):undefined;if(typeof xml!=='string'||Buffer.byteLength(xml)>2*1024*1024||!metadata)throw Error('大量保有取引の原本は2MiB以下です');
 const object=new EdinetXbrlParser().parse(xml,metadata.docID),report=object.selectLargeHoldingReport(metadata),all=object.getDataListByTagName(TAG),result:LargeHoldingTransactions={version:LARGE_HOLDING_TRANSACTIONS_VERSION,metadata:report.metadata,inputXmlSha256:hash(xml),sourceScope:'provided-xbrl-only',dateSemantics:'reported-calendar-only',numberSemantics:'displayed-values-only',reconstruction:'not-performed',holderIdentity:'not-established',status:report.status,rows:[],sources:[],diagnostics:[]};
 if(report.status!=='selected'){result.diagnostics.push({reason:'unsupported-report'});return result;}
 const holders=report.rows.filter(r=>r.role!=='reported-aggregate'),refs=new Set(holders.map(r=>r.contextRef));
 for(const f of all)if(!refs.has(f.contextRef))result.diagnostics.push({reason:'unsupported-transaction-context',contextRef:f.contextRef});
 for(const holder of holders){const facts=all.filter(f=>f.contextRef===holder.contextRef),source:LargeHoldingTransactionSource={contextRef:holder.contextRef,candidates:facts.map(f=>({key:f.key,namespaceURI:f.namespaceURI,unitRef:f.unitRef,nil:f.nil,rawSha256:f.rawValue===undefined?undefined:hash(f.rawValue)})),status:'missing',reason:'tag-absent',blankRows:0};result.sources.push(source);if(!facts.length)continue;
  const first=facts[0];Object.assign(source,{key:first.key,namespaceURI:first.namespaceURI,rawSha256:first.rawValue===undefined?undefined:hash(first.rawValue)});
  if(facts.length!==1){source.status='ambiguous';source.reason='multiple-facts';continue;}
  if(first.namespaceURI!==NS||first.unitRef){source.status='unsupported';source.reason=first.namespaceURI!==NS?'unknown-namespace':'unexpected-textblock-unit';continue;}
  if(first.nil){source.reason='nil';continue;}if(first.rawValue===undefined){source.status='unsupported';source.reason='raw-unavailable';continue;}
  let parsed:ReturnType<typeof parseDisclosureTableFragment>;try{parsed=parseDisclosureTableFragment(first.rawValue);}catch{source.status='unsupported';source.reason='unsupported-fragment';continue;}
  if(parsed.tables.length!==1){source.status='unsupported';source.reason='expected-one-table';continue;}
  const table=parsed.tables[0],cells=(row:number)=>(table.grid[row]??[]).map(i=>i===null?undefined:table.cells[i]);
  const header=cells(0);if(header.length!==7||header.some((c,i)=>!c||c.row!==0||c.column!==i||c.rowSpan!==1||c.columnSpan!==1||compact(c.parsedText)!==HEADER[i])){source.status='unsupported';source.reason='unsupported-header';continue;}
  source.status='selected';source.reason='reported-table';
  for(let rowIndex=1;rowIndex<table.grid.length;rowIndex++){const row=cells(rowIndex);if(row.length!==7||row.some((c,i)=>!c||c.row!==rowIndex||c.column!==i||c.rowSpan!==1||c.columnSpan!==1)){source.status='unsupported';source.reason='merged-or-missing-data-cell';break;}
   const physical=row as DisclosureTableCell[],v=physical.map(c=>c.parsedText);if(v.every(s=>!s.trim())){source.blankRows++;continue;}
   const iso=reportedDate(v[0]),instrument=compact(v[1]),market=compact(v[4]),action=compact(v[5]),quantity=number(v[2],true),ratio=number(v[3]),price=number(v[6]);
   const kind=instrument==='普通株式'?'ordinary-shares':instrument==='新株予約権'?'share-acquisition-rights':undefined,marketKind=market==='市場内'?'on-market':market==='市場外'?'off-market':undefined,actionKind=action==='取得'?'acquisition':action==='処分'?'disposal':undefined;
   const selected=!!iso&&!!kind&&!!marketKind&&!!actionKind&&quantity.status==='numeric'&&ratio.status==='numeric'&&price.status!=='unsupported';
   result.rows.push({rowKey:hash(JSON.stringify([report.metadata.docID,source.contextRef,source.rawSha256,table.index,rowIndex])),contextRef:source.contextRef,tableIndex:table.index,rowIndex,cells:physical,reportedDate:{raw:v[0],...(iso?{iso}:{})},instrument:{raw:v[1],...(kind?{kind}:{})},quantity,ratio,market:{raw:v[4],...(marketKind?{kind:marketKind}:{})},action:{raw:v[5],...(actionKind?{kind:actionKind}:{})},price,status:selected?'selected':'unsupported',...(selected?{}:{reason:'unsupported-row'})});
  }
  if(source.status!=='selected')result.rows=result.rows.filter(r=>r.contextRef!==source.contextRef);
 }
 return structuredClone(result);
}
export interface LargeHoldingTransactionSearchOptions {cutoff:string;reportedStartDate?:string;reportedEndDate?:string;instrument?:'ordinary-shares'|'share-acquisition-rights';market?:'on-market'|'off-market';action?:'acquisition'|'disposal';issuerEdinetCode?:string;offset?:number;limit?:number;}
/** cutoff filters supplied metadata knownAt/submitDateTime; it does not establish original availability from XML. Select correction versions separately. */
export function searchLargeHoldingTransactions(documents:readonly LargeHoldingDocument[],options:LargeHoldingTransactionSearchOptions):{reports:LargeHoldingTransactions[];rows:{sourceIndex:number;row:LargeHoldingTransactionRow}[];matched:number;filtered:number;excluded:{docID:string;reason:string;contextRef?:string}[]} {
 if(!Array.isArray(documents)||documents.length>100||!options||typeof options!=='object'||Object.keys(options).some(k=>!['cutoff','reportedStartDate','reportedEndDate','instrument','market','action','issuerEdinetCode','offset','limit'].includes(k)))throw Error('取引検索条件を確認してください');
 const q=structuredClone(options),cutoff=parseDocumentTimestamp(q.cutoff,true),offset=q.offset??0,limit=q.limit??100;
 if(cutoff===undefined||q.reportedStartDate!==undefined&&!date(q.reportedStartDate)||q.reportedEndDate!==undefined&&!date(q.reportedEndDate)||q.reportedStartDate&&q.reportedEndDate&&q.reportedStartDate>q.reportedEndDate||q.instrument!==undefined&&!['ordinary-shares','share-acquisition-rights'].includes(q.instrument)||q.market!==undefined&&!['on-market','off-market'].includes(q.market)||q.action!==undefined&&!['acquisition','disposal'].includes(q.action)||q.issuerEdinetCode!==undefined&&!/^E\d{5}$/.test(q.issuerEdinetCode)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>1000)throw Error('取引検索の日時/種類/条件を確認してください');
 const reports:LargeHoldingTransactions[]=[],rows:{sourceIndex:number;row:LargeHoldingTransactionRow}[]=[],excluded:{docID:string;reason:string;contextRef?:string}[]=[];let bytes=0,filtered=0,count=0;
 const parsed:LargeHoldingTransactions[]=[];for(let i=0;i<documents.length;i++){const d=documents[i];if(!d)throw Error('取引原本が必要です');const xml=d.xml,metadata=d.metadata;if(typeof xml!=='string'||(bytes+=Buffer.byteLength(xml))>32*1024*1024)throw Error('取引検索の原本上限を確認してください');parsed.push(extractLargeHoldingTransactions({xml,metadata}));}
 parsed.sort((a,b)=>a.metadata.docID<b.metadata.docID?-1:a.metadata.docID>b.metadata.docID?1:0);if(new Set(parsed.map(r=>r.metadata.docID)).size!==parsed.length)throw Error('取引原本が重複しています');
 const eligible=parsed.filter(r=>{if(parseDocumentTimestamp(r.metadata.knownAt,true)!>cutoff||parseDocumentTimestamp(r.metadata.submitDateTime,false)!>cutoff){excluded.push({docID:r.metadata.docID,reason:'not-known-at-cutoff'});return false;}return true;});
 const ids=new Set(eligible.map(r=>r.metadata.docID)),parents=new Set<string>();for(const r of eligible)if(r.metadata.docTypeCode==='360'&&r.metadata.parentDocID){if(ids.has(r.metadata.parentDocID)||parents.has(r.metadata.parentDocID))throw Error('訂正系列を先に選んでください');parents.add(r.metadata.parentDocID);}
 for(const report of eligible){const sourceIndex=reports.length;reports.push(report);count+=report.rows.length;if(count>10000)throw Error('取引検索は10000行以下です');
  if(report.status!=='selected'){excluded.push({docID:report.metadata.docID,reason:'unsupported-report'});continue;}
  for(const source of report.sources)if(source.status!=='selected')excluded.push({docID:report.metadata.docID,contextRef:source.contextRef,reason:source.reason});
  for(const row of report.rows){if(row.status!=='selected'){excluded.push({docID:report.metadata.docID,reason:'unsupported-row'});continue;}if(q.issuerEdinetCode&&q.issuerEdinetCode!==report.metadata.issuerEdinetCode||q.reportedStartDate&&row.reportedDate.iso!<q.reportedStartDate||q.reportedEndDate&&row.reportedDate.iso!>q.reportedEndDate||q.instrument&&row.instrument.kind!==q.instrument||q.market&&row.market.kind!==q.market||q.action&&row.action.kind!==q.action){filtered++;continue;}rows.push({sourceIndex,row});}
 }
 return {reports,rows:rows.slice(offset,offset+limit),matched:rows.length,filtered,excluded};
}
