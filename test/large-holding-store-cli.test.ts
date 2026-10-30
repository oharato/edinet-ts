import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {largeDocument} from './fixtures/large-holding-report';

it('CLIで未読込宣言を保存し、原本追記・原本なし検索・不正hashのrollbackを確認する',()=>{
 const dir=mkdtempSync(join(tmpdir(),'holding-store-cli-'));
 const run=(...args:string[])=>spawnSync(process.execPath,['--import','tsx','src/cli.ts',...args],{encoding:'utf8',timeout:30000});
 const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
 try{
  const doc=largeDocument(),db=join(dir,'store.sqlite'),obs=join(dir,'observations.json'),manifest=join(dir,'sources.json');
  const source={docID:doc.metadata.docID,availableAt:doc.metadata.knownAt,sourceSha256:hash(doc.xml),coverContextRef:doc.metadata.coverContextRef};
  writeFileSync(obs,JSON.stringify([{observationId:'first',observedAt:doc.metadata.knownAt,document:doc.metadata}]));writeFileSync(manifest,JSON.stringify([source]));
  let result=run('import-large-holdings','--db',db,'--observations',obs,'--manifest',manifest);expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout).observations).toBe(1);
  const search=()=>run('search-large-holding-store','--db',db,'--cutoff','2026-10-29T00:00:00Z','--duty-date','2025-06-16','--scope','report','--metric','holdingPercent');
  result=search();expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout).unavailableSources[0].reason).toBe('source-not-loaded');
  writeFileSync(obs,'[]');writeFileSync(join(dir,'original.xml'),doc.xml);writeFileSync(manifest,JSON.stringify([{...source,file:'original.xml'}]));
  result=run('import-large-holdings','--db',db,'--observations',obs,'--manifest',manifest);expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout).materializedSnapshots).toBe(1);
  rmSync(join(dir,'original.xml'));const before=hash(readFileSync(db));result=search();expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout).matched).toBe(1);expect(hash(readFileSync(db))).toBe(before);
  writeFileSync(join(dir,'original.xml'),'PRIVATE_INVALID_XML');writeFileSync(manifest,JSON.stringify([{...source,file:'original.xml'}]));result=run('import-large-holdings','--db',db,'--observations',obs,'--manifest',manifest);expect(result.status).toBe(1);expect(result.stderr).not.toContain('PRIVATE_INVALID_XML');expect(hash(readFileSync(db))).toBe(before);
 }finally{rmSync(dir,{recursive:true,force:true})}
},60000);
