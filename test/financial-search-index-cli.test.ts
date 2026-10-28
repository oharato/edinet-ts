import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {ObservedFinancialArchive} from '../src/index';
import {reportingInstance} from './fixtures/financial-reporting-basis';
it('CLIは原本アーカイブを変えず固定世代を作り、原本なしでもSQL検索し不正入力を非表示で拒否する',()=>{
 const dir=mkdtempSync(join(tmpdir(),'financial-index-cli-'));try{
  const archivePath=join(dir,'archive.sqlite'),indexPath=join(dir,'index.sqlite'),cohortPath=join(dir,'cohort.json'),xml=reportingInstance(),archive=new ObservedFinancialArchive(archivePath);
  archive.append([{observationId:'A',observedAt:'2026-06-26T00:00:00Z',document:{docID:'A',parentDocID:null,docTypeCode:'120',edinetCode:'E12345',secCode:'10010',periodStart:'2025-04-01',periodEnd:'2026-03-31',submitDateTime:'2026-06-24 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'}}],[{docID:'A',availableAt:'2026-06-27T00:00:00Z',sourceSha256:createHash('sha256').update(xml).digest('hex'),xml}]);archive.close();const before=readFileSync(archivePath);
  const base=['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli.ts')],run=(args:string[])=>spawnSync(process.execPath,[...base,...args],{cwd:'/tmp',encoding:'utf8'}),build=['index-financial-snapshots','--archive',archivePath,'--db',indexPath,'--generation','g1','--cutoff','2026-10-28T00:00:00Z','--extractor-version','cli-1'];
  const first=run(build);expect(first.status,first.stderr).toBe(0);expect(JSON.parse(first.stdout)).toMatchObject({id:'g1',rows:expect.any(Array)});expect(JSON.parse(first.stdout).rows).toHaveLength(2);const again=run(build);expect(again.status,again.stderr).toBe(0);expect(JSON.parse(again.stdout)).toEqual(JSON.parse(first.stdout));expect(readFileSync(archivePath)).toEqual(before);rmSync(archivePath);
  writeFileSync(cohortPath,JSON.stringify({generation:'g1',group:'details',accountingStandard:'J-GAAP',scope:'Consolidated',currency:'JPY',period:{startDate:'2025-04-01',endDate:'2026-03-31'},periodType:'annual'}));const args=['screen-financial-index','--db',indexPath,'--cohort',cohortPath,'--metrics','costOfSales,sellingGeneralAndAdministrativeExpenses'];
  const found=run([...args,'--conditions','[{"metric":"costOfSales","operator":"gte","value":10}]','--sort-by','costOfSales','--limit','1']);expect(found.status,found.stderr).toBe(0);expect(JSON.parse(found.stdout)).toMatchObject({total:1,rows:[{snapshot:{selections:{costOfSales:{raw:'10'}}}}]});
  for(const extra of [['--metrics','SECRET-FIXTURE'],['--offset','-1'],['--conditions','bad']]){const bad=run([...args,...extra]);expect(bad.status).toBe(1);expect(bad.stdout).toBe('');expect(bad.stderr).toContain('入力内容は非表示');expect(bad.stderr).not.toContain('SECRET-FIXTURE');}
  const invalidDb=join(dir,'not-created.sqlite'),badBuild=run([...build,'--db',invalidDb,'--generation','invalid/generation']);expect(badBuild.status).toBe(1);expect(existsSync(invalidDb)).toBe(false);
 }finally{rmSync(dir,{recursive:true,force:true});}
},30000);
