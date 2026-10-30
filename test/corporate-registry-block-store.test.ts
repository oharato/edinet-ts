import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,openSync,ftruncateSync,closeSync,statSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {CorporateRegistryBlockStore as Blocks,CORPORATE_REGISTRY_BLOCK_MAX_DB_BYTES as maxBytes} from '../src/db/corporate-registry-block-store';
import {CorporateRegistryStore as Rows} from '../src/db/corporate-registry-store';
import {Database} from '../src/db/node-sqlite';
import {recoverDedicatedSqliteSnapshot} from '../src/db/sqlite-recovery';
import {crashDatabase} from './fixtures/sqlite-crash';
import {CORPORATE_REGISTRY_FIELDS as fields} from '../src/corporate-registry';
import {registryStreamXml as xml,registryStreamRow as row,registryStreamSource as source} from './fixtures/corporate-registry-stream';
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex'),number='1010001001202';
const canonical=(v:unknown):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const query={corporateNumber:number,knownAt:'2026-10-31T00:00:00Z',registryPurpose:'sample' as const};
async function* chunks(text:string){const b=Buffer.from(text);for(let i=0;i<b.length;i+=65536)yield b.subarray(i,i+65536)}
async function fixture(use:(f:{dir:string;db:string;store:Blocks;add:(text?:string,date?:string,kind?:'full'|'diff')=>Promise<Awaited<ReturnType<Blocks['importFile']>>>})=>Promise<void>){
 const dir=mkdtempSync(join(tmpdir(),'registry-block-')),db=join(dir,'blocks.sqlite'),store=new Blocks(db);
 const add=async(text=xml(row()),date='2026-10-29',kind:'full'|'diff'='full')=>{const file=join(dir,date+'.xml');writeFileSync(file,text);return store.importFile({file,source:{...source,dataDate:date,kind,observedAt:date>'2026-10-30'?'2026-10-31T00:00:00Z':source.observedAt},part:date+'.xml',sha256:hash(text)})};
 try{await use({dir,db,store,add})}finally{store.close();rmSync(dir,{recursive:true,force:true})}
}
it('旧Storeと取込receipt・全30値・出典・検索・再構成が一致し、readonlyと原DBを保つ',()=>fixture(async f=>{
 const text=xml(row()+row({sequenceNumber:'2',corporateNumber:'2010001001201',name:'別会社'})),a=await f.add(text),raw=new Rows(join(f.dir,'raw.sqlite'));
 try{const b=await raw.importFile({file:join(f.dir,'2026-10-29.xml'),source:{...source,kind:'full'},part:'2026-10-29.xml',sha256:hash(text)});expect(a).toEqual(b);expect(f.store.query(query)).toEqual(raw.query(query));
  const d=[{scope:'national' as const,expectedParts:1,fileIds:[a.file.id]}],q={...query,asOf:'2026-10-29'};expect(f.store.reconstruct(d,q)).toEqual(raw.reconstruct(d,q));f.store.close();const before=hash(readFileSync(f.db)),reader=new Blocks(f.db,{readOnly:true});try{expect(reader.file(a.file.id)).toEqual(a.file);expect(reader.reconstruct(d,q)).toEqual(raw.reconstruct(d,q));const result=reader.query(query);result.rows[0].record.values.name='書換';expect(reader.query(query).rows[0].record.values.name).toBe('日本 & 会社');expect(reader.audit(a.file.id).records).toBe(2)}finally{reader.close()}expect(hash(readFileSync(f.db))).toBe(before);
 }finally{raw.close()}
}));
it('1024件のブロック境界を越えて再openできる',()=>fixture(async f=>{
 const text=xml(Array.from({length:2050},(_,i)=>row({sequenceNumber:String(i+1),corporateNumber:String(1000000000000+i),name:'法人'+i})).join('')),receipt=await f.add(text);f.store.close();const reader=new Blocks(f.db,{readOnly:true});try{for(const i of [0,1023,1024,2047,2048,2049])expect(reader.query({...query,corporateNumber:String(1000000000000+i)}).rows[0].record.recordNumber).toBe(i+1);expect(reader.audit(receipt.file.id).records).toBe(2050)}finally{reader.close()}
}));
it('連続差分の改称・削除を反映し、XMLの記録順と一連番号順を混同しない',()=>fixture(async f=>{
 const a=await f.add(),b=await f.add(xml(row({sequenceNumber:'2',process:'11',latest:'1',name:'新名',updateDate:'2026-10-30',changeDate:'2026-10-30'})+row({sequenceNumber:'1',process:'11',latest:'0',name:'旧名',updateDate:'2026-10-30',changeDate:'2026-10-30'})),'2026-10-30','diff'),manifest=[a,b].map(r=>({scope:'national' as const,expectedParts:1,fileIds:[r.file.id]}));
 expect(f.store.reconstruct(manifest,{...query,asOf:'2026-10-30'}).selection).toMatchObject({status:'available',record:{record:{values:{name:'新名'}}}});
 expect(f.store.reconstruct(manifest,{...query,asOf:'2026-10-31'}).selection).toMatchObject({status:'unresolved',reason:'coverage-gap'});
 const blank=Object.fromEntries(fields.map(k=>[k,''])),c=await f.add(xml(row({...blank,sequenceNumber:'1',corporateNumber:number,process:'99',updateDate:'2026-10-31'})),'2026-10-31','diff');expect(f.store.reconstruct([...manifest,{scope:'national',expectedParts:1,fileIds:[c.file.id]}],{...query,asOf:'2026-10-31'}).selection.status).toBe('deleted');
}));
it('同じ原本の再取込と別観測で内容を共有し、offset/limitと目的・cutoffを保つ',()=>fixture(async f=>{
 const text=xml(row()),a=await f.add(text);expect((await f.add(text)).status).toBe('unchanged');const b=await f.store.importChunks({chunks:chunks(text),source:{...source,kind:'full',observedAt:'2026-10-30T12:00:00Z'},part:'another.xml',sha256:hash(text)});expect(b.content).toBe('reused');expect(f.store.query(query)).toMatchObject({total:2,rows:[{file:{id:b.file.id}},{file:{id:a.file.id}}]});expect(f.store.query({...query,offset:1,limit:1}).rows[0].file.id).toBe(a.file.id);expect(f.store.query({...query,limit:0})).toMatchObject({total:2,rows:[]});expect(f.store.query({...query,registryPurpose:'download'}).total).toBe(0);expect(f.store.query({...query,knownAt:'2026-10-29T23:59:59Z'}).total).toBe(0);
}));
it('上流の後検査失敗・hash不一致・原本内重複を原子的に拒否する',()=>fixture(async f=>{
 const good=await f.add(),text=xml(row());async function* failed(){yield Buffer.from(text);throw Error('upstream failed')}
 for(const input of [{chunks:failed(),sha256:hash(text)},{chunks:chunks(text),sha256:'0'.repeat(64)},{chunks:chunks(xml(row()+row())),sha256:hash(xml(row()+row()))}])await expect(f.store.importChunks({...input,source:{...source,kind:'full'},part:'bad.xml'})).rejects.toThrow();expect(f.store.query(query)).toMatchObject({total:1});expect(f.store.file(good.file.id)).toEqual(good.file);
}));
it('中断時にiteratorを閉じ、読取/closeの割込みを拒否して再開できる',()=>fixture(async f=>{
 const controller=new AbortController();let closed=false;const text=xml(row());async function* stopped(){try{expect(()=>f.store.query(query)).toThrow('取込中');expect(()=>f.store.close()).toThrow('完了後');yield Buffer.from(text);controller.abort();yield Buffer.from(' ')}finally{closed=true}}
 await expect(f.store.importChunks({chunks:stopped(),source:{...source,kind:'full'},part:'abort.xml',sha256:hash(text)},{signal:controller.signal})).rejects.toThrow();expect(closed).toBe(true);expect(f.store.query(query).total).toBe(0);await f.add();expect(f.store.query(query).total).toBe(1);
}));
it.each(['payload','index','count','orphan','semantic'])('対象外の改変も全記録監査で拒否する: %s',kind=>fixture(async f=>{
 const a=await f.add();f.store.close();const db=new Database(f.db);
 try{
  if(kind==='payload')db.exec("UPDATE block_payloads SET payload=x'00'");
  if(kind==='index')db.exec("UPDATE block_positions SET number='2010001001201'");
  if(kind==='count')db.exec('UPDATE block_payloads SET count=2');
  if(kind==='orphan')db.exec('INSERT INTO block_payloads SELECT content,99999,count,payload,sha FROM block_payloads');
  if(kind==='semantic'){
   const statement=db.prepare('SELECT * FROM block_payloads'),block=statement.get()!;statement.close();const values=JSON.parse(inflateRawSync(block.payload as Uint8Array).toString());values[0][fields.indexOf('latest')]='BAD';const raw=Buffer.from(JSON.stringify(values)),update=db.prepare('UPDATE block_payloads SET payload=?,sha=?');update.run(deflateRawSync(raw),hash(raw));update.close();const content=db.prepare('SELECT * FROM block_contents'),c=content.get()!;content.close();const body=JSON.parse(String(c.body)),record={recordNumber:1,values:Object.fromEntries(fields.map((key,i)=>[key,values[0][i]])),processKnown:true,deletionExtraFields:[]};body.recordsSha256=hash(hash(canonical([a.file.sha256,1,canonical(record)]))+'\n');const encoded=canonical(body),rewrite=db.prepare('UPDATE block_contents SET body=?,body_sha=?');rewrite.run(encoded,hash(encoded));rewrite.close();
  }
 }finally{db.close()}const before=hash(readFileSync(f.db)),reader=new Blocks(f.db,{readOnly:true});try{expect(()=>reader.query({...query,corporateNumber:'9010001001204'})).toThrow()}finally{reader.close()}expect(hash(readFileSync(f.db))).toBe(before);
}));
it('異なるDB形式とコピー上限超過を元byte不変で拒否する',()=>fixture(async f=>{
 await f.add();f.store.close();const before=hash(readFileSync(f.db));expect(()=>new Rows(f.db,{readOnly:true})).toThrow();expect(hash(readFileSync(f.db))).toBe(before);
 const over=join(f.dir,'over.sqlite'),fd=openSync(over,'w');try{ftruncateSync(fd,maxBytes+1)}finally{closeSync(fd)}expect(()=>new Blocks(over,{readOnly:true})).toThrow('容量上限');expect(statSync(over).size).toBe(maxBytes+1);
}));
it('件数/疎配列/未知条件を拒否し、空原本と空manifestは扱える',()=>fixture(async f=>{
 const a=await f.add(xml(''));expect(f.store.audit(a.file.id).records).toBe(0);expect(f.store.reconstruct([],{...query,asOf:'2026-10-29'}).selection).toEqual({status:'unavailable',reason:'no-baseline'});
 for(const manifest of [new Array(1),[{scope:'national',expectedParts:2,fileIds:[a.file.id]}],[{scope:'national',expectedParts:1,fileIds:new Array(1)}]])expect(()=>f.store.reconstruct(manifest as never,{...query,asOf:'2026-10-29'})).toThrow();expect(()=>f.store.query({...query,limit:1001})).toThrow();await expect(f.store.importChunks({source,part:'x',sha256:hash(''),chunks:chunks(''),unknown:true} as never)).rejects.toThrow();
}));

