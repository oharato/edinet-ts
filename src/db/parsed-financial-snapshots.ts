import {ObservedFinancialArchive,normalizeArchivedFinancialSnapshotOptions,financialArchiveExtractionProvenance,type ArchivedFinancialSnapshotOptions,type ArchivedFinancialSnapshots} from './observed-financial-archive';
import {ParsedFinancialStore,parsedFinancialExtractionId,parsedFinancialMappingVersions} from './parsed-financial-store';
import {createObservedFinancialSnapshotsFromParsed,type ObservedParsedFinancialSource} from '../observed-financial-snapshots';
import {parseDocumentTimestamp} from '../document-timestamp';

/** 固定アーカイブの一覧・宣言と解析済みStoreから構築。XMLを読み出しません。 */
export function createParsedFinancialSnapshots(archive:ObservedFinancialArchive,store:ParsedFinancialStore,options:ArchivedFinancialSnapshotOptions):ArchivedFinancialSnapshots {
 if(!(archive instanceof ObservedFinancialArchive)||!(store instanceof ParsedFinancialStore))throw new Error('固定原本と解析済みStoreが必要です');
 const q=normalizeArchivedFinancialSnapshotOptions(options),sourceCommit=q.sourceCommit;
 if(sourceCommit===undefined)throw new Error('解析済み検索構築にはsource commitが必要です');
 const archiveSha256=archive.snapshotSha256(),parsedSha256=store.snapshotSha256(),observations=archive.readObservations(q.edinetCodes),cut=parseDocumentTimestamp(q.cutoff,true)!;
 const query={cutoff:q.cutoff,detailMetricIds:q.detailMetricIds};
 const preview=createObservedFinancialSnapshotsFromParsed(observations,[],query);
 const ids=preview.selection.selected.filter(s=>q.edinetCodes===undefined||q.edinetCodes.includes(s.observation.document.edinetCode??'')).map(s=>s.observation.document.docID),idSet=new Set(ids);
 const records:ArchivedFinancialSnapshots['records']=[],unavailable=new Map<string,ArchivedFinancialSnapshots['unavailableSources'][number]>(preview.unavailableSources.filter(s=>idSet.has(s.docID)).map(s=>[s.docID,s]));let hits=0;
 for(let offset=0;offset<ids.length;offset+=100){
  const batch=ids.slice(offset,offset+100),sources:ObservedParsedFinancialSource[]=[],conflicts=new Set<string>();
  for(const docID of batch){
   const declarations:Omit<ObservedParsedFinancialSource,'result'|'failure'>[]=[];let afterId:string|undefined;
   for(;;){const page=archive.sourceDeclarations(docID,{afterId});declarations.push(...page.sources);if(page.complete)break;afterId=page.nextAfterId}
   declarations.sort((a,b)=>parseDocumentTimestamp(a.availableAt,true)!-parseDocumentTimestamp(b.availableAt,true)!||(a.sourceSha256<b.sourceSha256?-1:a.sourceSha256>b.sourceSha256?1:0));
   if(!declarations.length)continue;
   const past=declarations.filter(s=>parseDocumentTimestamp(s.availableAt,true)!<=cut),latest=past.length?past.at(-1)!:declarations[0];
   if(past.length&&new Set(declarations.filter(s=>s.availableAt===latest.availableAt).map(s=>s.sourceSha256)).size>1){conflicts.add(docID);continue}
   if(!past.length){sources.push({...latest});continue}
   const present=archive.readSource(latest,{includeXml:false});
   if(!present){sources.push({...latest,failure:'source-not-loaded'});continue}
   const key=parsedFinancialExtractionId({docID,sourceSha256:latest.sourceSha256,extractorVersion:q.extractorVersion,sourceCommit,mappingVersions:parsedFinancialMappingVersions(),detailMetricIds:q.detailMetricIds}),cached=store.get(key);
   if(!cached){sources.push({...latest,failure:'source-not-loaded'});continue}
   hits++;
   sources.push(cached.outcome.status==='completed'?{...latest,result:cached.outcome.result}:{...latest,failure:cached.outcome.reason==='projection-failed'?'metric-projection-mismatch':'source-parse-failed'});
  }
  const result=createObservedFinancialSnapshotsFromParsed(observations,sources,query);
  for(const record of result.records){if(batch.includes(record.docID)){records.push(record);unavailable.delete(record.docID)}}
  for(const entry of result.unavailableSources)if(batch.includes(entry.docID))unavailable.set(entry.docID,conflicts.has(entry.docID)?{...entry,reason:'conflicting-source-observations'}:entry);
 }
 if(archive.snapshotSha256()!==archiveSha256||store.snapshotSha256()!==parsedSha256)throw new Error('構築中に固定入力が変化しました');
 return {selection:preview.selection,records,unavailableSources:[...unavailable.values()],provenance:financialArchiveExtractionProvenance(q),cache:{hits,extracted:0}};
}
