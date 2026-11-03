import {it,expect} from 'vitest';
import {DuckDBInstance} from '@duckdb/node-api';
import {duckFinancialReaderFixture as fixture} from './fixtures/duck-financial-reader';
import {FinancialIndexReadQueries,financialIndexRowColumns,financialIndexValueColumns} from '../src/db/financial-search-index';

it('リスト転記でも同一行の複数指標・途中cursor・本文がSQLiteと一致する',()=>fixture(async({sqlite,duck})=>{
 const queries=new FinancialIndexReadQueries();
 for(const table of ['financial_rows','financial_values'] as const){
  const columns=table==='financial_rows'?[...financialIndexRowColumns,'sha256','body']:financialIndexValueColumns;
  const expected=(sqlite as any).read(queries.projectionBatch(table,'all',columns)) as Record<string,unknown>[];
  expect(expected.length).toBeGreaterThan(2);expect(await (duck as any).execute(queries.projectionBatch(table,'all',columns))).toEqual(expected);
  const cursor=expected[Math.floor(expected.length/2)],after=String(cursor.row_id),metric=String(cursor.metric_id??'');
  const remaining=(sqlite as any).read(queries.projectionBatch(table,'all',columns,after,metric));
  expect(await (duck as any).execute(queries.projectionBatch(table,'all',columns,after,metric))).toEqual(remaining);
  const last=expected.at(-1)!;expect(await (duck as any).execute(queries.projectionBatch(table,'all',columns,String(last.row_id),String(last.metric_id??'')))).toEqual([]);
 }
}));

it('UTF-8バイト容量はASCII・日本語・絵文字・結合文字・NUL・NULLをSQLite定義どおり数える',()=>fixture(async({duck})=>{
 const values=['ascii','あ漢😀','e\u0301','\0','\\','',null],expected=values.map(value=>Buffer.byteLength(value??'','utf8'));
 function* query():Generator<any,number[],any>{const rows=yield {sql:`WITH samples(payload) AS (VALUES ${values.map(()=>'(?)').join(',')}) SELECT edinet_text_bytes(payload) AS bytes FROM samples`,args:values};return rows.map((row:any)=>row.bytes);}
 expect(await (duck as any).execute(query())).toEqual(expected);
}));

it.each([false,true])('文字列転送の見積り超過=%sでも同じ値を返し、超過時は通常列へ戻す',tooLarge=>fixture(async({sqlite,duck})=>{
 const snapshot=(duck as any).snapshot,original=snapshot.rows.bind(snapshot),seen:string[]=[];
 snapshot.rows=async(sql:string,args:any[])=>{seen.push(sql);const rows=await original(sql,args);if(sql.includes(' AS _edinet_wire_bytes ')){
  expect(rows.every((row:any)=>row._edinet_wire_bytes===6*row.bytes+256)).toBe(true);
  if(tooLarge&&rows.length)rows[0]={...rows[0],_edinet_wire_bytes:64*1024*1024+1};
 }return rows;};
 const query=()=>new FinancialIndexReadQueries(16000).projectionBatch('financial_values','all',financialIndexValueColumns);
 expect(await (duck as any).execute(query())).toEqual((sqlite as any).read(query()));
 expect(seen.some(sql=>sql.includes('system.main.to_json'))).toBe(!tooLarge);
}));
it.each(['null','[]','{"generation":{}}','not-json'])('不正な転送metadata %s を採用せず、次の読取を実行できる',bad=>fixture(async({duck})=>{
 const snapshot=(duck as any).snapshot,original=snapshot.rows.bind(snapshot),query=()=>new FinancialIndexReadQueries(16000).projectionBatch('financial_values','all',financialIndexValueColumns);
 snapshot.rows=async(sql:string,args:any[])=>{const rows=await original(sql,args);if(sql.includes(' AS _edinet_metadata,')&&rows.length)rows[0]={...rows[0],_edinet_metadata:bad};return rows;};
 await expect((duck as any).execute(query())).rejects.toThrow();snapshot.rows=original;
 expect((await (duck as any).execute(query())).length).toBeGreaterThan(0);
}));
it.each(['available','metric_order'])('文字列をまとめても %s の安全範囲外整数は拒否する',async column=>{
 await expect(fixture(async()=>{},async path=>{const db=await DuckDBInstance.create(path,{threads:'1'}),connection=await db.connect();try{await connection.run(`UPDATE financial_values SET ${column}=9007199254740992`)}finally{connection.closeSync();db.closeSync()}})).rejects.toThrow('Unsafe DuckDB integer');
});