it('1MiBより大きい集まりを分割し、長い日本語原値をそのまま復元する',()=>fixture(async f=>{
 const name='名'.repeat(20000),text=xml(Array.from({length:20},(_,i)=>row({sequenceNumber:String(i+1),corporateNumber:String(1000000000000+i),name})).join(''));await f.add(text);f.store.close();const db=new Database(f.db,{readOnly:true}),s=db.prepare('SELECT count,payload FROM block_payloads');try{const blocks=s.all();expect(blocks.length).toBeGreaterThan(1);expect(blocks.every(b=>Number(b.count)<1024&&inflateRawSync(b.payload as Uint8Array).length<=1024**2)).toBe(true)}finally{s.close();db.close()}
 const reader=new Blocks(f.db,{readOnly:true});try{expect(reader.query({...query,corporateNumber:'1000000000019'}).rows[0].record.values.name).toBe(name)}finally{reader.close()}
}));
it('多数の履歴もqueryは先にページングし、再構成の1万記録上限は保持する',()=>fixture(async f=>{
 const text=xml(Array.from({length:10005},(_,i)=>row({sequenceNumber:String(i+1)})).join('')),a=await f.add(text);f.store.close();const reader=new Blocks(f.db,{readOnly:true});try{const r=reader.query({...query,offset:10000,limit:5});expect(r.total).toBe(10005);expect(r.rows.map(v=>v.record.recordNumber)).toEqual([10001,10002,10003,10004,10005]);expect(()=>reader.reconstruct([{scope:'national',expectedParts:1,fileIds:[a.file.id]}],{...query,asOf:'2026-10-29'})).toThrow()}finally{reader.close()}
}));
it('分割間の法人番号重複と差分の一連番号重複は対象外でも拒否する',()=>fixture(async f=>{
 const a=await f.add(),text=xml(row()),b=await f.store.importChunks({source:{...source,kind:'full'},part:'second.xml',sha256:hash(text),chunks:chunks(text)});
 expect(()=>f.store.reconstruct([{scope:'national',expectedParts:2,fileIds:[a.file.id,b.file.id]}],{...query,asOf:'2026-10-29'})).toThrow();
 const d=await f.store.importChunks({source,part:'diff1.xml',sha256:hash(text),chunks:chunks(text)}),other=xml(row({corporateNumber:'2010001001201'})),e=await f.store.importChunks({source,part:'diff2.xml',sha256:hash(other),chunks:chunks(other)});
 expect(()=>f.store.reconstruct([{scope:'national',expectedParts:2,fileIds:[d.file.id,e.file.id]}],{...query,corporateNumber:'9010001001204',asOf:'2026-10-29'})).toThrow('重複');
}));
it('SQLiteの容量不足でも既存の原本とcheckpointを残して取込だけを戻す',async()=>{
 class Limited extends Blocks {limit(){this.db.exec('PRAGMA max_page_count=64')}}
 const dir=mkdtempSync(join(tmpdir(),'block-quota-')),db=join(dir,'db.sqlite'),store=new Limited(db),text=xml(row());
 try{const a=await store.importChunks({source:{...source,kind:'full'},part:'first.xml',sha256:hash(text),chunks:chunks(text)});store.limit();const large=xml(Array.from({length:1024},(_,i)=>row({sequenceNumber:String(i+1),corporateNumber:String(1000000000000+i),name:Array.from({length:30},(_,j)=>hash(String(i)+':'+j)).join('')})).join(''));
  await expect(store.importChunks({source:{...source,kind:'full'},part:'large.xml',sha256:hash(large),chunks:chunks(large)})).rejects.toThrow();expect(store.file(a.file.id)).toEqual(a.file);expect(store.query(query).total).toBe(1);
 }finally{store.close();rmSync(dir,{recursive:true,force:true})}
});
it('壊れた圧縮データの展開量を1MiBで打ち切る',()=>fixture(async f=>{
 await f.add();f.store.close();const db=new Database(f.db),s=db.prepare('UPDATE block_payloads SET payload=?');s.run(deflateRawSync(Buffer.alloc(2*1024**2,32)));s.close();db.close();const reader=new Blocks(f.db,{readOnly:true});try{expect(()=>reader.query(query)).toThrow(/1048576/)}finally{reader.close()}
}));

