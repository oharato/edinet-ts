/** Real-source P2 check on a small isolated archive; never copies the whole live candidate. */
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {createReadStream,existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {Database} from '../src/db/node-sqlite';
import {ObservedFinancialArchive} from '../src/db/observed-financial-archive';
import {ParsedFinancialStore,parsedFinancialMappingVersions} from '../src/db/parsed-financial-store';
import {ParsedFinancialJob} from '../src/db/parsed-financial-job';
import {createAutomaticFinancialSnapshots} from '../src/automatic-financial-snapshots';
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
async function fileHash(path:string){const h=createHash('sha256');for await(const part of createReadStream(path))h.update(part);return h.digest('hex')}
async function main(){
 const prior=JSON.parse(readFileSync(resolve(process.argv[2]),'utf8')),out=resolve(process.argv[3]);assert(!existsSync(out));mkdirSync(out,{recursive:true});
 const original=prior.archive;assert(!['-wal','-shm','-journal'].some(s=>existsSync(original+s)));const before=await fileHash(original);assert.equal(before,prior.archiveSha256);
 const files=readdirSync('src',{recursive:true}).filter(p=>String(p).endsWith('.ts')).map(p=>['src/'+p,hash(readFileSync('src/'+p))]).sort(),manifestSha256=hash(JSON.stringify(files));
 writeFileSync(join(out,'source-manifest.json'),JSON.stringify(files,null,2));const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const raw=new Database(original,{readOnly:true}),declaration=raw.prepare("SELECT body FROM archive_sources WHERE doc_id=? AND json_extract(body,'$.sourceSha256')=? ORDER BY available_ms DESC,id DESC LIMIT 1"),content=raw.prepare('SELECT xml FROM archive_contents WHERE sha256=?');
 const format=raw.prepare('SELECT kind FROM archive_format'),kind=format.get()!.kind;format.close();
 const sources=prior.records.map((r:any)=>{const source=JSON.parse(String(declaration.get(r.identity.docID,r.identity.sourceSha256)!.body)),compressed=content.get(source.sourceSha256)!.xml as Uint8Array,
  bytes=kind==='edinet-ts-observed-financial-archive-gzip-v1'?gunzipSync(compressed):Buffer.from(compressed);assert.equal(hash(bytes),source.sourceSha256);return {...source,xml:bytes.toString('utf8')}});declaration.close();content.close();raw.close();
 const archivePath=join(out,'input.sqlite'),writer=new ObservedFinancialArchive(archivePath,{compression:'gzip'});writer.append([],sources);writer.close();
 const archiveBefore=await fileHash(archivePath),archive=new ObservedFinancialArchive(archivePath,{readOnly:true}),storePath=join(out,'parsed.sqlite'),jobPath=join(out,'job.sqlite');let store=new ParsedFinancialStore(storePath),job=new ParsedFinancialJob(jobPath);
 try{
  const input={id:'real-job',archiveSha256:archive.snapshotSha256(),tasks:sources.map((s:any)=>({availableAt:s.availableAt,identity:{docID:s.docID,sourceSha256:s.sourceSha256,extractorVersion:'proof-job-'+manifestSha256,sourceCommit,mappingVersions:parsedFinancialMappingVersions()}}))};job.begin(input);
  const first=await job.runNext(input.id,archive,store,{limit:1});assert.equal(first.processed,1);assert.equal(first.pending,1);job.close();store.close();job=new ParsedFinancialJob(jobPath);store=new ParsedFinancialStore(storePath);
  const resumed=await job.runNext(input.id,archive,store,{limit:1});assert.equal(resumed.processed,1);assert.equal(resumed.completed,2);
  const read=archive.readSource.bind(archive);archive.readSource=(v,opts)=>{assert.equal(opts?.includeXml,false,'No XML on a fully cached run');return read(v,opts)};
  const cached=await job.runNext(input.id,archive,store);assert.equal(cached.processed,0);assert.equal(cached.reused,2);
  for(const record of store.page().records){const source=sources.find((s:any)=>s.docID===record.identity.docID);assert.deepEqual(record.outcome,{status:'completed',result:JSON.parse(JSON.stringify(createAutomaticFinancialSnapshots(source.xml,{docID:source.docID})))})}
  assert.equal(await fileHash(archivePath),archiveBefore);assert.equal(await fileHash(original),before);
  writeFileSync(join(out,'summary.json'),JSON.stringify({node:process.version,sourceCommit,sourceManifestSha256:manifestSha256,original,originalSha256:before,originalUnchanged:true,sampleArchiveUnchanged:true,originalRecords:sources.map(({xml,...source}:any)=>source),first,resumed,cached,resultsEqualToDirectParser:true},null,2));console.log({first,resumed,cached});
 }finally{store.close();job.close();archive.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
