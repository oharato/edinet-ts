import {createReadStream,existsSync,statfsSync,statSync,openSync,closeSync,constants,lstatSync,fstatSync,realpathSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {canonical,sha256,normalFile,readJSONSnapshot,atomicJSON} from './operational-files.mjs';
const format='edinet-ts-corporate-registry-archive-job-v1',reserve=34*1024**3,margin=64*1024**2;
const helper=fileURLToPath(new URL('./stream-corporate-registry-member.py',import.meta.url));
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const capacity=(db,limit)=>{const s=statfsSync(dirname(db));if(Number(s.bavail)*Number(s.bsize)<reserve+2*limit-(existsSync(db)?statSync(db).size:0)+margin)throw Error('Corporate registry capacity reserve reached')};
async function* chunks(receiptPath,entry,signal,check){
 const child=spawn('python3',[helper,'--receipt',receiptPath,'--entry',entry],{stdio:['ignore','pipe','pipe'],signal});
 let terminal=false;const exit=new Promise((done,reject)=>{child.once('error',reject);child.once('close',(code)=>{terminal=true;done(code)})});exit.catch(()=>{});
 child.stderr.resume();
 try{for await(const bytes of child.stdout){signal?.throwIfAborted();check();yield bytes}if(await exit!==0)throw Error('Corporate registry ZIP stream failed')}
 finally{if(!terminal)child.kill('SIGKILL');await exit.catch(()=>{})}
}
/** Caller holds dbPath+'.lock' and checkpointPath+'.lock' for the entire invocation. */
export async function importCorporateRegistryArchive({receiptPath,receiptSha256,dbPath,checkpointPath,sdkPath,maxParts=1,expectedDbSha256,signal}){
 for(const p of [receiptPath,dbPath,checkpointPath,sdkPath])if(typeof p!=='string'||resolve(p)!==p||realpathSync(dirname(p))!==dirname(p))throw Error('Canonical absolute paths required');
 if(new Set([receiptPath,dbPath,checkpointPath,sdkPath]).size!==4||!digest(receiptSha256)||(expectedDbSha256!==undefined&&!digest(expectedDbSha256))||!Number.isSafeInteger(maxParts)||maxParts<1||maxParts>100)throw Error('Invalid registry import job');
 signal?.throwIfAborted();const snapshot=readJSONSnapshot(receiptPath),receipt=snapshot.value;
 if(snapshot.sha256!==receiptSha256||Buffer.byteLength(snapshot.text)>2*1024**2||receipt.format!=='edinet-ts-corporate-registry-verified-archive-v1'||receipt.signaturesVerified!==true||!Array.isArray(receipt.parts)||receipt.parts.length<1||receipt.parts.length>100||new Set(receipt.parts.map(p=>p.entry)).size!==receipt.parts.length)throw Error('Verified archive receipt required');
 if(!receipt.archive||typeof receipt.archive.path!=='string'||resolve(receipt.archive.path)!==receipt.archive.path||[receiptPath,dbPath,checkpointPath,sdkPath,dbPath+'.lock',checkpointPath+'.lock'].includes(receipt.archive.path))throw Error('Archive must be separate from job files');
 normalFile(receipt.archive.path);
 for(const p of receipt.parts)if(typeof p.entry!=='string'||!p.entry.endsWith('.xml')||!digest(p.xmlSha256)||!Number.isSafeInteger(p.xmlBytes)||p.xmlBytes<1||p.xmlBytes>8*1024**3||p.trustedFingerprint!=='F4109E821F0DE67C4BA1947C4BCD87A24D615230')throw Error('Invalid verified archive part');
 const sdk=await import(pathToFileURL(normalFile(sdkPath)).href),Store=sdk.CorporateRegistryBlockStore,limit=sdk.CORPORATE_REGISTRY_BLOCK_MAX_DB_BYTES;
 if(typeof Store!=='function'||limit!==640*1024**2)throw Error('Compressed registry SDK required');
 sdk.parseCorporateRegistryDownloadXml('<corporations/>',receipt.source);
 capacity(dbPath,limit);const binding={format,receiptPath,receiptSha256,dbPath,...expectedDbSha256===undefined?{}:{expectedDbSha256}},present=existsSync(checkpointPath);
 let state=present?readJSONSnapshot(checkpointPath).value:{...binding,files:[]};
 if(canonical(Object.fromEntries(Object.keys(binding).map(k=>[k,state[k]])))!==canonical(binding)||!Array.isArray(state.files)||state.files.length>receipt.parts.length)throw Error('Checkpoint belongs to another input');
 const validate=(file,i)=>{const p=receipt.parts[i],source={...receipt.source,sourceUrl:new URL(receipt.source.sourceUrl).href,observedAt:new Date(receipt.source.observedAt).toISOString()};if(file.id!==sha256(canonical([source,p.entry]))||file.sha256!==p.xmlSha256||file.bytes!==p.xmlBytes||file.part!==p.entry||canonical(file.source)!==canonical(source))throw Error('Checkpoint differs from verified part')};
 state.files.forEach(validate);
 let deliveryValidated=false;
 const audit=()=>{const reader=new Store(dbPath,{readOnly:true});try{
  for(const file of state.files)if(canonical(reader.file(file.id))!==canonical(file))throw Error('Checkpoint differs from audited database');
  if(state.files.length===receipt.parts.length){reader.reconstruct([{scope:'national',expectedParts:receipt.parts.length,fileIds:state.files.map(f=>f.id)}],{corporateNumber:'1010001001202',asOf:receipt.source.dataDate,knownAt:receipt.source.observedAt,registryPurpose:receipt.source.purpose});deliveryValidated=true}
 }finally{reader.close()}};
 if(state.files.length)audit();
 if(!present&&existsSync(dbPath)){
  if(!expectedDbSha256)throw Error('Existing DB requires its original checkpoint or explicit base hash');
  const before=statSync(normalFile(dbPath),{bigint:true}),hash=createHash('sha256');
  if(before.size>BigInt(limit))throw Error('Base database exceeds capacity');
  for await(const bytes of createReadStream(dbPath,{flags:constants.O_RDONLY|constants.O_NOFOLLOW})){signal?.throwIfAborted();hash.update(bytes)}
  const after=statSync(normalFile(dbPath),{bigint:true});
  if(hash.digest('hex')!==expectedDbSha256||[before.dev,before.ino,before.size,before.mtimeNs,before.ctimeNs].join(':')!==[after.dev,after.ino,after.size,after.mtimeNs,after.ctimeNs].join(':'))throw Error('Base database differs from expected hash');
  const reader=new Store(dbPath,{readOnly:true});try{reader.query({corporateNumber:'1010001001202',knownAt:receipt.source.observedAt,registryPurpose:receipt.source.purpose,limit:0})}finally{reader.close()}
 }else if(!present&&expectedDbSha256)throw Error('Expected base database is missing');
 const save=()=>{if(readJSONSnapshot(receiptPath).sha256!==receiptSha256)throw Error('Receipt changed during import');atomicJSON(checkpointPath,{...binding,files:state.files,status:deliveryValidated?'complete':'pending',deliveryValidated,manifest:{scope:'national',expectedParts:receipt.parts.length,fileIds:state.files.map(f=>f.id)}},{createOnly:!existsSync(checkpointPath)})};
 if(!present)save();
 let store;
 try{if(state.files.length<receipt.parts.length){store=new Store(dbPath);let imported=0;
  while(state.files.length<receipt.parts.length&&imported++<maxParts){signal?.throwIfAborted();capacity(dbPath,limit);const part=receipt.parts[state.files.length],result=await store.importChunks({source:receipt.source,part:part.entry,sha256:part.xmlSha256,chunks:chunks(receiptPath,part.entry,signal,()=>capacity(dbPath,limit))},{signal});validate(result.file,state.files.length);state.files.push(result.file);save()}
 }else save();
 }finally{store?.close()}
 if(state.files.length===receipt.parts.length&&!deliveryValidated){audit();save()}
 return readJSONSnapshot(checkpointPath).value;
}
async function main(){
 const {values}=parseArgs({options:{receipt:{type:'string'},'receipt-sha256':{type:'string'},db:{type:'string'},checkpoint:{type:'string'},sdk:{type:'string'},'max-parts':{type:'string',default:'1'},'expected-db-sha256':{type:'string'}}});
 if(!values.receipt||!values.db||!values.checkpoint||!values.sdk||!/^([1-9]|[1-9]\d|100)$/.test(values['max-parts']))throw Error('Invalid job arguments');
 const paths=[values.db,values.checkpoint].map(p=>resolve(p)+'.lock'),fds=[];
 if(new Set([...paths,...[values.receipt,values.db,values.checkpoint,values.sdk].map(p=>resolve(p))]).size!==6)throw Error('Overlapping lock/input paths');
 try{for(const p of paths){if(realpathSync(dirname(p))!==dirname(p))throw Error('Invalid lock path');const fd=openSync(p,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);fds.push(fd);const s=fstatSync(fd),l=lstatSync(p);if(!s.isFile()||s.nlink!==1||s.ino!==l.ino||s.dev!==l.dev)throw Error('Invalid lock');const lock=spawnSync('/usr/bin/flock',['-n','-E','75','3'],{stdio:['ignore','ignore','ignore',fd],timeout:10000});if(lock.status!==0){const error=Error('Job locked');error.exitCode=lock.status===75?75:1;throw error}}
  const controller=new AbortController(),stop=()=>controller.abort();process.on('SIGINT',stop);process.on('SIGTERM',stop);
  try{const result=await importCorporateRegistryArchive({receiptPath:resolve(values.receipt),receiptSha256:values['receipt-sha256'],dbPath:resolve(values.db),checkpointPath:resolve(values.checkpoint),sdkPath:resolve(values.sdk),maxParts:Number(values['max-parts']),expectedDbSha256:values['expected-db-sha256'],signal:controller.signal});console.log(JSON.stringify(result))}finally{process.off('SIGINT',stop);process.off('SIGTERM',stop)}
 }finally{for(const fd of fds.reverse())closeSync(fd)}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error('法人番号原本・固定receipt・DB・checkpoint・排他・留保容量を確認してください（入力内容は非表示）');process.exitCode=error?.exitCode??(error?.name==='AbortError'?2:1)});
