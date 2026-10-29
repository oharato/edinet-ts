import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {ObservedFinancialArchive} from '../src/index';
import {Database} from '../src/db/node-sqlite';
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const canonical=(value:unknown):string=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
function fixture(run:(s:{sourcePath:string;targetPath:string;source:ObservedFinancialArchive;target:ObservedFinancialArchive;sha:string})=>void,mutate?:(db:Database)=>void){
 const dir=mkdtempSync(join(tmpdir(),'archive-transfer-')),sourcePath=join(dir,'source.sqlite'),targetPath=join(dir,'target.sqlite');
 const initial=new ObservedFinancialArchive(sourcePath);
 const xml='\uFEFF<x>日本語</x>',other='<x>2</x>';
 initial.append([],[{docID:'A',availableAt:'2026-01-01T00:00:00Z',sourceSha256:hash(xml),xml},{docID:'B',availableAt:'2026-01-01T00:00:00Z',sourceSha256:hash(xml),xml},{docID:'C',availableAt:'2026-01-01T00:00:00Z',sourceSha256:'f'.repeat(64)}]);
 initial.append([],[{docID:'A',availableAt:'2026-02-01T00:00:00Z',sourceSha256:hash(other),xml:other}]);initial.close();
 if(mutate){const db=new Database(sourcePath);try{mutate(db);}finally{db.close();}}
 const before=readFileSync(sourcePath),source=new ObservedFinancialArchive(sourcePath,{readOnly:true}),target=new ObservedFinancialArchive(targetPath);
 try{run({sourcePath,targetPath,source,target,sha:source.snapshotSha256()});expect(readFileSync(sourcePath)).toEqual(before);}finally{target.close();source.close();rmSync(dir,{recursive:true,force:true});}
}
it('全版・宣言だけの原本・共有内容・BOMを保持し、cursorで再開し再投入は冪等',()=>fixture(s=>{
 const first=s.source.transferSourcesTo(s.target,{sourceArchiveSha256:s.sha,limit:1});expect(first).toMatchObject({complete:false,insertedSources:1});expect(first.nextAfterId).toBe(first.transferredIds[0]);
 s.source.close();const reopened=new ObservedFinancialArchive(s.sourcePath,{readOnly:true});try{
 const rest=reopened.transferSourcesTo(s.target,{sourceArchiveSha256:s.sha,afterId:first.nextAfterId,limit:100});expect(rest).toMatchObject({complete:true,insertedSources:3});
 const replay=reopened.transferSourcesTo(s.target,{sourceArchiveSha256:s.sha});expect(replay).toMatchObject({complete:true,insertedSources:0,insertedContents:0});expect(replay.transferredIds).toHaveLength(4);
 }finally{reopened.close();}
 s.target.close();const a=new Database(s.sourcePath,{readOnly:true}),b=new Database(s.targetPath,{readOnly:true});try{
 for(const table of ['archive_sources','archive_contents']){
 const sql=`SELECT * FROM ${table} ORDER BY ${table==='archive_sources'?'id':'sha256'}`;expect(b.prepare(sql).all()).toEqual(a.prepare(sql).all());
 }expect(b.prepare('SELECT COUNT(*) AS n FROM archive_observations').get()!.n).toBe(0);
 }finally{a.close();b.close();}
}));
it('転送先の途中失敗後も再投入で重複せず全件を保存',()=>fixture(s=>{
 const original=s.target.append.bind(s.target);let count=0;
 s.target.append=(...args)=>{if(args[1]?.length&&++count===2)throw Error('disk failure');return original(...args)};
 expect(()=>s.source.transferSourcesTo(s.target,{sourceArchiveSha256:s.sha})).toThrow('disk failure');s.target.append=original;
 const result=s.source.transferSourcesTo(s.target,{sourceArchiveSha256:s.sha});expect(result).toMatchObject({complete:true,insertedSources:3});expect(result.transferredIds).toHaveLength(4);
}));
it.each(['hash','doc_id','available_ms','content'])('転送元の%s破損を未取得へ読み替えない',kind=>fixture(s=>{
 expect(()=>s.source.transferSourcesTo(s.target,{sourceArchiveSha256:s.sha})).toThrow();
},db=>{if(kind==='content')db.exec("UPDATE archive_contents SET xml=x'00'");else db.exec(`UPDATE archive_sources SET ${kind==='hash'?"sha256='bad'":kind==='doc_id'?"doc_id='OTHER'":"available_ms=0"}`)}));
it('hashが正しくても不正UTF-8を転送しない',()=>fixture(s=>{
 expect(()=>s.source.transferSourcesTo(s.target,{sourceArchiveSha256:s.sha})).toThrow('UTF-8');
},db=>{
 db.exec('DELETE FROM archive_sources;DELETE FROM archive_contents');const raw=Buffer.from([0xff]),sha=hash(raw),body=canonical({docID:'A',availableAt:'2026-01-01T00:00:00.000Z',sourceSha256:sha}),id=hash(body);
 db.prepare('INSERT INTO archive_sources VALUES(?,?,?,?,?)').run(id,'A',Date.parse('2026-01-01T00:00:00Z'),body,hash(canonical([id,body])));db.prepare('INSERT INTO archive_contents VALUES(?,?)').run(sha,raw);
}));
it('異なるsnapshot・存在しないcursor・不正入力・同一ファイル・readOnly転送先を拒否',()=>fixture(s=>{
 for(const options of [{sourceArchiveSha256:'0'.repeat(64)},{sourceArchiveSha256:s.sha,afterId:'0'.repeat(64)},{sourceArchiveSha256:s.sha,limit:0},{sourceArchiveSha256:s.sha,limit:101},{sourceArchiveSha256:s.sha,extra:1}])expect(()=>s.source.transferSourcesTo(s.target,options as never)).toThrow();
 expect(()=>s.target.transferSourcesTo(s.source,{sourceArchiveSha256:s.sha})).toThrow('readOnly');
 s.target.close();const ro=new ObservedFinancialArchive(s.targetPath,{readOnly:true}),same=new ObservedFinancialArchive(s.sourcePath);try{
 expect(()=>s.source.transferSourcesTo(ro,{sourceArchiveSha256:s.sha})).toThrow('readOnly');expect(()=>s.source.transferSourcesTo(same,{sourceArchiveSha256:s.sha})).toThrow('異なる');
 }finally{ro.close();same.close();}
}));
