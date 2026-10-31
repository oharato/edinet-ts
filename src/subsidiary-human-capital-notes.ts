import {createHash} from 'node:crypto';
import {parseDisclosureTableFragment,type DisclosureTable} from './disclosure-tables';
import type {EdinetData} from './edinet-xbrl-object';
import type {FinancialReportingBasis} from './financial-reporting-basis';
import type {ChildcareCalculationMethod,SubsidiaryHumanCapitalAnnotation,SubsidiaryHumanCapitalMetricId,SubsidiaryHumanCapitalMetricsExtraction,SubsidiaryHumanCapitalNoteProof} from './subsidiary-human-capital-metrics';

export interface SubsidiaryHumanCapitalAutoNoteEvidence {
 rowKey:string;metric:SubsidiaryHumanCapitalMetricId;tableIndex:number;row:number;cellIndex:number;
 noteNumber:number;noteText:string;cellText:string;proof:SubsidiaryHumanCapitalNoteProof;
 annotation:SubsidiaryHumanCapitalAnnotation;
}
export interface SubsidiaryHumanCapitalNoteInterpretation {
 version:'1';status:'matched'|'unresolved';reason?:string;proof?:SubsidiaryHumanCapitalNoteProof;
 reportingPeriod?:{startDate:string;endDate:string};
 matched:SubsidiaryHumanCapitalAutoNoteEvidence[];
 unresolved:{rowKey:string;metric:SubsidiaryHumanCapitalMetricId;reason:string}[];
}
const normal=(s:string)=>s.normalize('NFKC').replace(/\s/g,'');
const label=(s:string)=>s.replace(/[\r\n]/g,'').trim();
const women=normal('「女性の職業生活における活躍の推進に関する法律」（平成27年法律第64号）の規定に基づき算出したものであります。');
const ordinance=normal('「育児休業、介護休業等育児又は家族介護を行う労働者の福祉に関する法律」（平成3年法律第76号）の規定に基づき、「育児休業、介護休業等育児又は家族介護を行う労働者の福祉に関する法律施行規則」（平成3年労働省令第25号）');
function method(text:string):ChildcareCalculationMethod|undefined {
 const s=normal(text);
 if(s===women)return 'womens-act';
 if([ordinance+'第71条の6第2号',ordinance+'第71条の6の第2号'].some(prefix=>s===prefix+'における育児休業等及び育児目的休暇の取得割合を算出したものであります。'))return 'ordinance-item2';
}
function references(text:string):number[]{
 return [...new Set([...normal(text).matchAll(/\(注\)?(\d{1,2}(?:[、,]\d{1,2})*)\)?/g)].flatMap(m=>m[1].split(/[、,]/).map(Number)))];
}
function footnotes(text:string):Map<number,string|undefined>{
 const lines=text.normalize('NFKC').split('\n'),kept:string[]=[];
 for(const line of lines){if(/^\s*\(\d+\)/.test(line))break;kept.push(line);}
 const scope=kept.join('\n'),starts=[...scope.matchAll(/(?:^|\n)\s*(?:\(注\)\s*)?(\d{1,2})[.．]/g)],notes=new Map<number,string|undefined>();
 for(let i=0;i<starts.length;i++){
  const m=starts[i],id=Number(m[1]),body=scope.slice(m.index!+m[0].length,starts[i+1]?.index??scope.length).trim();
  notes.set(id,notes.has(id)||body.length>4096?undefined:body);
 }
 return notes;
}
const cell=(t:DisclosureTable,r:number,c:number)=>{const index=t.grid[r]?.[c];return index===null||index===undefined?undefined:t.cells[index];};
function layout(t:DisclosureTable):'split-workers'|'two-methods'|undefined {
 const h=(r:number,c:number)=>normal(cell(t,r,c)?.parsedText??'');
 if(t.grid.length<4||h(0,0)!=='当事業年度'||h(1,0)!=='名称'||!h(1,1).includes('女性労働者の割合')||!h(1,2).startsWith('男性労働者の育児休業取得率(%)'))return;
 if(t.grid[0].length===8&&cell(t,1,2)?.columnSpan===3&&h(2,2)==='全労働者'&&h(2,3)==='正規労働者'&&h(2,4)==='非正規労働者'&&h(1,5).startsWith('労働者の男女の賃金の額の差異(%)')&&h(2,5)==='全労働者'&&h(2,6)==='うち正規労働者'&&h(2,7)==='うち非正規労働者')return 'split-workers';
 if(t.grid[0].length===7&&cell(t,1,2)?.columnSpan===2&&h(2,2).startsWith('育児休業取得率(%)')&&h(2,3).startsWith('育児休業等及び育児目的休暇の取得率(%)')&&h(1,4).startsWith('労働者の男女の賃金の差異(%)')&&h(2,4)==='全労働者'&&h(2,5)==='正規雇用労働者'&&h(2,6)==='パート・有期労働者')return 'two-methods';
}
function fraction(s:string):{n:bigint;d:bigint}|undefined{
 if(s.length>128||!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s))return;
 const [a,b='']=s.replace(/^\+/,'').split('.');return{n:BigInt((a||'0')+b),d:10n**BigInt(b.length)};
}
function displayed(text:string):string{
 const value=text.replace(/[！-～]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xfee0))
  .replace(/\(注\)?\s*\d{1,2}(?:\s*[、,]\s*\d{1,2})*\)?/g,'').trim();
 if(/\s/.test(value)||value.includes(',')&&!/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?$/.test(value))return '!';
 return value.replaceAll(',','');
}
function equalPercent(raw:string,text:string):boolean{
 const a=fraction(raw),b=fraction(displayed(text));return !!a&&!!b&&a.n*100n*b.d===b.n*a.d;
}
/** Internal: classify only the reviewed layouts and exact note sentences. Unknown links stay unconfirmed. */
export function interpretSubsidiaryHumanCapitalNotes(base:SubsidiaryHumanCapitalMetricsExtraction,notes:readonly EdinetData[],basis:FinancialReportingBasis|undefined){
 const annotations:SubsidiaryHumanCapitalAnnotation[]=[],interpretation:SubsidiaryHumanCapitalNoteInterpretation={version:'1',status:'unresolved',matched:[],unresolved:[]};
 const unavailable=(reason:string)=>{interpretation.reason=reason;return{annotations,interpretation};};
 const note=notes[0];
 if(notes.length!==1||note.namespaceURI!=='http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2025-11-01/jpcrp_cor'||note.nil||note.unitRef||typeof note.rawValue!=='string')return unavailable('note-unavailable');
 const fields=basis?.fields,ends=fields?[fields.fiscalYearEnd,fields.currentPeriodEnd,fields.currentPeriodType,fields.fiscalYearStart]:[];
 if(ends.length!==4||ends.some(f=>f.status!=='selected')||!base.submitterEntity)return unavailable('period-unbound');
 const [fy,end,type,start]=ends;
 if(fy.status!=='selected'||end.status!=='selected'||type.status!=='selected'||fy.raw!==base.metadata.instant||end.raw!==base.metadata.instant||type.raw!=='FY'||ends.some(f=>f.status!=='selected'||f.source.contextRef!==note.contextRef||f.source.period?.instant===undefined||f.source.period.instant<base.metadata.instant||f.source.entity?.identifier!==base.submitterEntity?.identifier||f.source.entity?.scheme!==base.submitterEntity?.scheme))return unavailable('period-unbound');
 if(start.status!=='selected'||start.raw>end.raw)return unavailable('period-unbound');
 interpretation.reportingPeriod={startDate:start.raw,endDate:end.raw};
 const proof:SubsidiaryHumanCapitalNoteProof={key:'jpcrp_cor:InformationAboutEmployeesTextBlock',contextRef:note.contextRef,rawSha256:createHash('sha256').update(note.rawValue).digest('hex')};interpretation.proof=proof;
 let parsed:ReturnType<typeof parseDisclosureTableFragment>;
 try{parsed=parseDisclosureTableFragment(note.rawValue,true);}catch{return unavailable('unsupported-fragment');}
 type Located={table:DisclosureTable;row:number;kind:'split-workers'|'two-methods';notes:Map<number,string|undefined>};
 const located=new Map<string,Located[]>();
 for(let i=0;i<parsed.tables.length;i++){
  const first=parsed.tables[i],kind=layout(first);if(!kind)continue;
  const heading=(first.precedingText??'').trim().split('\n').filter(s=>s.trim()).at(-1)??'';
  if(!/^(?:\(?\d+\)?[.)]?)?(?:主要な)?連結子会社$/.test(normal(heading)))continue;
  const signature=(t:DisclosureTable)=>JSON.stringify(t.grid.slice(0,3).map(row=>row.map(index=>index===null?'':normal(t.cells[index].parsedText))));
  let last=i;while(last+1<parsed.tables.length&&!(parsed.tables[last+1].precedingText??'').trim()&&layout(parsed.tables[last+1])===kind&&signature(parsed.tables[last+1])===signature(first))last++;
  const scope=footnotes(parsed.tables[last+1]?.precedingText??parsed.trailingText??'');
  for(let n=i;n<=last;n++){const table=parsed.tables[n];for(let row=3;row<table.grid.length;row++){
   const name=cell(table,row,0);if(!name||name.row!==row||name.rowSpan!==1||name.columnSpan!==1)continue;
   const key=label(name.parsedText),list=located.get(key)??[];list.push({table,row,kind,notes:scope});located.set(key,list);
  }}i=last;
 }
 const labels=new Map<string,number>(),ambiguousLabels=new Set<string>();
 for(const r of base.rows){
  if(r.label.status==='selected')labels.set(label(r.label.parsedLabel),(labels.get(label(r.label.parsedLabel))??0)+1);
  else for(const candidate of r.label.candidates)ambiguousLabels.add(label(candidate.parsedText));
 }
 for(const r of base.rows){if(r.label.status!=='selected')continue;const key=label(r.label.parsedLabel),matches=located.get(key)??[];
  for(const [metricId,s]of Object.entries(r.selections)){
   const metric=metricId as SubsidiaryHumanCapitalMetricId,isChild=metric.startsWith('maleChildcareLeave');if(!s||(s.reason!=='nil'&&!(isChild&&s.status==='reported')))continue;
   const miss=(reason:string)=>interpretation.unresolved.push({rowKey:r.label.rowKey!,metric,reason});
   if(labels.get(key)!==1||ambiguousLabels.has(key)||matches.length!==1){miss(matches.length?'ambiguous-row':'row-unmatched');continue;}
   const {table,row,kind,notes}=matches[0];
   const columns:Partial<Record<SubsidiaryHumanCapitalMetricId,number[]>>=kind==='split-workers'?{femaleManagerRatio:[1],maleChildcareLeaveReportedAllRatio:[2],maleChildcareLeaveReportedRegularRatio:[3],maleChildcareLeaveReportedNonRegularRatio:[4],genderWageAllRatio:[5],genderWageRegularRatio:[6],genderWageNonRegularRatio:[7]}:{femaleManagerRatio:[1],maleChildcareLeaveReportedAllRatio:[2,3],genderWageAllRatio:[4],genderWageRegularRatio:[5],genderWageNonRegularRatio:[6]};
   const candidates=(columns[metric]??[]).flatMap(column=>{
    const data=cell(table,row,column);if(!data||data.row!==row||data.rowSpan!==1||data.columnSpan!==1||data.nestedTableCount)return[];
    const nil=s.reason==='nil',text=displayed(data.parsedText);if(nil?!['-','―','—','−',''].includes(text):!('raw'in s)||typeof s.raw!=='string'||!equalPercent(s.raw,data.parsedText))return[];
    return[{column,data,cellIndex:table.grid[row][column]!}];
   });
   if(candidates.length!==1){miss(candidates.length?'ambiguous-column':'value-unmatched');continue;}
   const {column,data,cellIndex}=candidates[0];let found=false;
   const add=(annotation:SubsidiaryHumanCapitalAnnotation,noteNumber:number,noteText:string)=>{annotations.push(annotation);interpretation.matched.push({rowKey:r.label.rowKey!,metric,tableIndex:table.index,row,cellIndex,noteNumber,noteText,cellText:data.parsedText,proof,annotation});found=true;};
   const refs=references(data.parsedText),nonapp=refs.filter(id=>notes.get(id)!==undefined&&normal(notes.get(id)!)==='対象となる従業員はおりません。');
   if(s.reason==='nil'&&nonapp.length===1)add({kind:'unavailable',rowKey:r.label.rowKey!,metric,state:'not-applicable',proof},nonapp[0],notes.get(nonapp[0])!);
   if(isChild&&!nonapp.length){
    const headerRefs=[...new Set([0,1,2].flatMap(header=>references(cell(table,header,column)?.parsedText??'')))];
    const methods=headerRefs.flatMap(id=>{const text=notes.get(id),value=text===undefined?undefined:method(text);return value?[{id,text:text!,value}]:[];});
    if(methods.length===1)add({kind:'childcare-method',rowKey:r.label.rowKey!,metric,method:methods[0].value,proof},methods[0].id,methods[0].text);
   }
   if(!found)miss('note-unmatched');
  }
 }
 interpretation.status=annotations.length?'matched':'unresolved';return{annotations,interpretation};
}
