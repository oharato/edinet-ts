import {duckFinancialReaderFixture as fixture} from './fixtures/duck-financial-reader';
import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';import {mkdtempSync,rmSync,chmodSync,appendFileSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {DuckDBInstance} from '@duckdb/node-api';
import {DuckFinancialIndexBuild} from '../src/db/duck-financial-index-build';
import {DuckFinancialSearchIndex} from '../src/db/duck-financial-search-index';
import {ObservedFinancialArchive} from '../src/db/observed-financial-archive';
import {ParsedFinancialStore,parsedFinancialMappingVersions} from '../src/db/parsed-financial-store';
import {ParsedFinancialJob} from '../src/db/parsed-financial-job';
import {FinancialIndexBuild} from '../src/db/financial-index-build';
import {FinancialSearchIndex,type FinancialIndexCohort,type FinancialIndexSearchOptions} from '../src/db/financial-search-index';
import {reportingInstance} from './fixtures/financial-reporting-basis';
const cohort=(standard:'J-GAAP'|'IFRS'='J-GAAP'):FinancialIndexCohort=>({generation:'all',group:'details',accountingStandard:standard,scope:'Consolidated',currency:'JPY',period:{startDate:'2025-04-01',endDate:'2026-03-31'},periodType:'annual'});
it('両基準の検索・出典・診断・順序・境界条件がSQLiteと一致',()=>fixture(async({sqlite,duck})=>{
 const cases:FinancialIndexSearchOptions[]=[{metricIds:['costOfSales']},{metricIds:['costOfSales','sellingGeneralAndAdministrativeExpenses'],limit:0},{metricIds:['costOfSales'],limit:1,offset:1},{metricIds:['costOfSales'],offset:100},{metricIds:['costOfSales'],conditions:[{metric:'costOfSales',operator:'gte',value:10}],sortBy:'costOfSales',order:'desc'},{metricIds:['sellingGeneralAndAdministrativeExpenses'],sortBy:'sellingGeneralAndAdministrativeExpenses',order:'asc'}];
 for(const standard of ['J-GAAP','IFRS'] as const)for(const options of cases)expect(await duck.screen(cohort(standard),options)).toEqual(sqlite.screen(cohort(standard),options));
 for(const options of cases)expect(await duck.screen({...cohort('IFRS'),scope:'NonConsolidated'},options)).toEqual(sqlite.screen({...cohort('IFRS'),scope:'NonConsolidated'},options));
 expect(await duck.screen({...cohort(),docIDs:['A1']},{metricIds:['costOfSales']})).toEqual(sqlite.screen({...cohort(),docIDs:['A1']},{metricIds:['costOfSales']}));
 for(const id of ['A3','missing'])await expect(duck.screen({...cohort(),docIDs:[id]},{metricIds:['costOfSales']})).rejects.toThrow();
 const bs:FinancialIndexCohort={...cohort(),group:'balanceSheet',period:{instant:'2026-03-31'},periodType:undefined};expect(await duck.screen(bs,{metricIds:['currentAssets']})).toEqual(sqlite.screen(bs,{metricIds:['currentAssets']}));
}),20000);
it('世代と品質は値・根拠・分類が一致し構築計画由来の指紋だけ異なる',()=>fixture(async({sqlite,duck})=>{
 const actual=await duck.generation('all'),expected=sqlite.generation('all');expect({...actual,assembly:undefined}).toEqual({...expected,assembly:undefined});expect(actual.assembly?.population).toEqual(expected.assembly?.population);
 const {generationSha256:a,...aq}=await duck.quality('all'),{generationSha256:b,...bq}=sqlite.quality('all');expect(aq).toEqual(bq);expect(a).not.toBe(b);
 actual.rows.length=0;expect((await duck.generation('all')).rows).toHaveLength(8);
}));
it('入力不正・存在しない世代を拒否し、失敗後も接続を利用できる',()=>fixture(async({duck})=>{
 for(const options of [{metricIds:[]},{metricIds:['unknown']},{metricIds:['costOfSales'],offset:-1},{metricIds:['costOfSales'],limit:NaN},{metricIds:['costOfSales'],sortBy:'currentAssets'}])await expect(duck.screen(cohort(),options as any)).rejects.toThrow();
 for(const id of ['','missing']){await expect(duck.generation(id)).rejects.toThrow();await expect(duck.quality(id)).rejects.toThrow()}
 expect((await duck.screen(cohort(),{metricIds:['costOfSales']})).total).toBe(1);
}));
it('複数SQLの読取処理を完了してからcloseし、追加処理を拒否',()=>fixture(async({duck})=>{
 const read=duck.quality('all'),closed=duck.close();await expect(duck.generation('all')).rejects.toThrow('closed');expect((await read).rows).toBe(8);await closed;await duck.close();
}));

it('定常検索で全世代監査を再実行せず、世代/品質はSQLなしで検査結果を返す',()=>fixture(async({duck})=>{
 const snapshot=(duck as any).snapshot,original=snapshot.rows.bind(snapshot),sql:string[]=[];snapshot.rows=async(query:string,args:any[])=>{sql.push(query);return original(query,args)};
 const generation=await duck.generation('all'),quality=await duck.quality('all');generation.rows.length=0;quality.values.available=-1;expect((await duck.generation('all')).rows).toHaveLength(8);expect((await duck.quality('all')).values.available).toBeGreaterThan(0);expect(sql).toEqual([]);
 await duck.screen(cohort(),{metricIds:['costOfSales']});expect(sql.length).toBeGreaterThan(0);expect(sql.some(q=>q.includes('financial_generations')||q.includes('octet_length')||q.includes('WHERE generation=? AND (row_id'))).toBe(false);
}));
it.each(['financial_generations','financial_rows','financial_values'])('%sの破損を初回監査で拒否する',async table=>{
 await expect(fixture(async()=>{},async path=>{const db=await DuckDBInstance.create(path,{threads:'1'}),c=await db.connect();try{await c.run(table==='financial_values'?'UPDATE financial_values SET available=1-available':`UPDATE ${table} SET body=body || 'corrupt'`)}finally{c.closeSync();db.closeSync()}})).rejects.toThrow();
});
it('別世代の孤立値を正常なsnapshotに混ぜない',async()=>{
 await expect(fixture(async()=>{},async path=>{const db=await DuckDBInstance.create(path,{threads:'1'}),c=await db.connect();try{await c.run("UPDATE financial_values SET generation='orphan'")}finally{c.closeSync();db.closeSync()}})).rejects.toThrow('outside');
});
it('SQLを使わないcache返却でも私有snapshotの変更を拒否する',()=>fixture(async({duck})=>{
 const file=(duck as any).snapshot.file;chmodSync(file,0o600);appendFileSync(file,'changed');await expect(duck.generation('all')).rejects.toThrow('changed');await expect(duck.quality('all')).rejects.toThrow('changed');await expect(duck.screen(cohort(),{metricIds:['costOfSales']})).rejects.toThrow('changed');
}));

it('64 MiBを超える本文はSQLで長さを調べて展開前に拒否する',async()=>{
 await expect(fixture(async()=>{},async path=>{const db=await DuckDBInstance.create(path,{threads:'1'}),c=await db.connect();try{await c.run("UPDATE financial_rows SET body=repeat('x',67108865) WHERE row_id=(SELECT MIN(row_id) FROM financial_rows)")}finally{c.closeSync();db.closeSync()}})).rejects.toThrow('容量');
},30000);