it('SIGKILLのhot journalを別候補へ復旧し、原本と取込済みcheckpointを監査して再開する',()=>fixture(async f=>{
 const a=await f.add();f.store.close();const before=readFileSync(f.db);await crashDatabase(f.db,f.dir,"UPDATE block_payloads SET payload=payload||printf('%0500000d',1)");const database=readFileSync(f.db),journal=readFileSync(f.db+'-journal');
 const result=recoverDedicatedSqliteSnapshot({source:f.db,outputDirectory:join(f.dir,'recovery'),kind:'corporate-registry-block-store',databaseSha256:hash(database),journalSha256:hash(journal)});expect(result.applicationRecordsValidated).toBe(false);expect(readFileSync(result.output.path)).toEqual(before);
 const restored=new Blocks(result.output.path);try{expect(restored.audit(a.file.id)).toMatchObject({verification:'all-records',records:1});const text=xml(row({name:'別原本'}));await restored.importChunks({source:{...source,kind:'full'},part:'new.xml',sha256:hash(text),chunks:chunks(text)});expect(restored.query(query).total).toBe(2)}finally{restored.close()}
 expect(readFileSync(f.db)).toEqual(database);expect(readFileSync(f.db+'-journal')).toEqual(journal);
}),30000);
it('復旧入口も640MiB超過をコピー前に拒否し、元DB/journalを保つ',()=>fixture(async f=>{
 await f.add();f.store.close();await crashDatabase(f.db,f.dir,"UPDATE block_payloads SET payload=payload||printf('%0500000d',1)");const journal=readFileSync(f.db+'-journal'),fd=openSync(f.db,'r+');try{ftruncateSync(fd,maxBytes+1)}finally{closeSync(fd)}
 expect(()=>recoverDedicatedSqliteSnapshot({source:f.db,outputDirectory:join(f.dir,'over-recovery'),kind:'corporate-registry-block-store',databaseSha256:'0'.repeat(64),journalSha256:hash(journal)})).toThrow('容量上限');expect(statSync(f.db).size).toBe(maxBytes+1);expect(readFileSync(f.db+'-journal')).toEqual(journal);
}),30000);

