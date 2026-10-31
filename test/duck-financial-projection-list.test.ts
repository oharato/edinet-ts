import {it,expect} from 'vitest';
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
