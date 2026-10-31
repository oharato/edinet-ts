import {it,expect} from 'vitest';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {ObservedFinancialArchive} from '../src/db/observed-financial-archive';
import {FinancialSearchIndex,financialIndexBuildPartId,financialIndexGenerationSha256} from '../src/db/financial-search-index';
import {FinancialIndexBuild,normalizeFinancialIndexBuildInput,type FinancialIndexBuildInput} from '../src/db/financial-index-build';
import {FinancialIndexPublication} from '../src/db/financial-index-publication';
import {authenticateFinancialVersionEvidence,readFinancialVersionProof,FINANCIAL_VERSION_POLICY} from '../src/financial-version-selection';
import {financialVersionEvidenceFixture,signFinancialVersionBundle} from './fixtures/financial-version-evidence';
const canonical=(v:any):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
async function setup(){
 const dir=mkdtempSync(join(tmpdir(),'financial-version-build-')),sourcePath=join(dir,'archive.sqlite'),indexPath=join(dir,'index.sqlite'),statePath=join(dir,'build.sqlite');
 const bundle=await financialVersionEvidenceFixture(),context=await authenticateFinancialVersionEvidence(bundle),binding={bundle,context},proof=readFinancialVersionProof(context);
 const writer=new ObservedFinancialArchive(sourcePath);writer.append(bundle.observations,bundle.sources);writer.close();
 const source=new ObservedFinancialArchive(sourcePath,{readOnly:true}),index=new FinancialSearchIndex(indexPath);let state=new FinancialIndexBuild(statePath);
 const input:FinancialIndexBuildInput={id:'build',generation:'all',archiveSha256:source.snapshotSha256(),population:{asOf:'2026-06-29',observedAt:bundle.cutoff,source:'fixture',sourceSha256:'a'.repeat(64),edinetCodes:['E12345']},options:{cutoff:bundle.cutoff,extractorVersion:'financial-version-build-test',financialVersion:{policy:FINANCIAL_VERSION_POLICY,evidenceManifestSha256:bundle.evidenceManifestSha256,proofSha256:proof.sha256}}};
 return {dir,sourcePath,indexPath,statePath,source,index,input,binding,proof,get state(){return state},reopen(){state.close();state=new FinancialIndexBuild(statePath)},close(){state.close();index.close();source.close();rmSync(dir,{recursive:true,force:true})}};
}
it('v2固定計画/parts/再open/progress/finishまで3pinと原本を保持する',async()=>{
 const s=await setup();try{
  const archiveBefore=sha(readFileSync(s.sourcePath)),p=s.state.begin(s.input);
  expect(p.plan).toMatchObject({indexVersion:'2',options:{financialVersion:s.input.options.financialVersion},provenance:{financialVersion:s.input.options.financialVersion}});
  expect(p.tasks[0]).toMatchObject({attempts:0,partID:financialIndexBuildPartId(p.planSha256,'E12345')});
  expect(()=>s.state.finish('build',s.index)).toThrow('全件');
  expect(s.state.runNext('build',s.source,s.index,{limit:1,financialVersion:s.binding})).toMatchObject({completed:1,pending:0,failed:0,rowCount:2});
  s.reopen();const report=s.state.finish('build',s.index);expect(report).toMatchObject({indexVersion:'2',financialVersionProof:s.proof,provenance:{financialVersion:s.input.options.financialVersion}});
  expect(s.state.progress('build')).toMatchObject({finished:true,generationSha256:financialIndexGenerationSha256(report)});expect(s.state.finish('build',s.index)).toEqual(report);
  expect(s.state.runNext('build',s.source,s.index,{financialVersion:s.binding}).finished).toBe(true);expect(sha(readFileSync(s.sourcePath))).toBe(archiveBefore);
 }finally{s.close()}
});
it.each(['missing','clone-context','clone-binding','wrong-context','wrong-manifest','wrong-proof','wrong-cutoff','mutated-source'])('不正runtime %sを会社attempt0で拒否する',async field=>{
 const s=await setup();try{
  const input=structuredClone(s.input);
  let binding:any=s.binding;
  if(field==='missing')binding=undefined;
  if(field==='clone-context')binding={...s.binding,context:JSON.parse(JSON.stringify(s.binding.context))};
  if(field==='clone-binding')binding=JSON.parse(JSON.stringify(s.binding));
  if(field==='wrong-context')binding={...s.binding,context:{}};
  if(field==='wrong-manifest')input.options.financialVersion!.evidenceManifestSha256='b'.repeat(64);
  if(field==='wrong-proof')input.options.financialVersion!.proofSha256='c'.repeat(64);
  if(field==='wrong-cutoff')input.options.cutoff='2026-07-01T00:00:00Z';
  if(field==='mutated-source'){const bundle=structuredClone(s.binding.bundle);bundle.sources[0].xml+=' ';binding={context:s.binding.context,bundle};}
  s.state.begin(input);expect(()=>s.state.runNext('build',s.source,s.index,{financialVersion:binding})).toThrow();
  expect(s.state.progress('build')).toMatchObject({completed:0,pending:1,failed:0,tasks:[{attempts:0,status:'pending'}]});
 }finally{s.close()}
});
it('別の認証済proof/原本へ再開せず、v1計画へruntimeを混ぜない',async()=>{
 const s=await setup();try{
  s.state.begin(s.input);
  const bundle=signFinancialVersionBundle({...s.binding.bundle,evidence:[]}),other={bundle,context:await authenticateFinancialVersionEvidence(bundle)};
  expect(()=>s.state.runNext('build',s.source,s.index,{financialVersion:other})).toThrow('不一致');
  const writable=new ObservedFinancialArchive(s.sourcePath);writable.append([{observationId:'extra',observedAt:s.input.options.cutoff,document:{docID:'EXTRA',docTypeCode:'180'}}]);writable.close();
  const changed=new ObservedFinancialArchive(s.sourcePath,{readOnly:true});try{expect(()=>s.state.runNext('build',changed,s.index,{financialVersion:s.binding})).toThrow('指紋')}finally{changed.close()}
  expect(s.state.progress('build').tasks[0].attempts).toBe(0);
  const {financialVersion,...ordinary}=s.input.options;s.state.begin({...s.input,id:'v1',generation:'v1',options:ordinary});
  expect(()=>s.state.runNext('v1',s.source,s.index,{financialVersion:s.binding})).toThrow('通常');expect(s.state.progress('v1').tasks[0].attempts).toBe(0);
 }finally{s.close()}
});
it('policy/manifest/proofの固定指紋を計画に含め、欠落/未知policy/上書きを拒否する',async()=>{
 const s=await setup();try{
  const base=normalizeFinancialIndexBuildInput(s.input),first=sha(canonical(base));
  for(const key of ['evidenceManifestSha256','proofSha256'] as const){const changed=structuredClone(s.input);changed.options.financialVersion![key]='d'.repeat(64);expect(sha(canonical(normalizeFinancialIndexBuildInput(changed)))).not.toBe(first)}
  s.state.begin(s.input);
  for(const key of ['policy','evidenceManifestSha256','proofSha256']){
   const missing:any=structuredClone(s.input);delete missing.options.financialVersion[key];expect(()=>normalizeFinancialIndexBuildInput(missing)).toThrow();
   const changed:any=structuredClone(s.input);changed.options.financialVersion[key]=key==='policy'?'unknown':'e'.repeat(64);expect(()=>s.state.begin(changed)).toThrow();
  }
 }finally{s.close()}
});
it('v2 transient失敗は秘匿し、正規contextで再試行しreadOnly状態を保護する',async()=>{
 const s=await setup();try{
  s.state.begin(s.input);const materialize=s.index.materializeSourceBacked.bind(s.index);s.index.materializeSourceBacked=()=>{throw Error('SECRET RAW SOURCE')};
  const failed=s.state.runNext('build',s.source,s.index,{financialVersion:s.binding});expect(failed.tasks[0]).toMatchObject({attempts:1,status:'failed',lastErrorCode:'company-materialization-failed'});expect(JSON.stringify(failed)).not.toContain('SECRET');
  s.index.materializeSourceBacked=materialize;s.reopen();expect(s.state.runNext('build',s.source,s.index,{financialVersion:s.binding}).tasks[0]).toMatchObject({attempts:2,status:'complete'});s.state.finish('build',s.index);
  const before=sha(readFileSync(s.statePath)),ro=new FinancialIndexBuild(s.statePath,{readOnly:true});try{expect(ro.progress('build').finished).toBe(true);expect(()=>ro.runNext('build',s.source,s.index,{financialVersion:s.binding})).toThrow('readOnly');expect(()=>ro.begin(s.input)).toThrow();expect(()=>ro.finish('build',s.index)).toThrow()}finally{ro.close()}
  expect(sha(readFileSync(s.statePath))).toBe(before);
 }finally{s.close()}
});
it.each(['old-observed','mode-downgrade','provenance-pin'])('hash整合な旧/異契約plan %sを混入させない',async field=>{
 const s=await setup();try{
  const p=s.state.begin(s.input),plan:any=structuredClone(p.plan);
  if(field==='old-observed')plan.provenance.mappingVersions.observed='5';
  if(field==='mode-downgrade')plan.indexVersion='1';
  if(field==='provenance-pin')plan.provenance.financialVersion.proofSha256='f'.repeat(64);
  const body=canonical(plan),planHash=sha(body),db=new DatabaseSync(s.statePath);try{
   db.prepare('update financial_build_plans set body=?,sha256=? where id=?').run(body,planHash,'build');
   for(const t of p.tasks){const task={...t,partID:financialIndexBuildPartId(planHash,t.edinetCode)},b=canonical(task);db.prepare('update financial_build_tasks set body=?,sha256=? where build=? and edinet_code=?').run(b,sha(canonical(['build',t.edinetCode,t.status,b])),'build',t.edinetCode)}
  }finally{db.close()}
  expect(()=>s.state.runNext('build',s.source,s.index,{financialVersion:s.binding})).toThrow();
 }finally{s.close()}
});
const permissive={minimumCompaniesWithUsableValues:0,maxUnavailableSources:100,maxUnresolvedSelections:100,maxUnavailableSelections:100,maxUnresolvedRecords:100,maxUnavailableGroups:100,maxDuplicateCohortIdentifiers:100,maxUnavailableValues:100};
it('公開条件を緩めてもv2 prepare/activate/resolveの同期非同期全経路でpointerを保護する',async()=>{
 const s=await setup(),catalogPath=join(s.dir,'catalog.sqlite');let catalog=new FinancialIndexPublication(catalogPath);
 try{
  s.state.begin(s.input);s.state.runNext('build',s.source,s.index,{financialVersion:s.binding});const report=s.state.finish('build',s.index),quality=s.index.quality('all');
  const {financialVersion,...ordinary}=s.input.options;s.state.begin({...s.input,id:'v1',generation:'old',options:ordinary});s.state.runNext('v1',s.source,s.index);s.state.finish('v1',s.index);
  catalog.prepare('old',s.index,'old',permissive);catalog.activate('old',s.index,{expectedActive:null});
  const current=catalog.current(),history=catalog.history(),asyncReader={generation:async(id:string)=>s.index.generation(id),quality:async(id:string)=>s.index.quality(id),snapshotSha256:async()=>'a'.repeat(64)};
  expect(()=>catalog.prepare('bad',s.index,'all',permissive)).toThrow('公開できません');await expect(catalog.prepareAsync('bad',asyncReader,'all',permissive)).rejects.toThrow('公開できません');
  expect(catalog.current()).toEqual(current);expect(catalog.history()).toEqual(history);
  // Bypass preparation with a hash-consistent eligible v2 catalog row: activation still authenticates the generation mode.
  const candidate={id:'forged',publicationVersion:'1',generation:'all',generationSha256:financialIndexGenerationSha256(report),archiveSha256:report.assembly!.archiveSha256,buildPlanSha256:report.assembly!.planSha256,quality,qualitySha256:sha(canonical(quality)),policy:permissive,eligible:true,violations:[]},body=canonical(candidate);
  catalog.close();let db=new DatabaseSync(catalogPath);db.prepare('insert into publication_candidates values(?,?,?)').run('forged',body,sha(canonical(['forged',body])));db.close();catalog=new FinancialIndexPublication(catalogPath);
  expect(catalog.candidate('forged').eligible).toBe(true);expect(()=>catalog.activate('forged',s.index,{expectedActive:'old'})).toThrow('公開できません');await expect(catalog.activateAsync('forged',asyncReader,{expectedActive:'old'})).rejects.toThrow('公開できません');expect(catalog.current()).toEqual(current);expect(catalog.history()).toEqual(history);
  // A pre-existing v2 pointer is refused by both resolve paths without changing that pointer.
  catalog.close();db=new DatabaseSync(catalogPath);const transition={sequence:2,previous:'old',publication:'forged'},transitionBody=canonical(transition);db.prepare('insert into publication_history values(?,?,?,?,?)').run(2,'old','forged',transitionBody,sha(canonical([2,transitionBody])));db.prepare('update publication_active set publication_id=?,sequence=?,sha256=?').run('forged',2,sha(canonical(['forged',2])));db.close();catalog=new FinancialIndexPublication(catalogPath);
  const forgedCurrent=catalog.current(),forgedHistory=catalog.history();expect(()=>catalog.resolve(s.index)).toThrow('公開できません');await expect(catalog.resolveAsync(asyncReader)).rejects.toThrow('公開できません');expect(catalog.current()).toEqual(forgedCurrent);expect(catalog.history()).toEqual(forgedHistory);
 }finally{catalog.close();s.close()}
});
