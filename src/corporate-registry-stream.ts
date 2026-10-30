import {createHash} from 'node:crypto';
import {open,lstat} from 'node:fs/promises';
import {constants,type BigIntStats} from 'node:fs';
import {parseCorporateRegistryDownloadXml,type CorporateRegistrySource,type CorporateRegistryRecord,type CorporateRegistryDownload} from './corporate-registry';
export const CORPORATE_REGISTRY_STREAM_MAX_BYTES=8*1024**3;
export const CORPORATE_REGISTRY_RECORD_MAX_BYTES=64*1024;
export interface CorporateRegistryStreamReceipt {parserVersion:'nta-download-stream-1';source:CorporateRegistryDownload['source'];bytes:number;records:number;}
export interface CorporateRegistryStreamOptions {maxBytes?:number;signal?:AbortSignal;}
const invalid=():never=>{throw Error('法人番号UTF-8 XMLの構造・容量・読取状態を確認してください');};
function settings(input:CorporateRegistryStreamOptions){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['maxBytes','signal'].includes(k)))invalid();
 const {maxBytes=CORPORATE_REGISTRY_STREAM_MAX_BYTES,signal}=input;
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>CORPORATE_REGISTRY_STREAM_MAX_BYTES||signal!==undefined&&!(signal instanceof AbortSignal))invalid();return {maxBytes,signal};
}
/** 一記録ずつ返します。全体SHAと末尾の検査はiterator完了時。重複一連番号は保存側で検査します。 */
export async function* streamCorporateRegistryRecords(chunks:AsyncIterable<Uint8Array>,input:CorporateRegistrySource,options:CorporateRegistryStreamOptions={}):AsyncGenerator<CorporateRegistryRecord,CorporateRegistryStreamReceipt> {
 const {maxBytes,signal}=settings(options),source=structuredClone(input);parseCorporateRegistryDownloadXml('<corporations/>',source);signal?.throwIfAborted();
 const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}),hash=createHash('sha256');const state:{stage:'header'|'records'|'end'}={stage:'header'};let buffer='',bytes=0,records=0,start=true,declared=false,declarationAllowed=true;
 const consume=function*():Generator<CorporateRegistryRecord>{
  for(;;){
   signal?.throwIfAborted();
   if(start){if(!buffer)return;start=false;if(buffer[0]==='\uFEFF')buffer=buffer.slice(1);}
   const trimmed=buffer.replace(/^[ \t\r\n]+/,'');if(state.stage==='header'&&!declared&&trimmed!==buffer)declarationAllowed=false;buffer=trimmed;if(!buffer)return;
   if(state.stage==='end')invalid();
   if(state.stage==='header'){
    if(buffer.startsWith('<?xml')){
     if(declared||!declarationAllowed)invalid();const end=buffer.indexOf('?>');if(end<0)return;const declaration=buffer.slice(0,end+2);
     if(/encoding\s*=\s*(['"])(?!UTF-8\1)/i.test(declaration))invalid();parseCorporateRegistryDownloadXml(declaration+'<corporations/>',source);declared=true;buffer=buffer.slice(end+2);continue;
    }
    if(buffer[0]!=='<')invalid();const end=buffer.indexOf('>');if(end<0)return;const tag=buffer.slice(0,end+1);
    if(!/^<corporations[ \t\r\n]*(?:\/>|>)$/.test(tag))invalid();state.stage=tag.endsWith('/>')?'end':'records';buffer=buffer.slice(end+1);continue;
   }
   if(buffer.startsWith('</corporations')){const end=buffer.indexOf('>');if(end<0)return;if(!/^<\/corporations[ \t\r\n]*>$/.test(buffer.slice(0,end+1)))invalid();state.stage='end';buffer=buffer.slice(end+1);continue;}
   const openEnd=buffer.indexOf('>');if(openEnd<0)return;if(!/^<corporation[ \t\r\n]*>$/.test(buffer.slice(0,openEnd+1)))invalid();
   const close=/<\/corporation[ \t\r\n]*>/.exec(buffer);if(!close)return;const end=close.index+close[0].length,xml=buffer.slice(0,end);
   if(Buffer.byteLength(xml)>CORPORATE_REGISTRY_RECORD_MAX_BYTES||xml.includes('<!')||xml.includes('<?'))invalid();
   const record=parseCorporateRegistryDownloadXml('<corporations>'+xml+'</corporations>',source).records[0];
   if(!record)invalid();buffer=buffer.slice(end);yield {...record,recordNumber:++records};
  }
 };
 for await(const chunk of chunks){
  signal?.throwIfAborted();if(!(chunk instanceof Uint8Array)||chunk.byteLength>1024*1024)invalid();bytes+=chunk.byteLength;if(bytes>maxBytes)invalid();hash.update(chunk);buffer+=decoder.decode(chunk,{stream:true});yield* consume();
  if(Buffer.byteLength(buffer)>CORPORATE_REGISTRY_RECORD_MAX_BYTES)invalid();
 }
 buffer+=decoder.decode();yield* consume();signal?.throwIfAborted();if(state.stage!=='end'||buffer||bytes===0)invalid();
 return {parserVersion:'nta-download-stream-1',source:{...source,inputXmlSha256:hash.digest('hex'),attribution:'国税庁法人番号公表サイト（国税庁）を加工して作成'},bytes,records};
}
const identity=(s:BigIntStats)=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.nlink].join(':');
/** 内部用。単一リンクの通常ファイルを固定FDで読み、完了前に原本指紋と不変性を確認します。 */
export async function* readCorporateRegistryFile(file:string,source:CorporateRegistrySource,sha256:string,options:CorporateRegistryStreamOptions={}):AsyncGenerator<CorporateRegistryRecord,CorporateRegistryStreamReceipt>{
 const config=settings(options);if(typeof file!=='string'||!file.trim()||typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256))invalid();
 const handle=await open(file,constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW);
 try{
  const before=await handle.stat({bigint:true});if(!before.isFile()||before.nlink!==1n||before.size>BigInt(config.maxBytes)||identity(await lstat(file,{bigint:true}))!==identity(before))invalid();
  async function* chunks(){const buffer=Buffer.allocUnsafe(64*1024);let position=0;for(;;){config.signal?.throwIfAborted();const {bytesRead}=await handle.read(buffer,0,buffer.length,position);if(!bytesRead)break;position+=bytesRead;yield buffer.subarray(0,bytesRead);}}
  const receipt=yield* streamCorporateRegistryRecords(chunks(),source,config);
  if(receipt.source.inputXmlSha256!==sha256||BigInt(receipt.bytes)!==before.size||identity(await handle.stat({bigint:true}))!==identity(before)||identity(await lstat(file,{bigint:true}))!==identity(before))invalid();config.signal?.throwIfAborted();return receipt;
 }finally{await handle.close();}
}
