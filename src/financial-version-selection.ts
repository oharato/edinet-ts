import type {DocumentVersionObservation,SelectedDocumentVersion} from './document-version-selection';
import type {ObservedFinancialSource} from './observed-financial-snapshots';
export const FINANCIAL_VERSION_POLICY='whole-attached-asr-q2r-v1' as const;
export interface FinancialVersionZipEvidence {docID:string;sha256:string;receivedAt:string;path?:string;bytes?:Uint8Array;}
export interface FinancialVersionEvidenceInput {cutoff:string;observations:readonly DocumentVersionObservation[];sources:readonly ObservedFinancialSource[];evidence:readonly FinancialVersionZipEvidence[];}
export interface FinancialVersionEvidenceBundle extends FinancialVersionEvidenceInput {evidenceManifestSha256:string;}
export interface FinancialVersionOptions {policy:typeof FINANCIAL_VERSION_POLICY;evidenceManifestSha256:string;}
declare const authenticatedFinancialVersion:unique symbol;
export interface AuthenticatedFinancialVersionContext {readonly [authenticatedFinancialVersion]:true;}
export interface FinancialVersionRuntimeBinding {context:AuthenticatedFinancialVersionContext;bundle:FinancialVersionEvidenceBundle;}
export type FinancialVersionHoldReason='metadata-ineligible'|'unsupported-branch-size'|'official-metadata-conflict'|'unsupported-form-or-status'|'source-missing-or-conflicting'|'source-hash-mismatch'|'source-unavailable-at-cutoff'|'source-before-submission'|'source-basis-invalid'|'dei-unavailable-or-ambiguous'|'dei-target-mismatch'|'root-not-original'|'amendment-flags-invalid'|'ordinal-sequence-invalid'|'submission-order-invalid'|'period-form-or-basis-mismatch'|'official-source-binding-mismatch'|'zip-missing-or-conflicting'|'zip-unavailable-at-cutoff'|'zip-hash-mismatch'|'zip-invalid'|'zip-manifest-invalid'|'zip-attachment-incomplete'|'zip-filename-mismatch'|'evidence-after-cutoff';
export interface FinancialVersionIdentity {issuer:string;security:string;form:string;currentPeriod:string;fiscalStart:string;fiscalEnd:string;periodCode:string;standard:string;scope:string;}
export interface FinancialVersionZipProof {rawResponseSha256:string;receivedAt:string;manifestSha256:string;role:string;preferred:string;inlineDocuments:{name:string;sha256:string}[];memberManifestSha256:string;memberCount:number;cover:{path:string;sha256:string};correctionBody:{path:string;sha256:string};}
export interface FinancialVersionSourceProof {docID:string;ordinal:number;sourceSha256:string;availableAt:string;identity:FinancialVersionIdentity;zip?:FinancialVersionZipProof;}
export type FinancialVersionDecision={rootDocID:string;status:'held';reason:FinancialVersionHoldReason}|{rootDocID:string;status:'selected-source';reason:'same-root-complete-attached-inline-submission-sequence';selectedDocID:string;chainDocIDs:string[];observationIds:string[];knownAt:string;selected:SelectedDocumentVersion;sourceVersions:FinancialVersionSourceProof[];sha256:string;};
export interface FinancialVersionProof {version:'1';policy:typeof FINANCIAL_VERSION_POLICY;cutoff:string;evidenceManifestSha256:string;observationsSha256:string;sourcesSha256:string;evidenceSha256:string;metadataSelection:ReturnType<typeof selectDocumentVersions>;decisions:FinancialVersionDecision[];sha256:string;}

