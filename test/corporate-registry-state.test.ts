import {it,expect} from 'vitest';
import {CORPORATE_REGISTRY_FIELDS as fields,reconstructCorporateRegistryState as state,type CorporateRegistryDelivery,type CorporateRegistryStateQuery,type CorporateRegistrySource} from '../src/corporate-registry';
const number='1010001001202';
const q:CorporateRegistryStateQuery={corporateNumber:number,asOf:'2026-10-29',knownAt:'2026-10-30T00:00:00Z',registryPurpose:'download'};
const row=(patch:Record<string,string>={})=>{const v:Record<string,string>={sequenceNumber:'1',corporateNumber:number,process:'01',correct:'0',updateDate:'2026-10-27',changeDate:'2015-10-05',name:'旧名',kind:'301',assignmentDate:'2015-10-05',latest:'1',hihyoji:'0',...patch};return '<corporation>'+fields.map(k=>'<'+k+'>'+(v[k]??'')+'</'+k+'>').join('')+'</corporation>';};
const source=(day:string,kind:'full'|'diff'):CorporateRegistrySource=>({sourceUrl:'https://example.test/'+day+'.xml',observedAt:'2026-10-30T00:00:00Z',dataDate:day,kind,purpose:'download'});
const delivery=(day:string,kind:'full'|'diff',rows=''):CorporateRegistryDelivery=>({scope:'national',expectedParts:1,parts:[{xml:'<corporations>'+rows+'</corporations>',source:source(day,kind)}]});
const base=()=>delivery('2026-10-27','full',row());
const change=(patch:Record<string,string>={})=>row({process:'11',updateDate:'2026-10-28',changeDate:'2026-10-20',name:'新名',...patch});
const empty=()=>delivery('2026-10-29','diff');
const deletion=()=>row({...Object.fromEntries(fields.map(k=>[k,''])),sequenceNumber:'1',corporateNumber:number,process:'99',updateDate:'2026-10-28'});
it('全件を起点に差分と空の日を適用し、法人番号と生の出典を維持する',()=>{
 const docs=[empty(),base(),delivery('2026-10-28','diff',change())],before=structuredClone(docs);const r=state(docs,q);expect(r.selection).toMatchObject({status:'available',record:{sourceIndex:2,record:{values:{name:'新名',corporateNumber:number}}}});expect(r.coverage).toEqual({from:'2026-10-27',through:'2026-10-29'});expect(r.appliedDeliveries).toEqual([1,2,0]);expect(r.history.map(r=>r.record.values.name)).toEqual(['旧名','新名']);expect(docs).toEqual(before);expect(r.sources.every(s=>/^[a-f0-9]{64}$/.test(s.inputXmlSha256))).toBe(true);
});
it('訂正があれば旧履歴を丸ごと置換し、最新行だけの属性合成はしない',()=>{
 const rows=change({sequenceNumber:'2',correct:'0',name:'訂正後の最新'})+change({sequenceNumber:'1',correct:'1',latest:'0',name:'訂正された過去',changeDate:'2015-10-05'});
 const r=state([base(),delivery('2026-10-28','diff',rows),empty()],q);expect(r.history.map(r=>r.record.values.name)).toEqual(['訂正された過去','訂正後の最新']);expect(r.selection).toMatchObject({status:'available',record:{record:{values:{name:'訂正後の最新'}}}});expect(r.deliveries[0].records[0].record.values.name).toBe('旧名');
});
it('削除99は履歴を除外して削除記録を残し、空の翌日でも復活しない',()=>{
 const r=state([base(),delivery('2026-10-28','diff',deletion()),empty()],q);expect(r.history).toEqual([]);expect(r.selection).toMatchObject({status:'deleted',record:{record:{values:{process:'99',name:''}}}});expect(r.deliveries[0].records).toHaveLength(1);
});
it('閉鎖と復活は番号を維持した記録で、承継先へ名寄せしない',()=>{
 const closed=delivery('2026-10-28','diff',change({process:'21',closeDate:'2026-10-20',closeCause:'11',successorCorporateNumber:'1010001001210'}));const restored=delivery('2026-10-29','diff',change({process:'22',updateDate:'2026-10-29',closeDate:'',closeCause:'',successorCorporateNumber:''}));
 expect(state([base(),closed],{...q,asOf:'2026-10-28'}).selection).toMatchObject({status:'available',record:{record:{values:{corporateNumber:number,closeDate:'2026-10-20'}}}});expect(state([base(),closed,restored],q).selection).toMatchObject({status:'available',record:{record:{values:{process:'22',closeDate:''}}}});
});
it('全件にない番号は不在とし、01の新規指定から採用できる',()=>{
 const b=delivery('2026-10-27','full');expect(state([b],{...q,asOf:'2026-10-27'}).selection).toEqual({status:'unavailable',reason:'not-in-baseline'});expect(state([b,delivery('2026-10-28','diff',change({process:'01'})),empty()],q).selection.status).toBe('available');expect(state([b,delivery('2026-10-28','diff',change()),empty()],q).selection).toMatchObject({status:'unresolved',reason:'change-without-base-record'});
});
it('間の一日も末尾の一日も欠けたまま最新と扱わない',()=>{
 expect(state([base(),empty()],q).selection).toEqual({status:'unresolved',reason:'coverage-gap',gap:{from:'2026-10-28',to:'2026-10-28'}});expect(state([base(),delivery('2026-10-28','diff',change())],q).selection).toMatchObject({status:'unresolved',reason:'coverage-gap',gap:{from:'2026-10-29',to:'2026-10-29'}});expect(state([delivery('2026-10-28','diff',change())],q).selection).toEqual({status:'unavailable',reason:'no-baseline'});
});
it('観測cutoff・as-of・架空サンプルを分離し、未来訂正を過去へ混ぜない',()=>{
 const future=delivery('2026-10-28','diff',change({name:'未来訂正',correct:'1'}));future.parts[0].source.observedAt='2026-10-31T00:00:00Z';const sample=delivery('2026-10-28','diff',change());sample.parts[0].source.purpose='sample';const r=state([base(),delivery('2026-10-28','diff',change()),empty(),future,sample,delivery('2026-10-30','diff')],q);expect(r.selection).toMatchObject({status:'available',record:{record:{values:{name:'新名'}}}});expect(r.excludedDeliveries.map(d=>d.reason)).toEqual(['source-after-cutoff','purpose-mismatch','data-after-as-of']);
});
it('分割をまとめて一連番号順に訂正し、同じ法人を部分ごとに誤選択しない',()=>{
 const a=delivery('2026-10-28','diff',change({sequenceNumber:'2',correct:'0',name:'最終'})),b=delivery('2026-10-28','diff',change({sequenceNumber:'1',correct:'1',latest:'0',name:'旧履歴'}));a.expectedParts=2;a.parts=[...a.parts,...b.parts];const r=state([base(),a,empty()],q);expect(r.history.map(r=>r.record.values.sequenceNumber)).toEqual(['1','2']);expect(r.selection).toMatchObject({status:'available',record:{sourceIndex:1,record:{values:{name:'最終'}}}});
});
it('同一時点で矛盾する配布を入力順で決めず、後日観測はcutoffで選ぶ',()=>{
 const a=delivery('2026-10-28','diff',change()),b=delivery('2026-10-28','diff',change({name:'別版'}));for(const ds of [[a,b],[b,a]])expect(state([base(),...ds,empty()],q).selection).toMatchObject({status:'unresolved',reason:'conflicting-deliveries'});
 b.parts[0].source.observedAt='2026-10-30T01:00:00Z';expect(state([base(),a,b,empty()],{...q,knownAt:'2026-10-30T02:00:00Z'}).selection).toMatchObject({status:'available',record:{record:{values:{name:'別版'}}}});
});
it.each([
 ['unknown-process',()=>change({process:'31'})],['record-after-data-date',()=>change({changeDate:'2026-10-29'})],['invalid-latest-flags',()=>change({latest:'0'})],['invalid-latest-flags',()=>change()+change({sequenceNumber:'2'})],['mixed-deletion-records',()=>deletion()+change({sequenceNumber:'2'})],['deletion-extra-fields',()=>deletion().replace('<hihyoji></hihyoji>','<hihyoji>0</hihyoji>')],['duplicate-assignment',()=>change({process:'01'})],
] as const)('%sを未解決として止める',(reason,rows)=>expect(state([base(),delivery('2026-10-28','diff',rows()),empty()],q).selection).toMatchObject({status:'unresolved',reason}));
it('不完全分割・異なる日付の混合・一連番号重複・全件での番号重複を拒否する',()=>{
 const partial=base();partial.expectedParts=2;expect(()=>state([partial],q)).toThrow();const mixed=base();mixed.expectedParts=2;mixed.parts=[...mixed.parts,...empty().parts];expect(()=>state([mixed],q)).toThrow();const dup=delivery('2026-10-28','diff',change());dup.expectedParts=2;dup.parts=[...dup.parts,...dup.parts];expect(()=>state([base(),dup],q)).toThrow();expect(()=>state([delivery('2026-10-27','full',row()+row({sequenceNumber:'2'}))],q)).toThrow();
});
it('unknown条件・boxed番号・疎配列・件数上限を拒否し、独自iteratorを辿らない',()=>{
 for(const query of [{...q,extra:true},{...q,corporateNumber:new String(number)},{...q,asOf:'2026-02-30'}])expect(()=>state([],query as never)).toThrow();expect(()=>state(new Array(1),q)).toThrow();expect(()=>state(Array(101).fill(base()),q)).toThrow();const ds=[base()];ds[Symbol.iterator]=()=>{throw Error('iterator')};expect(state(ds,{...q,asOf:'2026-10-27'}).selection.status).toBe('available');
});

it('全件の別地域ファイルでは一連番号の同値を許し、法人番号の重複は許さない',()=>{
 const b=base();b.expectedParts=2;b.parts=[...b.parts,...delivery('2026-10-27','full',row({corporateNumber:'1010001001210'})).parts];expect(state([b],{...q,asOf:'2026-10-27'}).selection.status).toBe('available');
});
it('配列lengthとXML getterを一回固定し、途中で内容を変えない',()=>{
 let reads=0,xmlReads=0;const b=base(),text=b.parts[0].xml;b.parts=[{get xml(){xmlReads++;if(xmlReads>1)throw Error('changed');return text},source:b.parts[0].source}];
 const ds=new Proxy([b],{get(t,k,r){if(k==='length')return ++reads===1?1:10000;return Reflect.get(t,k,r)}});expect(state(ds,{...q,asOf:'2026-10-27'}).selection.status).toBe('available');expect(reads).toBe(1);expect(xmlReads).toBe(1);
});
