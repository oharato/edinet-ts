import {it,expect} from 'vitest';import {mkdtempSync,rmSync,writeFileSync,readFileSync,linkSync,symlinkSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {CorporateRegistryStore} from '../src/db/corporate-registry-store';import {Database} from '../src/db/node-sqlite';import {registryStreamSource as source,registryStreamXml as xml,registryStreamRow as row} from './fixtures/corporate-registry-stream';
const sha=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
async function fixture(fn:(s:{dir:string;file:string;dbFile:string;store:CorporateRegistryStore;input:ReturnType<typeof input>})=>Promise<void>){const dir=mkdtempSync(join(tmpdir(),'registry-store-')),file=join(dir,'source.xml'),dbFile=join(dir,'store.sqlite'),store=new CorporateRegistryStore(dbFile);writeFileSync(file,xml());try{await fn({dir,file,dbFile,store,input:input(file)})}finally{store.close();rmSync(dir,{recursive:true,force:true})}}
function input(file:string,text=xml()){return {file,source,part:'diff.xml',sha256:sha(text)}}
const q={corporateNumber:'1010001001202',knownAt:source.observedAt,registryPurpose:'sample' as const};
it('原本を最後まで検査して保存し、再openで原値・出典・hash・総数とページを返す',()=>fixture(async s=>{
 const text=xml(row()+row({sequenceNumber:'2',correct:'1',latest:'0'}));writeFileSync(s.file,text);const result=await s.store.importFile(input(s.file,text));expect(result).toMatchObject({status:'inserted',content:'inserted',file:{bytes:Buffer.byteLength(text),records:2,part:'diff.xml',source:{...source,observedAt:new Date(source.observedAt).toISOString()}}});expect(s.store.audit(result.file.id).records).toBe(2);s.store.close();const dbBefore=readFileSync(s.dbFile),reader=new CorporateRegistryStore(s.dbFile,{readOnly:true});try{
 const r=reader.query({...q,limit:1,offset:1});expect(r.total).toBe(2);expect(r.rows).toHaveLength(1);expect(r.rows[0].record.values).toMatchObject({sequenceNumber:'2',name:'日本 & 会社',correct:'1',latest:'0'});expect(reader.file(result.file.id)).toEqual(result.file);expect(reader.query({...q,limit:0})).toMatchObject({total:2,rows:[]});expect(reader.query({...q,registryPurpose:'download'}).rows).toEqual([]);expect(reader.query({...q,knownAt:'2026-10-29T00:00:00Z'}).rows).toEqual([]);
 }finally{reader.close()}expect(readFileSync(s.dbFile)).toEqual(dbBefore);expect(readFileSync(s.file).toString()).toBe(text);
}));
it('同一原本は共有し、同一観測は再検査してunchanged、後日観測は別に保持する',()=>fixture(async s=>{
 const a=await s.store.importFile(s.input),b=await s.store.importFile(s.input),c=await s.store.importFile({...s.input,source:{...source,observedAt:'2026-10-31T00:00:00Z'}});expect(a.content).toBe('inserted');expect(b.status).toBe('unchanged');expect(c).toMatchObject({status:'inserted',content:'reused'});expect(s.store.query({...q,knownAt:'2026-11-01T00:00:00Z'}).total).toBe(2);s.store.close();const db=new Database(s.dbFile);try{expect(db.prepare('SELECT COUNT(*) n FROM registry_records').get()?.n).toBe(1);expect(db.prepare('SELECT COUNT(*) n FROM registry_files').get()?.n).toBe(2)}finally{db.close()}
}));
it.each(['truncated','duplicate-sequence','wrong-hash','unknown-tag'])('%sでは途中の記録もrollbackし既存観測を保持する',kind=>fixture(async s=>{
 const saved=await s.store.importFile(s.input);let text=xml(row({sequenceNumber:'2'}));if(kind==='truncated')text=text.replace('</corporations>','');if(kind==='duplicate-sequence')text=xml(row()+row());if(kind==='unknown-tag')text=text.replace('</corporations>','<unknown/></corporations>');writeFileSync(s.file,text);const changed={...input(s.file,text),part:'other.xml'};if(kind==='wrong-hash')changed.sha256='0'.repeat(64);await expect(s.store.importFile(changed)).rejects.toThrow();expect(s.store.query(q).total).toBe(1);expect(s.store.audit(saved.file.id).records).toBe(1);
}));
it('同じ観測への異なる原本、リンク、readonlyと不正境界を拒否する',()=>fixture(async s=>{
 await s.store.importFile(s.input);const changed=xml(row({name:'changed'}));writeFileSync(s.file,changed);await expect(s.store.importFile(input(s.file,changed))).rejects.toThrow('競合');writeFileSync(s.file,xml());
 for(const kind of ['hard','symbolic']){const path=join(s.dir,kind);if(kind==='hard')linkSync(s.file,path);else symlinkSync(s.file,path);await expect(s.store.importFile({...s.input,file:path,part:kind})).rejects.toThrow();if(kind==='hard')rmSync(path)}
 const controller=new AbortController();controller.abort();await expect(s.store.importFile({...s.input,part:'aborted'},{signal:controller.signal})).rejects.toThrow();
 for(const query of [{...q,corporateNumber:new String(q.corporateNumber)},{...q,limit:1001},{...q,offset:-1},{...q,extra:true}])expect(()=>s.store.query(query as never)).toThrow();
 s.store.close();const reader=new CorporateRegistryStore(s.dbFile,{readOnly:true});try{await expect(reader.importFile(s.input)).rejects.toThrow('readOnly')}finally{reader.close()}
}));
it('取込中の同じ接続を再利用/closeせず、完了後に再利用できる',()=>fixture(async s=>{
 const pending=s.store.importFile(s.input);expect(()=>s.store.close()).toThrow('完了');expect(()=>s.store.query(q)).toThrow();await expect(s.store.importFile(s.input)).rejects.toThrow();await pending;expect(s.store.query(q).total).toBe(1);
}));
it('検索に当たらない改変索引も全体検査で検出し、空結果へ隠さない',()=>fixture(async s=>{
 await s.store.importFile(s.input);s.store.close();const db=new Database(s.dbFile);try{db.exec("UPDATE registry_records SET corporate_number='1010001001210'")}finally{db.close()}
 const reader=new CorporateRegistryStore(s.dbFile,{readOnly:true});try{expect(()=>reader.query(q)).toThrow()}finally{reader.close()}
}));
it('readonly私有コピーの後付け変更で検査cacheを迂回できない',()=>fixture(async s=>{
 await s.store.importFile(s.input);s.store.close();const reader=new CorporateRegistryStore(s.dbFile,{readOnly:true});try{expect(reader.query(q).total).toBe(1);const path=(reader as any).snapshotFile;const db=new Database(path);try{db.exec("UPDATE registry_records SET corporate_number='1010001001210'")}finally{db.close()}expect(()=>reader.query(q)).toThrow('変化')}finally{reader.close()}
}));

it('保存できない長い出典をcommit前に拒否する',()=>fixture(async s=>{
 await expect(s.store.importFile({...s.input,source:{...source,sourceUrl:'https://example.test/'+'x'.repeat(10000)}})).rejects.toThrow();expect(s.store.query(q).total).toBe(0);
}));
