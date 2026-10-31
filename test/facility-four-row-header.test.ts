import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {extractFacilityDetails,screenFacilityDetails} from '../src/facility-details';
import {FacilityDetailStore} from '../src/db/facility-detail-store';
import {Database} from '../src/db/node-sqlite';
import {facilityDocument,facilityTable} from './fixtures/facility-details';
const query={asOfDate:'2026-03-31'};
function table(){
 const base=facilityTable(11).replace('建物及び構築物','建物構築物').replace('機械装置及び運搬具','機械運搬具工具器具備品').replace('その他','ソフトウエア').replace('従業員数(人)','従業員数(名)');
 const row=base.match(/<tbody>(<tr>.*<\/tr>)<\/tbody>/)![1];
 return base.replace('<thead>','<thead><tr>'+Array(7).fill('<td></td>').join('')+'<td colspan="4">2026年３月31日現在</td></tr>').replace(row,row.repeat(6));
}
const document=(raw=table(),id='NEW')=>facilityDocument(id,raw);
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
function fixture(run:(file:string)=>void){const dir=mkdtempSync(join(tmpdir(),'facility-header-'));try{run(join(dir,'store.sqlite'));}finally{rmSync(dir,{recursive:true,force:true});}}
/** Small legacy fixture: the old mapper preserved this source but recognized no rows. */
function rewrite(file:string,version:'2'|'3',kind:'2'|'3',legacy=false){
 const db=new Database(file);try{const row=db.prepare('SELECT * FROM facility_snapshots').get()! as Record<string,string>,record=JSON.parse(row.body);record.version=version;
 if(legacy){record.extraction.rows=[];record.extraction.diagnostics=[{tableIndex:0,reason:'unsupported-layout'}];}
 const id=sha(canonical([record.version,record.input,record.extraction.source.inputXmlSha256])),body=canonical(record),content=sha(canonical([id,row.doc_id,row.context_ref,row.as_of_date,row.input_sha256,body]));
 db.prepare('UPDATE facility_snapshots SET id=?,body=?,content_sha256=?').run(id,body,content);db.prepare('UPDATE facility_format SET kind=?').run(`edinet-ts-facility-${kind}-v1`);return id;
 }finally{db.close();}
}
it('確認済み4行見出しだけを読み、単一/検索/Storeで6行と原セルを保持する',()=>fixture(file=>{
 const d=document(),result=extractFacilityDetails(d);expect(result.rows).toHaveLength(6);expect(result.rows[0]).toMatchObject({rowIndex:4,rights:'unconfirmed',propertyIdentity:'not-established',values:{totalBookValueJPY:{raw:'3,300',decimal:'3300000000'},landAreaM2:{raw:'100.25',decimal:'100.25'}}});
 const screened=screenFacilityDetails([d],{...query,sort:{field:'totalBookValueJPY',order:'desc'},offset:1,limit:2});expect(screened.matched).toBe(6);expect(screened.rows).toHaveLength(2);
 const store=new FacilityDetailStore(file);try{store.append([d]);}finally{store.close();}
 const reader=new FacilityDetailStore(file,{readOnly:true});try{expect(reader.search(query).matched).toBe(6);}finally{reader.close();}
}));
it('別表の正しい日付が本文にあっても先頭日付不一致を拒否する',()=>{
 expect(()=>extractFacilityDetails(document(table().replace('2026年３月31日現在','2025年３月31日現在')))).toThrow('先頭日付');
});
it.each([
 ['複数日付',()=>table().replace('2026年３月31日現在','2026年３月31日現在 2025年３月31日現在')],
 ['日付の別配置',()=>table().replace('<td></td>','<td>2026年３月31日現在</td>')],
 ['未知列',()=>table().replace('ソフトウエア','その他')],
 ['別単位',()=>table().replaceAll('百万円','千円')],
] as const)('%sは旧3行形式にfallbackしない',(_label,raw)=>{const result=extractFacilityDetails(document(raw()));expect(result.rows).toHaveLength(0);expect(result.diagnostics).toEqual([{tableIndex:0,reason:'unsupported-layout'}]);});
it('4行ヘッダに数値セルを混ぜたりmerged数値を複製採用しない',()=>{
 const raw=table().replace('<td>3,300</td>','<td rowspan="2">3,300</td>').replace('<td>3,300</td>','');
 const result=extractFacilityDetails(document(raw));expect(result.rows).toHaveLength(6);expect(result.rows.slice(0,2).map(r=>r.values.totalBookValueJPY)).toEqual([expect.objectContaining({status:'unavailable',reason:'merged-data-cell'}),expect.objectContaining({status:'unavailable',reason:'merged-data-cell'})]);
});
it('旧版2の未対応0行をreadOnlyで維持し、書込拒否とbyte不変を守る',()=>fixture(file=>{
 const writer=new FacilityDetailStore(file);writer.append([document()]);writer.close();rewrite(file,'2','2',true);const before=sha(readFileSync(file));
 const reader=new FacilityDetailStore(file,{readOnly:true});try{expect(reader.audit().snapshots).toBe(1);expect(reader.search(query).matched).toBe(0);expect(reader.search(query).extractions[0].diagnostics).toEqual([{tableIndex:0,reason:'unsupported-layout'}]);expect(()=>reader.append([document()])).toThrow();}finally{reader.close();}
 expect(sha(readFileSync(file))).toBe(before);expect(()=>new FacilityDetailStore(file)).toThrow();expect(sha(readFileSync(file))).toBe(before);
}));
it('readOnly getterを一度だけ捕捉し、旧Storeを書込可能へ変えない',()=>fixture(file=>{
 const writer=new FacilityDetailStore(file);writer.append([document()]);writer.close();rewrite(file,'2','2',true);const before=sha(readFileSync(file));let reads=0;
 const reader=new FacilityDetailStore(file,{get readOnly(){return ++reads===1;}});
 try{expect(reads).toBe(1);expect(reader.search(query).matched).toBe(0);expect(()=>reader.append([document()])).toThrow();}finally{reader.close();}
 expect(sha(readFileSync(file))).toBe(before);
}));
it.each([['2','3'],['3','2']] as const)('hash修復済みmeta%s/record%sの混在も拒否する',(kind,version)=>fixture(file=>{
 const writer=new FacilityDetailStore(file);writer.append([document()]);writer.close();rewrite(file,version,kind,kind==='2');
 const reader=new FacilityDetailStore(file,{readOnly:true});try{expect(()=>reader.audit()).toThrow();}finally{reader.close();}
}));