it('ページサイズ変更後も640MiBのbyte上限を維持する',()=>fixture(async f=>{
 await f.add();f.store.close();const db=new Database(f.db);db.exec('PRAGMA page_size=8192; VACUUM');db.close();
 class Inspect extends Blocks {quota(){return Number(this.rows('PRAGMA max_page_count')[0].max_page_count)*Number(this.rows('PRAGMA page_size')[0].page_size)}}
 const store=new Inspect(f.db);try{expect(store.quota()).toBe(maxBytes);expect(store.query(query).total).toBe(1)}finally{store.close()}
}));
it('空の同schemaでも未対応のUTF16形式へ書き込まない',()=>fixture(async f=>{
 f.store.close();const original=new Database(f.db,{readOnly:true}),statement=original.prepare("SELECT sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"),schema=statement.all().map(row=>String(row.sql));statement.close();original.close();const file=join(f.dir,'utf16.sqlite'),db=new Database(file);db.exec("PRAGMA encoding='UTF-16le'");for(const sql of schema)db.exec(sql);db.exec("INSERT INTO block_format VALUES('edinet-ts-corporate-registry-block-v1')");db.close();const before=hash(readFileSync(file));expect(()=>new Blocks(file)).toThrow();expect(hash(readFileSync(file))).toBe(before);
}));

