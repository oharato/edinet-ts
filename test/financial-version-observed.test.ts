import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {authenticateFinancialVersionEvidence,FINANCIAL_VERSION_POLICY} from '../src/financial-version-selection';
import {createSourceBackedObservedFinancialSnapshots,createSourceBackedObservedFinancialSnapshotsUsing} from '../src/financial-version-observed';
import {createAutomaticFinancialSnapshots} from '../src/automatic-financial-snapshots';
import {createObservedFinancialSnapshots} from '../src/observed-financial-snapshots';
import {ObservedFinancialArchive} from '../src/db/observed-financial-archive';
import {projectFinancialIndexGeneration} from '../src/db/financial-search-index';
import {financialVersionEvidenceFixture,signFinancialVersionBundle} from './fixtures/financial-version-evidence';

it('metadataの未解決を保ち、認証した一原本の直接値と全兄弟の因果時刻を返す',async()=>{
 const bundle=await financialVersionEvidenceFixture(),context=await authenticateFinancialVersionEvidence(bundle);
 const ordinary=createObservedFinancialSnapshots(bundle.observations,bundle.sources,{cutoff:bundle.cutoff});
 expect(ordinary.records).toHaveLength(0);
 const result=createSourceBackedObservedFinancialSnapshots({bundle,context},{policy:FINANCIAL_VERSION_POLICY,evidenceManifestSha256:bundle.evidenceManifestSha256});
 expect(result.metadataSelection).toEqual(ordinary.selection);
 expect(result.metadataSelection.decisions[0].reason).toBe('multiple-correction-leaves');
 expect(result.records).toHaveLength(1);
 const row=result.records[0];
 expect(row).toMatchObject({docID:'C',chainDocIDs:['A','C'],observationIds:['A','B','C'],knownAt:'2026-06-28T12:00:00.000Z'});
 expect(row.financialVersionEvidenceSha256).toBe(result.financialVersionProof.sha256);
 const direct=createObservedFinancialSnapshots(bundle.observations.filter(o=>o.document.docID!=='B'),bundle.sources.filter(s=>s.docID!=='B'),{cutoff:bundle.cutoff});
 expect(row.result).toEqual(direct.records[0].result);
 expect(createObservedFinancialSnapshots(bundle.observations,bundle.sources,{cutoff:bundle.cutoff})).toEqual(ordinary);
});

it.each(['token','manifest','policy','source'] as const)('金融版の%s不一致を通常経路へ落とさず拒否する',async kind=>{
 const bundle=await financialVersionEvidenceFixture(),context=await authenticateFinancialVersionEvidence(bundle);
 const options={policy:FINANCIAL_VERSION_POLICY,evidenceManifestSha256:bundle.evidenceManifestSha256};
 if(kind==='manifest')options.evidenceManifestSha256='f'.repeat(64);
 if(kind==='policy')(options as any).policy='unknown';
 if(kind==='source')bundle.sources[2].xml+=' ';
 expect(()=>createSourceBackedObservedFinancialSnapshots({bundle,context:kind==='token'?{} as any:context},options)).toThrow();
});

it('認証した入力を固定し、抽出時に元のgetterから別原本を再取得しない',async()=>{
 const bundle=await financialVersionEvidenceFixture(),context=await authenticateFinancialVersionEvidence(bundle),sources=bundle.sources;
 let reads=0;
 Object.defineProperty(bundle,'sources',{get(){reads++;return reads===1?sources:sources.map(s=>({...s,xml:'<wrong/>'}))}});
 const result=createSourceBackedObservedFinancialSnapshots({bundle,context},{policy:FINANCIAL_VERSION_POLICY,evidenceManifestSha256:bundle.evidenceManifestSha256});
 expect(reads).toBe(1);expect(result.records[0].sourceSha256).toBe(sources[2].sourceSha256);
});

it.each(['standard','scope','fiscal-year','form'] as const)('解析cacheの%s改変を認証済みDEIへ再照合する',async kind=>{
 const bundle=await financialVersionEvidenceFixture(),context=await authenticateFinancialVersionEvidence(bundle);
 expect(()=>createSourceBackedObservedFinancialSnapshotsUsing({bundle,context},{policy:FINANCIAL_VERSION_POLICY,evidenceManifestSha256:bundle.evidenceManifestSha256},(xml,input)=>{
  const result=createAutomaticFinancialSnapshots(xml,input);
  if(result.status==='resolved'){
   const m=result.basis.metadata;
   if(kind==='standard')(m as any).accountingStandard='IFRS';
   if(kind==='scope')m.scope='NonConsolidated';
   if(kind==='fiscal-year')m.fiscalYear.endDate='2027-03-31';
   if(kind==='form')m.documentType='第五号様式';
  }
  return result;
 })).toThrow('解析cache');
});

