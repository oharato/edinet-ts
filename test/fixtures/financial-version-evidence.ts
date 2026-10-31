import JSZip from 'jszip';
import {createHash} from 'node:crypto';
import {reportingInstance} from './financial-reporting-basis';
import {financialVersionEvidenceManifestSha256,type FinancialVersionEvidenceBundle,type FinancialVersionEvidenceInput} from '../../src/financial-version-selection';
export const sourceHash=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
export function signFinancialVersionBundle(input:FinancialVersionEvidenceInput):FinancialVersionEvidenceBundle{return {...input,evidenceManifestSha256:financialVersionEvidenceManifestSha256(input)}}
export async function financialVersionEvidenceFixture():Promise<FinancialVersionEvidenceBundle>{
 const sources=['A','B','C'].map((docID,index)=>{
  const extra=Object.entries({NumberOfSubmissionDEI:String(index+1),AmendmentFlagDEI:index?'true':'false',ReportAmendmentFlagDEI:index?'true':'false',XBRLAmendmentFlagDEI:'false',...(index?{IdentificationOfDocumentSubjectToAmendmentDEI:'A'}:{})}).map(([tag,value])=>`<d:${tag} contextRef="filing"${tag==='NumberOfSubmissionDEI'?' unitRef="counter" decimals="0"':''}>${value}</d:${tag}>`).join('');
  const xml=reportingInstance({extra:extra+'<xbrli:unit id="counter"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit>'});return {docID,xml,sourceSha256:sourceHash(xml),availableAt:index?'2026-06-28T12:00:00Z':'2026-06-25T12:00:00Z'};
 });
 const observations=sources.map((s,index)=>({observationId:s.docID,observedAt:'2026-06-27T00:00:00Z',document:{docID:s.docID,parentDocID:index?'A':null,docTypeCode:index?'130':'120',edinetCode:'E12345',secCode:'10010',periodStart:index?null:'2025-04-01',periodEnd:index?null:'2026-03-31',submitDateTime:`2026-06-${24+index} 10:00`,withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0',xbrlFlag:'1' as const,...index?{}:{formCode:'030000',legalStatus:'1'}}}));
 const evidence=[];
 for(const [index,s] of sources.entries())if(index){
  const prefix=`jpcrp030000-asr-001_E12345-000_2026-03-31_0${index+1}_2026-06-${24+index}`,preferred=prefix+'.xbrl',header='0000000_header_'+prefix+'_ixbrl.htm',body='0101010_honbun_'+prefix+'_ixbrl.htm',zip=new JSZip();
  zip.file('XBRL/PublicDoc/'+preferred,s.xml);zip.file('XBRL/PublicDoc/'+header,'<html><body>訂正報告書の添付インラインXBRL</body></html>');zip.file('XBRL/PublicDoc/'+body,'<html><body>財務諸表本文</body></html>');zip.file('XBRL/PublicDoc/'+prefix+'.xsd','<schema/>');zip.file('PublicDoc/correction.htm','<html><body>訂正事項</body></html>');
  zip.file('XBRL/PublicDoc/manifest_PublicDoc.xml',`<manifest xmlns="http://disclosure.edinet-fsa.go.jp/2013/manifest"><tocComposition><item ref="jpcrp030000" extrole="http://disclosure.edinet-fsa.go.jp/role/jpcrp/rol_CabinetOfficeOrdinanceOnDisclosureOfCorporateInformationEtcFormNo3AnnualSecuritiesReport"/></tocComposition><list><instance id="jpcrp030000" type="PublicDoc" preferredFilename="${preferred}"><ixbrl>${header}</ixbrl><ixbrl>${body}</ixbrl></instance></list></manifest>`);
  const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});evidence.push({docID:s.docID,bytes,sha256:sourceHash(bytes),receivedAt:'2026-06-27T12:00:00Z'});
 }
 return signFinancialVersionBundle({cutoff:'2026-06-30T00:00:00Z',observations,sources,evidence});
}
