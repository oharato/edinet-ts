import {it,expect} from 'vitest';
import {DuckDBInstance} from '@duckdb/node-api';
import {Database} from '../src/db/node-sqlite';
import {FinancialIndexReadQueries,financialIndexSqliteSchema,financialIndexValueColumns} from '../src/db/financial-search-index';

it.each([{engine:'sqlite',limit:1000},{engine:'duckdb',limit:1000},{engine:'sqlite',limit:4096},{engine:'duckdb',limit:4096},{engine:'sqlite',limit:8192},{engine:'duckdb',limit:8192}] as const)('$engine: $limit 件の途中で同じ行の指標が分かれても欠落・重複・別世代混入がない',async ({engine,limit})=>{
 const sqlite=engine==='sqlite'?new Database(':memory:'):undefined;
 const duck=engine==='duckdb'?await DuckDBInstance.create(':memory:',{threads:'1'}):undefined;
 const connection=await duck?.connect();
 const all=async(sql:string,args:any[]=[]):Promise<Record<string,unknown>[]>=>{
  if(connection){const rows=(await connection.runAndReadAll(sql.replace(/edinet_text_bytes\((\w+)\)/g,"octet_length(encode(coalesce($1,'')))"),args)).getRowObjects();return rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='bigint'?Number(value):value])))}
  const statement=sqlite!.prepare(sql.replace(/edinet_text_bytes\((\w+)\)/g,"length(CAST(coalesce($1,'') AS BLOB))"));try{return statement.all(...args)}finally{statement.close()}
 };
 try{
  if(connection)await connection.run(financialIndexSqliteSchema.financial_values);else sqlite!.exec(financialIndexSqliteSchema.financial_values);
  const sql='INSERT INTO financial_values VALUES(?,?,?,?,?,?,?,?,?,?)',insert=sqlite?.prepare(sql);
  try{for(const generation of ['g','other'])for(let index=0;index<limit+5;index++){const row=Math.floor(index/3),metric=index%3;
   const values=[generation,row.toString(16).padStart(64,'0'),['a','b','c'][metric],1,row,`${generation}:${row}:${metric}`,'available','selected',null,metric];
   if(!connection)insert!.run(...values);
  }
   // Generate the same fixed records in one native call per generation.
   if(connection)for(const generation of ['g','other'])await connection.run("INSERT INTO financial_values SELECT ?,lpad(lower(to_hex(r)),64,'0'),chr(97+m::INTEGER),1,r,?||':'||r::VARCHAR||':'||m::VARCHAR,'available','selected',NULL,m FROM (SELECT n//3 AS r,n%3 AS m FROM range(?) t(n))",[generation,generation,limit+5]);
  }finally{insert?.close()}
  const expected=await all('SELECT * FROM financial_values WHERE generation=? ORDER BY row_id,metric_id',['g']),actual:Record<string,unknown>[]=[],sizes:number[]=[];
  let after='',metric='';
  for(;;){const query=new FinancialIndexReadQueries(limit).projectionBatch('financial_values','g',financialIndexValueColumns,after,metric);let step=query.next();while(!step.done)step=query.next(await all(step.value.sql,step.value.args));const batch=step.value;if(!batch.length)break;sizes.push(batch.length);actual.push(...batch);after=String(batch.at(-1)!.row_id);metric=String(batch.at(-1)!.metric_id)}
  expect(sizes).toEqual([limit,5]);expect(actual).toHaveLength(limit+5);expect(actual).toEqual(expected);
 }finally{sqlite?.close();connection?.closeSync();duck?.closeSync()}
},30000);

it.each([1000,4096,8192] as const)('%i 件でも64 MiBの容量上限で本文読取キーを絞る',limit=>{
 const query=new FinancialIndexReadQueries(limit).projectionBatch('financial_values','g',financialIndexValueColumns),headers=Array.from({length:limit},(_,i)=>({row_id:i.toString(16).padStart(64,'0'),metric_id:'a',bytes:40*1024*1024}));
 query.next();const request=query.next(headers);expect(request.done).toBe(false);if(request.done)throw Error('Expected bounded read request');expect(request.value.args).toEqual(['g',headers[0].row_id,'a']);
 const row={row_id:headers[0].row_id,metric_id:'a'};expect(query.next([row])).toEqual({done:true,value:[row]});
});

it.each([0,-1,4097,8193,NaN,Infinity,"4096"])("不正なbatch件数 %s を拒否する",limit=>{expect(()=>new FinancialIndexReadQueries(limit as 1000)).toThrow()});
