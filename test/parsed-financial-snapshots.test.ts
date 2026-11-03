import {it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {ObservedFinancialArchive} from '../src/db/observed-financial-archive';
import {ParsedFinancialStore,parsedFinancialMappingVersions} from '../src/db/parsed-financial-store';
import {ParsedFinancialJob} from '../src/db/parsed-financial-job';
import {createParsedFinancialSnapshots} from '../src/db/parsed-financial-snapshots';
import {createObservedFinancialSnapshotsFromParsed} from '../src/observed-financial-snapshots';
import {createAutomaticFinancialSnapshots} from '../src/automatic-financial-snapshots';
import {EdinetXbrlParser} from '../src/edinet-xbrl-parser';
import {reportingInstance} from './fixtures/financial-reporting-basis';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const options={cutoff:'2026-10-28T00:00:00Z',extractorVersion:'parser-1',sourceCommit:'a'.repeat(40)};
function observation(docID:string,parent:string|null=null,changes:any={}){return {observationId:docID,observedAt:'2026-06-26T00:00:00Z',document:{docID,parentDocID:parent,docTypeCode:parent?'130':'120',edinetCode:'E12345',secCode:'10010',periodStart:'2025-04-01',periodEnd:'2026-03-31',submitDateTime:'2026-06-24 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0',...changes}}}
async function fixture(mode:string,fn:(s:any)=>Promise<void>|void){
 const dir=mkdtempSync(join(tmpdir(),'parsed-snapshots-')),archivePath=join(dir,'archive.sqlite'),storePath=join(dir,'parsed.sqlite');
 const observations=[observation('A',null,mode==='period'?{periodEnd:'2026-03-30'}:{})],sources:any[]=[{docID:'A',xml:reportingInstance(),availableAt:mode==='future'?'2026-11-01T00:00:00Z':'2026-07-01T00:00:00Z'}];
 if(mode==='correction'||mode==='bad-target'){observations.push(observation('B','A'));sources.push({docID:'B',xml:reportingInstance({extra:`<d:IdentificationOfDocumentSubjectToAmendmentDEI contextRef="filing">${mode==='bad-target'?'UNRELATED':'A'}</d:IdentificationOfDocumentSubjectToAmendmentDEI>`}),availableAt:'2026-07-02T00:00:00Z'})}
 if(mode==='conflict'||mode==='newer')sources.push({docID:'A',xml:reportingInstance().replace('>10</jppfs_cor:CostOfSales>','>11</jppfs_cor:CostOfSales>'),availableAt:mode==='conflict'?'2026-07-01T00:00:00Z':'2026-07-02T00:00:00Z'});
 if(mode==='ifrs')sources[0].xml=reportingInstance({standard:'IFRS'});
 if(mode==='half'){observations[0].document.docTypeCode='160';observations[0].document.periodEnd='2025-09-30';sources[0].xml=reportingInstance({periodCode:'HY',currentEnd:'2025-09-30'})}
 for(const s of sources)s.sourceSha256=sha(s.xml);
 const writer=new ObservedFinancialArchive(archivePath,{compression:'gzip'});writer.append(observations);for(const s of sources)writer.append([],[s]);writer.close();
 const archive=new ObservedFinancialArchive(archivePath,{readOnly:true}),store=new ParsedFinancialStore(storePath),job=new ParsedFinancialJob(':memory:');
 const tasks=(mode==='newer'?sources.slice(0,1):sources).map(({docID,sourceSha256,availableAt})=>({availableAt,identity:{docID,sourceSha256,extractorVersion:options.extractorVersion,sourceCommit:options.sourceCommit,mappingVersions:parsedFinancialMappingVersions()}}));job.begin({id:'parse',archiveSha256:archive.snapshotSha256(),tasks});await job.runNext('parse',archive,store);store.close();const parsed=new ParsedFinancialStore(storePath,{readOnly:true});
 try{await fn({archive,parsed,options,sources,observations,dir,storePath})}finally{parsed.close();archive.close();job.close();store.close();rmSync(dir,{recursive:true,force:true})}
}
it.each(['normal','ifrs','correction','bad-target','period','future','conflict','half'])('XMLなしの%s結果が既存経路の採用・来歴と一致',mode=>fixture(mode,s=>{
 const expected=s.archive.createSnapshots(options),{cache:_,...legacy}=expected;
 const original=s.archive.readSource.bind(s.archive);s.archive.readSource=(input:any,opts:any)=>{expect(opts?.includeXml).toBe(false);return original(input,opts)};
 const parse=vi.spyOn(EdinetXbrlParser.prototype,'parse').mockImplementation(()=>{throw Error('XML parser must not run')});
 try{const {cache,...actual}=createParsedFinancialSnapshots(s.archive,s.parsed,options);expect(actual).toEqual(legacy);expect(cache.extracted).toBe(0);expect(parse).not.toHaveBeenCalled()}finally{parse.mockRestore()}
}));
it('新しい原本の解析がなければ古い解析結果に戻らない',()=>fixture('newer',s=>{
 const actual=createParsedFinancialSnapshots(s.archive,s.parsed,options);expect(actual.records).toEqual([]);expect(actual.unavailableSources[0].reason).toBe('source-not-loaded');expect(s.archive.createSnapshots(options).records[0].result.details.snapshot.selections.costOfSales.raw).toBe('11');
}));
it('別版・別項目のcacheへ暗黙に戻らず、固定readOnlyを要求',()=>fixture('normal',s=>{
 expect(createParsedFinancialSnapshots(s.archive,s.parsed,{...options,extractorVersion:'new'}).unavailableSources[0].reason).toBe('source-not-loaded');
 expect(createParsedFinancialSnapshots(s.archive,s.parsed,{...options,detailMetricIds:['costOfSales']}).unavailableSources[0].reason).toBe('source-not-loaded');
 expect(()=>createParsedFinancialSnapshots(s.archive,s.parsed,{...options,sourceCommit:undefined})).toThrow('commit');
 const writer=new ParsedFinancialStore(s.storePath);try{expect(()=>createParsedFinancialSnapshots(s.archive,writer,options)).toThrow('readOnly')}finally{writer.close()}
}));
it('解析結果の原本・書類の結合不一致と明示項目の不一致を拒否',()=>{
 const xml=reportingInstance(),result=createAutomaticFinancialSnapshots(xml,{docID:'A'}),header={docID:'A',sourceSha256:sha(xml),availableAt:'2026-07-01T00:00:00Z'};
 expect(()=>createObservedFinancialSnapshotsFromParsed([observation('A')],[{...header,result:{...result,inputXmlSha256:'b'.repeat(64)}}],{cutoff:options.cutoff})).toThrow('不一致');
 expect(createObservedFinancialSnapshotsFromParsed([observation('A')],[{...header,result}],{cutoff:options.cutoff,detailMetricIds:['costOfSales']}).unavailableSources[0].reason).toBe('metric-projection-mismatch');
 expect(()=>createObservedFinancialSnapshotsFromParsed([],[{...header,result,xml} as never],{cutoff:options.cutoff})).toThrow('宣言');
});
it('原本宣言をページ分割して全版を保持し、絞り込んだ観測を返す',()=>fixture('newer',s=>{
 const first=s.archive.sourceDeclarations('A',{limit:1});expect(first.complete).toBe(false);const next=s.archive.sourceDeclarations('A',{afterId:first.nextAfterId,limit:1});expect(next.complete).toBe(true);expect([...first.sources,...next.sources]).toHaveLength(2);
 expect(s.archive.readObservations(['E12345'])).toEqual(s.observations.map((v:any)=>({...v,observedAt:new Date(v.observedAt).toISOString()})));expect(s.archive.readObservations(['E99999'])).toEqual([]);
 expect(()=>s.archive.readObservations(['bad'])).toThrow();expect(()=>s.archive.sourceDeclarations('A',{limit:101})).toThrow();
}));
