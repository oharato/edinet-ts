import {mkdtempSync,rmSync,readFileSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {ObservedFinancialArchive,EdinetRepository,archiveFinancialDocumentObservations} from '../src/index';
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

it('取得時点以前の全版だけを同じ条件で分割再開し、未来の原本を混ぜない',()=>fixture(s=>{
 const options={sourceArchiveSha256:s.sha,availableBy:'2026-01-01T09:00:00+09:00',limit:1};let afterId:string|undefined,ids:string[]=[];
 for(let i=0;i<5;i++){const page=s.source.transferSourcesTo(s.target,{...options,afterId});expect(page.availableBy).toBe('2026-01-01T00:00:00.000Z');ids.push(...page.transferredIds);if(page.complete)break;afterId=page.nextAfterId;}
 expect(ids).toHaveLength(3);expect(new Set(ids).size).toBe(3);expect(s.source.transferSourcesTo(s.target,options).insertedSources).toBe(0);
 const raw=new Database(s.targetPath,{readOnly:true});try{expect(raw.prepare('SELECT available_ms FROM archive_sources').all().every(r=>r.available_ms===Date.parse('2026-01-01T00:00:00Z'))).toBe(true);expect(raw.prepare('SELECT COUNT(*) AS n FROM archive_contents').get()!.n).toBe(1)}finally{raw.close()}
}));
it('取得時点より後のcursor・不正日時を拒否し、対象原本0件でも完了する',()=>fixture(s=>{
 const raw=new Database(s.sourcePath,{readOnly:true});let future:string;try{future=String(raw.prepare('SELECT id FROM archive_sources WHERE available_ms>?').get(Date.parse('2026-01-01T00:00:00Z'))!.id)}finally{raw.close()}
 for(const availableBy of ['SECRET','2026-01-01',null])expect(()=>s.source.transferSourcesTo(s.target,{sourceArchiveSha256:s.sha,availableBy} as never)).toThrow();
 expect(()=>s.source.transferSourcesTo(s.target,{sourceArchiveSha256:s.sha,availableBy:'2026-01-01T00:00:00Z',afterId:future})).toThrow('範囲外');
 expect(s.source.transferSourcesTo(s.target,{sourceArchiveSha256:s.sha,availableBy:'2025-12-31T23:59:59.999Z'})).toMatchObject({complete:true,transferredIds:[],insertedSources:0,insertedContents:0});
}));
it('未来へ偽装した索引でも過去の宣言を隠せず、破損を空集合へ読み替えない',()=>fixture(s=>{
 expect(()=>s.source.transferSourcesTo(s.target,{sourceArchiveSha256:s.sha,availableBy:'2026-01-01T00:00:00Z'})).toThrow('索引');
},db=>db.exec('UPDATE archive_sources SET available_ms=9999999999999')));
it('対象外の未来原本の内容は読まず、過去の原本だけを転送する',()=>fixture(s=>{
 expect(s.source.transferSourcesTo(s.target,{sourceArchiveSha256:s.sha,availableBy:'2026-01-01T00:00:00Z'})).toMatchObject({complete:true,insertedSources:3,insertedContents:1});
 expect(()=>s.source.transferSourcesTo(s.target,{sourceArchiveSha256:s.sha})).toThrow('hash');
},db=>db.prepare("UPDATE archive_contents SET xml=x'00' WHERE sha256=?").run(hash('<x>2</x>'))));
it('1000件超の未来宣言を挟んでも、後方の対象原本を読み落とさない',()=>{
 const dir=mkdtempSync(join(tmpdir(),'archive-cutoff-pages-')),sourcePath=join(dir,'source.sqlite'),target=new ObservedFinancialArchive(join(dir,'target.sqlite'));let source:ObservedFinancialArchive|undefined;
 try{const writer=new ObservedFinancialArchive(sourcePath),xml='<x>fixture</x>',sha=hash(xml);const future=Array.from({length:1001},(_,i)=>({docID:'F'+i,availableAt:'2026-02-01T00:00:00.000Z',sourceSha256:sha,xml}));const max=future.map(({xml,...s})=>hash(canonical(s))).sort().at(-1)!;let original:any;
 for(let i=0;i<100000;i++){const candidate={docID:'OLD'+i,availableAt:'2026-01-01T00:00:00.000Z',sourceSha256:sha};if(hash(canonical(candidate))>max){original={...candidate,xml};break}}expect(original).toBeDefined();for(let i=0;i<future.length;i+=100)writer.append([],future.slice(i,i+100));writer.append([],[original]);writer.close();
 source=new ObservedFinancialArchive(sourcePath,{readOnly:true});expect(source.transferSourcesTo(target,{sourceArchiveSha256:source.snapshotSha256(),availableBy:'2026-01-01T00:00:00Z',limit:1})).toMatchObject({complete:true,insertedSources:1,insertedContents:1});
 }finally{source?.close();target.close();rmSync(dir,{recursive:true,force:true})}
});

it('観測/原本が後から増えても同じ固定条件なら過去の入力DBをbyte単位で再生成できる',()=>fixture(s=>{
 const repo=new EdinetRepository(':memory:'),laterSource=s.sourcePath+'.later',rebuiltPath=s.targetPath+'.rebuilt';let later:ObservedFinancialArchive|undefined,rebuilt:ObservedFinancialArchive|undefined;
 try{
  repo.saveDocumentList([{docID:'A',secCode:'10010',edinetCode:'E12345',docTypeCode:'120',docDescription:'fixture',submitDateTime:'2026-01-01 09:00',periodStart:'2024-04-01',periodEnd:'2025-03-31',withdrawalStatus:'0',docInfoEditStatus:0,disclosureStatus:'0'}],'2026-01-01');
  archiveFinancialDocumentObservations(repo,s.target,{sourceId:'recipe',throughSequence:1});s.source.transferSourcesTo(s.target,{sourceArchiveSha256:s.sha,availableBy:'2026-01-01T00:00:00Z'});s.target.close();const before=readFileSync(s.targetPath);
  repo.saveDocumentList([{docID:'B',secCode:null,edinetCode:null,docTypeCode:null,docDescription:null,submitDateTime:null,periodStart:null,periodEnd:null,withdrawalStatus:'2',docInfoEditStatus:0,disclosureStatus:'0'}],'2026-02-01');
  copyFileSync(s.sourcePath,laterSource);const writer=new ObservedFinancialArchive(laterSource),xml='<x>later</x>';writer.append([],[{docID:'LATER',availableAt:'2026-03-01T00:00:00Z',sourceSha256:hash(xml),xml}]);writer.close();later=new ObservedFinancialArchive(laterSource,{readOnly:true});rebuilt=new ObservedFinancialArchive(rebuiltPath);
  archiveFinancialDocumentObservations(repo,rebuilt,{sourceId:'recipe',throughSequence:1});let afterId:string|undefined;for(let i=0;i<5;i++){const page=later.transferSourcesTo(rebuilt,{sourceArchiveSha256:later.snapshotSha256(),availableBy:'2026-01-01T09:00:00+09:00',afterId,limit:1});if(page.complete)break;afterId=page.nextAfterId}rebuilt.close();expect(readFileSync(rebuiltPath).equals(before)).toBe(true);
 }finally{repo.close();later?.close();rebuilt?.close()}
}));

it('巨大な宣言本文をJSへ全件読み込まず、時刻で除外する前に拒否する',()=>fixture(s=>{
 expect(()=>s.source.transferSourcesTo(s.target,{sourceArchiveSha256:s.sha,availableBy:'2020-01-01T00:00:00Z'})).toThrow('2048');
},db=>db.exec("UPDATE archive_sources SET body=body||printf('%8192s','')")));
