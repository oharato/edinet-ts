import {it,expect} from 'vitest';
import {DuckDBInstance} from '@duckdb/node-api';
import {duckFinancialReaderFixture as fixture} from './fixtures/duck-financial-reader';

it.each(['1e999','-1e999'])('SQLite: 欠損値へ%sを入れてもnullと同じhashとして受け入れない',literal=>fixture(async({sqlite})=>{
 expect(sqlite.quality('all').values.missing).toBeGreaterThan(0);
 (sqlite as any).run(`UPDATE financial_values SET numeric_value=${literal} WHERE available=0`);
 expect(()=>sqlite.quality('all')).toThrow('財務数値');
}));

it.each(['NaN','Infinity','-Infinity'])('DuckDB: 欠損値へ%sを入れてもnullと同じhashとして受け入れない',async value=>{
 let mutated=false;
 await expect(fixture(async()=>{},async path=>{
  const db=await DuckDBInstance.create(path,{threads:'1'}),connection=await db.connect();
  try{
   expect(Number((await connection.runAndReadAll('SELECT COUNT(*) AS n FROM financial_values WHERE available=0')).getRowObjects()[0].n)).toBeGreaterThan(0);
   await connection.run('UPDATE financial_values SET numeric_value=CAST(? AS DOUBLE) WHERE available=0',[value]);mutated=true;
  }finally{connection.closeSync();db.closeSync()}
 })).rejects.toThrow('財務数値');
 expect(mutated).toBe(true);
});
