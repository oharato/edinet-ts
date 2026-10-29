import {mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync,symlinkSync,linkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {ObservedFinancialArchive,createObservedFinancialSnapshots,type DocumentVersionObservation} from '../src/index';
import {Database} from '../src/db/node-sqlite';
import {reportingInstance} from './fixtures/financial-reporting-basis';
const query={cutoff:'2026-10-28T00:00:00Z',extractorVersion:'test-1'};
function observation(id='A',parent?:string,extra:Record<string,unknown>={}):DocumentVersionObservation{return {observationId:id,observedAt:'2026-06-26T00:00:00Z',document:{docID:id,parentDocID:parent??null,docTypeCode:parent?'130':'120',edinetCode:'E12345',secCode:'10010',periodStart:'2025-04-01',periodEnd:'2026-03-31',submitDateTime:parent?'2026-06-25 10:00':'2026-06-24 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0',...extra}};}
function source(docID='A',xml=reportingInstance(),availableAt='2026-06-27T00:00:00Z'){return {docID,xml,availableAt,sourceSha256:createHash('sha256').update(xml).digest('hex')};}
const normalized=(v:unknown)=>JSON.parse(JSON.stringify(v));
function withFile(fn:(path:string,dir:string)=>void){const dir=mkdtempSync(join(tmpdir(),'observed-archive-'));try{fn(join(dir,'archive.sqlite'),dir);}finally{rmSync(dir,{recursive:true,force:true});}}
it('観測・BOM付き原本・直接結果を保存し、再openで再解析せず同じ値を返す',()=>withFile(path=>{
 const o=observation(),s=source('A','\ufeff'+reportingInstance());let db=new ObservedFinancialArchive(path);
 expect(db.append([o],[s])).toEqual({insertedObservations:1,insertedSources:1,insertedContents:1});expect(db.append([o],[s])).toEqual({insertedObservations:0,insertedSources:0,insertedContents:0});
 const first=db.createSnapshots(query);expect(first.cache).toEqual({hits:0,extracted:1});expect(first.records).toEqual(normalized(createObservedFinancialSnapshots([o],[s],{cutoff:query.cutoff}).records));db.close();
 db=new ObservedFinancialArchive(path);const second=db.createSnapshots(query);expect(second.records).toEqual(first.records);expect(second.cache).toEqual({hits:1,extracted:0});db.close();
 const raw=new Database(path,{readOnly:true});const stmt=raw.prepare('SELECT xml FROM archive_contents');try{expect(Buffer.from(stmt.get()!.xml as Uint8Array).toString('utf8')).toBe(s.xml);}finally{stmt.close();raw.close();}
}));
it('IFRS連結の結果とIFRS単体の未確定も保存して再利用する',()=>{
 for(const consolidated of ['true','false']){const db=new ObservedFinancialArchive(':memory:');try{db.append([observation()],[source('A',reportingInstance({standard:'IFRS',consolidated}))]);const a=db.createSnapshots(query),b=db.createSnapshots(query);expect(b.records).toEqual(a.records);expect(b.cache.hits).toBe(1);expect(a.records[0].result).toMatchObject(consolidated==='true'?{status:'resolved',accountingStandard:'IFRS'}:{status:'unresolved',reason:'unsupported-ifrs-scope'});}finally{db.close();}}
});
it('抽出版・ソースcommit・明示項目が変われば別の解析結果として保持する',()=>{
 const db=new ObservedFinancialArchive(':memory:');try{db.append([observation()],[source()]);for(const q of [query,{...query,extractorVersion:'test-2'},{...query,sourceCommit:'a'.repeat(40)},{...query,detailMetricIds:['costOfSales'] as const}]){expect(db.createSnapshots(q).cache.extracted).toBe(1);expect(db.createSnapshots(q).cache.hits).toBe(1);}}finally{db.close();}
});
it('同じ書類の新旧原本をcutoffで選び、旧版を上書きしない',()=>{
 const db=new ObservedFinancialArchive(':memory:');try{const old=source(),next=source('A',reportingInstance().replace('>10</jppfs_cor:CostOfSales>','>30</jppfs_cor:CostOfSales>'),'2026-07-01T00:00:00Z');db.append([observation()],[old]);db.append([],[next]);
 for(const [cutoff,value]of [['2026-06-28T00:00:00Z','10'],['2026-07-02T00:00:00Z','30']])expect(db.createSnapshots({...query,cutoff}).records[0]).toMatchObject({knownAt:cutoff.startsWith('2026-06')?'2026-06-27T00:00:00.000Z':'2026-07-01T00:00:00.000Z',result:{details:{snapshot:{selections:{costOfSales:{raw:value}}}}}});
 }finally{db.close();}
});
it('同時刻の異なるhashは競合として保留し、旧原本に戻らない',()=>{
 const db=new ObservedFinancialArchive(':memory:');try{db.append([observation()],[source()]);db.append([],[source('A',reportingInstance({standard:'IFRS'}))]);const r=db.createSnapshots(query);expect(r.records).toEqual([]);expect(r.unavailableSources).toEqual([{docID:'A',rootDocID:'A',reason:'conflicting-source-observations'}]);expect(r.cache.extracted).toBe(0);}finally{db.close();}
});
it('後日の取下げ・訂正の選択と原本不在を再起動後も維持する',()=>withFile(path=>{
 let db=new ObservedFinancialArchive(path);db.append([observation()],[source()]);db.close();db=new ObservedFinancialArchive(path);db.append([observation('B','A')]);expect(db.createSnapshots(query)).toMatchObject({records:[],unavailableSources:[{docID:'B',reason:'source-missing'}]});db.close();
 db=new ObservedFinancialArchive(path);db.append([{...observation('B','A',{withdrawalStatus:'2'}),observationId:'withdrawn',observedAt:'2026-07-02T00:00:00Z'}]);expect(db.createSnapshots(query).records[0]).toMatchObject({docID:'A',knownAt:'2026-07-02T00:00:00.000Z'});db.close();
}));
it('観測IDの内容衝突でbatch全体を戻し、再実行で二重登録しない',()=>{
 const db=new ObservedFinancialArchive(':memory:');try{db.append([observation()],[source()]);expect(()=>db.append([observation('B'),observation('A',undefined,{secCode:'99990'})],[source('B')])).toThrow('上書き');const r=db.createSnapshots(query);expect(r.selection.selected.map(s=>s.observation.document.docID)).toEqual(['A']);expect(r.records).toHaveLength(1);expect(db.append([observation('B')],[source('B')]).insertedObservations).toBe(1);}finally{db.close();}
});
it('未読込の原本宣言を後から同じhashの内容で満たせる',()=>{
 const db=new ObservedFinancialArchive(':memory:');try{const s=source(),{xml,...declaration}=s;db.append([observation()],[declaration]);expect(db.createSnapshots(query).unavailableSources[0].reason).toBe('source-not-loaded');expect(db.append([],[s])).toEqual({insertedObservations:0,insertedSources:0,insertedContents:1});expect(db.createSnapshots(query).records).toHaveLength(1);}finally{db.close();}
});
it('不正hash・不正UTF8文字列は未選択原本でも保存しない',()=>{
 const db=new ObservedFinancialArchive(':memory:');try{for(const s of [{...source(),sourceSha256:'0'.repeat(64)},source('A','\ud800')])expect(()=>db.append([observation()],[s])).toThrow('UTF-8/hash');expect(db.createSnapshots(query).selection.decisions).toEqual([]);}finally{db.close();}
});
it('解析失敗と基準に合わない項目も版ごとにキャッシュする',()=>{
 for(const [s,q,reason]of [[source('A','<invalid>'),query,'source-parse-failed'],[source('A',reportingInstance({standard:'IFRS'})),{...query,detailMetricIds:['incomeTaxes']},'metric-projection-mismatch']]as const){const db=new ObservedFinancialArchive(':memory:');try{db.append([observation()],[s]);expect(db.createSnapshots(q as never).unavailableSources[0].reason).toBe(reason);const r=db.createSnapshots(q as never);expect(r.cache).toEqual({hits:1,extracted:0});expect(r.unavailableSources[0].reason).toBe(reason);}finally{db.close();}}
});
it('readOnlyは私有コピーを読み、cache missでも元ファイル・副ファイルを変更しない',()=>withFile((path,dir)=>{
 const db=new ObservedFinancialArchive(path);db.append([observation()],[source()]);db.close();const before=readFileSync(path),names=readdirSync(dir);const ro=new ObservedFinancialArchive(path,{readOnly:true});try{expect(ro.createSnapshots(query).cache.extracted).toBe(1);expect(ro.createSnapshots(query).cache.extracted).toBe(1);expect(()=>ro.append([],[])).toThrow('readOnly');}finally{ro.close();}expect(readFileSync(path)).toEqual(before);expect(readdirSync(dir)).toEqual(names);
}));
it.each(['text','empty','sqlite','symlink','hardlink','sidecar'])('既存%sを元のまま拒否する',kind=>withFile((path,dir)=>{
 if(kind==='sqlite'){const other=new Database(path);other.exec('CREATE TABLE unrelated(value TEXT)');other.close();}
 else if(kind==='symlink'||kind==='hardlink'){const target=join(dir,'original');writeFileSync(target,'private input');if(kind==='symlink')symlinkSync(target,path);else linkSync(target,path);}
 else if(kind==='sidecar'){const db=new ObservedFinancialArchive(path);db.close();writeFileSync(path+'-journal','original sidecar');}
 else writeFileSync(path,kind==='empty'?'':'private input');
 const before=readFileSync(path),names=readdirSync(dir);expect(()=>new ObservedFinancialArchive(path)).toThrow();expect(readFileSync(path)).toEqual(before);expect(readdirSync(dir)).toEqual(names);
}));
it.each(['archive_observations','archive_sources','archive_extractions','archive_contents'])('%sの破損を正常な抽出失敗にしない',table=>withFile(path=>{
 let db=new ObservedFinancialArchive(path);db.append([observation()],[source()]);db.createSnapshots(query);db.close();const raw=new Database(path);raw.exec(table==='archive_contents'?"UPDATE archive_contents SET xml=X'00'":`UPDATE ${table} SET ${table==='archive_extractions'?'body':'sha256'}='corrupt'`);raw.close();db=new ObservedFinancialArchive(path);try{expect(()=>db.createSnapshots(query)).toThrow();}finally{db.close();}
}));
it('未知schema・追加triggerを私有コピーで拒否する',()=>withFile(path=>{
 const db=new ObservedFinancialArchive(path);db.close();const raw=new Database(path);raw.exec('CREATE TRIGGER unexpected AFTER INSERT ON archive_observations BEGIN DELETE FROM archive_sources; END');raw.close();const before=readFileSync(path);expect(()=>new ObservedFinancialArchive(path)).toThrow('schema');expect(readFileSync(path)).toEqual(before);
}));
it('未知条件・抽出版なし・不正commit・close後の利用を拒否する',()=>{
 const db=new ObservedFinancialArchive(':memory:');for(const q of [{...query,extractorVersion:''},{...query,sourceCommit:'bad'},{...query,extra:true},{...query,detailMetricIds:['unknown']},{...query,cutoff:'2026-10-28'}])expect(()=>db.createSnapshots(q as never)).toThrow();db.close();db.close();expect(()=>db.createSnapshots(query)).toThrow('close');expect(()=>new ObservedFinancialArchive(':memory:',{readOnly:true})).toThrow();
});

it.each(['-journal','-wal','-shm'])('DBが未作成でも既存副ファイル%sを変更せず拒否する',suffix=>withFile((path,dir)=>{
 writeFileSync(path+suffix,'private sidecar');const names=readdirSync(dir);expect(()=>new ObservedFinancialArchive(path)).toThrow('副ファイル');expect(readFileSync(path+suffix,'utf8')).toBe('private sidecar');expect(readdirSync(dir)).toEqual(names);
}));

it('100件を超える原本を内部batchで処理し、再実行は全件cacheを使う',()=>{
 const db=new ObservedFinancialArchive(':memory:');try{const observations=Array.from({length:101},(_,i)=>observation('A'+i)),sources=observations.map(o=>source(o.document.docID));db.append(observations,sources.slice(0,100));db.append([],sources.slice(100));const first=db.createSnapshots(query),second=db.createSnapshots(query);expect(first.records).toHaveLength(101);expect(first.unavailableSources).toEqual([]);expect(first.cache).toEqual({hits:0,extracted:101});expect(second.records).toEqual(first.records);expect(second.cache).toEqual({hits:101,extracted:0});}finally{db.close();}
});
it('全保存件数が10,000を超えても会社を指定して既存アーカイブを利用できる',()=>{
 const db=new ObservedFinancialArchive(':memory:');try{db.append(Array.from({length:10000},(_,i)=>({...observation('OTHER',undefined,{edinetCode:'E99999'}),observationId:'other-'+i})));db.append([observation()],[source()]);expect(()=>db.createSnapshots(query)).toThrow('edinetCodes');expect(db.createSnapshots({...query,edinetCodes:['E12345']}).records[0].docID).toBe('A');}finally{db.close();}
});
it('会社指定で他社を名乗る訂正を落とさず、元書類の誤採用を防ぐ',()=>{
 const db=new ObservedFinancialArchive(':memory:');try{db.append([observation(),observation('B','A',{edinetCode:'E99999'})],[source()]);const r=db.createSnapshots({...query,edinetCodes:['E12345']});expect(r.records).toEqual([]);expect(r.selection.decisions).toContainEqual(expect.objectContaining({rootDocID:'A',reason:'unresolved-correction'}));}finally{db.close();}
});
it('未来の関係から他社原本が閉包へ入っても対象会社以外の値を返さない',()=>{
 const db=new ObservedFinancialArchive(':memory:');try{const future={...observation('F','OTHER'),observedAt:'2026-10-29T00:00:00Z'};db.append([observation('OTHER',undefined,{edinetCode:'E99999'}),future],[source('OTHER',reportingInstance({issuer:'E99999'}))]);const r=db.createSnapshots({...query,edinetCodes:['E12345']});expect(r.selection.selected).toHaveLength(1);expect(r.records).toEqual([]);expect(r.unavailableSources).toEqual([]);expect(r.cache.extracted).toBe(0);}finally{db.close();}
});
it('会社指定の未知値・重複・疎配列・件数超過を拒否する',()=>{
 const db=new ObservedFinancialArchive(':memory:');try{for(const edinetCodes of [[],['bad'],['E12345','E12345'],new Array(1),new Array(101)])expect(()=>db.createSnapshots({...query,edinetCodes})).toThrow();}finally{db.close();}
});
it('原本だけ先に保存しても一覧観測までは解析せず、後日の観測時刻を保持する',()=>{
 const db=new ObservedFinancialArchive(':memory:');try{db.append([],[source()]);expect(db.createSnapshots(query)).toMatchObject({records:[],cache:{hits:0,extracted:0}});db.append([{...observation(),observedAt:'2026-06-30T00:00:00Z'}]);expect(db.createSnapshots(query).records[0].knownAt).toBe('2026-06-30T00:00:00.000Z');}finally{db.close();}
});
it('保存済み原本の破損を追記中に検知したら新規観測・原本のbatch全体を戻す',()=>withFile(path=>{
 let db=new ObservedFinancialArchive(path);db.append([observation()],[source()]);db.close();let raw=new Database(path);raw.exec("UPDATE archive_contents SET xml=X'00'");raw.close();db=new ObservedFinancialArchive(path);try{expect(()=>db.append([observation('B')],[source('B',reportingInstance({standard:'IFRS'})),source()])).toThrow('不整合');}finally{db.close();}
 raw=new Database(path,{readOnly:true});for(const table of ['archive_observations','archive_sources','archive_contents']){const s=raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`);try{expect(s.get()!.n).toBe(1);}finally{s.close();}}raw.close();
}));

it('会社コードも消えた新観測を会社指定でも読み、旧原本を再採用/再取得しない',()=>withFile(path=>{
 for(const status of ['0','2']){
  const db=new ObservedFinancialArchive(path+status);try{
   const before=observation(),s=source(),after:DocumentVersionObservation={observationId:'A-removed',observedAt:'2026-07-01T00:00:00Z',document:{docID:'A',docTypeCode:null,edinetCode:null,secCode:null,parentDocID:null,submitDateTime:null,periodStart:null,periodEnd:null,withdrawalStatus:status,disclosureStatus:'0',docInfoEditStatus:'0'}};
   db.append([before],[s]);db.append([after]);
   expect(db.createSnapshots({...query,cutoff:'2026-06-30T00:00:00Z',edinetCodes:['E12345']}).records).toHaveLength(1);
   const snapshots=db.createSnapshots({...query,edinetCodes:['E12345']});expect(snapshots.records).toEqual([]);expect(snapshots.selection.decisions[0].reason).toBe(status==='2'?'withdrawn':'document-type-unavailable');
   expect(db.planSourceAcquisition({cutoff:query.cutoff,edinetCodes:['E12345']}).items).toEqual([]);expect(db.append([],[s])).toEqual({insertedObservations:0,insertedSources:0,insertedContents:0});
  }finally{db.close()}
 }
}));

it('会社を跨ぐ親参照の競合は、各社指定の取得計画でも両系列を止める',()=>{
 const db=new ObservedFinancialArchive(':memory:');try{
  const a=observation('A'),x=observation('X',undefined,{edinetCode:'E54321',secCode:'20020'}),b=observation('B','A'),other=observation('B','X',{edinetCode:'E54321',secCode:'20020'});other.observationId='conflict';
  db.append([a,x,b,other]);
  for(const [code,id] of [['E12345','A'],['E54321','X']]){const plan=db.planSourceAcquisition({cutoff:query.cutoff,edinetCodes:[code]});expect(plan.items).toEqual([]);expect(plan.selection.decisions.find(d=>d.rootDocID===id)).toMatchObject({reason:'unresolved-correction',observationIds:expect.arrayContaining(['B','conflict'])})}
 }finally{db.close()}
});