it('本文が無改変でも時点索引の欠落をSQLite整合検査で拒否する',()=>fixture(async f=>{
 await f.add();f.store.close();const db=new Database(f.db,{readOnly:true}),size=db.prepare('PRAGMA page_size'),root=db.prepare("SELECT rootpage FROM sqlite_master WHERE name='block_by_time'");const pageSize=Number(size.get()!.page_size),page=Number(root.get()!.rootpage);size.close();root.close();db.close();expect(pageSize).toBe(4096);const bytes=readFileSync(f.db),start=(page-1)*pageSize;expect(bytes[start]).toBe(10);bytes.writeUInt16BE(0,start+1);bytes.writeUInt16BE(0,start+3);bytes.writeUInt16BE(pageSize,start+5);bytes[start+7]=0;writeFileSync(f.db,bytes);
 const check=new Database(f.db,{readOnly:true}),physical=check.prepare("SELECT COUNT(*) n FROM block_files NOT INDEXED WHERE purpose='sample'"),indexed=check.prepare("SELECT COUNT(*) n FROM block_files INDEXED BY block_by_time WHERE purpose='sample'");try{expect(Number(physical.get()!.n)).toBe(1);expect(Number(indexed.get()!.n)).toBe(0)}finally{physical.close();indexed.close();check.close()}
 const before=hash(readFileSync(f.db)),reader=new Blocks(f.db,{readOnly:true});try{expect(()=>reader.query(query)).toThrow()}finally{reader.close()}expect(hash(readFileSync(f.db))).toBe(before);
}));

it('副ファイルのないWAL形式も接続前に拒否し、新たな副ファイルを作らない',()=>fixture(async f=>{
 await f.add();f.store.close();const native=new Database(f.db);native.exec('PRAGMA journal_mode=WAL');native.close();expect(existsSync(f.db+'-wal')).toBe(false);expect(existsSync(f.db+'-shm')).toBe(false);const before=readFileSync(f.db);
 for(const readOnly of [true,false]){expect(()=>new Blocks(f.db,{readOnly})).toThrow('rollback journal');expect(readFileSync(f.db)).toEqual(before);expect(existsSync(f.db+'-wal')).toBe(false);expect(existsSync(f.db+'-shm')).toBe(false)}
}));
