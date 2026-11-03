import {it,expect} from 'vitest';
import {DuckDBInstance} from '@duckdb/node-api';
import {createHash} from 'node:crypto';
import {duckFinancialReaderFixture as fixture} from './fixtures/duck-financial-reader';
import {FinancialIndexReadQueries,financialIndexRowColumns,type FinancialReadQuery} from '../src/db/financial-search-index';

it('世代監査と品質をまとめても従来結果と一致し、行は本文付きで一巡だけ読む',()=>fixture(async({sqlite})=>{
 class Queries extends FinancialIndexReadQueries {
  rowColumns:readonly string[][]=[];
  override *projectionBatch(...args:Parameters<FinancialIndexReadQueries['projectionBatch']>):FinancialReadQuery<Record<string,unknown>[]> {
   if(args[0]==='financial_rows')this.rowColumns=[...this.rowColumns,[...args[2]]];
   return yield* super.projectionBatch(...args);
  }
 }
 const queries=new Queries(),result=(sqlite as any).read(queries.auditSnapshot('all'));
 expect(result.generation).toEqual(sqlite.generation('all'));expect(result.quality).toEqual(sqlite.quality('all'));
 expect(queries.rowColumns).toHaveLength(2);expect(queries.rowColumns.every(columns=>columns.includes('body'))).toBe(true);
}));

it('本文と保存hashを整合させた改変も世代manifestと異なれば拒否する',async()=>{
 const canonical=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
 await expect(fixture(async()=>{},async path=>{
  const db=await DuckDBInstance.create(path,{threads:'1'}),connection=await db.connect();
  try{
   const row=(await connection.runAndReadAll('SELECT * FROM financial_rows ORDER BY row_id LIMIT 1')).getRowObjects()[0],body=JSON.parse(String(row.body));body.knownAt='2026-07-02T00:00:00Z';const changed=canonical(body),sha256=createHash('sha256').update(canonical([financialIndexRowColumns.map(k=>row[k]),changed])).digest('hex');
   await connection.run('UPDATE financial_rows SET body=?,sha256=? WHERE row_id=?',[changed,sha256,row.row_id]);
  }finally{connection.closeSync();db.closeSync()}
 })).rejects.toThrow('索引');
});

it('行の欠落は指標値が残っていても初回監査で拒否する',async()=>{
 await expect(fixture(async()=>{},async path=>{
  const db=await DuckDBInstance.create(path,{threads:'1'}),connection=await db.connect();
  try{await connection.run('DELETE FROM financial_rows WHERE row_id=(SELECT MIN(row_id) FROM financial_rows)')}finally{connection.closeSync();db.closeSync()}
 })).rejects.toThrow('行数');
});

it.each(['invalid-json','empty-object','trailing-space','reordered','changed-value'])('初回監査で本文の %s を拒否する',async kind=>{
 await expect(fixture(async()=>{},async path=>{
  const db=await DuckDBInstance.create(path,{threads:'1'}),connection=await db.connect();
  try{
   const row=(await connection.runAndReadAll('SELECT row_id,body FROM financial_rows ORDER BY row_id LIMIT 1')).getRowObjects()[0],body=String(row.body),parsed=JSON.parse(body);
   const changed=kind==='invalid-json'?'corrupt':kind==='empty-object'?'{}':kind==='trailing-space'?body+' ':kind==='reordered'?JSON.stringify(Object.fromEntries(Object.entries(parsed).reverse())):JSON.stringify({...parsed,knownAt:'2026-07-02T00:00:00Z'});
   expect(changed).not.toBe(body);await connection.run('UPDATE financial_rows SET body=? WHERE row_id=?',[changed,row.row_id]);
  }finally{connection.closeSync();db.closeSync()}
 })).rejects.toThrow('本文');
});
