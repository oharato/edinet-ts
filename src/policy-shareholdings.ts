import {createHash} from "node:crypto";
import {extractDisclosureTables,DisclosureTableKind,type DisclosureTableDocument,type DisclosureTableExtraction} from "./disclosure-tables";
import {parseReportedTableNumber} from "./reported-table-number";
import {decimalFraction,compareFractions} from "./decimal-fraction";
import type {ComparisonOperator} from "./financial-options";
export const POLICY_SHAREHOLDINGS_VERSION="1";
export type PolicyShareholdingKind="non-pure-summary"|"specified"|"deemed";
export interface PolicyShareholdingDeclaration {tableIndex:number;rawSha256:string;kind:PolicyShareholdingKind;headingTableIndex?:number;}
/** periodEndsは原本を確認した呼出元の宣言。会計年度/決算日の自動認定ではありません。 */
export interface PolicyShareholdingDocument extends DisclosureTableDocument {periodEnds:{current:string;previous:string};tables:readonly PolicyShareholdingDeclaration[];}
export type PolicyShareholdingValue={cellIndex:number;raw:string;headerCellIndex:number;rawHeader:string;unit:"shares"|"JPY"|"issues";multiplier:1|1000|1000000}&(ReturnType<typeof parseReportedTableNumber>|{status:"unavailable";reason:"non-integer-count"});
export interface PolicyShareholdingEntry {
 rowKey:string;tableIndex:number;rowIndex:number;kind:PolicyShareholdingKind;period:"current"|"previous";periodEnd:string;periodBasis:"caller-reviewed";
 identity:"unresolved";ownerScope:"not-established";amountDefinition:"balance-sheet-carrying-amount"|"deemed-holding-reported-amount";listingClass:"non-listed"|"other-than-non-listed"|"not-established";
 name:{cellIndex:number;raw:string};purpose?:{cellIndex:number;raw:string};reciprocalHolding?:{cellIndex:number;raw:string};
 values:Partial<Record<"shares"|"reportedAmount"|"issueCount",PolicyShareholdingValue>>;
}
export interface PolicyShareholdingExtraction {source:DisclosureTableExtraction;periodEnds:PolicyShareholdingDocument["periodEnds"];entries:PolicyShareholdingEntry[];diagnostics:{reason:"unsupported-context"|"unsupported-layout"|"unconfirmed-kind"|"ambiguous-row";tableIndex?:number;rowIndex?:number}[];}
const norm=(s:string)=>s.normalize("NFKC").replace(/\s/g,"");
const date=(s:unknown):s is string=>typeof s==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const kinds=["non-pure-summary","specified","deemed"] as const;
function capture(d:PolicyShareholdingDocument):PolicyShareholdingDocument{
 if(!d?.selection||d.selection.kind!==DisclosureTableKind.PolicyShareholdings||!d.periodEnds||!date(d.periodEnds.current)||!date(d.periodEnds.previous)||d.periodEnds.previous>=d.periodEnds.current||!Array.isArray(d.tables)||!d.tables.length||d.tables.length>200)throw new Error("政策保有の本文/確認済み期間/表を指定してください");
 const seen=new Set<number>(),tables=Array.from({length:d.tables.length},(_,i)=>{
  const t=d.tables[i];
  if(!t||Object.keys(t).some(k=>!["tableIndex","rawSha256","kind","headingTableIndex"].includes(k))||!Number.isSafeInteger(t.tableIndex)||t.tableIndex<0||seen.has(t.tableIndex)||!kinds.includes(t.kind)||typeof t.rawSha256!=="string"||!/^[a-f0-9]{64}$/.test(t.rawSha256)||t.kind!=="non-pure-summary"&&(!Number.isSafeInteger(t.headingTableIndex)||t.headingTableIndex!<0||t.headingTableIndex!>t.tableIndex)||t.kind==="non-pure-summary"&&t.headingTableIndex!==undefined)throw new Error("政策保有表の位置/hash/種類/見出し参照/重複を確認してください");
  seen.add(t.tableIndex);return {tableIndex:t.tableIndex,rawSha256:t.rawSha256,kind:t.kind,headingTableIndex:t.headingTableIndex};
 }).sort((a,b)=>a.tableIndex-b.tableIndex);
 return {xml:d.xml,selection:{docID:d.selection.docID,kind:d.selection.kind,contextRef:d.selection.contextRef},periodEnds:{current:d.periodEnds.current,previous:d.periodEnds.previous},tables};
}
export function extractPolicyShareholdings(input:PolicyShareholdingDocument):PolicyShareholdingExtraction{
 const d=capture(input),source=extractDisclosureTables(d.xml,d.selection),result:PolicyShareholdingExtraction={source,periodEnds:d.periodEnds,entries:[],diagnostics:[]};
 const diag=(reason:PolicyShareholdingExtraction["diagnostics"][number]["reason"],tableIndex?:number,rowIndex?:number)=>result.diagnostics.push({reason,tableIndex,rowIndex});
 if(source.status!=="selected")return result;
 if(d.tables.some(t=>t.rawSha256!==source.source.rawSha256))throw new Error("政策保有の本文参照が一致しません");
 const instant=source.source.period?.instant;
 if(!date(instant)||d.periodEnds.current>instant||source.source.contextTrace.candidates[0]?.dimensions.length!==0){diag("unsupported-context");return result;}
 for(const declaration of d.tables){
  const {tableIndex,kind}=declaration,t=source.tables[tableIndex];if(!t){diag("unsupported-layout",tableIndex);continue;}
  const cell=(r:number,c:number)=>t.grid[r]?.[c],raw=(r:number,c:number)=>{const i=cell(r,c);return i==null?"":t.cells[i].parsedText;},text=(r:number,c:number)=>norm(raw(r,c));
  const reference=(r:number,c:number)=>({cellIndex:cell(r,c)!,raw:raw(r,c)});
  const value=(r:number,c:number,unit:PolicyShareholdingValue["unit"],multiplier:PolicyShareholdingValue["multiplier"]):PolicyShareholdingValue=>{
   const ref=reference(r,c),parsed=parseReportedTableNumber(ref.raw.trim(),multiplier);
   const v=parsed.status==="numeric"&&unit!=="JPY"&&!/^\d+(?:\.0+)?$/.test(parsed.decimal)?{status:"unavailable" as const,reason:"non-integer-count" as const}:parsed;
   const headerRow=kind==="non-pure-summary"?0:unit==="shares"?1:2;
   return {...ref,headerCellIndex:cell(headerRow,c)!,rawHeader:raw(headerRow,c),unit,multiplier,...v};
  };
  const key=(r:number,period:string)=>createHash("sha256").update(JSON.stringify([d.selection.docID,source.source.rawSha256,tableIndex,r,kind,period])).digest("hex");
  if(kind==="non-pure-summary"){
   const prefix=norm(t.precedingText??"");
   if(prefix.lastIndexOf("保有目的が純投資目的である投資株式")>prefix.lastIndexOf("純投資目的以外")||!prefix.includes("純投資目的以外")||!prefix.endsWith("銘柄数及び貸借対照表計上額")&&!prefix.endsWith("銘柄数及び貸借対照表計上額の合計額")){diag("unconfirmed-kind",tableIndex);continue;}
   const money=/^貸借対照表計上額の合計額\((百万円|千円|円)\)$/.exec(text(0,2));
   if(t.grid.length!==3||t.grid.some(r=>r.length!==3||r.some(i=>i===null||t.cells[i].rowSpan!==1||t.cells[i].columnSpan!==1))||text(0,0)!==""||text(0,1)!=="銘柄数(銘柄)"||!money||text(1,0)!=="非上場株式"||text(2,0)!=="非上場株式以外の株式"){diag("unsupported-layout",tableIndex);continue;}
   const multiplier=money[1]==="百万円"?1000000:money[1]==="千円"?1000:1;
   for(const r of [1,2])result.entries.push({rowKey:key(r,"current"),tableIndex,rowIndex:r,kind,period:"current",periodEnd:d.periodEnds.current,periodBasis:"caller-reviewed",identity:"unresolved",ownerScope:"not-established",amountDefinition:"balance-sheet-carrying-amount",listingClass:r===1?"non-listed":"other-than-non-listed",name:reference(r,0),values:{issueCount:value(r,1,"issues",1),reportedAmount:value(r,2,"JPY",multiplier)}});
   continue;
  }
  const heading=declaration.headingTableIndex!,label=kind==="specified"?"特定投資株式":"みなし保有株式";
  if(!norm(source.tables[heading]?.precedingText??"").endsWith(label)||source.tables.slice(heading+1,tableIndex+1).some(table=>norm(table.precedingText??"")!=="")){diag("unconfirmed-kind",tableIndex);continue;}
  const money=/^貸借対照表計上額\((百万円|千円|円)\)(?:\(注[0-9]+\))?$/.exec(text(2,1)),shares=/^株式数\((千)?株\)(?:\(注[0-9]+\))?$/.exec(text(1,1));
  if(t.grid.length<5||(t.grid.length-3)%2!==0||t.grid.some(r=>r.length!==5||r.some(i=>i===null))||text(0,0)!=="銘柄"||text(0,1)!=="当事業年度"||text(0,2)!=="前事業年度"||!shares||text(1,2)!==text(1,1)||!money||text(2,2)!==text(2,1)||!text(0,3).startsWith("保有目的、業務提携")||!/^当社(?:の)?株式の保有の有無$/.test(text(0,4))||
   [0,3,4].some(c=>cell(0,c)!==cell(1,c)||cell(0,c)!==cell(2,c)||t.cells[cell(0,c)!].rowSpan!==3||t.cells[cell(0,c)!].columnSpan!==1)||
   [1,2].some(c=>[0,1,2].some(r=>{const x=t.cells[cell(r,c)!];return x.rowSpan!==1||x.columnSpan!==1;}))){diag("unsupported-layout",tableIndex);continue;}
  const multiplier=money[1]==="百万円"?1000000:money[1]==="千円"?1000:1;
  for(let r=3;r<t.grid.length;r+=2){
   const numberCells=[cell(r,1),cell(r,2),cell(r+1,1),cell(r+1,2)];
   const shared=[0,3,4].every(c=>cell(r,c)===cell(r+1,c)&&t.cells[cell(r,c)!].row===r&&t.cells[cell(r,c)!].rowSpan===2&&t.cells[cell(r,c)!].columnSpan===1);
   if(!shared||new Set(numberCells).size!==4||numberCells.some(i=>{const x=t.cells[i!];return x.rowSpan!==1||x.columnSpan!==1;})||!text(r,0)){diag("ambiguous-row",tableIndex,r);continue;}
   for(const [period,c] of [["current",1],["previous",2]] as const)result.entries.push({rowKey:key(r,period),tableIndex,rowIndex:r,kind,period,periodEnd:d.periodEnds[period],periodBasis:"caller-reviewed",identity:"unresolved",ownerScope:"not-established",amountDefinition:kind==="deemed"?"deemed-holding-reported-amount":"balance-sheet-carrying-amount",listingClass:"not-established",name:reference(r,0),purpose:reference(r,3),reciprocalHolding:reference(r,4),values:{shares:value(r,c,"shares",shares[1]?1000:1),reportedAmount:value(r+1,c,"JPY",multiplier)}});
  }
 }
 return result;
}
export interface PolicyShareholdingSearchOptions {kind:PolicyShareholdingKind;periodEnd:string;metric:"shares"|"reportedAmount"|"issueCount";listingClass?:PolicyShareholdingEntry["listingClass"];nameContains?:string;condition?:{operator:ComparisonOperator;value:number};sort?:"value-asc"|"value-desc";offset?:number;limit?:number;}
const fraction=(s:string)=>{const [i,f=""]=s.split(".");return {numerator:BigInt(i+f),denominator:10n**BigInt(f.length)};};
export function searchPolicyShareholdings(documents:readonly PolicyShareholdingDocument[],options:PolicyShareholdingSearchOptions){
 if(!Array.isArray(documents)||documents.length>100||!options)throw new Error("政策保有検索は100原本以下で条件が必要です");
 const {kind,periodEnd,metric,listingClass,nameContains,condition,sort,offset=0,limit=100}=options;
 if(!kinds.includes(kind)||!date(periodEnd)||!["shares","reportedAmount","issueCount"].includes(metric)||kind==="non-pure-summary"&&metric==="shares"||kind!=="non-pure-summary"&&metric==="issueCount"||listingClass!==undefined&&!["non-listed","other-than-non-listed","not-established"].includes(listingClass)||nameContains!==undefined&&(typeof nameContains!=="string"||!nameContains.trim()||nameContains.length>1000)||condition!==undefined&&(!condition||typeof condition!=="object"||Array.isArray(condition)||!["gt","gte","lt","lte","eq"].includes(condition.operator)||!Number.isFinite(condition.value))||sort!==undefined&&!["value-asc","value-desc"].includes(sort)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>1000)throw new Error("政策保有検索の種類/期間/指標/条件を確認してください");
 const inputs=Array.from({length:documents.length},(_,i)=>capture(documents[i])).sort((a,b)=>a.selection.docID<b.selection.docID?-1:a.selection.docID>b.selection.docID?1:0);
 if(inputs.some(d=>typeof d.xml!=="string")||inputs.reduce((n,d)=>n+Buffer.byteLength(d.xml),0)>256*1024*1024||new Set(inputs.map(d=>d.selection.docID)).size!==inputs.length)throw new Error("政策保有原本の重複/上限を確認してください");
 const extractions:PolicyShareholdingExtraction[]=[],rows:{sourceIndex:number;entry:PolicyShareholdingEntry}[]=[],excluded:{sourceIndex:number;rowKey:string;reason:string}[]=[],series=new Set<string>();let filtered=0,count=0,cells=0;
 for(const d of inputs){
  const extraction=extractPolicyShareholdings(d),sourceIndex=extractions.length;
  count+=extraction.entries.length;cells+=extraction.source.tables.reduce((n,t)=>n+t.cells.length,0);if(count>10000||cells>100000)throw new Error("政策保有検索は10000記載/100000セル以下です");
  extractions.push(extraction);
  const entity=extraction.source.source.entity;
  if(entity){const id=JSON.stringify([entity.scheme,entity.identifier,periodEnd]);if(series.has(id))throw new Error("同一提出者の原本は訂正版/比較年度を先に選択してください");series.add(id);}
  for(const entry of extraction.entries){
   if(entry.kind!==kind||entry.periodEnd!==periodEnd||listingClass!==undefined&&entry.listingClass!==listingClass||nameContains!==undefined&&!entry.name.raw.includes(nameContains)){filtered++;continue;}
   const value=entry.values[metric];if(!value||value.status!=="numeric"){excluded.push({sourceIndex,rowKey:entry.rowKey,reason:value?.reason??"metric-not-reported"});continue;}
   if(condition){const n=compareFractions(fraction(value.decimal),decimalFraction(condition.value));if(!(condition.operator==="gt"?n>0:condition.operator==="gte"?n>=0:condition.operator==="lt"?n<0:condition.operator==="lte"?n<=0:n===0)){filtered++;continue;}}
   rows.push({sourceIndex,entry});
  }
 }
 if(sort)rows.sort((a,b)=>{const x=a.entry.values[metric],y=b.entry.values[metric];return x?.status==="numeric"&&y?.status==="numeric"?compareFractions(fraction(x.decimal),fraction(y.decimal))*(sort==="value-asc"?1:-1):0;});
 return {extractions,rows:rows.slice(offset,offset+limit),matched:rows.length,filtered,excluded};
}
