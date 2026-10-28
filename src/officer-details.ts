import {createHash} from "node:crypto";
import {extractDisclosureTables,DisclosureTableKind,type DisclosureTableDocument,type DisclosureTableExtraction} from "./disclosure-tables";
import {parseReportedTableNumber} from "./reported-table-number";
import {decimalFraction,compareFractions} from "./decimal-fraction";
import type {ComparisonOperator} from "./financial-options";
export const OFFICER_DETAILS_VERSION="1";
export interface OfficerTableDeclaration {tableIndex:number;rawSha256:string;status:"as-filed"|"proposed";evidenceTableIndex:number;}
export interface OfficerDocument extends DisclosureTableDocument {tables:readonly OfficerTableDeclaration[];}
export interface OfficerCellReference {cellIndex:number;raw:string;}
export type OfficerShares=OfficerCellReference&{unit:"shares";multiplier:1|100|1000;headerCellIndex:number;rawHeader:string}&(ReturnType<typeof parseReportedTableNumber>|{status:"unavailable";reason:"non-integer-shares"});
export interface OfficerRow {
 rowKey:string;tableIndex:number;rowIndex:number;status:"as-filed"|"proposed";rosterDate:string;role:"named"|"reported-total";identity:"unresolved";
 summaryLabel?:OfficerCellReference;position?:OfficerCellReference;name?:OfficerCellReference;birthDate?:OfficerCellReference;biography?:OfficerCellReference;term?:OfficerCellReference;
 reportedShares:OfficerShares;
}
export interface OfficerGroup {tableIndex:number;status:"as-filed"|"proposed";rosterDate:string;dateBasis:"filing-date-in-prefix"|"scheduled-meeting-date-in-prefix";evidenceTableIndex:number;precedingText:string;rows:OfficerRow[];}
export interface OfficerExtraction {source:DisclosureTableExtraction;groups:OfficerGroup[];diagnostics:{reason:"unsupported-context"|"unsupported-layout"|"unconfirmed-status"|"invalid-roster-date"|"ambiguous-row";tableIndex?:number;rowIndex?:number}[];}
const norm=(s:string)=>s.normalize("NFKC").replace(/\s/g,"");
const validDate=(s:unknown):s is string=>typeof s==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const date=(y:string,m:string,d:string)=>{const value=y+"-"+m.padStart(2,"0")+"-"+d.padStart(2,"0");return validDate(value)?value:undefined;};
function capture(d:OfficerDocument):OfficerDocument{
 if(!d?.selection||d.selection.kind!==DisclosureTableKind.Officers||!Array.isArray(d.tables)||!d.tables.length||d.tables.length>200)throw new Error("役員本文と確認済みの表/状態参照が必要です");
 const seen=new Set<number>(),tables=Array.from({length:d.tables.length},(_,i)=>{
  const t=d.tables[i];
  if(!t||Object.keys(t).some(k=>!["tableIndex","rawSha256","status","evidenceTableIndex"].includes(k))||!Number.isSafeInteger(t.tableIndex)||t.tableIndex<0||seen.has(t.tableIndex)||!["as-filed","proposed"].includes(t.status)||typeof t.rawSha256!=="string"||!/^[a-f0-9]{64}$/.test(t.rawSha256)||!Number.isSafeInteger(t.evidenceTableIndex)||t.evidenceTableIndex<0||t.evidenceTableIndex>t.tableIndex)throw new Error("役員表の位置/hash/状態/参照/重複を確認してください");
  seen.add(t.tableIndex);return {tableIndex:t.tableIndex,rawSha256:t.rawSha256,status:t.status,evidenceTableIndex:t.evidenceTableIndex};
 }).sort((a,b)=>a.tableIndex-b.tableIndex);
 return {xml:d.xml,selection:{docID:d.selection.docID,kind:d.selection.kind,contextRef:d.selection.contextRef},tables};
}
export function extractOfficerDetails(input:OfficerDocument):OfficerExtraction{
 const d=capture(input),source=extractDisclosureTables(d.xml,d.selection),result:OfficerExtraction={source,groups:[],diagnostics:[]};
 const diag=(reason:OfficerExtraction["diagnostics"][number]["reason"],tableIndex?:number,rowIndex?:number)=>result.diagnostics.push({reason,tableIndex,rowIndex});
 if(source.status!=="selected")return result;
 if(d.tables.some(t=>t.rawSha256!==source.source.rawSha256))throw new Error("役員本文の参照が一致しません");
 const instant=source.source.period?.instant;
 if(!validDate(instant)||source.source.contextTrace.candidates[0]?.dimensions.length!==0){diag("unsupported-context");return result;}
 for(const declaration of d.tables){
  const {tableIndex,status,evidenceTableIndex}=declaration,t=source.tables[tableIndex],evidence=source.tables[evidenceTableIndex];
  if(!t||!evidence){diag("unsupported-layout",tableIndex);continue;}
  const precedingText=evidence.precedingText??"",prefix=norm(precedingText),dates=[...prefix.matchAll(status==="as-filed"?/(?<!\d)(\d{4})年(\d{1,2})月(\d{1,2})日\(有価証券報告書提出日\)現在の当社の役員の状況/g:/(?<!\d)(\d{4})年(\d{1,2})月(\d{1,2})日開催予定/g)];
  if(dates.length!==1||status==="as-filed"&&prefix.includes("当該議案")&&prefix.includes("承認可決")||status==="proposed"&&(!prefix.includes("当該議案")||!prefix.includes("承認可決")||!prefix.includes("予定"))||source.tables.slice(evidenceTableIndex+1,tableIndex+1).some(t=>norm(t.precedingText??"")!=="")){diag("unconfirmed-status",tableIndex);continue;}
  const rosterDate=date(dates[0][1],dates[0][2],dates[0][3]);
  if(!rosterDate||status==="as-filed"&&rosterDate!==instant||status==="proposed"&&rosterDate<instant){diag("invalid-roster-date",tableIndex);continue;}
  const cell=(r:number,c:number)=>t.grid[r]?.[c],reference=(r:number,c:number):OfficerCellReference=>({cellIndex:cell(r,c)!,raw:t.cells[cell(r,c)!].parsedText}),text=(r:number,c:number)=>{const i=cell(r,c);return i==null?"":norm(t.cells[i].parsedText);};
  const unit=/^所有株式数\((百|千)?株\)$/.exec(text(0,5));
  if(t.grid.length<2||t.grid.some(row=>row.length!==6||row.some(i=>i===null))||["役職名","氏名","生年月日","略歴","任期"].some((s,c)=>text(0,c)!==s)||!unit||t.grid[0].some(i=>{const x=t.cells[i!];return x.rowSpan!==1||x.columnSpan!==1||!!x.nestedTableCount;})){diag("unsupported-layout",tableIndex);continue;}
  const group:OfficerGroup={tableIndex,status,rosterDate,dateBasis:status==="as-filed"?"filing-date-in-prefix":"scheduled-meeting-date-in-prefix",evidenceTableIndex,precedingText,rows:[]},multiplier=unit[1]==="百"?100:unit[1]==="千"?1000:1;
  for(let rowIndex=1;rowIndex<t.grid.length;rowIndex++){
   const indices=t.grid[rowIndex] as number[],summary=["計","合計","総計"].includes(text(rowIndex,0)),sharesCell=t.cells[indices[5]];
   const validSummary=summary&&indices.slice(0,5).every(i=>i===indices[0])&&t.cells[indices[0]].columnSpan===5&&t.cells[indices[0]].rowSpan===1&&!t.cells[indices[0]].nestedTableCount;
   const validNamed=!summary&&new Set(indices).size===6&&indices.every((i,c)=>t.cells[i].rowSpan===1&&t.cells[i].columnSpan===1&&(c===3||!t.cells[i].nestedTableCount))&&!!text(rowIndex,0)&&!!text(rowIndex,1);
   if(!validSummary&&!validNamed||sharesCell.rowSpan!==1||sharesCell.columnSpan!==1||sharesCell.nestedTableCount){diag("ambiguous-row",tableIndex,rowIndex);continue;}
   const ref=reference(rowIndex,5),parsed=parseReportedTableNumber(ref.raw.trim(),multiplier),value=parsed.status==="numeric"&&!/^\d+(?:\.0+)?$/.test(parsed.decimal)?{status:"unavailable" as const,reason:"non-integer-shares" as const}:parsed;
   const rowKey=createHash("sha256").update(JSON.stringify([d.selection.docID,source.source.rawSha256,tableIndex,rowIndex,status,rosterDate])).digest("hex");
   group.rows.push({rowKey,tableIndex,rowIndex,status,rosterDate,role:summary?"reported-total":"named",identity:"unresolved",...(summary?{summaryLabel:reference(rowIndex,0)}:{position:reference(rowIndex,0),name:reference(rowIndex,1),birthDate:reference(rowIndex,2),biography:reference(rowIndex,3),term:reference(rowIndex,4)}),reportedShares:{...ref,unit:"shares",multiplier,headerCellIndex:cell(0,5)!,rawHeader:t.cells[cell(0,5)!].parsedText,...value}});
  }
  result.groups.push(group);
 }
 return result;
}
export interface OfficerSearchOptions {metric:"record"|"reportedShares";status:"as-filed"|"proposed";rosterDate:string;role:"named"|"reported-total";nameContains?:string;positionContains?:string;biographyContains?:string;condition?:{operator:ComparisonOperator;value:number};sort?:"value-asc"|"value-desc";offset?:number;limit?:number;}
const fraction=(s:string)=>{const [i,f=""]=s.split(".");return {numerator:BigInt(i+f),denominator:10n**BigInt(f.length)};};
export function searchOfficerDetails(documents:readonly OfficerDocument[],options:OfficerSearchOptions){
 if(!Array.isArray(documents)||documents.length>100||!options)throw new Error("役員検索は100原本以下で条件を指定してください");
 const {metric,status,rosterDate,role,nameContains,positionContains,biographyContains,condition,sort,offset=0,limit=100}=options;
 if(!["record","reportedShares"].includes(metric)||metric==="record"&&(condition!==undefined||sort!==undefined)||!["as-filed","proposed"].includes(status)||!validDate(rosterDate)||!["named","reported-total"].includes(role)||[nameContains,positionContains,biographyContains].some(s=>s!==undefined&&(typeof s!=="string"||!s.trim()||s.length>1000))||condition!==undefined&&(!condition||typeof condition!=="object"||Array.isArray(condition)||!["gt","gte","lt","lte","eq"].includes(condition.operator)||!Number.isFinite(condition.value))||sort!==undefined&&!["value-asc","value-desc"].includes(sort)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>1000)throw new Error("役員検索の状態/日付/行区分/条件を確認してください");
 const inputs=Array.from({length:documents.length},(_,i)=>capture(documents[i])).sort((a,b)=>a.selection.docID<b.selection.docID?-1:a.selection.docID>b.selection.docID?1:0);
 if(inputs.some(d=>typeof d.xml!=="string")||inputs.reduce((n,d)=>n+Buffer.byteLength(d.xml),0)>256*1024*1024||new Set(inputs.map(d=>d.selection.docID)).size!==inputs.length)throw new Error("役員原本の重複/上限を確認してください");
 const extractions:OfficerExtraction[]=[],rows:{sourceIndex:number;row:OfficerRow}[]=[],excluded:{sourceIndex:number;rowKey:string;reason:string}[]=[],issuers=new Set<string>();let filtered=0,cells=0,count=0;
 for(const input of inputs){
  const extraction=extractOfficerDetails(input),sourceIndex=extractions.length,entity=extraction.source.source.entity;
  if(entity){const id=JSON.stringify([entity.scheme,entity.identifier]);if(issuers.has(id))throw new Error("同一提出者の訂正版/年度は先に選択してください");issuers.add(id);}
  cells+=extraction.source.tables.reduce((n,t)=>n+t.cells.length,0);count+=extraction.groups.reduce((n,g)=>n+g.rows.length,0);if(cells>100000||count>10000)throw new Error("役員検索は100000セル/10000記載以下です");
  extractions.push(extraction);
  for(const group of extraction.groups)for(const row of group.rows){
   if(row.status!==status||row.rosterDate!==rosterDate||row.role!==role||nameContains!==undefined&&!row.name?.raw.includes(nameContains)||positionContains!==undefined&&!row.position?.raw.includes(positionContains)||biographyContains!==undefined&&!row.biography?.raw.includes(biographyContains)){filtered++;continue;}
   const value=row.reportedShares;if(metric==="reportedShares"&&value.status!=="numeric"){excluded.push({sourceIndex,rowKey:row.rowKey,reason:value.reason});continue;}
   if(condition&&value.status==="numeric"){const n=compareFractions(fraction(value.decimal),decimalFraction(condition.value));if(!(condition.operator==="gt"?n>0:condition.operator==="gte"?n>=0:condition.operator==="lt"?n<0:condition.operator==="lte"?n<=0:n===0)){filtered++;continue;}}
   rows.push({sourceIndex,row});
  }
 }
 if(sort)rows.sort((a,b)=>{const x=a.row.reportedShares,y=b.row.reportedShares;return x.status==="numeric"&&y.status==="numeric"?compareFractions(fraction(x.decimal),fraction(y.decimal))*(sort==="value-asc"?1:-1):0;});
 return {extractions,rows:rows.slice(offset,offset+limit),matched:rows.length,filtered,excluded};
}
