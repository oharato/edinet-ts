import {createHash} from "node:crypto";
import {selectDocumentVersions,type DocumentVersionObservation} from "./document-version-selection";
import {createAutomaticFinancialSnapshots,normalizeAutomaticFinancialDetailMetricIds,AutomaticFinancialProjectionError,type AutomaticFinancialSnapshotOptions,type AutomaticFinancialSnapshots} from "./automatic-financial-snapshots";
import {parseDocumentTimestamp as timestamp} from "./document-timestamp";
export const OBSERVED_FINANCIAL_SNAPSHOT_VERSION="8";
export interface ObservedFinancialSource {docID:string;availableAt:string;sourceSha256:string;xml?:string;}
export interface ObservedFinancialSnapshotOptions extends Pick<AutomaticFinancialSnapshotOptions,"detailMetricIds"> {cutoff:string;}
export interface ObservedFinancialSnapshotRecord {
 rootDocID:string;docID:string;chainDocIDs:string[];observationIds:string[];knownAt:string;sourceSha256:string;
 /** 選択された一原本の直接結果。訂正差分と親原本を合成した完全版ではありません。 */
 result:AutomaticFinancialSnapshots;
}
export type ObservedFinancialSourceReason="xbrl-not-provided"|"source-missing"|"not-available-at-cutoff"|"source-before-submission"|"source-not-loaded"|"source-hash-mismatch"|"source-parse-failed"|"issuer-mismatch"|"security-code-mismatch"|"period-mismatch"|"report-type-mismatch"|"metric-projection-mismatch"|"correction-target-mismatch";
/** 内部共有: 原本宣言を一回取得して検証します。 */
export function captureObservedFinancialSources(sources:readonly ObservedFinancialSource[]){
 if(!Array.isArray(sources))throw new Error("財務原本は100件以下です");
 const length=sources.length;
 if(!Number.isSafeInteger(length)||length<0||length>100)throw new Error("財務原本は100件以下です");
 const inputs=Array.from({length},(_,i)=>{
  if(!Object.hasOwn(sources,i))throw new Error("原本に疎配列は使えません");
  const s=sources[i];
  if(!s||typeof s!=="object"||Array.isArray(s)||Object.keys(s).some(k=>!["docID","availableAt","sourceSha256","xml"].includes(k)))throw new Error("財務原本宣言が不正です");
  const {docID,availableAt,sourceSha256,xml}=s;
  if(typeof docID!=="string"||!docID.trim()||docID!==docID.trim()||docID.length>256||/[\x00-\x1f\x7f-\x9f]/.test(docID)||timestamp(availableAt,true)===undefined||typeof sourceSha256!=="string"||!/[a-f0-9]{64}/.test(sourceSha256)||sourceSha256.length!==64||xml!==undefined&&typeof xml!=="string")throw new Error("財務原本のID/取得日時/hash/XMLを確認してください");
  return {docID,availableAt,sourceSha256,xml};
 });
 if(new Set(inputs.map(s=>s.docID)).size!==length||inputs.reduce((n,s)=>n+Buffer.byteLength(s.xml??""),0)>256*1024*1024)throw new Error("財務原本の重複/合計上限を確認してください");
 return inputs;
}
/** 観測系列・原本hash・DEIを接続。選択された原本を利用できなくても親へ戻しません。 */
export function createObservedFinancialSnapshots(observations:readonly DocumentVersionObservation[],sources:readonly ObservedFinancialSource[],options:ObservedFinancialSnapshotOptions){
 return createObservedFinancialSnapshotsUsing(observations,sources,options,createAutomaticFinancialSnapshots);
}
/** 保存系の失敗を、通常の原本解析失敗へ読み替えないための内部境界です。 */
export class ObservedFinancialResolutionFatalError extends Error {}
class SourceUnavailable extends Error {constructor(readonly reason:ObservedFinancialSourceReason){super(reason)}}
/** 内部入口: 永続キャッシュも同じ観測/原本照合を通します。 */
export function createObservedFinancialSnapshotsUsing(observations:readonly DocumentVersionObservation[],sources:readonly ObservedFinancialSource[],options:ObservedFinancialSnapshotOptions,resolve:(xml:string,input:AutomaticFinancialSnapshotOptions)=>AutomaticFinancialSnapshots){
 return createObservedFinancialSnapshotsResolving(observations,sources,options,(source,input)=>{
  if(source.xml===undefined)throw new SourceUnavailable("source-not-loaded");
  if(createHash("sha256").update(source.xml).digest("hex")!==source.sourceSha256)throw new SourceUnavailable("source-hash-mismatch");
  return resolve(source.xml,input);
 });
}
export interface ObservedParsedFinancialSource extends Omit<ObservedFinancialSource,"xml"> {
 result?:AutomaticFinancialSnapshots;
 failure?:"source-not-loaded"|"source-parse-failed"|"metric-projection-mismatch";
}
/** 検査済み解析結果から構築。書類選択・時点・DEI・訂正対象の検査はXML入口と共有します。 */
export function createObservedFinancialSnapshotsFromParsed(observations:readonly DocumentVersionObservation[],sources:readonly ObservedParsedFinancialSource[],options:ObservedFinancialSnapshotOptions){
 if(!Array.isArray(sources)||sources.length>100)throw new Error("解析済み原本は100件以下です");
 const captured=Array.from(sources,source=>{
  if(!source||typeof source!=="object"||Array.isArray(source)||Object.keys(source).some(k=>!["docID","availableAt","sourceSha256","result","failure"].includes(k))||source.result!==undefined&&source.failure!==undefined||source.failure!==undefined&&!["source-not-loaded","source-parse-failed","metric-projection-mismatch"].includes(source.failure))throw new Error("解析済み原本宣言が不正です");
  return {...source};
 });
 const byID=new Map(captured.map(s=>[s.docID,s]));
 return createObservedFinancialSnapshotsResolving(observations,captured.map(({docID,availableAt,sourceSha256})=>({docID,availableAt,sourceSha256})),options,(source,input)=>{
  const parsed=byID.get(source.docID)!;
  if(parsed.failure||!parsed.result)throw new SourceUnavailable(parsed.failure??"source-not-loaded");
  const result=parsed.result;
  if(input.detailMetricIds&&result.status==="resolved"&&result.details.status==="created"&&JSON.stringify(Object.keys(result.details.snapshot.selections).sort())!==JSON.stringify([...input.detailMetricIds].sort()))throw new SourceUnavailable("metric-projection-mismatch");
  return result;
 });
}
/** 内部入口: 永続キャッシュも同じ観測/原本照合を通します。 */
function createObservedFinancialSnapshotsResolving(observations:readonly DocumentVersionObservation[],sources:readonly ObservedFinancialSource[],options:ObservedFinancialSnapshotOptions,resolve:(source:ObservedFinancialSource,input:AutomaticFinancialSnapshotOptions)=>AutomaticFinancialSnapshots){
 if(!options||typeof options!=="object"||Array.isArray(options)||Object.keys(options).some(k=>!["cutoff","detailMetricIds"].includes(k)))throw new Error("観測cutoffと明細項目を指定してください");
 const cutoff=options.cutoff,requested=options.detailMetricIds;
 // 原本の有無に依存せず、指定項目を検証して固定します。
 const detailMetricIds=normalizeAutomaticFinancialDetailMetricIds(requested);
 const selection=selectDocumentVersions(observations,cutoff),cut=timestamp(cutoff,true)!;
 const inputs=captureObservedFinancialSources(sources);
 const byID=new Map(inputs.map(s=>[s.docID,s])),records:ObservedFinancialSnapshotRecord[]=[],unavailableSources:{rootDocID:string;docID:string;reason:ObservedFinancialSourceReason}[]=[];
 for(const selected of selection.selected){
  const d=selected.observation.document,docID=d.docID,s=byID.get(docID);
  const fail=(reason:ObservedFinancialSourceReason)=>unavailableSources.push({rootDocID:selected.rootDocID,docID,reason});
  if(!s){fail(selected.formatAvailability?.formats.xbrl.state==="not-provided"?"xbrl-not-provided":"source-missing");continue;}
  const available=timestamp(s.availableAt,true)!;
  if(available>cut){fail("not-available-at-cutoff");continue;}
  if(available<timestamp(d.submitDateTime,false)!){fail("source-before-submission");continue;}
  let result:AutomaticFinancialSnapshots;
  try{result=resolve(s,{docID,detailMetricIds});}catch(error){if(error instanceof ObservedFinancialResolutionFatalError)throw error;if(error instanceof SourceUnavailable){fail(error.reason);continue;}fail(error instanceof AutomaticFinancialProjectionError?"metric-projection-mismatch":"source-parse-failed");continue;}
  if(result.inputXmlSha256!==s.sourceSha256||result.basis.docID!==docID||result.basis.inputXmlSha256!==s.sourceSha256)throw new ObservedFinancialResolutionFatalError("解析結果と原本宣言が不一致です");
  if(result.basis.status==="selected"){
   const m=result.basis.metadata,p=selected.targetPeriod;
   if(selected.chainDocIDs.length>1&&m.amendmentTargetDocID!==undefined&&(m.amendmentTargetDocID===docID||!selected.chainDocIDs.slice(0,-1).includes(m.amendmentTargetDocID))){fail("correction-target-mismatch");continue;}
   if(m.edinetCode!==d.edinetCode){fail("issuer-mismatch");continue;}
   if(d.secCode&&m.securityCode!==d.secCode){fail("security-code-mismatch");continue;}
   const code=m.reportingPeriodCode,type=d.docTypeCode;
   // 半期一覧の実例には事業年度/半期累計の両方がある。原本の宣言期間と完全一致させる。
   const listedPeriods=["160","170"].includes(type!)?[m.fiscalYear,m.period]:
    [["140","150"].includes(type!)&&(code==="Q2"||code==="Q3"||code==="Q4")?m.quarterPeriod:m.period];
   if(!listedPeriods.some(period=>period&&period.startDate===p.startDate&&period.endDate===p.endDate)){fail("period-mismatch");continue;}
   if(!(["120","130"].includes(type!)?code==="FY":["140","150"].includes(type!)?["Q1","Q2","Q3","Q4"].includes(code):["HY","Q2"].includes(code))){fail("report-type-mismatch");continue;}
  }
  records.push({rootDocID:selected.rootDocID,docID,chainDocIDs:[...selected.chainDocIDs],observationIds:[...selected.observationIds],knownAt:new Date(Math.max(available,timestamp(selected.observedAt,true)!)).toISOString(),sourceSha256:s.sourceSha256,result});
 }
 return {selection,records,unavailableSources};
}
