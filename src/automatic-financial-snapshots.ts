import {createHash} from "node:crypto";
import {resolveFinancialReportingBasis,type FinancialReportingBasis} from "./financial-reporting-basis";
import {createBalanceSheetSnapshot,type BalanceSheetSnapshot} from "./balance-sheet-screening";
import {createFinancialDetailSnapshot,type FinancialDetailSnapshot} from "./financial-detail-screening";
import {createIfrsBalanceSheetSnapshot,type IfrsBalanceSheetSnapshot} from "./ifrs-balance-sheet-screening";
import {createIfrsFinancialDetailSnapshot,type IfrsFinancialDetailSnapshot} from "./ifrs-financial-detail-screening";
import {FINANCIAL_DETAIL_REGISTRY,DEFAULT_FINANCIAL_DETAIL_METRICS,type FinancialDetailMetricId} from "./financial-detail-registry";
import {IFRS_FINANCIAL_DETAIL_REGISTRY,DEFAULT_IFRS_FINANCIAL_DETAIL_METRICS,type IfrsFinancialDetailMetricId} from "./ifrs-financial-detail-registry";
export interface AutomaticFinancialSnapshotOptions {docID:string;detailMetricIds?:readonly (FinancialDetailMetricId|IfrsFinancialDetailMetricId)[];}
type SnapshotOutcome<T>={status:"created";snapshot:T}|{status:"unavailable";reason:"current-period-context-absent"|"duplicate-current-period-context"};
export type AutomaticFinancialSnapshots={inputXmlSha256:string;targetCurrency:"JPY"}&(
 {status:"unresolved";reason:"basis-unresolved"|"security-code-unavailable"|"unsupported-ifrs-scope";basis:FinancialReportingBasis}|
 {status:"resolved";accountingStandard:"J-GAAP";basis:Extract<FinancialReportingBasis,{status:"selected"}>;balanceSheet:SnapshotOutcome<BalanceSheetSnapshot>;details:SnapshotOutcome<FinancialDetailSnapshot>}|
 {status:"resolved";accountingStandard:"IFRS";basis:Extract<FinancialReportingBasis,{status:"selected"}>;balanceSheet:SnapshotOutcome<IfrsBalanceSheetSnapshot>;details:SnapshotOutcome<IfrsFinancialDetailSnapshot>}
);
/** 内部共有: 原本がない入口でも同じ項目検証を適用します。 */
export function normalizeAutomaticFinancialDetailMetricIds(requested:AutomaticFinancialSnapshotOptions["detailMetricIds"]){
 let metrics:(FinancialDetailMetricId|IfrsFinancialDetailMetricId)[]|undefined;
 if(requested!==undefined){
  if(!Array.isArray(requested))throw new Error("明細項目は配列です");
  const length=requested.length;
  if(!Number.isSafeInteger(length)||length<1||length>50)throw new Error("明細項目は空でない50件以下の配列です");
  metrics=Array.from({length},(_,i)=>{if(!Object.hasOwn(requested,i))throw new Error("疎配列は使えません");return requested[i];});
  if(new Set(metrics).size!==metrics.length||metrics.some(id=>typeof id!=="string"||!Object.hasOwn(FINANCIAL_DETAIL_REGISTRY,id)&&!Object.hasOwn(IFRS_FINANCIAL_DETAIL_REGISTRY,id)))throw new Error("未知/重複/未記録の明細項目があります");
 }
 return metrics;
}
export class AutomaticFinancialProjectionError extends Error {}
/** 宣言のない基準へフォールバックしません。対象はDEIの当期・主たる財務範囲です。 */
export function createAutomaticFinancialSnapshots(xml:string,input:AutomaticFinancialSnapshotOptions):AutomaticFinancialSnapshots{
 if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).some(k=>!["docID","detailMetricIds"].includes(k)))throw new Error("書類IDと明示するduration明細だけを指定してください");
 const docID=input.docID,requested=input.detailMetricIds;
 const metrics=normalizeAutomaticFinancialDetailMetricIds(requested);
 const basis=resolveFinancialReportingBasis(xml,docID),inputXmlSha256=createHash("sha256").update(xml).digest("hex");
 if(basis.status!=="selected")return {status:"unresolved",reason:"basis-unresolved",basis,inputXmlSha256,targetCurrency:"JPY"};
 const m=basis.metadata;
 if(!m.securityCode)return {status:"unresolved",reason:"security-code-unavailable",basis,inputXmlSha256,targetCurrency:"JPY"};
 const unavailable=(periodKind:"instant"|"duration"):SnapshotOutcome<never>=>({status:"unavailable",reason:m.contexts.blockedDuplicateContexts.some(c=>c.periodKind===periodKind)?"duplicate-current-period-context":"current-period-context-absent"});
 const common={secCode:m.securityCode,docID,scope:m.scope,accountingStandard:m.accountingStandard,currency:"JPY" as const};
 // shortcut: 既存snapshotの検証契約を再利用するため最大3回解析。大量取り込みは解析済みobject共用へ移行します。
 if(m.accountingStandard==="J-GAAP"){
  const chosen=metrics??DEFAULT_FINANCIAL_DETAIL_METRICS.filter(id=>FINANCIAL_DETAIL_REGISTRY[id].periodType==="duration");
  if(chosen.some(id=>!Object.hasOwn(FINANCIAL_DETAIL_REGISTRY,id)||FINANCIAL_DETAIL_REGISTRY[id as FinancialDetailMetricId].periodType!=="duration"))throw new AutomaticFinancialProjectionError("日本基準のduration明細だけを指定してください");
  return {status:"resolved",accountingStandard:"J-GAAP",basis,inputXmlSha256,targetCurrency:"JPY",
   balanceSheet:m.contexts.instant.length?{status:"created",snapshot:createBalanceSheetSnapshot(xml,{...common,accountingStandard:"J-GAAP",instant:m.instant})}:unavailable("instant"),
   details:m.contexts.duration.length?{status:"created",snapshot:createFinancialDetailSnapshot(xml,{...common,accountingStandard:"J-GAAP",period:m.period,periodType:m.periodType},chosen as FinancialDetailMetricId[])}:unavailable("duration")};
 }
 if(m.scope!=="Consolidated")return {status:"unresolved",reason:"unsupported-ifrs-scope",basis,inputXmlSha256,targetCurrency:"JPY"};
 const chosen=metrics??[...DEFAULT_IFRS_FINANCIAL_DETAIL_METRICS];
 if(chosen.some(id=>!Object.hasOwn(IFRS_FINANCIAL_DETAIL_REGISTRY,id)))throw new AutomaticFinancialProjectionError("IFRSのduration明細だけを指定してください");
 return {status:"resolved",accountingStandard:"IFRS",basis,inputXmlSha256,targetCurrency:"JPY",
  balanceSheet:m.contexts.instant.length?{status:"created",snapshot:createIfrsBalanceSheetSnapshot(xml,{...common,accountingStandard:"IFRS",scope:"Consolidated",instant:m.instant})}:unavailable("instant"),
  details:m.contexts.duration.length?{status:"created",snapshot:createIfrsFinancialDetailSnapshot(xml,{...common,accountingStandard:"IFRS",scope:"Consolidated",period:m.period,periodType:m.periodType},chosen as IfrsFinancialDetailMetricId[])}:unavailable("duration")};
}
