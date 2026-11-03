import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {it,expect} from 'vitest';
import {ObservedFinancialArchive} from '../src/index';
import {reportingInstance} from './fixtures/financial-reporting-basis';
it('CLIは取得前計画をreadOnlyで返し、cacheから保存・再開・失敗JSONを返す',()=>{
 const dir=mkdtempSync(join(tmpdir(),'financial-source-cli-'));
 try {
  const file=join(dir,'archive.sqlite'),cache=join(dir,'cache'),a=new ObservedFinancialArchive(file);
  a.append(['A1','A2','A3'].map(docID=>({observationId:docID,observedAt:'2026-06-26T00:00:00Z',document:{docID,parentDocID:null,docTypeCode:'120',edinetCode:'E12345',secCode:'10010',periodStart:'2025-04-01',periodEnd:'2026-03-31',submitDateTime:'2026-06-24 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'}})));a.close();
  for(const id of ['A1','A2','A3']){mkdirSync(join(cache,id),{recursive:true});writeFileSync(join(cache,id,'report.xbrl'),id==='A2'?'broken xml':reportingInstance());}
  const before=readFileSync(file),base=['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli.ts')];
  const run=(args:string[])=>spawnSync(process.execPath,[...base,...args],{cwd:'/tmp',encoding:'utf8',maxBuffer:8*1024*1024});
  const q=['--archive',file,'--cutoff','2026-07-01T00:00:00Z','--edinet-codes','E12345'];
  const plan=run(['plan-financial-source-acquisition',...q]);expect(plan.status,plan.stderr).toBe(0);expect(JSON.parse(plan.stdout).items).toHaveLength(3);expect(readFileSync(file)).toEqual(before);
  const command=['acquire-financial-sources',...q,'--cache',cache,'--limit','1'];
  const first=run(command);expect(first.status,first.stderr).toBe(0);expect(JSON.parse(first.stdout)).toMatchObject({remaining:2,nextAfterDocID:'A1',results:[{docID:'A1',status:'stored'}]});
  const second=run([...command,'--after-doc-id','A1']);expect(second.status).toBe(1);expect(JSON.parse(second.stdout)).toMatchObject({remaining:1,nextAfterDocID:'A2',results:[{docID:'A2',status:'failed'}]});
  const third=run([...command,'--after-doc-id','A2']);expect(third.status,third.stderr).toBe(0);expect(JSON.parse(third.stdout).results[0]).toMatchObject({docID:'A3',status:'stored'});
  writeFileSync(join(cache,'A2','report.xbrl'),reportingInstance());const retry=run(command);expect(retry.status,retry.stderr).toBe(0);expect(JSON.parse(retry.stdout).results.map((r:{docID:string})=>r.docID)).toEqual(['A2']);const done=run(command);expect(done.status).toBe(0);expect(JSON.parse(done.stdout).results).toEqual([]);
  const invalid=run([...command,'--limit','SECRET-FIXTURE']);expect(invalid.status).toBe(1);expect(invalid.stderr).not.toContain('SECRET-FIXTURE');
 } finally {rmSync(dir,{recursive:true,force:true});}
},30000);
