import {createHash} from "node:crypto";
import type {EdinetData} from "./edinet-xbrl-object";
import type {EdinetContext} from "./edinet-context";
import type {CompanyProfileEvidence,CompanyProfileReason} from "./company-profile";
import {EdinetXbrlParser} from "./edinet-xbrl-parser";
export const FINANCIAL_REPORTING_BASIS_VERSION="1";
const tags={
 edinetCode:"EDINETCodeDEI",securityCode:"SecurityCodeDEI",documentType:"DocumentTypeDEI",accountingStandard:"AccountingStandardsDEI",consolidated:"WhetherConsolidatedFinancialStatementsArePreparedDEI",
 fiscalYearStart:"CurrentFiscalYearStartDateDEI",fiscalYearEnd:"CurrentFiscalYearEndDateDEI",currentPeriodEnd:"CurrentPeriodEndDateDEI",currentPeriodType:"TypeOfCurrentPeriodDEI",
 consolidatedIndustry:"IndustryCodeWhenConsolidatedFinancialStatementsArePreparedInAccordanceWithIndustrySpecificRegulationsDEI",standaloneIndustry:"IndustryCodeWhenFinancialStatementsArePreparedInAccordanceWithIndustrySpecificRegulationsDEI"
} as const;
export type FinancialReportingBasisField=keyof typeof tags;
export interface ReportingBasisEvidence extends Omit<CompanyProfileEvidence,"reason"> {reason:CompanyProfileReason|"invalid-field-value";}
export type ReportingBasisFieldSelection={fieldId:FinancialReportingBasisField;reason:CompanyProfileReason|"invalid-field-value";evidence:ReportingBasisEvidence[]}&({status:"selected";raw:string;source:ReportingBasisEvidence}|{status:"missing"|"unsupported"|"ambiguous"});
export interface FinancialReportingBasisIssue {reason:"field-unavailable"|"inconsistent-dei-context"|"invalid-issuer"|"unsupported-standard"|"invalid-consolidated-flag"|"unsupported-period-code"|"unsupported-document-form"|"period-range-conflict";field?:FinancialReportingBasisField;}
export interface ResolvedFinancialReportingMetadata {
 accountingStandard:"J-GAAP"|"IFRS";scope:"Consolidated"|"NonConsolidated";edinetCode:string;securityCode?:string;
 documentType:string;reportingPeriodCode:"FY"|"HY"|"Q1"|"Q2"|"Q3";periodType:"annual"|"ytd";deiContextInstant:string;
 fiscalYear:{startDate:string;endDate:string};period:{startDate:string;endDate:string};instant:string;
 entity:{scheme:string;identifier:string};industryCode?:string;
 /** ID名から期間を推定せず、実際のperiod/entity/scopeで一致したcontextだけ。 */
 contexts:{duration:string[];instant:string[];blockedDuplicateContexts:{contextRef:string;periodKind:"duration"|"instant"}[]};
}
export type FinancialReportingBasis={docID:string;version:typeof FINANCIAL_REPORTING_BASIS_VERSION;inputXmlSha256?:string;fields:Record<FinancialReportingBasisField,ReportingBasisFieldSelection>;issues:FinancialReportingBasisIssue[]}&({status:"selected";metadata:ResolvedFinancialReportingMetadata}|{status:"unresolved"});
const date=(s:unknown):s is string=>typeof s==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const namespace=(s:string|undefined)=>{const m=/^http:\/\/disclosure\.edinet-fsa\.go\.jp\/taxonomy\/jpdei\/(\d{4}-\d{2}-\d{2})\/jpdei_cor$/.exec(s??"");return !!m&&date(m[1]);};
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
function assertDocID(docID:unknown):asserts docID is string{
 if(typeof docID!=="string"||!docID.trim()||docID.length>256||/[\x00-\x1f\x7f]/.test(docID))throw new Error("正しい書類IDが必要です");
}
/** DEIの宣言と実contextだけを照合。科目の存在やcontext ID名で基準/期間を推測しません。 */
export function selectFinancialReportingBasis(docID:string,facts:ReadonlyMap<string,readonly EdinetData[]>,contexts:ReadonlyMap<string,EdinetContext>,duplicates:ReadonlySet<string>):FinancialReportingBasis{
 assertDocID(docID);
 const entities=new Set([...contexts.values()].map(c=>c.entity?JSON.stringify([c.entity.scheme,c.entity.identifier]):"")),singleEntity=entities.size===1&&!entities.has("");
 const fields={} as FinancialReportingBasis["fields"];
 for(const [fieldId,tag] of Object.entries(tags) as [FinancialReportingBasisField,string][]){
  const evidence:ReportingBasisEvidence[]=[];
  for(const [key,list]of facts){
   if(key.split(":").at(-1)!==tag)continue;
   for(const fact of list){
    const contextRef=fact.contextRef,c=contexts.get(contextRef),item:ReportingBasisEvidence={docID,key,namespaceURI:fact.namespaceURI,contextRef,entity:c?.entity?{...c.entity}:undefined,period:c?{...c.period}:undefined,dimensions:c?[...c.dimensions]:undefined,rawDimensions:c?.rawDimensions===undefined?undefined:structuredClone(c.rawDimensions),raw:fact.rawValue,nil:fact.nil,unitRef:fact.unitRef,reason:"selected"};
    if(!namespace(item.namespaceURI))item.reason="unknown-namespace";
    else if(!c)item.reason="unknown-context";
    else if(duplicates.has(contextRef))item.reason="duplicate-context";
    else if(!c.namespaceVerified||!c.periodValid||!date(c.period.instant)||c.period.startDate!==undefined||c.period.endDate!==undefined)item.reason="unsupported-context";
    else if(!singleEntity)item.reason="unsupported-entity";
    else if(c.unsupportedDimensions||c.dimensions.length!==0)item.reason="unsupported-dimensions";
    else if(item.unitRef!=="")item.reason="unsupported-unit";
    else if(item.nil)item.reason="nil";
    else if(item.raw===undefined)item.reason="raw-unavailable";
    else if(!item.raw.trim())item.reason="empty-value";
    else if(item.raw.length>2048)item.reason="invalid-field-value";
    else if(["fiscalYearStart","fiscalYearEnd","currentPeriodEnd"].includes(fieldId)&&!date(item.raw))item.reason="invalid-date";
    evidence.push(item);
   }
  }
  let selected:ReportingBasisFieldSelection;
  if(evidence.some(e=>e.reason==="duplicate-context"))selected={fieldId,status:"ambiguous",reason:"duplicate-context",evidence};
  else if(evidence.length>1)selected={fieldId,status:"ambiguous",reason:"multiple-facts",evidence};
  else if(!evidence.length)selected={fieldId,status:"missing",reason:"tag-absent",evidence};
  else{
   const e=evidence[0];
   selected=e.reason==="selected"?{fieldId,status:"selected",reason:"selected",raw:e.raw!,source:e,evidence}:{fieldId,status:e.reason==="nil"||e.reason==="empty-value"?"missing":"unsupported",reason:e.reason,evidence};
  }
  fields[fieldId]=selected;
 }
 const issues:FinancialReportingBasisIssue[]=[],optional=new Set<FinancialReportingBasisField>(["securityCode","consolidatedIndustry","standaloneIndustry"]);
 for(const [field,s]of Object.entries(fields)as[FinancialReportingBasisField,ReportingBasisFieldSelection][])if(s.status!=="selected"&&(!optional.has(field)||s.status!=="missing"))issues.push({reason:"field-unavailable",field});
 const raw=(id:FinancialReportingBasisField)=>fields[id].status==="selected"?fields[id].raw:undefined;
 const selected=Object.values(fields).filter((s):s is ReportingBasisFieldSelection&{status:"selected"}=>s.status==="selected");
 if(new Set(selected.map(s=>JSON.stringify([s.source.entity?.scheme,s.source.entity?.identifier,s.source.period?.instant]))).size>1)issues.push({reason:"inconsistent-dei-context"});
 const issuer=raw("edinetCode"),entity=selected[0]?.source.entity,security=raw("securityCode");
 if(issuer!==undefined&&(!/^E\d{5}$/.test(issuer)||!entity||entity.scheme!=="http://disclosure.edinet-fsa.go.jp"||entity.identifier!==issuer+"-000")||security!==undefined&&!/^[0-9A-Z]{4}0$/.test(security))issues.push({reason:"invalid-issuer"});
 const standard=raw("accountingStandard"),flag=raw("consolidated"),periodCode=raw("currentPeriodType"),form=raw("documentType");
 if(standard!==undefined&&!["Japan GAAP","IFRS"].includes(standard))issues.push({reason:"unsupported-standard",field:"accountingStandard"});
 if(flag!==undefined&&!["true","false","1","0"].includes(flag))issues.push({reason:"invalid-consolidated-flag",field:"consolidated"});
 if(periodCode!==undefined&&!["FY","HY","Q1","Q2","Q3"].includes(periodCode))issues.push({reason:"unsupported-period-code",field:"currentPeriodType"});
 if(form!==undefined&&periodCode!==undefined&&!(periodCode==="FY"?form==="第三号様式":periodCode==="HY"?["第四号の三様式","第五号様式"].includes(form):form==="第四号の三様式"))issues.push({reason:"unsupported-document-form",field:"documentType"});
 const start=raw("fiscalYearStart"),end=raw("fiscalYearEnd"),currentEnd=raw("currentPeriodEnd"),filing=selected[0]?.source.period?.instant;
 if(start&&end&&currentEnd&&filing&&(start>currentEnd||currentEnd>end||currentEnd>filing||periodCode==="FY"&&currentEnd!==end||periodCode!=="FY"&&currentEnd>=end))issues.push({reason:"period-range-conflict"});
 const base={docID,version:FINANCIAL_REPORTING_BASIS_VERSION,fields,issues} satisfies Pick<FinancialReportingBasis,"docID"|"version"|"fields"|"issues">;
 if(issues.length)return structuredClone({...base,status:"unresolved"});
 const scope=flag==="true"||flag==="1"?"Consolidated":"NonConsolidated",duration:string[]=[],instant:string[]=[],blockedDuplicateContexts:{contextRef:string;periodKind:"duration"|"instant"}[]=[];
 for(const [id,c]of contexts){
  if(!c.namespaceVerified||!c.periodValid||c.unsupportedDimensions||c.scope!==scope||(c.entity?.scheme!==entity?.scheme||c.entity?.identifier!==entity?.identifier)||scope==="Consolidated"&&c.dimensions.length!==0||scope==="NonConsolidated"&&(c.dimensions.length!==1||c.dimensions[0]!=="NonConsolidatedMember"))continue;
  const durationMatch=c.period.startDate===start&&c.period.endDate===currentEnd&&c.period.instant===undefined,instantMatch=c.period.instant===currentEnd&&c.period.startDate===undefined&&c.period.endDate===undefined;
  if(!durationMatch&&!instantMatch)continue;
  if(duplicates.has(id)){blockedDuplicateContexts.push({contextRef:id,periodKind:durationMatch?"duration":"instant"});continue;}
  if(durationMatch)duration.push(id);if(instantMatch)instant.push(id);
 }
 const industryCode=raw(scope==="Consolidated"?"consolidatedIndustry":"standaloneIndustry");
 const metadata:ResolvedFinancialReportingMetadata={
  accountingStandard:standard==="IFRS"?"IFRS":"J-GAAP",scope,edinetCode:issuer!,
  ...(security?{securityCode:security}:{}),documentType:form!,
  reportingPeriodCode:periodCode as ResolvedFinancialReportingMetadata["reportingPeriodCode"],
  periodType:periodCode==="FY"?"annual":"ytd",deiContextInstant:filing!,
  fiscalYear:{startDate:start!,endDate:end!},period:{startDate:start!,endDate:currentEnd!},
  instant:currentEnd!,entity:entity!,...(industryCode!==undefined?{industryCode}:{}),
  contexts:{
   duration:duration.sort(compare),instant:instant.sort(compare),
   blockedDuplicateContexts:blockedDuplicateContexts.sort((a,b)=>compare(a.contextRef,b.contextRef))
  }
 };
 return structuredClone({...base,status:"selected",metadata});
}
export function resolveFinancialReportingBasis(xml:string,docID:string):FinancialReportingBasis{
 assertDocID(docID);
 const object=new EdinetXbrlParser().parse(xml,docID);
 return {...object.selectFinancialReportingBasis(),inputXmlSha256:createHash("sha256").update(xml).digest("hex")};
}
