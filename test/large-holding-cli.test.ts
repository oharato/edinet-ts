import {createHash} from "node:crypto";
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {it,expect} from 'vitest';
import {largeDocument} from './fixtures/large-holding-report';
it('一次大量保有CLIは相対原本を読み、集計範囲と観測時点を保持する',()=>{
 const dir=mkdtempSync(join(tmpdir(),'large-cli-'));try{
  const {xml,...rest}=largeDocument({two:true});writeFileSync(join(dir,'source.xbrl'),'\ufeff'+xml);writeFileSync(join(dir,'manifest.json'),JSON.stringify([{file:'source.xbrl',...rest}]));
  const args=['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli.ts'),'screen-large-holdings','--manifest',join(dir,'manifest.json'),'--cutoff','2026-10-28T00:00:00Z','--duty-date','2025-06-16','--scope','report','--metric','holdingPercent'];
  const run=(extra:string[])=>spawnSync(process.execPath,[...args,...extra],{cwd:'/tmp',encoding:'utf8'});
  const r=run(['--condition','{"operator":"gte","value":5}']);expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({matched:1,rows:[{row:{role:'reported-aggregate',values:{holdingPercent:{decimal:'5.0500',valueUnit:'percent'}}}}]});
  expect(JSON.parse(r.stdout).reports[0].inputXmlSha256).toBe(createHash('sha256').update('\ufeff'+xml).digest('hex'));
  for(const extra of [['--condition','null'],['--offset','-1'],['--condition','{"operator":"eq","value":"SECRET-FIXTURE"}']]){const bad=run(extra);expect(bad.status).toBe(1);expect(bad.stdout).toBe('');expect(bad.stderr).toContain('入力内容は非表示');expect(bad.stderr).not.toContain('SECRET-FIXTURE');}
 }finally{rmSync(dir,{recursive:true,force:true});}
},30000);

it('観測付きCLIは訂正を選び、欠落時は旧版へ戻らず、未来原本を読み込まない',()=>{
 const dir=mkdtempSync(join(tmpdir(),'large-observed-cli-'));try{
  const a=largeDocument({docID:'ORIGINAL'}),b=largeDocument({docID:'CORRECTED',correction:true});
  writeFileSync(join(dir,'source.xbrl'),'\ufeff'+b.xml);
  writeFileSync(join(dir,'observations.json'),JSON.stringify([a,b].map(d=>({observationId:d.metadata.docID,observedAt:d.metadata.knownAt,document:d.metadata}))));
  const entries=[a,b].map(d=>({file:d===a?'missing-parent.xbrl':'source.xbrl',docID:d.metadata.docID,availableAt:d.metadata.knownAt,sourceSha256:createHash('sha256').update('\ufeff'+d.xml).digest('hex'),coverContextRef:'cover'}));
  const run=()=>spawnSync(process.execPath,['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli.ts'),'screen-large-holdings','--manifest',join(dir,'manifest.json'),'--observations',join(dir,'observations.json'),'--cutoff','2026-10-28T00:00:00Z','--duty-date','2025-06-16','--scope','report','--metric','holdingPercent'],{cwd:'/tmp',encoding:'utf8'});
  writeFileSync(join(dir,'manifest.json'),JSON.stringify(entries));let r=run();expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({matched:1,unavailableSources:[],selection:{selected:[{observation:{document:{docID:'CORRECTED'}}}]}});
  entries[1].availableAt='2026-10-29T00:00:00Z';entries[1].file='missing-future.xbrl';writeFileSync(join(dir,'manifest.json'),JSON.stringify(entries));r=run();expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({matched:0,unavailableSources:[{reason:'not-available-at-cutoff'}]});
  entries[1].availableAt=b.metadata.knownAt;writeFileSync(join(dir,'manifest.json'),JSON.stringify(entries));r=run();expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({matched:0,unavailableSources:[{reason:'source-not-loaded'}]});
 }finally{rmSync(dir,{recursive:true,force:true});}
},30000);
