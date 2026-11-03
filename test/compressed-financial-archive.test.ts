import {Database} from '../src/db/node-sqlite';
import {it,expect} from 'vitest';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {ObservedFinancialArchive} from '../src/db/observed-financial-archive';import {reportingInstance} from './fixtures/financial-reporting-basis';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
it('圧縮原本を再読込し、非圧縮と同じ財務値・証跡を返し、原時刻付きで転送する',()=>{
 const dir=mkdtempSync(join(tmpdir(),'compressed-archive-')),path=join(dir,'compressed.sqlite');const writer=new ObservedFinancialArchive(path,{compression:'gzip'}),plain=new ObservedFinancialArchive(':memory:');let reader:ObservedFinancialArchive|undefined;
 try{
  const xml='\ufeff'+reportingInstance(),source={docID:'A',availableAt:'2026-06-27T00:00:00Z',sourceSha256:hash(xml),xml};const observation={observationId:'o',observedAt:'2026-06-26T00:00:00Z',document:{docID:'A',edinetCode:'E12345',secCode:'10010',docTypeCode:'120',submitDateTime:'2026-06-24 10:00',periodStart:'2025-04-01',periodEnd:'2026-03-31',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'}};
  writer.append([observation],[source]);plain.append([observation],[source]);expect(writer.append([],[source]).insertedContents).toBe(0);
  const query={cutoff:'2026-10-28T00:00:00Z',extractorVersion:'compressed-test'};expect(writer.createSnapshots(query).records).toEqual(plain.createSnapshots(query).records);writer.close();const before=readFileSync(path);
  reader=new ObservedFinancialArchive(path,{readOnly:true});expect(reader.createSnapshots(query).records).toEqual(plain.createSnapshots(query).records);expect(reader.transferSourcesTo(plain,{sourceArchiveSha256:reader.snapshotSha256()})).toMatchObject({insertedSources:0,insertedContents:0,complete:true});reader.close();expect(readFileSync(path)).toEqual(before);
 }finally{reader?.close();writer.close();plain.close();rmSync(dir,{recursive:true,force:true})}
});

it('非圧縮から圧縮へ転送し、壊れた圧縮内容の採用を拒否する',()=>{
 const dir=mkdtempSync(join(tmpdir(),'compressed-transfer-')),path=join(dir,'plain.sqlite'),compressed=join(dir,'gzip.sqlite');
 let plain=new ObservedFinancialArchive(path),target=new ObservedFinancialArchive(compressed,{compression:'gzip'});
 try{
  const xml=reportingInstance(),source={docID:'A',availableAt:'2026-06-27T00:00:00Z',sourceSha256:hash(xml),xml};
  plain.append([],[source]);plain.close();plain=new ObservedFinancialArchive(path,{readOnly:true});
  expect(plain.transferSourcesTo(target,{sourceArchiveSha256:plain.snapshotSha256()})).toMatchObject({insertedSources:1,insertedContents:1,complete:true});
  expect(target.append([],[source]).insertedContents).toBe(0);target.close();
  const raw=new Database(compressed);raw.exec("UPDATE archive_contents SET xml=X'1F8B00'");raw.close();
  target=new ObservedFinancialArchive(compressed);
  expect(()=>target.append([],[source])).toThrow('不整合');
 }finally{plain.close();target.close();rmSync(dir,{recursive:true,force:true})}
});

it('圧縮移行の一覧観測を境界から再開し、重複投入でも原時刻・全指紋を保つ',()=>{
 const dir=mkdtempSync(join(tmpdir(),'compressed-observations-')),path=join(dir,'plain.sqlite');
 let source=new ObservedFinancialArchive(path);const target=new ObservedFinancialArchive(':memory:',{compression:'gzip'});
 try{
  source.append(['a','b','c'].map(observationId=>({observationId,observedAt:'2026-06-26T00:00:00Z',document:{docID:observationId,edinetCode:'E12345'}})));source.close();source=new ObservedFinancialArchive(path,{readOnly:true});
  const sourceArchiveSha256=source.snapshotSha256(),first=source.transferObservationsTo(target,{sourceArchiveSha256,limit:2});
  expect(first).toMatchObject({transferredObservations:2,insertedObservations:2,nextAfterId:'b',complete:false});
  expect(source.transferObservationsTo(target,{sourceArchiveSha256,limit:2}).insertedObservations).toBe(0);
  expect(source.transferObservationsTo(target,{sourceArchiveSha256,afterId:first.nextAfterId,limit:2})).toMatchObject({transferredObservations:1,insertedObservations:1,complete:true});
  expect(target.observationsSha256()).toBe(source.observationsSha256());
  for(const changed of [{sourceArchiveSha256:'0'.repeat(64)},{afterId:'missing'},{limit:1001},{extra:true}])expect(()=>source.transferObservationsTo(target,{sourceArchiveSha256,...changed} as never)).toThrow();
  expect(()=>source.transferObservationsTo(source,{sourceArchiveSha256})).toThrow();
 }finally{source.close();target.close();rmSync(dir,{recursive:true,force:true})}
});
