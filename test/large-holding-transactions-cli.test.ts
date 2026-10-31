import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync,truncateSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {largeDocument} from './fixtures/large-holding-report';
import {searchLargeHoldingTransactions} from '../src/large-holding-transactions';
it('取引CLIは別cwdからAPIと一致し、不正条件・原本・訂正系列を拒否する',()=>{
 const dir=mkdtempSync(join(tmpdir(),'holding-transactions-cli-'));
 try {
  const doc=largeDocument(),tag='DetailsOfAcquisitionsAndDisposalsOfStocksEtcIssuedByIssuerOfSaidStocksEtcDuringLast60DaysTextBlock';
  const table='<table><tr>'+['年月日','株券等の種類','数量','割合','市場内外取引の別','取得又は処分の別','単価'].map(x=>`<td>${x}</td>`).join('')+'</tr><tr>'+['2025年4月23日','普通株式','100','0.00','市場内','取得',''].map(x=>`<td>${x}</td>`).join('')+'</tr></table>';
  doc.xml=doc.xml.replace('</xbrli:xbrl>',`<j:${tag} contextRef="holder1">${table.replaceAll('<','&lt;').replaceAll('>','&gt;')}</j:${tag}></xbrli:xbrl>`);
  writeFileSync(join(dir,'source.xbrl'),doc.xml);
  const entry={file:'source.xbrl',metadata:doc.metadata},manifest=join(dir,'manifest.json');
  writeFileSync(manifest,JSON.stringify([entry]));
  const run=(...extra:string[])=>spawnSync(process.execPath,['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli.ts'),'screen-large-holding-transactions','--manifest',manifest,'--cutoff','2026-10-29T00:00:00Z',...extra],{cwd:'/tmp',encoding:'utf8',timeout:30000});
  const good=run('--action','acquisition','--pretty');expect(good.status,good.stderr).toBe(0);
  const expected=searchLargeHoldingTransactions([doc],{cutoff:'2026-10-29T00:00:00Z',action:'acquisition'});
  expect(expected.matched).toBe(1);expect(JSON.parse(good.stdout)).toEqual(expected);
  expect(JSON.parse(run('--action','disposal').stdout).matched).toBe(0);
  for(const args of [['--limit','1.5'],['--reported-start-date','2025-02-30'],['--instrument','unknown']]){const r=run(...args);expect(r.status).toBe(1);expect(r.stdout).toBe('');expect(r.stderr).not.toContain(doc.xml);}
  writeFileSync(manifest,JSON.stringify([entry,entry]));expect(run().status).toBe(1);
  const leaf=largeDocument({docID:'CORRECTION',correction:true});
  writeFileSync(manifest,JSON.stringify([{...entry,metadata:{...doc.metadata,docID:'ORIGINAL'}},{...entry,metadata:leaf.metadata}]));expect(run().status).toBe(1);
  writeFileSync(manifest,JSON.stringify([{...entry,secret:'do-not-print'}]));const invalid=run();expect(invalid.status).toBe(1);expect(invalid.stderr).not.toContain('do-not-print');
  writeFileSync(manifest,JSON.stringify([entry]));writeFileSync(join(dir,'source.xbrl'),Buffer.from([0xff]));expect(run().status).toBe(1);
  truncateSync(join(dir,'source.xbrl'),2*1024*1024+1);expect(run().status).toBe(1);
 }finally{rmSync(dir,{recursive:true,force:true});}
},60000);
