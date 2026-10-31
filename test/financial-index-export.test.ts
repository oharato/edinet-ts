import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,renameSync,rmSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {it,expect} from 'vitest';
import {ObservedFinancialArchive,FinancialIndexBuild,FinancialSearchIndex,FinancialIndexPublication,PublishedFinancialIndex} from '../src/index';
import {reportingInstance} from './fixtures/financial-reporting-basis';
const cohort={group:'details' as const,accountingStandard:'J-GAAP' as const,scope:'Consolidated' as const,currency:'JPY' as const,period:{startDate:'2025-04-01',endDate:'2026-03-31'},periodType:'annual' as const};
const query={metricIds:['costOfSales'] as const};
function fixture(fn:(s:ReturnType<typeof setup>)=>void,transform=(xml:string)=>xml){const s=setup(transform);try{fn(s)}finally{s.close()}}
function setup(transform=(xml:string)=>xml){
 const dir=mkdtempSync(join(tmpdir(),'index-export-')),indexPath=join(dir,'build-index.sqlite'),statePath=join(dir,'build.sqlite'),index=new FinancialSearchIndex(indexPath),state=new FinancialIndexBuild(statePath),archivePath=join(dir,'archive.sqlite'),archive=new ObservedFinancialArchive(archivePath);
 const xml=transform(reportingInstance());archive.append([{observationId:'A',observedAt:'2026-06-26T00:00:00Z',document:{docID:'A',parentDocID:null,docTypeCode:'120',edinetCode:'E12345',secCode:'10010',periodStart:'2025-04-01',periodEnd:'2026-03-31',submitDateTime:'2026-06-24 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'}}],[{docID:'A',xml,availableAt:'2026-06-27T00:00:00Z',sourceSha256:createHash('sha256').update(xml).digest('hex')}]);
 archive.close();
 const source=new ObservedFinancialArchive(archivePath,{readOnly:true});
 const inputs=['old','next'].map(id=>({id,generation:id,archiveSha256:source.snapshotSha256(),population:{asOf:'2026-06-26',observedAt:'2026-06-26T12:00:00Z',source:'fixture',sourceSha256:'a'.repeat(64),edinetCodes:['E12345']},options:{cutoff:'2026-06-27T12:00:00Z',extractorVersion:'export-test'}}));
 for(const input of inputs){state.begin(input);state.runNext(input.id,source,index);state.finish(input.id,index)}
 return {dir,indexPath,statePath,index,state,source,close(){source.close();state.close();index.close();rmSync(dir,{recursive:true,force:true})}};
}
it('集約だけを同一hash/品質で出力し、元checkpoint再開・既存reader・旧世代切戻しを保持する',()=>fixture(s=>{
 const beforeIndex=readFileSync(s.indexPath),beforeState=readFileSync(s.statePath),source=new FinancialSearchIndex(s.indexPath,{readOnly:true}),path=join(s.dir,'reader.sqlite'),nextPath=join(s.dir,'next.sqlite'),oldPath=join(s.dir,'old.sqlite');
 const target=new FinancialSearchIndex(path),next=new FinancialSearchIndex(nextPath),catalogPath=join(s.dir,'catalog.sqlite'),catalog=new FinancialIndexPublication(catalogPath);
 try{
  expect(source.exportGenerationTo('old',target)).toEqual(source.generation('old'));source.exportGenerationTo('next',next);
  for(const [id,index] of [['old',target],['next',next]] as const){expect(index.quality(id)).toEqual(source.quality(id));expect(index.screen({...cohort,generation:id},query)).toEqual(source.screen({...cohort,generation:id},query));const part=source.generation(id).assembly!.parts[0].id;expect(()=>index.generation(part)).toThrow('未収録');}
  expect(statSync(path).size).toBeLessThan(statSync(s.indexPath).size);
  const old=catalog.prepare('old',target,'old');expect(old).toEqual(catalog.prepare('old',source,'old'));catalog.activate('old',target,{expectedActive:null});catalog.prepare('next',next,'next');
  const reader=new PublishedFinancialIndex(catalogPath,path);
  try{expect(reader.screen(cohort,query).rows).toEqual(target.screen({...cohort,generation:'old'},query).rows);target.close();next.close();renameSync(path,oldPath);renameSync(nextPath,path);
   const nextRead=new FinancialSearchIndex(path,{readOnly:true});try{catalog.activate('next',nextRead,{expectedActive:'old'})}finally{nextRead.close()}
   expect(reader.reload().generation).toBe('next');renameSync(path,nextPath);renameSync(oldPath,path);
   const oldRead=new FinancialSearchIndex(path,{readOnly:true});try{catalog.activate('old',oldRead,{expectedActive:'next'})}finally{oldRead.close()}
   expect(reader.reload().generation).toBe('old');expect(reader.quality()).toEqual(source.quality('old'));
  }finally{reader.close()}
  expect(s.state.runNext('old',s.source,s.index)).toMatchObject({finished:true,completed:1});expect(s.state.finish('old',s.index)).toEqual(source.generation('old'));
  expect(readFileSync(s.indexPath)).toEqual(beforeIndex);expect(readFileSync(s.statePath)).toEqual(beforeState);
 }finally{catalog.close();next.close();target.close();source.close()}
}));
it('会社別世代・同一DB・既存内容のある転送先・readOnly転送先を拒否する',()=>fixture(s=>{
 const empty=new FinancialSearchIndex(':memory:'),nonempty=new FinancialSearchIndex(':memory:');s.index.exportGenerationTo('old',nonempty);
 try{
  const part=s.index.generation('old').assembly!.parts[0].id;expect(()=>s.index.exportGenerationTo(part,empty)).toThrow('集約');expect(()=>s.index.exportGenerationTo('old',s.index)).toThrow('別');
  const before=nonempty.generation('old');expect(()=>s.index.exportGenerationTo('next',nonempty)).toThrow('空');expect(nonempty.generation('old')).toEqual(before);
  const path=join(s.dir,'readonly.sqlite'),writer=new FinancialSearchIndex(path);writer.close();const ro=new FinancialSearchIndex(path,{readOnly:true});try{expect(()=>s.index.exportGenerationTo('old',ro)).toThrow('readOnly')}finally{ro.close()}
 }finally{empty.close();nonempty.close()}
}));
it('転送途中の失敗は転送先の世代・行・値を全てrollbackし、同じ空DBで再試行できる',()=>fixture(s=>{
 const target=new FinancialSearchIndex(':memory:'),raw=target as unknown as {run:(sql:string,args?:unknown[])=>void},run=raw.run;let writes=0;
 raw.run=function(sql,args){if(sql.startsWith('INSERT INTO financial_values')&&++writes===2)throw Error('transfer interrupted');return run.call(target,sql,args)};
 try{expect(()=>s.index.exportGenerationTo('old',target)).toThrow('interrupted');expect(()=>target.generation('old')).toThrow('未収録');raw.run=run;expect(s.index.exportGenerationTo('old',target)).toEqual(s.index.generation('old'));expect(target.quality('old')).toEqual(s.index.quality('old'))}finally{raw.run=run;target.close()}
}));
it('元本文の破損を正常な索引で隠して転送しない',()=>fixture(s=>{
 const target=new FinancialSearchIndex(':memory:'),raw=s.index as unknown as {run:(sql:string)=>void};raw.run("UPDATE financial_rows SET body='corrupt' WHERE generation='old'");
 try{expect(()=>s.index.exportGenerationTo('old',target)).toThrow('本文');expect(()=>target.generation('old')).toThrow('未収録')}finally{target.close()}
}));

it.each(['missing','ambiguous','unsafe-number'] as const)('%sの診断・原値・証跡も利用側DBへ保持する',kind=>fixture(s=>{
 const target=new FinancialSearchIndex(':memory:');try{s.index.exportGenerationTo('old',target);expect(target.quality('old')).toEqual(s.index.quality('old'));expect(target.screen({...cohort,generation:'old'},query)).toEqual(s.index.screen({...cohort,generation:'old'},query));expect(target.screen({...cohort,generation:'old'},query).reasonCounts[kind]).toBe(1)}finally{target.close()}
},xml=>{const tag='<jppfs_cor:CostOfSales contextRef="arbitrary-duration" unitRef="money" decimals="0">10</jppfs_cor:CostOfSales>';return xml.replace(tag,kind==='missing'?'':kind==='ambiguous'?tag+tag.replace('>10<','>11<'):tag.replace('>10<','>9007199254740993<'))}));