import {createHash} from 'node:crypto';
import {constants,openSync,fstatSync,readSync,closeSync} from 'node:fs';
import {XMLParser} from 'fast-xml-parser';
import {selectDocumentVersions,captureDocumentVersionObservations} from './document-version-selection';
import {captureObservedFinancialSources,createObservedFinancialSnapshots} from './observed-financial-snapshots';
import {EdinetXbrlParser} from './edinet-xbrl-parser';
import {loadZipArchive,ZIP_LIMITS} from './zip-archive';
import {assertXmlInput} from './xml-input';
import {parseDocumentTimestamp} from './document-timestamp';
const canonical=(v:unknown):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)&&!(x instanceof Uint8Array)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
const digest=(v:unknown)=>hash(canonical(v));
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
class Hold extends Error {constructor(readonly reason:FinancialVersionHoldReason){super(reason)}}
function need(value:unknown,reason:FinancialVersionHoldReason):asserts value {if(!value)throw new Hold(reason)}
const time=(v:string,official=false)=>parseDocumentTimestamp(v,!official);
function array<T>(a:readonly T[],max:number):T[]{
 if(!Array.isArray(a))throw Error('金融版の配列が必要です');const length=a.length;
 if(!Number.isSafeInteger(length)||length<0||length>max)throw Error('金融版入力の件数上限です');
 return Array.from({length},(_,i)=>{if(!Object.hasOwn(a,i))throw Error('疎配列は使えません');return a[i]});
}
function capture(input:FinancialVersionEvidenceInput){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['cutoff','observations','sources','evidence','evidenceManifestSha256'].includes(k)))throw Error('金融版入力が不正です');
 const {cutoff,observations:rawObservations,sources:rawSources,evidence:rawEvidence}=input;if(time(cutoff)===undefined)throw Error('金融版cutoffが不正です');
 let metadataBytes=0;
 const primitive=(v:unknown,key:string)=>{if(v!==null&&v!==undefined&&!['string','number','boolean'].includes(typeof v)||typeof v==='number'&&!Number.isFinite(v))throw Error('公式観測はflat JSON primitiveで指定してください');metadataBytes+=Buffer.byteLength(key)+(typeof v==='string'?Buffer.byteLength(v):16);if(metadataBytes>16*1024**2)throw Error('金融版観測の容量上限です');return v};
 const flat=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('公式documentが不正です');const keys=Object.keys(v);if(keys.length>128)throw Error('公式documentの項目上限です');return Object.fromEntries(keys.map(k=>[k,primitive((v as Record<string,unknown>)[k],k)]))};
 const observations=array(rawObservations,10000).map(o=>{if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).length>6)throw Error('公式観測が不正です');return Object.fromEntries(Object.keys(o).map(k=>[k,k==='document'?flat(o.document):primitive((o as unknown as Record<string,unknown>)[k],k)])) as unknown as DocumentVersionObservation});captureDocumentVersionObservations(observations);
 const sources=array(rawSources,100).map(s=>captureObservedFinancialSources([s])[0]);
 if(sources.some(s=>Buffer.byteLength(s.xml??'')>64*1024**2)||sources.reduce((n,s)=>n+Buffer.byteLength(s.xml??''),0)>256*1024**2)throw Error('金融版原本の容量上限です');
 let bytes=0;
 const evidence=array(rawEvidence,100).map(e=>{
  if(!e||typeof e!=='object'||Array.isArray(e)||Object.keys(e).some(k=>!['docID','sha256','receivedAt','path','bytes'].includes(k)))throw Error('ZIP証拠宣言が不正です');
  const {docID,sha256,receivedAt,path,bytes:raw}=e;
  if(typeof docID!=='string'||!docID.trim()||!sha(sha256)||time(receivedAt)===undefined||(path===undefined)===(raw===undefined)||path!==undefined&&(typeof path!=='string'||!path.trim())||raw!==undefined&&!(raw instanceof Uint8Array))throw Error('ZIP証拠のID/hash/時刻/保存先が不正です');
  if(raw){const length=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength')!.get!.call(raw) as number;bytes+=length;if(length>ZIP_LIMITS.compressedBytes||bytes>256*1024**2)throw Error('ZIP証拠の容量上限です')}
  return {docID,sha256,receivedAt,...path!==undefined?{path}:{bytes:new Uint8Array(raw!)}};
 });
 return {cutoff,observations,sources,evidence};
}
/** Internal boundary shared by observed/archive consumers; manifest is captured once. */
export function captureFinancialVersionEvidenceBundle(input:FinancialVersionEvidenceBundle):FinancialVersionEvidenceBundle{
 const b=capture(input),manifest=input.evidenceManifestSha256;if(!sha(manifest))throw Error('金融版manifest hashが不正です');return {...b,evidenceManifestSha256:manifest};
}
function fingerprints(b:FinancialVersionEvidenceInput){
 const observationsSha256=digest(b.observations),sourcesSha256=digest(b.sources.map(({docID,sourceSha256,availableAt})=>({docID,sourceSha256,availableAt}))),evidenceSha256=digest(b.evidence.map(({docID,sha256,receivedAt})=>({docID,sha256,receivedAt})));
 return {observationsSha256,sourcesSha256,evidenceSha256,evidenceManifestSha256:digest({cutoff:b.cutoff,observationsSha256,sourcesSha256,evidenceSha256})};
}
/** 宣言集合の指紋。raw byteの真正性を認証する関数ではありません。 */
export function financialVersionEvidenceManifestSha256(input:FinancialVersionEvidenceInput):string{return fingerprints(capture(input)).evidenceManifestSha256}
function rawZip(e:FinancialVersionZipEvidence):Uint8Array{
 if(e.bytes)return e.bytes;
 let fd:number|undefined;
 try{fd=openSync(e.path!,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const before=fstatSync(fd,{bigint:true});need(before.isFile()&&before.size<=BigInt(ZIP_LIMITS.compressedBytes),'zip-invalid');const data=Buffer.alloc(Number(before.size)+1);let length=0;while(length<data.length){const n=readSync(fd,data,length,data.length-length,null);if(!n)break;length+=n}const after=fstatSync(fd,{bigint:true});need(length===Number(before.size)&&before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs,'zip-invalid');return data.subarray(0,length)}
 catch(e){if(e instanceof Hold)throw e;throw new Hold('zip-invalid')}
 finally{if(fd!==undefined)closeSync(fd)}
}
function rawBinding(b:FinancialVersionEvidenceInput){
 let total=0;
 const z=b.evidence.map(e=>{try{const raw=rawZip(e);total+=raw.byteLength;if(total>256*1024**2)throw Error('金融版全ZIP容量上限です');return {docID:e.docID,rawSha256:hash(raw)}}catch(error){if(!(error instanceof Hold))throw error;return {docID:e.docID,unavailable:error.reason}}});
 return digest({sources:b.sources.map(s=>({docID:s.docID,xmlSha256:s.xml===undefined?null:hash(s.xml),availableAt:s.availableAt})),zip:z});
}
const contexts=new WeakMap<object,{proof:FinancialVersionProof;binding:string}>();
function state(context:AuthenticatedFinancialVersionContext){const s=context&&typeof context==='object'?contexts.get(context):undefined;if(!s)throw Error('金融版の再認証済みcontextが必要です');return s}
/** 返却proofは記録用cloneであり、新processの認証contextにはなりません。 */
export function readFinancialVersionProof(context:AuthenticatedFinancialVersionContext):FinancialVersionProof{return structuredClone(state(context).proof)}
export function verifyFinancialVersionContext(context:AuthenticatedFinancialVersionContext,bundle:FinancialVersionEvidenceBundle):FinancialVersionProof{
 const s=state(context),b=captureFinancialVersionEvidenceBundle(bundle),f=fingerprints(b);
 if(b.evidenceManifestSha256!==f.evidenceManifestSha256||f.evidenceManifestSha256!==s.proof.evidenceManifestSha256||rawBinding(b)!==s.binding)throw Error('金融版contextのmanifest/全原本証拠が変わりました');
 return structuredClone(s.proof);
}
function pureUnits(xml:string):ReadonlySet<string>{
 const root=new XMLParser({ignoreAttributes:false,parseTagValue:false}).parse(xml)['xbrli:xbrl'];
 if(!root||root['@_xmlns:xbrli']!=='http://www.xbrl.org/2003/instance')return new Set();
 const list=root['xbrli:unit']===undefined?[]:Array.isArray(root['xbrli:unit'])?root['xbrli:unit']:[root['xbrli:unit']],groups=new Map<string,any[]>();
 for(const unit of list){const id=unit['@_id'];groups.set(id,[...(groups.get(id)??[]),unit])}
 const result=new Set<string>();
 for(const [id,units]of groups){if(units.length!==1)continue;const unit=units[0],measure=unit['xbrli:measure'];
  if((unit['@_xmlns:xbrli']??root['@_xmlns:xbrli'])!=='http://www.xbrl.org/2003/instance')continue;
  if(Object.keys(unit).some(k=>k!=='@_id'&&k!=='xbrli:measure'&&!k.startsWith('@_xmlns:'))||measure===undefined||Array.isArray(measure))continue;
  if(typeof measure==='object'&&Object.keys(measure).some(k=>k!=='#text'&&!k.startsWith('@_xmlns:')))continue;
  const attrs={...root,...unit,...typeof measure==='object'?measure:{}},value=typeof measure==='string'?measure:measure?.['#text'];
  if(attrs['@_xmlns:xbrli']!=='http://www.xbrl.org/2003/instance'||typeof value!=='string')continue;
  const match=/^([^:]+):pure$/.exec(value.trim());if(match&&attrs['@_xmlns:'+match[1]]==='http://www.xbrl.org/2003/instance')result.add(id);
 }
 return result;
}
function one(obj:ReturnType<EdinetXbrlParser['parse']>,tag:string,contextRef:string,namespaceURI:string,units:ReadonlySet<string>):string{
 const facts=obj.getDataListByTagName(tag);need(facts.length===1,'dei-unavailable-or-ambiguous');const f=facts[0];
 need(/^http:\/\/disclosure\.edinet-fsa\.go\.jp\/taxonomy\/jpdei\/\d{4}-\d{2}-\d{2}\/jpdei_cor$/.test(f.namespaceURI??'')&&f.namespaceURI===namespaceURI&&f.contextRef===contextRef&&(tag==='NumberOfSubmissionDEI'?units.has(f.unitRef)&&f.rawDecimals==='0':f.unitRef==='')&&!f.nil&&typeof f.rawValue==='string'&&f.rawValue.trim()!=='','dei-unavailable-or-ambiguous');return f.rawValue!;
}
const text=(b:Uint8Array)=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);
const visible=(s:string)=>s.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
async function zipProof(source:ObservedFinancialSource,e:FinancialVersionZipEvidence,ordinal:number,identity:FinancialVersionIdentity,submitDay:string,rootType:string):Promise<FinancialVersionZipProof>{
 try{
  const bytes=rawZip(e);need(hash(bytes)===e.sha256,'zip-hash-mismatch');const zip=await loadZipArchive(bytes),members=[];
  for(const member of zip.entries)if(!member.dir)members.push({...member,sha256:hash(await zip.readEntry(member.name))});
  const byName=new Map(members.map(m=>[m.name,m])),manifestName='XBRL/PublicDoc/manifest_PublicDoc.xml';need(byName.has(manifestName),'zip-manifest-invalid');
  const manifest=text(await zip.readEntry(manifestName));assertXmlInput(manifest);const parsed=new XMLParser({ignoreAttributes:false,parseTagValue:false}).parse(manifest).manifest;
  need(parsed&&parsed['@_xmlns']==='http://disclosure.edinet-fsa.go.jp/2013/manifest','zip-manifest-invalid');
  const item=parsed.tocComposition?.item,instance=parsed.list?.instance;
  need([parsed.tocComposition,parsed.list,item,instance].every(n=>n&&(!Object.hasOwn(n,'@_xmlns')||n['@_xmlns']==='http://disclosure.edinet-fsa.go.jp/2013/manifest')),'zip-manifest-invalid');
  need(Object.keys(parsed.list).every(k=>k==='instance'||k.startsWith('@_xmlns'))&&Object.keys(instance).every(k=>['@_id','@_type','@_preferredFilename','ixbrl'].includes(k)||k.startsWith('@_xmlns')),'zip-manifest-invalid');
  need(item&&!Array.isArray(item)&&instance&&!Array.isArray(instance)&&instance['@_type']==='PublicDoc'&&item['@_ref']===instance['@_id'],'zip-manifest-invalid');
  const role=item['@_extrole'],preferred=instance['@_preferredFilename'];need(typeof role==='string'&&/^http:\/\/disclosure\.edinet-fsa\.go\.jp\/role\/jpcrp\/rol_CabinetOfficeOrdinanceOnDisclosureOfCorporateInformationEtcFormNo(?:3Annual|43Quarterly)SecuritiesReport$/.test(role)&&role.endsWith(rootType==='120'?'FormNo3AnnualSecuritiesReport':'FormNo43QuarterlySecuritiesReport')&&typeof preferred==='string'&&!preferred.includes('/')&&!preferred.includes('\\'),'zip-manifest-invalid');
  const names=typeof instance.ixbrl==='string'?[instance.ixbrl]:instance.ixbrl;need(Array.isArray(names)&&names.length>=2&&names.every((n:unknown)=>typeof n==='string'&&!n.includes('/')&&!n.includes('\\'))&&new Set(names).size===names.length,'zip-attachment-incomplete');
  const listed:string[]=names.map((n:string)=>'XBRL/PublicDoc/'+n);need(listed.every(n=>byName.has(n)),'zip-attachment-incomplete');const main='XBRL/PublicDoc/'+preferred;
  need(byName.has(main)&&hash(await zip.readEntry(main))===source.sourceSha256,'zip-attachment-incomplete');
  const headers=listed.filter(n=>n.includes('_header_'));need(headers.length===1&&listed.some(n=>n.includes('_honbun_')),'zip-attachment-incomplete');
  need(/訂正報告書の添付\s*インライン\s*XBRL/i.test(visible(text(await zip.readEntry(headers[0])))),'zip-attachment-incomplete');
  for(const m of members)if(m.name.startsWith('XBRL/PublicDoc/')&&/\.(?:xbrl|xsd|xml|htm|html)$/.test(m.name)&&m.name!==manifestName){const f=m.name.match(/_(E\d{5}-\d{3})_(\d{4}-\d{2}-\d{2})_(\d{2})_(\d{4}-\d{2}-\d{2})(?:_|\.|$)/);need(f&&f[1]===identity.issuer+'-000'&&f[2]===identity.currentPeriod&&Number(f[3])===ordinal&&f[4]===submitDay,'zip-filename-mismatch')}
  let body:typeof members[number]|undefined;
  for(const m of members)if(m.name.startsWith('PublicDoc/')&&/\.html?$/.test(m.name)&&/訂正事項|訂正箇所/.test(visible(text(await zip.readEntry(m.name))))){body=m;break}
  need(body,'zip-attachment-incomplete');
  return {rawResponseSha256:e.sha256,receivedAt:e.receivedAt,manifestSha256:byName.get(manifestName)!.sha256,role,preferred,inlineDocuments:listed.map(name=>({name,sha256:byName.get(name)!.sha256})),memberManifestSha256:digest(members),memberCount:members.length,cover:{path:headers[0],sha256:byName.get(headers[0])!.sha256},correctionBody:{path:body.name,sha256:body.sha256}};
 }catch(error){if(error instanceof Hold)throw error;throw new Hold('zip-invalid')}
}
/** 固定のwhole-attached policy。金額の一致を版選択条件に使用しません。 */
export async function authenticateFinancialVersionEvidence(bundle:FinancialVersionEvidenceBundle):Promise<AuthenticatedFinancialVersionContext>{
 const b=captureFinancialVersionEvidenceBundle(bundle),f=fingerprints(b);if(b.evidenceManifestSha256!==f.evidenceManifestSha256)throw Error('金融版evidence manifest hashが一致しません');
 const binding=rawBinding(b),metadataSelection=selectDocumentVersions(b.observations,b.cutoff),decisions:FinancialVersionDecision[]=[],cut=time(b.cutoff)!;
 for(const original of metadataSelection.decisions){
  if(original.status==='selected')continue;
  try{
   need(original.reason==='multiple-correction-leaves','metadata-ineligible');const rootID=original.rootDocID;
   const beforeCutoff=b.observations.filter(o=>time(o.observedAt)!<=cut),relevant=beforeCutoff.filter(o=>o.document.docID===rootID||o.document.parentDocID===rootID),ids=[...new Set(relevant.map(o=>o.document.docID))];
   need(ids.length===3&&ids.includes(rootID)&&original.chainDocIDs.length===3&&original.chainDocIDs.every(id=>ids.includes(id))&&!beforeCutoff.some(o=>ids.includes(o.document.parentDocID??'')&&!ids.includes(o.document.docID)),'unsupported-branch-size');
   const latest=new Map<string,DocumentVersionObservation>();
   for(const o of relevant){const old=latest.get(o.document.docID);if(!old||time(old.observedAt)!<time(o.observedAt)!)latest.set(o.document.docID,o);else if(time(old.observedAt)===time(o.observedAt))need(canonical(old.document)===canonical(o.document),'official-metadata-conflict')}
   const root=latest.get(rootID)!.document;need(['120','160'].includes(root.docTypeCode??'')&&root.formCode===(root.docTypeCode==='120'?'030000':'043A00')&&root.legalStatus==='1','unsupported-form-or-status');
   const items:{docID:string;ordinal:number;document:DocumentVersionObservation['document'];source:ObservedFinancialSource;identity:FinancialVersionIdentity;zip?:FinancialVersionZipProof}[]=[];
   for(const id of [rootID,...ids.filter(id=>id!==rootID)]){
    const sources=b.sources.filter(s=>s.docID===id);need(sources.length===1&&sources[0].xml!==undefined,'source-missing-or-conflicting');const source=sources[0],d=latest.get(id)!.document;
    need(hash(source.xml!)===source.sourceSha256,'source-hash-mismatch');need(time(source.availableAt)!<=cut,'source-unavailable-at-cutoff');need(time(source.availableAt)!>=time(d.submitDateTime!,true)!,'source-before-submission');
    need((id===rootID||d.parentDocID===rootID)&&d.edinetCode===root.edinetCode&&d.secCode===root.secCode&&d.xbrlFlag==='1'&&(id===rootID||d.docTypeCode===(root.docTypeCode==='120'?'130':'170')),'official-source-binding-mismatch');
    let object:ReturnType<EdinetXbrlParser['parse']>;try{object=new EdinetXbrlParser().parse(source.xml!,id)}catch{throw new Hold('source-basis-invalid')}
    const basis=object.selectFinancialReportingBasis();need(basis.status==='selected','source-basis-invalid');const context=basis.fields.accountingStandard.status==='selected'?basis.fields.accountingStandard.source.contextRef:'';
    const units=pureUnits(source.xml!),value=(tag:string)=>one(object,tag,context,basis.fields.accountingStandard.status==='selected'?basis.fields.accountingStandard.source.namespaceURI!:'',units),issuer=value('EDINETCodeDEI'),security=value('SecurityCodeDEI'),number=value('NumberOfSubmissionDEI');
    need(issuer===root.edinetCode&&security===root.secCode,'official-source-binding-mismatch');need(/^[1-9]\d*$/.test(number)&&Number.isSafeInteger(Number(number)),'ordinal-sequence-invalid');const ordinal=Number(number);
    if(id===rootID)need(ordinal===1&&value('AmendmentFlagDEI')==='false'&&value('ReportAmendmentFlagDEI')==='false'&&value('XBRLAmendmentFlagDEI')==='false'&&basis.metadata.amendmentTargetDocID===undefined,'root-not-original');
    else{need(basis.metadata.amendmentTargetDocID===rootID,'dei-target-mismatch');const a=value('AmendmentFlagDEI'),r=value('ReportAmendmentFlagDEI'),x=value('XBRLAmendmentFlagDEI');need(a==='true'&&(r==='true'&&x==='false'||r==='false'&&x==='true'),'amendment-flags-invalid')}
    const m=basis.metadata;need(m.documentType===(root.docTypeCode==='120'?'第三号様式':'第四号の三様式'),'unsupported-form-or-status');need(m.accountingStandard==='J-GAAP'&&m.scope==='Consolidated','source-basis-invalid');
    items.push({docID:id,ordinal,document:d,source,identity:{issuer,security,form:value('DocumentTypeDEI'),currentPeriod:m.instant,fiscalStart:m.fiscalYear.startDate,fiscalEnd:m.fiscalYear.endDate,periodCode:m.reportingPeriodCode,standard:m.accountingStandard,scope:m.scope}});
   }
   const rootItem=items[0],leaves=items.slice(1).sort((a,b)=>a.ordinal-b.ordinal);need(leaves[0].ordinal===2&&leaves[1].ordinal===3,'ordinal-sequence-invalid');need(time(leaves[0].document.submitDateTime!,true)!<time(leaves[1].document.submitDateTime!,true)!,'submission-order-invalid');need(items.every(i=>canonical(i.identity)===canonical(rootItem.identity)),'period-form-or-basis-mismatch');
   let selected:SelectedDocumentVersion|undefined;
   for(const item of items){const branchIDs=item.docID===rootID?[rootID]:[rootID,item.docID],branch=createObservedFinancialSnapshots(relevant.filter(o=>branchIDs.includes(o.document.docID)),items.filter(i=>branchIDs.includes(i.docID)).map(i=>i.source),{cutoff:b.cutoff});need(branch.records.length===1&&branch.records[0].docID===item.docID&&branch.records[0].result.status==='resolved','official-source-binding-mismatch');if(item===leaves[1])selected=branch.selection.selected[0]}
   for(const leaf of leaves){const entries=b.evidence.filter(e=>e.docID===leaf.docID);need(entries.length===1,'zip-missing-or-conflicting');const e=entries[0];need(time(e.receivedAt)!<=cut&&time(e.receivedAt)!<=time(leaf.source.availableAt)!&&time(e.receivedAt)!>=time(leaf.document.submitDateTime!,true)!,'zip-unavailable-at-cutoff');leaf.zip=await zipProof(leaf.source,e,leaf.ordinal,rootItem.identity,leaf.document.submitDateTime!.slice(0,10),root.docTypeCode!)}
   const knownAt=new Date(Math.max(...relevant.map(o=>time(o.observedAt)!),...items.map(i=>time(i.source.availableAt)!),...leaves.map(i=>time(i.zip!.receivedAt)!))).toISOString();need(time(knownAt)!<=cut,'evidence-after-cutoff');
   const observationIds=[...new Set(relevant.map(o=>o.observationId))].sort();need(selected,'official-source-binding-mismatch');selected=structuredClone(selected);selected.observationIds=observationIds;selected.observedAt=new Date(Math.max(...relevant.map(o=>time(o.observedAt)!))).toISOString();
   const decision={rootDocID:rootID,status:'selected-source' as const,reason:'same-root-complete-attached-inline-submission-sequence' as const,selectedDocID:leaves[1].docID,chainDocIDs:[rootID,leaves[1].docID],observationIds,knownAt,selected,sourceVersions:items.map(i=>({docID:i.docID,ordinal:i.ordinal,sourceSha256:i.source.sourceSha256,availableAt:i.source.availableAt,identity:i.identity,...i.zip?{zip:i.zip}:{}}))};decisions.push({...decision,sha256:digest(decision)});
  }catch(error){decisions.push({rootDocID:original.rootDocID,status:'held',reason:error instanceof Hold?error.reason:'source-basis-invalid'})}
 }
 if(rawBinding(b)!==binding)throw Error('認証中に金融版のraw証拠が変わりました');
 const body={version:'1' as const,policy:FINANCIAL_VERSION_POLICY,cutoff:b.cutoff,...f,metadataSelection,decisions},proof={...body,sha256:digest(body)};
 const token=Object.freeze(Object.create(null)) as AuthenticatedFinancialVersionContext;contexts.set(token,{proof,binding});return token;
}
