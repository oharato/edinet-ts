import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {FacilityDetailStore} from '../src/db/facility-detail-store';
import {screenFacilityDetails,type FacilityScreeningOptions} from '../src/facility-details';
import {Database} from '../src/db/node-sqlite';
import {facilityDocument as document,facilityTable as table} from './fixtures/facility-details';
const hash=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
function fixture(use:(file:string)=>void){const dir=mkdtempSync(join(tmpdir(),'facility-store-'));try{use(join(dir,'facilities.sqlite'))}finally{rmSync(dir,{recursive:true,force:true})}}
const query={asOfDate:'2026-03-31'};
it('再open後の条件/並び順/除外/出典が直接検索のJSON結果と一致し、原DBを変更しない',()=>fixture(file=>{
 const docs=[document('B',table(12)),document('A',table(9,['本店','通信','0.0000001','9','－','2','－','9,007,199,254,740,993','1']))],writer=new FacilityDetailStore(file);
 const appended=writer.append(docs);expect(appended.inserted).toBe(2);expect(writer.append(docs).inserted).toBe(0);writer.close();
 const before=hash(readFileSync(file)),store=new FacilityDetailStore(file,{readOnly:true});
 const queries:FacilityScreeningOptions[]=[query,{...query,sort:{field:'totalBookValueJPY',order:'desc'}},{...query,conditions:[{field:'landAreaM2',operator:'gte',value:0}]},{...query,contains:'本店',offset:0,limit:1},{...query,organization:'overseas-subsidiaries'}];
 try{for(const q of queries){const {storage,...actual}=store.search(q);expect(actual).toEqual(JSON.parse(JSON.stringify(screenFacilityDetails(docs,q))));expect(storage.snapshotIds).toHaveLength(2)}expect(store.audit().snapshots).toBe(2)}finally{store.close()}
 expect(hash(readFileSync(file))).toBe(before);const db=new Database(file,{readOnly:true});try{expect(db.prepare("SELECT decimal_text FROM facility_values WHERE field_id='totalBookValueJPY' AND doc_id='A'").all()).toEqual([{decimal_text:'9007199254740993000000'}])}finally{db.close()}
}));
it('複数時点を保存し、明示snapshotで旧原本を選択できる。競合を自動解消しない',()=>fixture(file=>{
 const a=document('A'),b=document('A',table(9,['別拠点','通信','1','2','3','4','－','5','1'])),past=document('PAST',table(),2025),store=new FacilityDetailStore(file);
 try{const first=store.append([a]);store.append([b,past]);expect(()=>store.search(query)).toThrow('重複');expect(store.search({...query,snapshotIds:first.snapshotIds}).matched).toBe(1);expect(store.search({asOfDate:'2025-03-31'}).matched).toBe(1);expect(()=>store.search({...query,snapshotIds:['0'.repeat(64)]})).toThrow();expect(()=>store.search({asOfDate:'2025-03-31',snapshotIds:first.snapshotIds})).toThrow();expect(store.search({...query,snapshotIds:[]}).matched).toBe(0)}finally{store.close()}
}));
it('誤った宣言を含む投入は全体を保存せず、非対応本文は非対応として残す',()=>fixture(file=>{
 const a=document('A'),bad=document('B');bad.declarations=[{...bad.declarations[0],rawSha256:'0'.repeat(64)}];const store=new FacilityDetailStore(file);
 try{expect(()=>store.append([a,bad])).toThrow();expect(store.audit().snapshots).toBe(0);const unsupported={...a,xml:a.xml.replace('2025-11-01/jpcrp_cor','unknown/jpcrp_cor')};store.append([unsupported]);const r=store.search(query);expect(r.matched).toBe(0);expect(r.extractions[0].source.status).toBe('unsupported')}finally{store.close()}
}));
it('対象外の日付にある索引改変も全保存監査で拒否する',()=>fixture(file=>{
 const store=new FacilityDetailStore(file);store.append([document()]);store.close();const db=new Database(file);db.exec("UPDATE facility_snapshots SET as_of_date='2001-01-01'");db.close();const reader=new FacilityDetailStore(file,{readOnly:true});try{expect(()=>reader.search({asOfDate:'1999-01-01'})).toThrow()}finally{reader.close()}
}));
it('整合hashを作り直しても原表セルと異なる保存値は拒否する',()=>fixture(file=>{
 const store=new FacilityDetailStore(file);store.append([document()]);store.close();const db=new Database(file);
 try{const row=db.prepare('SELECT * FROM facility_snapshots').get()! as Record<string,string>;const body=JSON.parse(row.body);body.extraction.rows[0].values.totalBookValueJPY.decimal='999';
  const canonical=(value:unknown):string=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);const text=canonical(body),sha=createHash('sha256').update(canonical([row.id,row.doc_id,row.context_ref,row.as_of_date,row.input_sha256,text])).digest('hex');db.prepare('UPDATE facility_snapshots SET body=?,content_sha256=?').run(text,sha);
 }finally{db.close()}
 const reader=new FacilityDetailStore(file,{readOnly:true});try{expect(()=>reader.audit()).toThrow()}finally{reader.close()}
}));
