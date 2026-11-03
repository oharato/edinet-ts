import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {CorporateRegistryStore,type CorporateRegistryStoredDelivery} from '../src/db/corporate-registry-store';
import {linkCompanyMasterCorporateStates as link,type CompanyCorporateStateQuery} from '../src/company-corporate-state';
import {CORPORATE_REGISTRY_FIELDS as fields} from '../src/corporate-registry';
import type {CompanyMasterSnapshot} from '../src/company-master';
const number='1010001001202',sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const row=(patch:Record<string,string>={})=>{const values={sequenceNumber:'1',corporateNumber:number,process:'01',correct:'0',updateDate:'2026-10-27',changeDate:'2015-10-05',assignmentDate:'2015-10-05',name:'法人',kind:'301',latest:'1',hihyoji:'0',...patch};return '<corporation>'+fields.map(f=>'<'+f+'>'+((values as Record<string,string>)[f]??'')+'</'+f+'>').join('')+'</corporation>'};
const master=():CompanyMasterSnapshot=>({asOf:'2026-10-27',observedAt:'2026-10-30T00:00:00Z',sourceUrl:'https://example.test/master.csv',sourceSha256:'1'.repeat(64),records:[{entityId:'edinet:E00001',edinetCode:'E00001',corporateNumber:number,name:'法人',filerType:'内国法人',listingStatus:'listed',securityCode:'12340'}]});
const q:CompanyCorporateStateQuery={asOf:'2026-10-27',knownAt:'2026-10-31T00:00:00Z',registryPurpose:'download',edinetCodes:['E00001']};
async function fixture(use:(f:{store:CorporateRegistryStore;db:string;deliveries:CorporateRegistryStoredDelivery[];add:(date:string,kind:'full'|'diff',content:string,purpose?:'sample'|'download')=>Promise<void>})=>Promise<void>,initial=row()){
 const dir=mkdtempSync(join(tmpdir(),'company-registry-')),db=join(dir,'registry.sqlite'),store=new CorporateRegistryStore(db),deliveries:CorporateRegistryStoredDelivery[]=[];
 const add=async(date:string,kind:'full'|'diff',content:string,purpose:'sample'|'download'='download')=>{const xml='<corporations>'+content+'</corporations>',file=join(dir,date+'-'+purpose+'.xml');writeFileSync(file,xml);const result=await store.importFile({file,part:date+'.xml',sha256:sha(xml),source:{sourceUrl:'https://example.test/'+date+'.xml',dataDate:date,kind,purpose,observedAt:'2026-10-30T00:00:00Z'}});deliveries.push({scope:'national',expectedParts:1,fileIds:[result.file.id]})};
 try{await add('2026-10-27','full',initial);await use({store,db,deliveries,add})}finally{store.close();rmSync(dir,{recursive:true,force:true})}
}
it('保存状態を再構成して番号と原名称が一致する会社へ結合し、EDINET IDと出典を保つ',()=>fixture(async f=>{
 f.store.close();const before=sha(readFileSync(f.db)),reader=new CorporateRegistryStore(f.db,{readOnly:true});try{const r=link([master()],reader,f.deliveries,q);expect(r.rows[0]).toMatchObject({status:'number-and-name-matched',reason:'exact-number-and-name',company:{entityId:'edinet:E00001'},nameComparison:'exact',state:{coverage:{through:'2026-10-27'},storage:{verification:'all-records'}}});expect(r).toMatchObject({entityIdentity:'not-established',mergedEntities:false,followedSuccessor:false,total:1});expect(r.master.total).toBe(1)}finally{reader.close()}expect(sha(readFileSync(f.db))).toBe(before);
}));
it('差分欠落では単独の原記録へ戻って一致扱いにしない',()=>fixture(async f=>{
 const r=link([master()],f.store,f.deliveries,{...q,asOf:'2026-10-29'});expect(r.rows[0]).toMatchObject({status:'unresolved',reason:'registry-state-unresolved',state:{selection:{reason:'coverage-gap'}}});
}));
it('検索フィルタや要求IDで隠れた同じ法人番号の別EDINET IDも競合とする',()=>fixture(async f=>{
 const m=master();m.records=[...m.records,{...m.records[0],entityId:'edinet:E00002',edinetCode:'E00002',securityCode:'56780',listingStatus:'unlisted'}];const r=link([m],f.store,f.deliveries,{...q,securityCode:'1234'});expect(r.rows[0].reason).toBe('shared-corporate-number');expect(r.rows[0].state).toBeUndefined();
}));
it('新しいマスターの名称が違えば旧観測へ戻らず、空白や文字幅も同一視しない',()=>fixture(async f=>{
 const old=master(),newer={...master(),observedAt:'2026-10-30T12:00:00Z',sourceSha256:'2'.repeat(64)};newer.records=[{...newer.records[0],name:'法人 '}];const r=link([old,newer],f.store,f.deliveries,q);expect(r.rows[0]).toMatchObject({reason:'registry-name-mismatch',nameComparison:'different',company:{name:'法人 '}});
}));
it('閉鎖法人と承継先は結合を保留し、別法人番号へ追跡しない',()=>fixture(async f=>{
 const r=link([master()],f.store,f.deliveries,q);expect(r.rows[0]).toMatchObject({status:'unresolved',reason:'closed-corporation',nameComparison:'exact'});expect(r.followedSuccessor).toBe(false);
},row({process:'21',closeDate:'2026-10-26',closeCause:'01',successorCorporateNumber:'2010001001201'})));
it('削除差分を反映し、名称一致した全件記録を復活させない',()=>fixture(async f=>{
 const empty=Object.fromEntries(fields.map(k=>[k,'']));await f.add('2026-10-28','diff',row({...empty,sequenceNumber:'1',corporateNumber:number,process:'99',updateDate:'2026-10-28'}));expect(link([master()],f.store,f.deliveries,{...q,asOf:'2026-10-28'}).rows[0].reason).toBe('registry-record-deleted');
}));
it('目的不一致・未保存番号・法人番号なしと要求IDの不在を区別する',()=>fixture(async f=>{
 expect(link([master()],f.store,f.deliveries,{...q,registryPurpose:'sample'}).rows[0].reason).toBe('registry-state-unavailable');const m=master();m.records=[{...m.records[0],corporateNumber:undefined}];const r=link([m],f.store,f.deliveries,{...q,edinetCodes:['E00001','E99999']});expect(r.rows[0].reason).toBe('corporate-number-missing');expect(r.absentEdinetCodes).toEqual(['E99999']);
}));
it('IDの重複・不正形式・件数超過と未知条件を拒否する',()=>fixture(async f=>{
 for(const ids of [['E00001','E00001'],['bad'],Array.from({length:101},(_,i)=>'E'+String(i).padStart(5,'0'))])expect(()=>link([master()],f.store,f.deliveries,{...q,edinetCodes:ids})).toThrow();expect(()=>link([master()],f.store,f.deliveries,{...q,unknown:true} as never)).toThrow();
}));
