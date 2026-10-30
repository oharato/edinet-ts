import {it,expect} from 'vitest';import {mkdtempSync,rmSync,writeFileSync,unlinkSync,readFileSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {CorporateRegistryStore,type CorporateRegistryStoredDelivery} from '../src/db/corporate-registry-store';
import {reconstructCorporateRegistryState as reconstruct,type CorporateRegistryDelivery,type CorporateRegistryStateQuery,CORPORATE_REGISTRY_FIELDS} from '../src/corporate-registry';
import {registryCalendarFixture} from './fixtures/corporate-registry-calendar';import {registryStreamXml as xml,registryStreamRow as row,registryStreamSource} from './fixtures/corporate-registry-stream';import {Database} from '../src/db/node-sqlite';
const q:CorporateRegistryStateQuery={corporateNumber:'1010001001202',asOf:'2026-10-29',knownAt:'2026-10-30T00:00:00Z',registryPurpose:'sample'};
const r=(patch:Record<string,string>={})=>row({process:'01',updateDate:'2026-10-27',changeDate:'2015-10-05',name:'元名',...patch});
const delivery=(day:string,kind:'full'|'diff',...parts:string[]):CorporateRegistryDelivery=>({scope:'national',expectedParts:parts.length,parts:parts.map(text=>({xml:xml(text),source:{...registryStreamSource,dataDate:day,kind}}))});
const base=()=>delivery('2026-10-27','full',r()+r({sequenceNumber:'2',corporateNumber:'1010001001210',name:'別の法人'}));
const changed=(patch:Record<string,string>={})=>r({process:'11',updateDate:'2026-10-28',changeDate:'2026-10-20',name:'変更名',...patch});
async function fixture(ds:CorporateRegistryDelivery[],fn:(s:{store:CorporateRegistryStore;raw:CorporateRegistryDelivery[];manifest:CorporateRegistryStoredDelivery[];db:string;files:string[]})=>void|Promise<void>){
 const dir=mkdtempSync(join(tmpdir(),'registry-stored-state-')),db=join(dir,'registry.sqlite'),store=new CorporateRegistryStore(db),raw:CorporateRegistryDelivery[]=[],manifest:CorporateRegistryStoredDelivery[]=[],files:string[]=[];
 try{for(const d of ds){const parts=[],ids=[];for(const p of d.parts){const file=join(dir,files.length+'.xml');writeFileSync(file,p.xml);files.push(file);const result=await store.importFile({file,source:p.source,part:String(files.length)+'.xml',sha256:createHash('sha256').update(p.xml).digest('hex')});ids.push(result.file.id);parts.push({xml:p.xml,source:result.file.source});}raw.push({...d,parts});manifest.push({scope:'national',expectedParts:d.expectedParts,fileIds:ids});}await fn({store,raw,manifest,db,files});}
 finally{store.close();rmSync(dir,{recursive:true,force:true})}
}
const withoutStorage=(result:ReturnType<CorporateRegistryStore['reconstruct']>)=>{const {storage,...state}=result;return state};
it('元XMLを再読込せず、全体SHAと元位置を保って同じ状態へ接続する',()=>fixture([base(),delivery('2026-10-28','diff',changed()),delivery('2026-10-29','diff','')],s=>{
 const expected=reconstruct(s.raw,q);for(const file of s.files)unlinkSync(file);const actual=s.store.reconstruct(s.manifest,q);expect(withoutStorage(actual)).toEqual(expected);expect(actual.selection).toMatchObject({status:'available',record:{sourceIndex:1,record:{recordNumber:1,values:{name:'変更名'}}}});expect(actual.sources[0].inputXmlSha256).not.toBe(createHash('sha256').update(xml(r())).digest('hex'));expect(actual.storage.files.map(f=>f.sha256)).toEqual(actual.sources.map(p=>p.inputXmlSha256));
}));
it('複数partの訂正を一連番号順に置換し、元part内の位置を付け替えない',()=>fixture([base(),delivery('2026-10-28','diff',changed({sequenceNumber:'2',name:'最新',correct:'0'}),changed({sequenceNumber:'1',name:'訂正過去',correct:'1',latest:'0'})),delivery('2026-10-29','diff','')],s=>{
 const actual=s.store.reconstruct(s.manifest,q);expect(withoutStorage(actual)).toEqual(reconstruct(s.raw,q));expect(actual.history.map(r=>[r.sourceIndex,r.record.recordNumber,r.record.values.name])).toEqual([[2,1,'訂正過去'],[1,1,'最新']]);
}));
it('対象外法人だけが違う同時点配布も衝突とし、対象行だけの比較へ縮めない',()=>{
 const a=base(),b=delivery('2026-10-27','full',r()+r({sequenceNumber:'2',corporateNumber:'1010001001210',name:'別法人の変更'}));b.parts[0].source.sourceUrl='https://example.test/other.zip';return fixture([a,b],s=>{expect(withoutStorage(s.store.reconstruct(s.manifest,{...q,asOf:'2026-10-27'}))).toEqual(reconstruct(s.raw,{...q,asOf:'2026-10-27'}));expect(s.store.reconstruct(s.manifest,{...q,asOf:'2026-10-27'}).selection).toMatchObject({status:'unresolved',reason:'conflicting-deliveries'});});
});
it('原byteの空白差だけなら同じ配布内容とし、SHAと出典は両方残す',()=>{
 const a=base(),b=base();b.parts[0].xml=b.parts[0].xml.replace('<corporation>','\n<corporation>');b.parts[0].source.sourceUrl='https://example.test/format.zip';return fixture([a,b],s=>{const query={...q,asOf:'2026-10-27'},actual=s.store.reconstruct(s.manifest,query);expect(withoutStorage(actual)).toEqual(reconstruct(s.raw,query));expect(actual.selection.status).toBe('available');expect(actual.sources[0].inputXmlSha256).not.toBe(actual.sources[1].inputXmlSha256);});
});
it.each(['full','diff'] as const)('%sの分割間の重複を、対象外の法人でも拒否する',kind=>{
 const d=kind==='full'?delivery('2026-10-27','full',r(),r({sequenceNumber:'2'})):delivery('2026-10-28','diff',changed(),changed({corporateNumber:'1010001001210'}));return fixture(kind==='full'?[d]:[base(),d],s=>{expect(()=>s.store.reconstruct(s.manifest,q)).toThrow('重複')});
});
it('休日・未来観測・sampleとdownload・欠落日の判定をXML入口と共有する',()=>{
 const b=delivery('2026-10-23','full',r({updateDate:'2026-10-23'})),monday=delivery('2026-10-26','diff',changed({updateDate:'2026-10-26'})),future=delivery('2026-10-27','diff',changed({updateDate:'2026-10-27'}));future.parts[0].source.observedAt='2026-10-31T00:00:00Z';return fixture([b,monday,future],s=>{const query={...q,asOf:'2026-10-26'},calendar=registryCalendarFixture();expect(withoutStorage(s.store.reconstruct(s.manifest,query,calendar))).toEqual(reconstruct(s.raw,query,calendar));expect(s.store.reconstruct(s.manifest,query,calendar).selection.status).toBe('available');expect(s.store.reconstruct(s.manifest,query).selection).toMatchObject({reason:'coverage-gap'});expect(s.store.reconstruct(s.manifest,{...query,registryPurpose:'download'},calendar).selection).toMatchObject({status:'unavailable',reason:'no-baseline'});});
});
it('削除行も合成せず同じ結果を返す',()=>{
 const blank=Object.fromEntries(CORPORATE_REGISTRY_FIELDS.map(k=>[k,'']));return fixture([base(),delivery('2026-10-28','diff',row({...blank,sequenceNumber:'1',corporateNumber:q.corporateNumber,process:'99',updateDate:'2026-10-28'})),delivery('2026-10-29','diff','')],s=>{const actual=s.store.reconstruct(s.manifest,q);expect(withoutStorage(actual)).toEqual(reconstruct(s.raw,q));expect(actual.selection.status).toBe('deleted');expect(actual.history).toEqual([]);});
});
it('不足part・未知ID・重複ID・疎配列・未知条件を受理しない',()=>fixture([base()],s=>{
 const d=s.manifest[0];for(const input of [[{...d,expectedParts:2}],[{...d,fileIds:['0'.repeat(64)]}],[{...d,expectedParts:2,fileIds:[d.fileIds[0],d.fileIds[0]]}],new Array(1),[{...d,fileIds:new Array(1)}]])expect(()=>s.store.reconstruct(input as never,q)).toThrow();expect(()=>s.store.reconstruct(s.manifest,{...q,limit:1} as never)).toThrow();
 let reads=0;const proxy=new Proxy(s.manifest,{get(t,k,r){if(k==='length')return ++reads===1?1:1000;return Reflect.get(t,k,r)}});expect(s.store.reconstruct(proxy,{...q,asOf:'2026-10-27'}).selection.status).toBe('available');expect(reads).toBe(1);
}));
it('readOnlyで指紋cacheを使っても私有DBの後付け変更を拒否する',()=>fixture([base()],s=>{
 s.store.close();const before=readFileSync(s.db),reader=new CorporateRegistryStore(s.db,{readOnly:true});try{const query={...q,asOf:'2026-10-27'};expect(reader.reconstruct(s.manifest,query).selection.status).toBe('available');expect(reader.reconstruct(s.manifest,query).selection.status).toBe('available');const db=new Database((reader as any).snapshotFile);try{db.exec("UPDATE registry_records SET corporate_number='1010001001210'")}finally{db.close()}expect(()=>reader.reconstruct(s.manifest,query)).toThrow('変化');}finally{reader.close()}expect(readFileSync(s.db)).toEqual(before);
}));