it('archive全閉包を照合し、純粋解析cacheとmetadata-only結果を維持して再openする',async()=>{
 const bundle=await financialVersionEvidenceFixture(),context=await authenticateFinancialVersionEvidence(bundle),binding={bundle,context};
 const options={cutoff:bundle.cutoff,extractorVersion:'financial-version-test',financialVersion:{policy:FINANCIAL_VERSION_POLICY,evidenceManifestSha256:bundle.evidenceManifestSha256}};
 const dir=mkdtempSync(join(tmpdir(),'financial-version-archive-')),path=join(dir,'archive.sqlite');let archive=new ObservedFinancialArchive(path,{compression:'gzip'});
 try{
  archive.append(bundle.observations,bundle.sources);
  const ordinary=archive.createSnapshots({cutoff:bundle.cutoff,extractorVersion:options.extractorVersion});
  const first=archive.createSourceBackedSnapshots(options,binding);
  expect(first.metadataSelection).toEqual(ordinary.selection);expect(first.records).toHaveLength(1);expect(first.cache).toEqual({hits:0,extracted:1});
  expect(()=>projectFinancialIndexGeneration('must-not-strip-financial-mode',first)).toThrow('専用の世代形式');
  expect(archive.createSourceBackedSnapshots(options,binding).cache).toEqual({hits:1,extracted:0});
  expect(archive.createSnapshots({cutoff:bundle.cutoff,extractorVersion:options.extractorVersion})).toEqual(ordinary);
  archive.close();archive=new ObservedFinancialArchive(path,{readOnly:true});const before=archive.snapshotSha256();
  expect(archive.createSourceBackedSnapshots(options,binding).cache).toEqual({hits:1,extracted:0});expect(archive.snapshotSha256()).toBe(before);
 }finally{archive.close();rmSync(dir,{recursive:true,force:true})}
});

it.each(['third-sibling','source-conflict','missing-content'] as const)('sidecarで隠したarchiveの%sを拒否する',async kind=>{
 const bundle=await financialVersionEvidenceFixture(),context=await authenticateFinancialVersionEvidence(bundle),archive=new ObservedFinancialArchive(':memory:');
 try{
  archive.append(bundle.observations,bundle.sources.map(s=>kind==='missing-content'&&s.docID==='B'?{...s,xml:undefined}:s));
  if(kind==='third-sibling')archive.append([{...bundle.observations[1],observationId:'D',document:{...bundle.observations[1].document,docID:'D'}}]);
  if(kind==='source-conflict')archive.append([],[{...bundle.sources[1],availableAt:'2026-06-28T13:00:00Z'}]);
  expect(()=>archive.createSourceBackedSnapshots({cutoff:bundle.cutoff,extractorVersion:'test',financialVersion:{policy:FINANCIAL_VERSION_POLICY,evidenceManifestSha256:bundle.evidenceManifestSha256}},{bundle,context})).toThrow();
 }finally{archive.close()}
});

it('cutoff後に観測した兄弟は過去の認証閉包へ混ぜず、ignoredへ保持する',async()=>{
 const bundle=await financialVersionEvidenceFixture(),context=await authenticateFinancialVersionEvidence(bundle),archive=new ObservedFinancialArchive(':memory:');
 try{
  archive.append(bundle.observations,bundle.sources);
  archive.append([{...bundle.observations[1],observationId:'future-D',observedAt:'2026-07-02T00:00:00Z',document:{...bundle.observations[1].document,docID:'D'}}]);
  const result=archive.createSourceBackedSnapshots({cutoff:bundle.cutoff,extractorVersion:'as-of-boundary',financialVersion:{policy:FINANCIAL_VERSION_POLICY,evidenceManifestSha256:bundle.evidenceManifestSha256}},{bundle,context});
  expect(result.records).toHaveLength(1);expect(result.records[0]).toMatchObject({docID:'C',knownAt:'2026-06-28T12:00:00.000Z'});
  expect(result.metadataSelection.ignored).toContainEqual({observationId:'future-D',reason:'after-cutoff'});
 }finally{archive.close()}
});

it('後日の別issuer観測を先頭に渡しても、過去の会社scopeを変えない',async()=>{
 const original=await financialVersionEvidenceFixture(),future={...original.observations[0],observationId:'future-owner',observedAt:'2026-07-02T00:00:00Z',document:{...original.observations[0].document,edinetCode:'E99999'}};
 const bundle=signFinancialVersionBundle({...original,observations:[future,...original.observations]}),context=await authenticateFinancialVersionEvidence(bundle),archive=new ObservedFinancialArchive(':memory:');
 try{
  archive.append(bundle.observations,bundle.sources);
  const result=archive.createSourceBackedSnapshots({cutoff:bundle.cutoff,extractorVersion:'as-of-owner',edinetCodes:['E12345'],financialVersion:{policy:FINANCIAL_VERSION_POLICY,evidenceManifestSha256:bundle.evidenceManifestSha256}},{bundle,context});
  expect(result.records).toHaveLength(1);expect(result.records[0].docID).toBe('C');expect(result.metadataSelection.ignored).toContainEqual({observationId:'future-owner',reason:'after-cutoff'});
 }finally{archive.close()}
});

it('親欠落の未対応系列も、架空の親を補わずheldと元metadataを保持する',async()=>{
 const original=await financialVersionEvidenceFixture(),bundle=signFinancialVersionBundle({...original,observations:original.observations.filter(o=>o.document.docID!=='A'),sources:original.sources.filter(s=>s.docID!=='A')}),context=await authenticateFinancialVersionEvidence(bundle),archive=new ObservedFinancialArchive(':memory:');
 try{
  archive.append(bundle.observations,bundle.sources);
  const ordinary=archive.createSnapshots({cutoff:bundle.cutoff,extractorVersion:'missing-parent'});
  const result=archive.createSourceBackedSnapshots({cutoff:bundle.cutoff,extractorVersion:'missing-parent',financialVersion:{policy:FINANCIAL_VERSION_POLICY,evidenceManifestSha256:bundle.evidenceManifestSha256}},{bundle,context});
  expect(result.records).toEqual([]);expect(result.metadataSelection).toEqual(ordinary.selection);expect(result.financialVersionSelection.length).toBeGreaterThan(0);expect(result.financialVersionSelection.every(d=>d.status==='held')).toBe(true);
 }finally{archive.close()}
});
