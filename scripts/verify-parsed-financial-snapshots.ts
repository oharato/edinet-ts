/** Verify the XML-free selection path against existing real half-year inputs. */
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {createReadStream,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Database} from '../src/db/node-sqlite';
import {ObservedFinancialArchive} from '../src/db/observed-financial-archive';
import {ParsedFinancialStore} from '../src/db/parsed-financial-store';
import {ParsedFinancialJob} from '../src/db/parsed-financial-job';
import {createParsedFinancialSnapshots} from '../src/db/parsed-financial-snapshots';
import {EdinetXbrlParser} from '../src/edinet-xbrl-parser';
async function fileHash(path:string){const h=createHash('sha256');for await(const data of createReadStream(path))h.update(data);return h.digest('hex')}
async function main(){
 const input=resolve(process.argv[2]),out=resolve(process.argv[3]);assert(!existsSync(out));mkdirSync(out,{recursive:true});const prior=JSON.parse(readFileSync(join(input,'summary.json'),'utf8'));
 assert(!['-wal','-shm','-journal'].some(s=>existsSync(prior.original+s)));assert.equal(await fileHash(prior.original),prior.originalSha256);
 const db=new Database(prior.original,{readOnly:true}),stmt=db.prepare('SELECT body FROM archive_observations WHERE doc_id=? ORDER BY id'),observations=prior.originalRecords.flatMap((s:any)=>stmt.all(s.docID).map(r=>JSON.parse(String(r.body))));stmt.close();db.close();
 const raw=new ObservedFinancialArchive(join(input,'input.sqlite'),{readOnly:true}),writer=new ObservedFinancialArchive(join(out,'input.sqlite'),{compression:'gzip'});
 try{writer.append(observations);for(const source of prior.originalRecords){const xml=raw.readSource(source)?.xml;assert(xml!==undefined);writer.append([],[{...source,xml}])}}finally{raw.close();writer.close()}
 const archive=new ObservedFinancialArchive(join(out,'input.sqlite'),{readOnly:true}),store=new ParsedFinancialStore(join(input,'parsed.sqlite'),{readOnly:true}),job=new ParsedFinancialJob(join(input,'job.sqlite'),{readOnly:true});
 try{
  const identity=job.plan('real-job').tasks[0].identity,options={cutoff:new Date().toISOString(),extractorVersion:identity.extractorVersion,sourceCommit:identity.sourceCommit};
  const expected=archive.createSnapshots(options),{cache:_,...legacy}=expected;assert.equal(expected.records.length,2);
  let parserCalls=0,contentReads=0;const parse=EdinetXbrlParser.prototype.parse,read=archive.readSource.bind(archive);
  EdinetXbrlParser.prototype.parse=function(){parserCalls++;throw Error('XML parser must not run')};archive.readSource=(source,opts)=>{if(opts?.includeXml!==false){contentReads++;throw Error('XML content must not be read')}return read(source,opts)};
  let result;try{result=createParsedFinancialSnapshots(archive,store,options);const {cache,...actual}=result;assert.deepEqual(actual,legacy);assert.equal(cache.hits,2);assert.equal(cache.extracted,0)}finally{EdinetXbrlParser.prototype.parse=parse}
  assert.equal(parserCalls,0);assert.equal(contentReads,0);assert.equal(await fileHash(prior.original),prior.originalSha256);
  const sourceFiles=['src/observed-financial-snapshots.ts','src/db/observed-financial-archive.ts','src/db/parsed-financial-snapshots.ts'];
  writeFileSync(join(out,'summary.json'),JSON.stringify({node:process.version,sourceSha256:Object.fromEntries(sourceFiles.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')])),original:prior.original,originalUnchanged:true,cutoff:options.cutoff,records:result.records.map(r=>({docID:r.docID,sourceSha256:r.sourceSha256,knownAt:r.knownAt,status:r.result.status})),unavailable:result.unavailableSources,resultsEqual:true,parserCalls,xmlContentReads:contentReads,cache:result.cache},null,2));console.log({records:result.records.length,resultsEqual:true,parserCalls,contentReads});
 }finally{archive.close();store.close();job.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
