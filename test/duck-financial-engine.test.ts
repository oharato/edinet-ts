import {it,expect,vi} from 'vitest';
import {assertDuckFinancialEngine,DuckFinancialIndexBuild,type DuckFinancialConnection} from '../src/db/duck-financial-index-build';
it.each(['v1.5.3','v2.1.0',undefined])('実エンジン%sを構築の書込開始前に拒否する',async version=>{
 const run=vi.fn(),read=vi.fn(async()=>({getRowObjects:()=>[{edinet_engine_version:version}]})),connection={run,runAndReadAll:read} as DuckFinancialConnection;
 const input={id:'engine-guard',generation:'g',archiveSha256:'a'.repeat(64),population:{asOf:'2026-06-30',observedAt:'2026-06-30T00:00:00Z',source:'synthetic-engine-guard',sourceSha256:'b'.repeat(64),edinetCodes:['E12345']},options:{cutoff:'2026-07-01T00:00:00Z',extractorVersion:'test',sourceCommit:'c'.repeat(40)}};
 await expect(new DuckFinancialIndexBuild(connection).begin(input,'a'.repeat(64))).rejects.toThrow('separate process');await expect(new DuckFinancialIndexBuild(connection).progress('existing')).rejects.toThrow('separate process');expect(run).not.toHaveBeenCalled();expect(read).toHaveBeenCalledWith('SELECT version() AS edinet_engine_version');
});
it('固定した2.0.0のみ認め、不正なversion応答も拒否する',async()=>{
 const connection=(rows:Record<string,unknown>[])=>({run:async()=>{},runAndReadAll:async()=>({getRowObjects:()=>rows})});await expect(assertDuckFinancialEngine(connection([{edinet_engine_version:'v2.0.0'}]))).resolves.toBeUndefined();await expect(assertDuckFinancialEngine(connection([]))).rejects.toThrow('engine required');
});
