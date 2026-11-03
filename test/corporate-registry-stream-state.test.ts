import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {reconstructCorporateRegistryStreamStates as scan,type CorporateRegistryStreamDelivery} from '../src/corporate-registry-stream-state';
import {reconstructCorporateRegistryState as raw,CORPORATE_REGISTRY_FIELDS as fields,type CorporateRegistrySource,type CorporateRegistryDelivery} from '../src/corporate-registry';
const a='1010001001202',b='2010001001201',sha=(v:string)=>createHash('sha256').update(v).digest('hex');
const row=(patch:Record<string,string>={})=>{const data={sequenceNumber:'1',corporateNumber:a,process:'01',correct:'0',updateDate:'2026-10-27',changeDate:'2015-10-05',assignmentDate:'2015-10-05',name:'日本会社',kind:'301',latest:'1',hihyoji:'0',...patch};return '<corporation>'+fields.map(k=>'<'+k+'>'+((data as Record<string,string>)[k]??'')+'</'+k+'>').join('')+'</corporation>'};
const source=(kind:'full'|'diff',dataDate='2026-10-27'):CorporateRegistrySource=>({kind,dataDate,observedAt:'2026-10-30T00:00:00Z',sourceUrl:'https://example.test/'+dataDate+'.xml',purpose:'download'});
async function* chunks(xml:string){const bytes=Buffer.from(xml);for(let i=0;i<bytes.length;i+=19)yield bytes.subarray(i,i+19)}
const part=(text:string,src=source('full'))=>({source:src,sha256:sha(text),chunks:chunks(text)});
const delivery=(text:string,src=source('full')):CorporateRegistryStreamDelivery=>({scope:'national',expectedParts:1,parts:[part(text,src)]});
const wrap=(v:string)=>'<corporations>'+v+'</corporations>';
const q={corporateNumbers:[a,b],asOf:'2026-10-27',knownAt:'2026-10-31T00:00:00Z',registryPurpose:'download' as const};
it('複数法人の全件/差分の状態・原記録位置が既存XML入口と完全一致する',async()=>{
 const base=wrap(row()+row({sequenceNumber:'2',corporateNumber:b})),diff=wrap(row({process:'11',updateDate:'2026-10-28',changeDate:'2026-10-28',name:'新名'}));const inputs=[delivery(base),delivery(diff,source('diff','2026-10-28'))],query={...q,asOf:'2026-10-28'};
 const result=await scan(inputs,query),original:CorporateRegistryDelivery[]=[{scope:'national',expectedParts:1,parts:[{xml:base,source:source('full')}]},{scope:'national',expectedParts:1,parts:[{xml:diff,source:source('diff','2026-10-28')}]}];
 for(let i=0;i<q.corporateNumbers.length;i++){const {corporateNumbers,...settings}=query;expect(result.states[i]).toEqual(raw(original,{...settings,corporateNumber:corporateNumbers[i]}))}expect(result.scan).toMatchObject({records:3,selectedRecords:3,allPartsCompleted:true,bytes:Buffer.byteLength(base)+Buffer.byteLength(diff)});
 result.states[0].sources[0].sourceUrl='changed';expect(result.states[1].sources[0].sourceUrl).not.toBe('changed');
});
it('全件の分割間では一連番号の再使用を認め、法人番号の重複は拒否する',async()=>{
 const first=wrap(row()),second=wrap(row({corporateNumber:b}));const d={scope:'national' as const,expectedParts:2,parts:[part(first),part(second)]};expect((await scan([d],q)).scan.records).toBe(2);
 await expect(scan([{...d,parts:[part(first),part(first)]}],{...q,corporateNumbers:[b]})).rejects.toThrow('重複');
});
it('対象外法人の一連番号重複も拒否する',async()=>{
 await expect(scan([delivery(wrap(row({corporateNumber:b})+row({corporateNumber:b})))],{...q,corporateNumbers:[a]})).rejects.toThrow('一連番号');
});
it('差分の分割間で一連番号が重複すれば対象外でも拒否する',async()=>{
 const d={scope:'national' as const,expectedParts:2,parts:[part(wrap(row()),source('diff')),part(wrap(row({corporateNumber:b})),source('diff'))]};await expect(scan([d],q)).rejects.toThrow('重複');
});
it('対象発見後の末尾破損・hash不一致・対象外の不正記録を返却前に拒否する',async()=>{
 await expect(scan([delivery(wrap(row())+'broken')],q)).rejects.toThrow();const d=delivery(wrap(row()));d.parts=[{...d.parts[0],sha256:'0'.repeat(64)}];await expect(scan([d],q)).rejects.toThrow();
 await expect(scan([delivery(wrap(row()+row({sequenceNumber:'2',corporateNumber:b,latest:'bad'})))],{...q,corporateNumbers:[a]})).rejects.toThrow();
});
it('cutoff対象外のパートも全量検査し、原本破損を見逃さない',async()=>{
 await expect(scan([delivery(wrap(row())+'bad')],{...q,knownAt:'2026-10-29T00:00:00Z'})).rejects.toThrow();
 const result=await scan([delivery(wrap(row()))],{...q,knownAt:'2026-10-29T00:00:00Z'});expect(result.states[0].selection).toEqual({status:'unavailable',reason:'no-baseline'});expect(result.scan.records).toBe(1);
});
it('同じ記録集合の順序・空白が異なる配布は同時刻競合へ変えない',async()=>{
 const first=wrap(row()+row({sequenceNumber:'2',corporateNumber:b})),second=wrap(row({sequenceNumber:'2',corporateNumber:b})+'\n'+row());const r=await scan([delivery(first),delivery(second)],q);expect(r.states.every(s=>s.selection.status==='available')).toBe(true);
});
it('後続の読み出し中止で上流iteratorを閉じ、不完全な結果を返さない',async()=>{
 let closed=false;const controller=new AbortController();async function* stopped(){try{yield Buffer.from(wrap(row()));controller.abort();yield Buffer.from(' ')}finally{closed=true}}
 const d=delivery(wrap(row()));d.parts=[{...d.parts[0],chunks:stopped()}];await expect(scan([d],q,undefined,{signal:controller.signal})).rejects.toThrow();expect(closed).toBe(true);
});
it('空集合・重複番号・疎配列・欠けたpart・混在した目的を拒否する',async()=>{
 for(const ids of [[],[a,a],Array(1)])await expect(scan([],{...q,corporateNumbers:ids})).rejects.toThrow();await expect(scan([{...delivery(wrap(row())),expectedParts:2}],q)).rejects.toThrow();
 const d={scope:'national' as const,expectedParts:2,parts:[part(wrap(row())),part(wrap(row({corporateNumber:b})),{...source('full'),purpose:'sample' as const})]};await expect(scan([d],q)).rejects.toThrow();
});

it('企業マスター全体に使う1万番号の集合を受け付け、超過を拒否する',async()=>{
 const corporateNumbers=Array.from({length:10000},(_,i)=>String(1000000000000+i)),r=await scan([],{...q,corporateNumbers});expect(r.states).toHaveLength(10000);expect(r.states[9999].selection).toEqual({status:'unavailable',reason:'no-baseline'});expect(r.scan.files).toEqual([]);await expect(scan([],{...q,corporateNumbers:[...corporateNumbers,'2000000000000']})).rejects.toThrow();
});
