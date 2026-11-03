import {it,expect} from 'vitest';
import {DuckFinancialIndexBuild} from '../src/db/duck-financial-index-build';
import {FINANCIAL_VERSION_POLICY} from '../src/financial-version-selection';
it('未対応のDuckDB構築へ金融版planを渡してもDBへ接続・書込みしない',async()=>{
 let calls=0;
 const connection={async run(){calls++;return undefined},async runAndReadAll(){calls++;return {getRowObjects:()=>[]}}};
 const build=new DuckFinancialIndexBuild(connection);
 const input={id:'unsupported-source-backed-duck',generation:'g',archiveSha256:'a'.repeat(64),population:{asOf:'2026-06-30',observedAt:'2026-06-30T00:00:00Z',source:'synthetic-boundary',sourceSha256:'b'.repeat(64),edinetCodes:['E12345']},options:{cutoff:'2026-07-01T00:00:00Z',extractorVersion:'test',sourceCommit:'c'.repeat(40),financialVersion:{policy:FINANCIAL_VERSION_POLICY,evidenceManifestSha256:'d'.repeat(64),proofSha256:'e'.repeat(64)}}};
 await expect(build.begin(input,'f'.repeat(64))).rejects.toThrow('does not support financial version');
 expect(calls).toBe(0);
});
