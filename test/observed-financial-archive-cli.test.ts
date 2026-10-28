import {mkdtempSync,writeFileSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {reportingInstance} from './fixtures/financial-reporting-basis';
it('アーカイブCLIは相対原本を保存して再実行・readOnlyで再解析せず、入力不正を非表示で拒否する',()=>{
 const dir=mkdtempSync(join(tmpdir(),'financial-archive-cli-'));try{
  const xml='\ufeff'+reportingInstance({standard:'IFRS'}),db=join(dir,'archive.sqlite');writeFileSync(join(dir,'source.xbrl'),xml);
  const observation={observationId:'A',observedAt:'2026-06-25T00:00:00Z',document:{docID:'A',parentDocID:null,docTypeCode:'120',edinetCode:'E12345',secCode:'10010',periodStart:'2025-04-01',periodEnd:'2026-03-31',submitDateTime:'2026-06-24 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'}};
  writeFileSync(join(dir,'observations.json'),JSON.stringify([observation]));const source={docID:'A',availableAt:'2026-06-26T00:00:00Z',sourceSha256:createHash('sha256').update(xml).digest('hex'),file:'source.xbrl'};writeFileSync(join(dir,'manifest.json'),JSON.stringify([source]));
  const args=['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli.ts'),'archive-financial-snapshots','--db',db,'--cutoff','2026-10-28T00:00:00Z','--extractor-version','cli-test-1'];
  const run=(extra:string[]=[])=>spawnSync(process.execPath,[...args,...extra],{cwd:'/tmp',encoding:'utf8'}),ingest=['--observations',join(dir,'observations.json'),'--manifest',join(dir,'manifest.json')];
  const first=run(ingest);expect(first.status,first.stderr).toBe(0);const a=JSON.parse(first.stdout);expect(a).toMatchObject({appended:{insertedObservations:1,insertedSources:1,insertedContents:1},cache:{hits:0,extracted:1},records:[{result:{accountingStandard:'IFRS',inputXmlSha256:source.sourceSha256}}]});
  const again=run(ingest);expect(again.status,again.stderr).toBe(0);expect(JSON.parse(again.stdout)).toMatchObject({appended:{insertedObservations:0,insertedSources:0,insertedContents:0},cache:{hits:1,extracted:0}});
  const before=readFileSync(db),ro=run(['--read-only']);expect(ro.status,ro.stderr).toBe(0);const b=JSON.parse(ro.stdout);expect(b.records).toEqual(a.records);expect(b.cache).toEqual({hits:1,extracted:0});expect(readFileSync(db)).toEqual(before);
  for(const extra of [['--read-only',...ingest],['--extractor-version',''],['--detail-metrics','SECRET-FIXTURE']]){const bad=run(extra);expect(bad.status).toBe(1);expect(bad.stdout).toBe('');expect(bad.stderr).toContain('入力内容は非表示');expect(bad.stderr).not.toContain('SECRET-FIXTURE');}
  const badDb=join(dir,'must-not-exist.sqlite');writeFileSync(join(dir,'manifest.json'),JSON.stringify([{...source,sourceSha256:'0'.repeat(64)}]));expect(run(['--db',badDb,...ingest]).status).toBe(1);expect(existsSync(badDb)).toBe(false);
 }finally{rmSync(dir,{recursive:true,force:true});}
},30000);