it('旧版2の採用済み3行形式の全値と検索JSONをreadOnlyで保持する',()=>fixture(file=>{
 const d=facilityDocument('LEGACY',facilityTable(9)),writer=new FacilityDetailStore(file);writer.append([d]);const expected=writer.search(query);writer.close();
 expect(expected.matched).toBe(1);expect(expected.rows[0].row.values.totalBookValueJPY).toMatchObject({status:'numeric',raw:'3,300',decimal:'3300000000'});
 const legacyID=rewrite(file,'2','2'),before=sha(readFileSync(file));
 const reader=new FacilityDetailStore(file,{readOnly:true});try{
  expect(reader.search(query)).toEqual({...expected,storage:{...expected.storage,snapshotIds:[legacyID]}});
  expect(reader.search({...query,conditions:[{field:'totalBookValueJPY',operator:'gte',value:3300000000}]}).matched).toBe(1);
  expect(reader.search({...query,conditions:[{field:'totalBookValueJPY',operator:'gt',value:3300000000}]}).matched).toBe(0);
  expect(()=>reader.append([d])).toThrow();
 }finally{reader.close();}
 expect(sha(readFileSync(file))).toBe(before);expect(()=>new FacilityDetailStore(file)).toThrow();expect(sha(readFileSync(file))).toBe(before);
}));
