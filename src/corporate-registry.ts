import {createHash} from 'node:crypto';
import {XMLParser} from 'fast-xml-parser';
import {assertXmlInput} from './xml-input';
import {parseDocumentTimestamp} from './document-timestamp';
export const CORPORATE_REGISTRY_FIELDS = Object.freeze(['sequenceNumber','corporateNumber','process','correct','updateDate','changeDate','name','nameImageId','kind','prefectureName','cityName','streetNumber','addressImageId','prefectureCode','cityCode','postCode','addressOutside','addressOutsideImageId','closeDate','closeCause','successorCorporateNumber','changeCause','assignmentDate','latest','enName','enPrefectureName','enCityName','enAddressOutside','furigana','hihyoji'] as const);
export type CorporateRegistryField = typeof CORPORATE_REGISTRY_FIELDS[number];
export interface CorporateRegistrySource {sourceUrl:string; observedAt:string; dataDate:string; kind:'full'|'diff'; purpose:'sample'|'download';}
export interface CorporateRegistryRecord {recordNumber:number; values:Record<CorporateRegistryField,string>; processKnown:boolean; deletionExtraFields:CorporateRegistryField[];}
export interface CorporateRegistryDownload {source:CorporateRegistrySource & {inputXmlSha256:string; attribution:string}; records:CorporateRegistryRecord[];}
const date=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&parseDocumentTimestamp(s+'T00:00:00Z',true)!==undefined;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function fail():never{throw new Error('法人番号ダウンロードXML/出典が不正です');}
/** 30列の現行ダウンロードXML。訂正/削除/最新履歴フラグを解釈で消さず原値のまま保持します。 */
export function parseCorporateRegistryDownloadXml(xml:string,input:CorporateRegistrySource):CorporateRegistryDownload {
    if(!object(input)||Object.keys(input).some(k=>!['sourceUrl','observedAt','dataDate','kind','purpose'].includes(k)))fail();
    const source={sourceUrl:input.sourceUrl,observedAt:input.observedAt,dataDate:input.dataDate,kind:input.kind,purpose:input.purpose};
    const observed=parseDocumentTimestamp(source.observedAt,true);
    if(observed===undefined||typeof source.sourceUrl!=='string'||typeof source.dataDate!=='string'||!date(source.dataDate)||!['full','diff'].includes(source.kind)||!['sample','download'].includes(source.purpose)||source.dataDate>new Date(observed+9*3600000).toISOString().slice(0,10))fail();
    try{const url=new URL(source.sourceUrl);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)fail();}catch{fail();}
    assertXmlInput(xml);
    const parsed=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:false}).parse(xml);
    if(!object(parsed)||Object.keys(parsed).some(k=>!['?xml','corporations'].includes(k)) )fail();
    const root=typeof parsed.corporations==='string'&&!parsed.corporations.trim()?{}:parsed.corporations;if(!object(root))fail();if(Object.keys(root).some(k=>k!=='corporation'&&!(k==='#text'&&typeof root[k]==='string'&&!root[k].trim())))fail();
    const elements=root.corporation===undefined?[]:Array.isArray(root.corporation)?root.corporation:[root.corporation];
    if(elements.length>100000)fail();const seen=new Set<string>();
    const records=elements.map((element:unknown,i:number):CorporateRegistryRecord=>{
        if(!object(element)||Object.keys(element).some(k=>!CORPORATE_REGISTRY_FIELDS.includes(k as CorporateRegistryField)&&!(k==='#text'&&typeof element[k]==='string'&&!element[k].trim())))fail();
        const values={}as Record<CorporateRegistryField,string>;
        for(const key of CORPORATE_REGISTRY_FIELDS){if(typeof element[key]!=='string')fail();values[key]=element[key];}
        if(!/^[1-9]\d{0,7}$/.test(values.sequenceNumber)||seen.has(values.sequenceNumber)||!/^\d{13}$/.test(values.corporateNumber)||!/^\d{2}$/.test(values.process)||!date(values.updateDate)||values.updateDate>source.dataDate)fail();seen.add(values.sequenceNumber);
        const deletionExtraFields=values.process==='99'?CORPORATE_REGISTRY_FIELDS.filter(k=>!['sequenceNumber','corporateNumber','process','updateDate'].includes(k)&&values[k]!==''):[];
        for(const k of ['changeDate','assignmentDate','closeDate']as const)if(values[k]&&!date(values[k]))fail();
        if(values.process!=='99'){
            if(!['0','1'].includes(values.correct)||!['0','1'].includes(values.latest)||!['0','1'].includes(values.hihyoji)||!/^\d{3}$/.test(values.kind)||!values.name&&!values.nameImageId)fail();
            for(const k of ['changeDate','assignmentDate']as const)if(!date(values[k]))fail();
            if(values.closeDate&&!date(values.closeDate)||values.successorCorporateNumber&&!/^\d{13}$/.test(values.successorCorporateNumber))fail();
        }
        return{recordNumber:i+1,values,processKnown:['01','11','12','13','21','22','71','72','81','99'].includes(values.process),deletionExtraFields};
    });
    return{source:{...source,inputXmlSha256:createHash('sha256').update(xml).digest('hex'),attribution:'国税庁法人番号公表サイト（国税庁）を加工して作成'},records};
}
/** 法人番号の完全一致で観測済み原記録を返します。diffを最新状態へ合成しません。 */
export function queryCorporateRegistryDownloads(inputs:readonly {xml:string;source:CorporateRegistrySource}[],query:{corporateNumber:string;knownAt:string}) {
    if(!object(query)||Object.keys(query).some(k=>!['corporateNumber','knownAt'].includes(k)))fail();
    const corporateNumber=query.corporateNumber,knownAt=query.knownAt,cutoff=parseDocumentTimestamp(knownAt,true);
    if(!/^\d{13}$/.test(corporateNumber)||cutoff===undefined||!Array.isArray(inputs)||inputs.length>100)fail();
    const captured=Array.from({length:inputs.length},(_,i)=>{if(!Object.hasOwn(inputs,i))fail();const d=inputs[i];if(!object(d)||Object.keys(d).some(k=>!['xml','source'].includes(k)))fail();const {xml,source}=d;if(typeof xml!=='string')fail();return{xml,source:structuredClone(source) as CorporateRegistrySource};});
    if(captured.reduce((n,d)=>n+Buffer.byteLength(d.xml),0)>256*1024*1024)fail();
    const rows:{sourceIndex:number;record:CorporateRegistryRecord}[]=[],sources:CorporateRegistryDownload['source'][]=[],excludedSources:{sourceIndex:number;reason:'source-after-cutoff'}[]=[];
    for(const d of captured){const parsed=parseCorporateRegistryDownloadXml(d.xml,d.source),sourceIndex=sources.length;sources.push(parsed.source);if(parseDocumentTimestamp(parsed.source.observedAt,true)!>cutoff){excludedSources.push({sourceIndex,reason:'source-after-cutoff'});continue;}for(const record of parsed.records)if(record.values.corporateNumber===corporateNumber)rows.push({sourceIndex,record});}
    return{corporateNumber,knownAt,sources,rows,excludedSources,total:rows.length};
}
