import {createHash} from "node:crypto";
import {extractDisclosureTables,DisclosureTableKind,type DisclosureTableDocument,type DisclosureTableExtraction,type DisclosureTable} from "./disclosure-tables";
import {parseReportedTableNumber} from "./reported-table-number";
import {decimalFraction,compareFractions} from "./decimal-fraction";
import type {ComparisonOperator} from "./financial-options";
export const OFFICER_REMUNERATION_VERSION="1";
export interface RemunerationTableDeclaration {tableIndex:number;rawSha256:string;kind:"category"|"individual";headerRows:2|3;}
export interface RemunerationDocument extends DisclosureTableDocument {period:{startDate:string;endDate:string};tables:readonly RemunerationTableDeclaration[];}
export interface RemunerationCellReference {cellIndex:number;raw:string;}
export type RemunerationValue=RemunerationCellReference&{unit:"JPY"|"people";multiplier:1|1000|1000000;headers:RemunerationCellReference[]}&(ReturnType<typeof parseReportedTableNumber>|{status:"unavailable";reason:"non-integer-people"});
export interface RemunerationComponent {path:RemunerationCellReference[];value:RemunerationValue;}
interface EntryBase {entryKey:string;tableIndex:number;rowIndex:number;role:"detail"|"reported-total";period:RemunerationDocument["period"];periodBasis:"caller-reviewed";identity:"unresolved";paymentBasis:"reported-not-verified-cash-payment";total:RemunerationValue;}
export interface CategoryRemunerationEntry extends EntryBase {kind:"category";categories:RemunerationCellReference[];recipientCount:RemunerationValue;components:RemunerationComponent[];}
export interface IndividualRemunerationEntry extends EntryBase {kind:"individual";name:RemunerationCellReference;contributions:{rowIndex:number;position:RemunerationCellReference;company:RemunerationCellReference;components:RemunerationComponent[]}[];}
export type RemunerationEntry=CategoryRemunerationEntry|IndividualRemunerationEntry;
export interface RemunerationExtraction {source:DisclosureTableExtraction;entries:RemunerationEntry[];diagnostics:{reason:"unsupported-context"|"unsupported-layout"|"ambiguous-row";tableIndex?:number;rowIndex?:number}[];}
const norm=(s:string)=>s.normalize("NFKC").replace(/\s/g,"");
const validDate=(s:unknown):s is string=>typeof s==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const multiplier=(unit:string):1|1000|1000000=>unit==="百万円"?1000000:unit==="千円"?1000:1;
function capture(d:RemunerationDocument):RemunerationDocument{
 if(!d?.selection||d.selection.kind!==DisclosureTableKind.OfficerRemuneration||!d.period||!validDate(d.period.startDate)||!validDate(d.period.endDate)||d.period.startDate>=d.period.endDate)throw new Error("役員報酬の本文/確認済み期間/表が必要です");
 const declared=d.tables;if(!Array.isArray(declared))throw new Error("確認済み表の配列が必要です");
 const tableCount=declared.length;if(!Number.isSafeInteger(tableCount)||tableCount<1||tableCount>200)throw new Error("確認済み表は1〜200件です");
 const seen=new Set<number>(),tables=Array.from({length:tableCount},(_,i)=>{
  if(!Object.hasOwn(declared,i))throw new Error("確認済み表の配列要素が欠落しています");
  const t=declared[i];
  if(!t||Object.keys(t).some(k=>!["tableIndex","rawSha256","kind","headerRows"].includes(k))||!Number.isSafeInteger(t.tableIndex)||t.tableIndex<0||seen.has(t.tableIndex)||!["category","individual"].includes(t.kind)||![2,3].includes(t.headerRows)||typeof t.rawSha256!=="string"||!/^[a-f0-9]{64}$/.test(t.rawSha256))throw new Error("役員報酬表の位置/hash/種類/見出し/重複を確認してください");
  seen.add(t.tableIndex);return {tableIndex:t.tableIndex,rawSha256:t.rawSha256,kind:t.kind,headerRows:t.headerRows};
 }).sort((a,b)=>a.tableIndex-b.tableIndex);
 return {xml:d.xml,selection:{docID:d.selection.docID,kind:d.selection.kind,contextRef:d.selection.contextRef},period:{startDate:d.period.startDate,endDate:d.period.endDate},tables};
}
function headerPath(t:DisclosureTable,rows:number,column:number):RemunerationCellReference[]{
 const seen=new Set<number>(),path:RemunerationCellReference[]=[];
 for(let r=0;r<rows;r++){const i=t.grid[r]?.[column];if(i==null||seen.has(i))continue;seen.add(i);if(t.cells[i].parsedText.trim())path.push({cellIndex:i,raw:t.cells[i].parsedText});}
 return path;
}
export function extractOfficerRemuneration(input:RemunerationDocument):RemunerationExtraction{
 const d=capture(input),source=extractDisclosureTables(d.xml,d.selection),result:RemunerationExtraction={source,entries:[],diagnostics:[]};
 const diag=(reason:RemunerationExtraction["diagnostics"][number]["reason"],tableIndex?:number,rowIndex?:number)=>result.diagnostics.push({reason,tableIndex,rowIndex});
 if(source.status!=="selected")return result;
 if(d.tables.some(t=>t.rawSha256!==source.source.rawSha256))throw new Error("役員報酬の本文参照が一致しません");
 const instant=source.source.period?.instant;
 if(!validDate(instant)||d.period.endDate>instant||source.source.contextTrace.candidates[0]?.dimensions.length!==0){diag("unsupported-context");return result;}
 for(const declared of d.tables){
  const {tableIndex,kind,headerRows:h}=declared,t=source.tables[tableIndex];
  if(!t||t.grid.length<=h){diag("unsupported-layout",tableIndex);continue;}
  const width=t.grid[0].length,cell=(r:number,c:number)=>t.grid[r]?.[c],reference=(r:number,c:number)=>({cellIndex:cell(r,c)!,raw:t.cells[cell(r,c)!].parsedText}),text=(r:number,c:number)=>{const i=cell(r,c);return i==null?"":norm(t.cells[i].parsedText);};
  const totalColumn=kind==="category"?t.grid[0].findIndex((_,c)=>/^報酬等の総額\((百万円|千円|円)\)$/.test(text(0,c))):1,firstComponent=kind==="category"?totalColumn+1:4,lastComponent=kind==="category"?width-2:width-1;
  const total=/^(?:連結)?報酬等の総額\((百万円|千円|円)\)$/.exec(text(0,totalColumn)),root=/^(?:連結)?報酬等の(?:種類別|種別)の(?:総額|額)\((百万円|千円|円)\)$/.exec(text(0,firstComponent));
  const columns=Array.from({length:Math.max(0,lastComponent-firstComponent+1)},(_,i)=>i+firstComponent);
  const components=columns.map(c=>({column:c,path:headerPath(t,h,c).slice(1)}));
  const countPath=kind==="category"?headerPath(t,h,width-1):[];
  if(t.grid.some(row=>row.length!==width||row.some(i=>i===null))||!total||!root||total[1]!==root[1]||columns.length<1||columns.length>20||
   (kind==="category"?(totalColumn!==1&&totalColumn!==2)||text(0,0)!=="役員区分"||totalColumn===2&&cell(0,0)!==cell(0,1)||!/^対象となる役員の員数\((人|名)\)$/.test(norm(countPath.map(p=>p.raw).join(""))):
    text(0,0)!=="氏名"||text(0,1)!=="連結報酬等の総額("+total[1]+")"||text(0,2)!=="役員区分"||text(0,3)!=="会社区分")||
   columns.some(c=>cell(0,c)!==cell(0,firstComponent)||t.cells[cell(h-1,c)!].columnSpan!==1)||components.some(c=>!c.path.length||c.path.some(p=>!norm(p.raw)||/[％%]/.test(p.raw)||!/[A-Za-z\u3040-\u30ff\u3400-\u9fff]/.test(norm(p.raw))))||new Set(components.map(c=>JSON.stringify(c.path.map(p=>norm(p.raw))))).size!==columns.length){diag("unsupported-layout",tableIndex);continue;}
  const headerLabels=Array.from({length:h},(_,r)=>r).some(r=>
   (kind==="category"?Array.from({length:totalColumn},(_,c)=>text(r,c)).some(s=>s!==""&&s!=="役員区分"):
    [0,2,3].some(c=>text(r,c)!==text(0,c)))||text(r,totalColumn)!==""&&text(r,totalColumn)!==text(0,totalColumn));
  if(headerLabels){diag("unsupported-layout",tableIndex);continue;}
  // 見出しが明細行へ延びる結合は、実績額と見出しを混在させるため採用しません。
  if(t.cells.some(c=>c.row<h&&c.row+c.rowSpan>h)){diag("unsupported-layout",tableIndex);continue;}
  const amountMultiplier=multiplier(total[1]),value=(r:number,c:number,unit:"JPY"|"people"="JPY"):RemunerationValue=>{
   const ref=reference(r,c),m=unit==="people"?1:amountMultiplier,parsed=parseReportedTableNumber(ref.raw.trim(),m);
   const selected=unit==="people"&&parsed.status==="numeric"&&!/^\d+(?:\.0+)?$/.test(parsed.decimal)?{status:"unavailable" as const,reason:"non-integer-people" as const}:parsed;
   return {...ref,headers:headerPath(t,h,c),unit,multiplier:m,...selected};
  };
  const base=(rowIndex:number,role:"detail"|"reported-total"):EntryBase=>({entryKey:createHash("sha256").update(JSON.stringify([d.selection.docID,source.source.rawSha256,tableIndex,rowIndex,kind,d.period])).digest("hex"),tableIndex,rowIndex,role,period:{...d.period},periodBasis:"caller-reviewed",identity:"unresolved",paymentBasis:"reported-not-verified-cash-payment",total:value(rowIndex,totalColumn)});
  const numericCells=(r:number,cols:readonly number[])=>new Set(cols.map(c=>cell(r,c))).size===cols.length&&cols.every(c=>{const x=t.cells[cell(r,c)!];return x.rowSpan===1&&x.columnSpan===1;});
  const rowComponents=(r:number)=>components.map(c=>({path:c.path,value:value(r,c.column)}));
  for(let r=h;r<t.grid.length;){
   if(kind==="category"){
    const labelIDs=[...new Set(Array.from({length:totalColumn},(_,c)=>cell(r,c)!))],categories=labelIDs.map(i=>({cellIndex:i,raw:t.cells[i].parsedText}));
    if(categories.some(p=>!norm(p.raw))||labelIDs.some(i=>t.cells[i].column+t.cells[i].columnSpan>totalColumn)||!numericCells(r,[totalColumn,...columns,width-1])){diag("ambiguous-row",tableIndex,r);r++;continue;}
    const role=categories.some(p=>["計","合計","総計"].includes(norm(p.raw)))?"reported-total":"detail";
    result.entries.push({...base(r,role),kind,categories,recipientCount:value(r,width-1,"people"),components:rowComponents(r)});r++;continue;
   }
   const nameCell=t.cells[cell(r,0)!],totalCell=t.cells[cell(r,1)!],span=nameCell.rowSpan;
   let good=nameCell.row===r&&nameCell.columnSpan===1&&totalCell.row===r&&totalCell.rowSpan===span&&totalCell.columnSpan===1&&r+span<=t.grid.length&&!!text(r,0);
   for(let next=r;good&&next<r+span;next++){
    const position=t.cells[cell(next,2)!];
    good=cell(next,0)===cell(r,0)&&cell(next,1)===cell(r,1)&&position.columnSpan===1&&position.row>=r&&position.row+position.rowSpan<=r+span&&!!text(next,2)&&!!text(next,3)&&numericCells(next,[3,...columns]);
   }
   if(!good){diag("ambiguous-row",tableIndex,r);r++;continue;}
   result.entries.push({...base(r,"detail"),kind,name:reference(r,0),contributions:Array.from({length:span},(_,i)=>({rowIndex:r+i,position:reference(r+i,2),company:reference(r+i,3),components:rowComponents(r+i)}))});r+=span;
  }
 }
 return result;
}
export interface RemunerationSearchOptions {kind:"category"|"individual";period:{startDate:string;endDate:string};role:"detail"|"reported-total";metric:"total"|"recipientCount"|"component";componentPath?:readonly string[];labelContains?:string;companyContains?:string;condition?:{operator:ComparisonOperator;value:number};sort?:"value-asc"|"value-desc";offset?:number;limit?:number;}
const fraction=(s:string)=>{const [i,f=""]=s.split(".");return {numerator:BigInt(i+f),denominator:10n**BigInt(f.length)};};
export function searchOfficerRemuneration(documents:readonly RemunerationDocument[],options:RemunerationSearchOptions){
 if(!Array.isArray(documents)||!options?.period)throw new Error("役員報酬検索は100原本以下で対象期間が必要です");
 const documentCount=documents.length;if(!Number.isSafeInteger(documentCount)||documentCount<0||documentCount>100)throw new Error("検索原本は100件以下です");
 const {kind,period,role,metric,componentPath,labelContains,companyContains,condition,sort,offset=0,limit=100}=options;
 if(!["category","individual"].includes(kind)||!validDate(period.startDate)||!validDate(period.endDate)||period.startDate>=period.endDate||!["detail","reported-total"].includes(role)||!["total","recipientCount","component"].includes(metric)||kind==="individual"&&(metric==="recipientCount"||role==="reported-total")||
  (metric==="component"? !Array.isArray(componentPath)||!componentPath.length||componentPath.length>5||Array.from({length:componentPath.length},(_,i)=>componentPath[i]).some(s=>typeof s!=="string"||!s.trim()||s.length>1000):componentPath!==undefined)||
  [labelContains,companyContains].some(s=>s!==undefined&&(typeof s!=="string"||!s.trim()||s.length>1000))||companyContains!==undefined&&(kind!=="individual"||metric!=="component")||
  condition!==undefined&&(!condition||typeof condition!=="object"||Array.isArray(condition)||!["gt","gte","lt","lte","eq"].includes(condition.operator)||!Number.isFinite(condition.value))||sort!==undefined&&!["value-asc","value-desc"].includes(sort)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>1000)throw new Error("役員報酬検索の種類/期間/指標/内訳見出し/条件を確認してください");
 const inputs=Array.from({length:documentCount},(_,i)=>{if(!Object.hasOwn(documents,i))throw new Error("検索原本の配列要素が欠落しています");return capture(documents[i]);}).sort((a,b)=>a.selection.docID<b.selection.docID?-1:a.selection.docID>b.selection.docID?1:0);
 if(inputs.some(d=>typeof d.xml!=="string")||inputs.reduce((n,d)=>n+Buffer.byteLength(d.xml),0)>256*1024*1024||new Set(inputs.map(d=>d.selection.docID)).size!==inputs.length)throw new Error("役員報酬原本の重複/上限を確認してください");
 const extractions:RemunerationExtraction[]=[],rows:{sourceIndex:number;entry:RemunerationEntry;value:RemunerationValue;contributionIndex?:number}[]=[],excluded:{sourceIndex:number;entryKey:string;contributionIndex?:number;reason:string}[]=[],issuers=new Set<string>();let filtered=0,count=0,cells=0;
 for(const d of inputs){
  const extraction=extractOfficerRemuneration(d),sourceIndex=extractions.length,entity=extraction.source.source.entity;
  if(entity){const id=JSON.stringify([entity.scheme,entity.identifier]);if(issuers.has(id))throw new Error("同一提出者の訂正版/対象年度は先に選択してください");issuers.add(id);}
  count+=extraction.entries.reduce((n,e)=>n+(e.kind==="individual"?e.contributions.length:1),0);cells+=extraction.source.tables.reduce((n,t)=>n+t.cells.length,0);if(count>10000||cells>100000)throw new Error("役員報酬検索は10000記載/100000セル以下です");extractions.push(extraction);
  for(const entry of extraction.entries){
   const labels=entry.kind==="individual"?[entry.name]:entry.categories;
   if(entry.kind!==kind||entry.role!==role||entry.period.startDate!==period.startDate||entry.period.endDate!==period.endDate||labelContains!==undefined&&!labels.some(l=>l.raw.includes(labelContains))){filtered++;continue;}
   const selected:{value?:RemunerationValue;contributionIndex?:number}[]=[];
   if(metric==="total")selected.push({value:entry.total});
   else if(metric==="recipientCount"&&entry.kind==="category")selected.push({value:entry.recipientCount});
   else{
    const contributions:{components:RemunerationComponent[];company?:RemunerationCellReference}[]=entry.kind==="category"?[{components:entry.components}]:entry.contributions;
    for(const [index,contribution] of contributions.entries()){
     if(companyContains!==undefined&&!contribution.company?.raw.includes(companyContains)){filtered++;continue;}
     const component=contribution.components.find(c=>c.path.length===componentPath!.length&&c.path.every((p,i)=>norm(p.raw)===norm(componentPath![i])));
     selected.push({value:component?.value,...(entry.kind==="individual"?{contributionIndex:index}:{})});
    }
   }
   for(const {value,contributionIndex} of selected){
    if(!value||value.status!=="numeric"){excluded.push({sourceIndex,entryKey:entry.entryKey,...(contributionIndex!==undefined?{contributionIndex}:{}),reason:value?.reason??"component-not-reported"});continue;}
    if(condition){const n=compareFractions(fraction(value.decimal),decimalFraction(condition.value));if(!(condition.operator==="gt"?n>0:condition.operator==="gte"?n>=0:condition.operator==="lt"?n<0:condition.operator==="lte"?n<=0:n===0)){filtered++;continue;}}
    rows.push({sourceIndex,entry,value,...(contributionIndex!==undefined?{contributionIndex}:{})});
   }
  }
 }
 if(sort)rows.sort((a,b)=>a.value.status==="numeric"&&b.value.status==="numeric"?compareFractions(fraction(a.value.decimal),fraction(b.value.decimal))*(sort==="value-asc"?1:-1):0);
 return {extractions,rows:rows.slice(offset,offset+limit),matched:rows.length,filtered,excluded};
}
