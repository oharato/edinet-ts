/** Verify a new parsed store against real stopped archive inputs, without modifying the archive. */
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {createReadStream,existsSync,mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {Database} from '../src/db/node-sqlite';
import {createAutomaticFinancialSnapshots} from '../src/automatic-financial-snapshots';
import {ParsedFinancialStore,parsedFinancialMappingVersions,type ParsedFinancialExtraction} from '../src/db/parsed-financial-store';
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
async function fileHash(path:string){const h=createHash('sha256');for await(const part of createReadStream(path))h.update(part);return h.digest('hex')}
async function main(){
 const archive=resolve(process.argv[2]),out=resolve(process.argv[3]);assert(!existsSync(out),'Use a fresh output directory');mkdirSync(out,{recursive:true});
 assert(!['-wal','-shm','-journal'].some(s=>existsSync(archive+s)),'Archive must be stopped');
 const before=await fileHash(archive),sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const sourceFiles=readdirSync('src',{recursive:true}).filter(p=>String(p).endsWith('.ts')).map(p=>['src/'+p,hash(readFileSync('src/'+p))]).sort();
 const sourceManifestSha256=hash(JSON.stringify(sourceFiles));writeFileSync(join(out,'source-manifest.json'),JSON.stringify(sourceFiles,null,2));
 const raw=new Database(archive,{readOnly:true}),stmt=raw.prepare('SELECT sha256,xml FROM archive_contents WHERE sha256>? ORDER BY sha256 LIMIT 20');
 const format=raw.prepare('SELECT kind FROM archive_format'),kind=format.get()!.kind;format.close();
 const source=raw.prepare("SELECT doc_id FROM archive_sources WHERE json_extract(body,'$.sourceSha256')=? ORDER BY available_ms DESC,id DESC LIMIT 1");
 const store=new ParsedFinancialStore(join(out,'parsed.sqlite')),inputs:ParsedFinancialExtraction[]=[],standards=new Set<string>();
 let cursor='';
 try{
  while(standards.size<2){
   const batch=stmt.all(cursor);assert(batch.length,'Need both J-GAAP and IFRS raw inputs');
   for(const row of batch){
    cursor=String(row.sha256);const bytes=kind==='edinet-ts-observed-financial-archive-gzip-v1'?gunzipSync(row.xml as Uint8Array):Buffer.from(row.xml as Uint8Array);
    assert.equal(hash(bytes),row.sha256);
    const xml=bytes.toString('utf8'),docID=String(source.get(String(row.sha256))!.doc_id);
    if(!/AccountingStandardsDEI[^>]*>\s*(?:Japan GAAP|IFRS)\s*</.test(xml))continue;
    const result=createAutomaticFinancialSnapshots(xml,{docID});if(result.status!=='resolved'||standards.has(result.accountingStandard))continue;
    const input:ParsedFinancialExtraction={identity:{docID,sourceSha256:String(row.sha256),extractorVersion:'proof-'+sourceManifestSha256,sourceCommit,mappingVersions:parsedFinancialMappingVersions()},parsedAt:new Date().toISOString(),outcome:{status:'completed',result}};
    const saved=store.put(input);assert.equal(saved.inserted,true);assert.deepEqual(store.get(saved.id),JSON.parse(JSON.stringify(input)));inputs.push(input);standards.add(result.accountingStandard);
    console.log('verified',docID,result.accountingStandard);
    if(standards.size===2)break;
   }
  }
 }finally{store.close();source.close();stmt.close();raw.close()}
 const beforeParsed=await fileHash(join(out,'parsed.sqlite')),reader=new ParsedFinancialStore(join(out,'parsed.sqlite'),{readOnly:true});
 try{for(const input of inputs){const id=(await import('../src/db/parsed-financial-store')).parsedFinancialExtractionId(input.identity);assert.deepEqual(reader.get(id),JSON.parse(JSON.stringify(input)))}assert.equal(reader.page().records.length,2)}finally{reader.close()}
 assert.equal(await fileHash(join(out,'parsed.sqlite')),beforeParsed);assert.equal(await fileHash(archive),before);
 const sql=new Database(join(out,'parsed.sqlite'),{readOnly:true}),counts:any={};for(const t of ['parsed_extractions','parsed_rows','parsed_values']){const s=sql.prepare('SELECT COUNT(*) n FROM '+t);counts[t]=s.get()!.n;s.close()}sql.close();
 writeFileSync(join(out,'summary.json'),JSON.stringify({node:process.version,sourceCommit,sourceManifestSha256,extractorVersion:'proof-'+sourceManifestSha256,archive,archiveSha256:before,archiveUnchanged:true,parsedReadOnlyUnchanged:true,counts,records:inputs.map(i=>({identity:i.identity,parsedAt:i.parsedAt,status:i.outcome.status}))},null,2));
 console.log(counts);
}
main().catch(e=>{console.error(e);process.exitCode=1});
