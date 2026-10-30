import {it,expect,vi} from 'vitest';
vi.mock('node:fs',async original=>{const fs=await original<typeof import('node:fs')>();return {...fs,statfsSync:vi.fn((...args:Parameters<typeof fs.statfsSync>)=>({...fs.statfsSync(...args),bsize:1024,bavail:2**30}))}});
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync,statfsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {Database} from '../src/db/node-sqlite';
import {CorporateRegistryBlockStore} from '../src/db/corporate-registry-block-store';
import {registryStreamXml as xml,registryStreamRow as row,registryStreamSource as source} from './fixtures/corporate-registry-stream';
import {importCorporateRegistryArchive as run} from '../scripts/roadmap/import-corporate-registry-archive.mjs';
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
function fixture(bad=false,duplicate=false){
 const dir=mkdtempSync(join(tmpdir(),'registry-job-')),texts=[xml(row()),xml(row({corporateNumber:duplicate?'1010001001202':'2010001001201',name:'別会社'}))],archive=join(dir,'source.zip'),receiptPath=join(dir,'receipt.json'),dbPath=join(dir,'registry.sqlite'),checkpointPath=join(dir,'checkpoint.json');
 texts.forEach((t,i)=>writeFileSync(join(dir,i+'.xml'),t));
 const zipped=spawnSync('python3',['-c',"import zipfile,sys,pathlib; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(p/'source.zip','w',zipfile.ZIP_DEFLATED); [(z.writestr(str(i)+'.xml',(p/(str(i)+'.xml')).read_bytes()),z.writestr(str(i)+'.xml.asc',b'test-signature')) for i in range(2)]; z.close()",dir]);expect(zipped.status).toBe(0);
 const receipt={format:'edinet-ts-corporate-registry-verified-archive-v1',signaturesVerified:true,archive:{path:archive,bytes:readFileSync(archive).length,sha256:hash(readFileSync(archive))},source:{...source,kind:'full'},parts:texts.map((t,i)=>({entry:i+'.xml',xmlBytes:Buffer.byteLength(t),xmlSha256:bad&&i===1?'0'.repeat(64):hash(t),trustedFingerprint:'F4109E821F0DE67C4BA1947C4BCD87A24D615230'}))};
 const encoded=JSON.stringify(receipt);writeFileSync(receiptPath,encoded);
 return {dir,archive,receiptPath,dbPath,checkpointPath,input:{receiptPath,receiptSha256:hash(encoded),dbPath,checkpointPath,sdkPath:resolve('src/index.ts'),maxParts:1}};
}
it('部分取込→監査付き再開→完了の再実行で原値・manifest・DB不変を確認する',async()=>{
 const f=fixture();try{const first=await run(f.input);expect(first.status).toBe('pending');expect(first.files).toHaveLength(1);const second=await run(f.input);expect(second.status).toBe('complete');expect(second.deliveryValidated).toBe(true);expect(second.files).toHaveLength(2);expect(second.files[0]).toEqual(first.files[0]);expect(second.manifest.fileIds).toEqual(second.files.map((v:{id:string})=>v.id));
 const before=hash(readFileSync(f.dbPath));expect(await run(f.input)).toEqual(second);expect(hash(readFileSync(f.dbPath))).toBe(before);const reader=new CorporateRegistryBlockStore(f.dbPath,{readOnly:true});try{expect(reader.query({corporateNumber:'2010001001201',knownAt:source.observedAt,registryPurpose:'sample'}).rows[0].record.values.name).toBe('別会社')}finally{reader.close()}
 }finally{rmSync(f.dir,{recursive:true,force:true})}
});
it('後続パートの上流失敗はrollbackし、前のcheckpointと原本を保持する',async()=>{
 const f=fixture(true);try{const first=await run(f.input),before=readFileSync(f.checkpointPath),archive=hash(readFileSync(f.archive));await expect(run(f.input)).rejects.toThrow();expect(readFileSync(f.checkpointPath)).toEqual(before);expect(hash(readFileSync(f.archive))).toBe(archive);const reader=new CorporateRegistryBlockStore(f.dbPath,{readOnly:true});try{expect(reader.file(first.files[0].id)).toEqual(first.files[0]);expect(reader.query({corporateNumber:'2010001001201',knownAt:source.observedAt,registryPurpose:'sample'}).total).toBe(0)}finally{reader.close()}
 }finally{rmSync(f.dir,{recursive:true,force:true})}
});
it('receipt/checkpointの改変と既存DBへのcheckpointなしの追記を拒否する',async()=>{
 const f=fixture();try{await expect(run({...f.input,receiptSha256:'0'.repeat(64)})).rejects.toThrow();expect(existsSync(f.dbPath)).toBe(false);await run(f.input);const before=hash(readFileSync(f.dbPath)),saved=readFileSync(f.checkpointPath);let state=JSON.parse(saved.toString());state.files[0].part='another.xml';writeFileSync(f.checkpointPath,JSON.stringify(state));await expect(run(f.input)).rejects.toThrow();writeFileSync(f.checkpointPath,saved);writeFileSync(f.receiptPath,readFileSync(f.receiptPath).toString()+' ');await expect(run(f.input)).rejects.toThrow();expect(hash(readFileSync(f.dbPath))).toBe(before);
 await expect(run({...f.input,receiptSha256:hash(readFileSync(f.receiptPath)),checkpointPath:join(f.dir,'other.json')})).rejects.toThrow('Existing DB');
 }finally{rmSync(f.dir,{recursive:true,force:true})}
});
it('実CLIは排他付きで取込み、未知オプションを秘密値を出力せず拒否する',()=>{
 const f=fixture();try{const args=['--import',resolve('test/fixtures/registry-job-capacity.mjs'),'--import','tsx','scripts/roadmap/import-corporate-registry-archive.mjs','--receipt',f.receiptPath,'--receipt-sha256',f.input.receiptSha256,'--db',f.dbPath,'--checkpoint',f.checkpointPath,'--sdk',f.input.sdkPath];let result=spawnSync(process.execPath,args,{encoding:'utf8',timeout:30000});expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout).status).toBe('pending');result=spawnSync(process.execPath,[...args,'--PRIVATE_INVALID'],{encoding:'utf8',timeout:30000});expect(result.status).toBe(1);expect(result.stderr).not.toContain('PRIVATE_INVALID');
 }finally{rmSync(f.dir,{recursive:true,force:true})}
});
it('固定hashと全記録監査で確認した既存DBへ別観測を追記し、元の観測を保持する',async()=>{
 const f=fixture();try{const first=await run({...f.input,maxParts:2}),before=hash(readFileSync(f.dbPath)),receipt=JSON.parse(readFileSync(f.receiptPath).toString());receipt.source.observedAt='2026-10-31T00:00:00Z';const encoded=JSON.stringify(receipt),newReceipt=join(f.dir,'next-receipt.json');writeFileSync(newReceipt,encoded);const input={...f.input,receiptPath:newReceipt,receiptSha256:hash(encoded),checkpointPath:join(f.dir,'next-checkpoint.json'),expectedDbSha256:before};await expect(run({...input,expectedDbSha256:'0'.repeat(64)})).rejects.toThrow('Base database');expect(hash(readFileSync(f.dbPath))).toBe(before);const next=await run(input);expect(next.status).toBe('pending');expect((await run(input)).status).toBe('complete');const reader=new CorporateRegistryBlockStore(f.dbPath,{readOnly:true});try{expect(reader.file(first.files[0].id)).toEqual(first.files[0]);expect(reader.query({corporateNumber:'1010001001202',knownAt:receipt.source.observedAt,registryPurpose:'sample'}).total).toBe(2)}finally{reader.close()}
 }finally{rmSync(f.dir,{recursive:true,force:true})}
});
it('中断済みsignalと原ZIPへのcheckpoint上書きをDB作成前に拒否する',async()=>{
 const f=fixture();try{const controller=new AbortController();controller.abort();await expect(run({...f.input,signal:controller.signal})).rejects.toThrow();const before=hash(readFileSync(f.archive));await expect(run({...f.input,checkpointPath:f.archive})).rejects.toThrow();expect(hash(readFileSync(f.archive))).toBe(before);expect(existsSync(f.dbPath)).toBe(false)
 }finally{rmSync(f.dir,{recursive:true,force:true})}
});
it('DBの排他が取れなければCLIは75で終了し、DBを作成しない',async()=>{
 const f=fixture();const {spawn}=await import('node:child_process');const child=spawn('/usr/bin/flock',['--no-fork','-n',f.dbPath+'.lock',process.execPath,'-e',"console.log('locked');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','pipe']});
 try{await new Promise<void>((done,reject)=>{child.stdout.once('data',()=>done());child.once('error',reject);child.once('exit',()=>reject(Error('Lock holder exited')))});const result=spawnSync(process.execPath,['--import',resolve('test/fixtures/registry-job-capacity.mjs'),'--import','tsx','scripts/roadmap/import-corporate-registry-archive.mjs','--receipt',f.receiptPath,'--receipt-sha256',f.input.receiptSha256,'--db',f.dbPath,'--checkpoint',f.checkpointPath,'--sdk',f.input.sdkPath],{encoding:'utf8',timeout:30000});expect(result.status).toBe(75);expect(existsSync(f.dbPath)).toBe(false)
 }finally{child.kill('SIGTERM');await new Promise<void>(done=>child.once('close',()=>done()));rmSync(f.dir,{recursive:true,force:true})}
});
it('DB commit後・checkpoint保存前の停止相当では、同じパートを再検証して重複を作らない',async()=>{
 const f=fixture();try{const first=await run(f.input),pending=readFileSync(f.checkpointPath),complete=await run(f.input),before=hash(readFileSync(f.dbPath));writeFileSync(f.checkpointPath,pending);expect(await run(f.input)).toEqual(complete);expect(hash(readFileSync(f.dbPath))).toBe(before);expect(complete.files[0]).toEqual(first.files[0])
 }finally{rmSync(f.dir,{recursive:true,force:true})}
});
it('取込済みパートの破損は次パート取込前の全記録監査で拒否する',async()=>{
 const f=fixture();try{await run(f.input);const db=new Database(f.dbPath);try{db.exec("UPDATE block_payloads SET payload=x'00'")}finally{db.close()}const before=hash(readFileSync(f.dbPath)),checkpoint=readFileSync(f.checkpointPath);await expect(run(f.input)).rejects.toThrow();expect(hash(readFileSync(f.dbPath))).toBe(before);expect(readFileSync(f.checkpointPath)).toEqual(checkpoint)
 }finally{rmSync(f.dir,{recursive:true,force:true})}
});

it('全国全件の別パートで法人番号が重複すると、保存済みでもcompleteを出さない',async()=>{
 const f=fixture(false,true);try{const first=await run(f.input);expect(first.deliveryValidated).toBe(false);await expect(run(f.input)).rejects.toThrow();const state=JSON.parse(readFileSync(f.checkpointPath).toString());expect(state.files).toHaveLength(2);expect(state.status).toBe('pending');expect(state.deliveryValidated).toBe(false);await expect(run(f.input)).rejects.toThrow()
 }finally{rmSync(f.dir,{recursive:true,force:true})}
});

it('全国差分の別パートで一連番号が重複するとcompleteを出さない',async()=>{
 const f=fixture();try{const receipt=JSON.parse(readFileSync(f.receiptPath).toString());receipt.source.kind='diff';const encoded=JSON.stringify(receipt);writeFileSync(f.receiptPath,encoded);const input={...f.input,receiptSha256:hash(encoded)};await run(input);await expect(run(input)).rejects.toThrow();expect(JSON.parse(readFileSync(f.checkpointPath).toString())).toMatchObject({status:'pending',deliveryValidated:false})
 }finally{rmSync(f.dir,{recursive:true,force:true})}
});

it('留保容量を下回るとAPIとCLIがDB/checkpoint作成前に停止する',async()=>{
 const f=fixture();try{vi.mocked(statfsSync).mockReturnValueOnce({...statfsSync(f.dir),bsize:1024,bavail:0});await expect(run(f.input)).rejects.toMatchObject({code:'CORPORATE_REGISTRY_CAPACITY'});expect(existsSync(f.dbPath)).toBe(false);expect(existsSync(f.checkpointPath)).toBe(false);const result=spawnSync(process.execPath,['--import',resolve('test/fixtures/registry-job-capacity.mjs'),'--import','tsx','scripts/roadmap/import-corporate-registry-archive.mjs','--receipt',f.receiptPath,'--receipt-sha256',f.input.receiptSha256,'--db',f.dbPath,'--checkpoint',f.checkpointPath,'--sdk',f.input.sdkPath],{encoding:'utf8',timeout:30000,env:{...process.env,REGISTRY_JOB_TEST_FREE_BYTES:'0'}});expect(result.status).toBe(1);expect(result.stderr).toContain('容量保護で停止');expect(existsSync(f.dbPath)).toBe(false);expect(existsSync(f.checkpointPath)).toBe(false)
 }finally{rmSync(f.dir,{recursive:true,force:true})}
});
