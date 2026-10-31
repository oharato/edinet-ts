import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {it,expect,vi} from 'vitest';import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {EdinetRepository,ObservedFinancialArchive,FinancialIndexPublication} from '../dist/index.js';
import {prepareFinancialCycle} from '../scripts/roadmap/prepare-financial-cycle.mjs';
import {acquirePreparedFinancialCycle} from '../scripts/roadmap/acquire-financial-cycle.mjs';
import {buildReconstructedDuckFinancialCycle} from '../scripts/roadmap/build-duck-financial-cycle.mjs';
import {sha256,atomicJSON} from '../scripts/roadmap/operational-files.mjs';
import {reportingInstance} from './fixtures/financial-reporting-basis';
it.each([false,true])('日次完了記録=%sで取得・再構築からDuckDBへ接続し、同じ世代を再開する',async withOrigin=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-30T01:00:00Z'));
 const dir=mkdtempSync(join(tmpdir(),'acquired-duck-real-')),metadataPath=join(dir,'metadata.sqlite'),sourceArchivePath=join(dir,'pool.sqlite'),repo=new EdinetRepository(metadataPath),pool=new ObservedFinancialArchive(sourceArchivePath);
 try{
  repo.saveDocumentList([{docID:'A0',edinetCode:'E12345',secCode:'10010',docTypeCode:'120',submitDateTime:'2026-09-01 09:00',periodStart:'2025-04-01',periodEnd:'2026-03-31',withdrawalStatus:'0',docInfoEditStatus:'0',disclosureStatus:'0',xbrlFlag:'1'}],'2026-09-01');
  const xml=reportingInstance({standard:'Japan GAAP'});pool.append([],[{docID:'A0',availableAt:'2026-10-01T00:00:00Z',sourceSha256:sha256(xml),xml}]);pool.close();
  const archive=new ObservedFinancialArchive(sourceArchivePath,{readOnly:true}),sourceArchiveSha256=archive.snapshotSha256();archive.close();const before=readFileSync(sourceArchivePath);
  const config:any={version:1,metadataPath,sourceArchivePath,sourceArchiveSha256,sourceId:'acquired-duck-test',throughSequence:1,availableBy:'2026-10-30T02:00:00Z',outputDirectory:join(dir,'candidate'),input:{id:'acquired-duck-test',cutoff:'2026-10-30T02:00:00Z',population:{asOf:'2026-10-29',observedAt:'2026-10-29T01:00:00Z',source:'https://example.test/master.csv',sourceSha256:'a'.repeat(64),edinetCodes:['E12345']}}};
  if(withOrigin){config.metadataCheckpointPath=join(dir,'daily-completion.json');atomicJSON(config.metadataCheckpointPath,{version:1,metadataPath,sourceId:config.sourceId,seedSha256:'b'.repeat(64),checkpoint:{version:3,throughDate:'2026-10-29',completedDay:'2026-10-30',budget:{date:'2026-10-30',requests:8},notices:{afterSequence:1,seen:[],pending:[],unresolved:[]},lastCompletedRun:{startDate:'2026-10-23',endDate:'2026-10-29',refreshAfter:'2026-10-30T01:00:00.000Z',probe:{date:'2026-10-30',observedAt:'2026-10-30T01:00:00.000Z',documents:0,sha256:'c'.repeat(64)},throughSequence:1,closedThrough:'2026-10-29',completedAt:'2026-10-30T01:00:00.000Z',unresolvedNotices:0}}},{createOnly:true})}
  vi.setSystemTime(new Date('2026-10-30T03:00:00Z'));await prepareFinancialCycle(config);await acquirePreparedFinancialCycle(config,{fetchXbrl:async()=>xml});
  const options={parsedStorePath:join(dir,'parsed.sqlite'),sourceCommit:'a'.repeat(40),maxDocuments:1,maxCompanies:1};
  const result=await buildReconstructedDuckFinancialCycle(config,options);expect(result.status).toBe('built');expect(result).toMatchObject({metadataCurrentForCutoff:withOrigin,publicationEligible:false,financialValuesValidated:false});expect(result.publicationBlockers.includes('metadata-current-unverified')).toBe(!withOrigin);
  const again=await buildReconstructedDuckFinancialCycle(config,options);expect(again).toEqual(result);expect(readFileSync(sourceArchivePath)).toEqual(before);
  const file=join(dir,'config.json');writeFileSync(file,JSON.stringify(config));const args=[resolve('scripts/roadmap/run-acquired-duck-financial-cycle.mjs'),'--config',file,'--parsed-store',options.parsedStorePath,'--source-commit',options.sourceCommit];
  const cli=spawnSync(process.execPath,args,{encoding:'utf8',timeout:30000});expect(cli.status,cli.stderr).toBe(0);expect(JSON.parse(cli.stdout)).toEqual(result);
  const verified=spawnSync(process.execPath,[...args,'--verify'],{encoding:'utf8',timeout:30000});expect(verified.status,verified.stderr).toBe(0);expect(JSON.parse(verified.stdout).financialValuesValidated).toBe(true);
  const catalogPath=join(dir,'official.sqlite'),publishArgs=[...args,'--publish','--catalog',catalogPath,'--expected-active','null'];
  const published=spawnSync(process.execPath,publishArgs,{encoding:'utf8',timeout:30000});expect(published.status,published.stderr).toBe(withOrigin?0:1);expect(JSON.parse(published.stdout).status).toBe(withOrigin?'published':'publication-blocked');
  if(withOrigin){const stale=spawnSync(process.execPath,publishArgs,{encoding:'utf8',timeout:30000});expect(stale.status).toBe(1);const official=new FinancialIndexPublication(catalogPath,{readOnly:true});try{expect(official.history()).toHaveLength(1);expect(official.current()?.id).toBe(result.publicationCandidate.id)}finally{official.close()}}
  const catalogBusy=spawnSync('/usr/bin/flock',['--no-fork','-n',catalogPath+'.lock',process.execPath,...publishArgs],{encoding:'utf8',timeout:30000});expect(catalogBusy.status,catalogBusy.stderr).toBe(75);

  const locks=[config.outputDirectory+'.lock',join(config.outputDirectory,'duckdb.lock'),options.parsedStorePath+'.lock',...withOrigin?[config.metadataCheckpointPath+'.lock']:[]];
  for(const lock of locks){const busy=spawnSync('/usr/bin/flock',['--no-fork','-n',lock,process.execPath,...args],{encoding:'utf8',timeout:30000});expect(busy.status,busy.stderr).toBe(75);expect(busy.stdout).toBe('')}

 }finally{repo.close();pool.close();rmSync(dir,{recursive:true,force:true});vi.useRealTimers()}
},120000);
