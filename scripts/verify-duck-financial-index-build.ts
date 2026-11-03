import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,statSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {ObservedFinancialArchive} from '../src/db/observed-financial-archive';
import {ParsedFinancialStore,parsedFinancialMappingVersions} from '../src/db/parsed-financial-store';
import {ParsedFinancialJob} from '../src/db/parsed-financial-job';
import {DuckFinancialIndexBuild} from '../src/db/duck-financial-index-build';
import {FinancialIndexBuild} from '../src/db/financial-index-build';
import {FinancialSearchIndex} from '../src/db/financial-search-index';
import {EdinetXbrlParser} from '../src/edinet-xbrl-parser';
import {Database} from '../src/db/node-sqlite';
const sha=(s:Buffer|string)=>createHash('sha256').update(s).digest('hex');
const plain=(r:Record<string,unknown>)=>JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(r).map(([k,v])=>[k,typeof v==='bigint'?Number(v):v]))));
async function main(){
 const selectionProof=resolve(process.argv[2]),parseProof=resolve(process.argv[3]),out=resolve(process.argv[4]);assert(!existsSync(out));mkdirSync(out,{recursive:true});
 const identityJob=new ParsedFinancialJob(join(parseProof,'job.sqlite'),{readOnly:true}),identity=identityJob.plan('real-job').tasks[0].identity;identityJob.close();
 const archivePath=join(selectionProof,'input.sqlite'),parsedPath=join(out,'parsed.sqlite'),archiveBefore=sha(readFileSync(archivePath)),archive=new ObservedFinancialArchive(archivePath,{readOnly:true});
 const parserSources=readdirSync('src',{recursive:true}).filter(p=>String(p).endsWith('.ts')).map(p=>['src/'+p,sha(readFileSync('src/'+p))]).sort();
 identity.extractorVersion='duck-proof-'+sha(JSON.stringify(parserSources));identity.mappingVersions=parsedFinancialMappingVersions();
 const writer=new ParsedFinancialStore(parsedPath),job=new ParsedFinancialJob(join(out,'parse-job.sqlite'));
 try{const tasks=[...new Set(archive.readObservations().map(o=>o.document.docID))].flatMap(docID=>archive.sourceDeclarations(docID).sources.map(s=>({availableAt:s.availableAt,identity:{...identity,docID:s.docID,sourceSha256:s.sourceSha256}})));job.begin({id:'parse',archiveSha256:archive.snapshotSha256(),tasks});await job.runNext('parse',archive,writer,{limit:100})}finally{job.close();writer.close()}
 const parsedBefore=sha(readFileSync(parsedPath)),parsed=new ParsedFinancialStore(parsedPath,{readOnly:true});
 writeFileSync(join(out,'parser-source-manifest.json'),JSON.stringify(parserSources,null,2));
 const observations=archive.readObservations(),codes=[...new Set(observations.map(o=>o.document.edinetCode!))].sort(),cutoff=new Date().toISOString(),asOf=new Date(Date.parse(cutoff)+9*3600000).toISOString().slice(0,10),options={cutoff,extractorVersion:identity.extractorVersion,sourceCommit:identity.sourceCommit};
 const input={id:'real-duck-build',generation:'real-duck',archiveSha256:archive.snapshotSha256(),options,population:{edinetCodes:codes,asOf,observedAt:cutoff,source:'explicit retained two-company verification subset',sourceSha256:sha(JSON.stringify(codes))}};
 const moduleName=process.env.DUCKDB_NODE_MODULE??'@duckdb/node-api',{DuckDBInstance}=await import(moduleName),path=join(out,'index.duckdb');let instance=await DuckDBInstance.create(path,{threads:'1'}),connection=await instance.connect(),builder=new DuckFinancialIndexBuild(connection);
 const parse=EdinetXbrlParser.prototype.parse,read=archive.readSource.bind(archive);let parserCalls=0,xmlReads=0;
 EdinetXbrlParser.prototype.parse=function(){parserCalls++;throw Error('XML parser must not run')};archive.readSource=(s,o)=>{if(o?.includeXml!==false){xmlReads++;throw Error('XML content must not load')}return read(s,o)};
 let first,complete,report,finalProgress;
 try{
  await builder.begin(input,parsed.snapshotSha256());first=await builder.runNext(input.id,archive,parsed,{limit:1});assert.equal(first.completed,1);connection.closeSync();instance.closeSync();
  instance=await DuckDBInstance.create(path,{threads:'1'});connection=await instance.connect();builder=new DuckFinancialIndexBuild(connection);await builder.begin(input,parsed.snapshotSha256());complete=await builder.runNext(input.id,archive,parsed,{limit:1});report=await builder.finish(input.id);finalProgress=await builder.progress(input.id);assert.equal(finalProgress.finished,true);assert.equal(complete.completed,codes.length);assert.equal(report.rows.length,4);assert.equal(parserCalls,0);assert.equal(xmlReads,0);
 }finally{EdinetXbrlParser.prototype.parse=parse;archive.readSource=read}
 const legacyPath=join(out,'legacy.sqlite'),aggregatePath=join(out,'aggregate.sqlite'),legacy=new FinancialSearchIndex(legacyPath),state=new FinancialIndexBuild(':memory:');let legacyReport;
 try{state.begin(input);state.runNext(input.id,archive,legacy);legacyReport=state.finish(input.id,legacy);assert.deepEqual(report.rows,legacyReport.rows);assert.deepEqual(report.selection,legacyReport.selection);assert.deepEqual(report.provenance,legacyReport.provenance);const aggregate=new FinancialSearchIndex(aggregatePath);try{legacy.exportGenerationTo(input.generation,aggregate)}finally{aggregate.close()}}finally{state.close();legacy.close()}
 const sqlite=new Database(aggregatePath,{readOnly:true}),counts:Record<string,number>={};
 try{for(const [table,order] of [['financial_rows','row_id'],['financial_values','row_id,metric_order']]){const stmt=sqlite.prepare(`SELECT * FROM ${table} WHERE generation=? ORDER BY ${order}`),expected=stmt.all(input.generation).map(plain);stmt.close();const actual=(await connection.runAndReadAll(`SELECT * FROM ${table} WHERE generation=? ORDER BY ${order}`,[input.generation])).getRowObjects().map(plain);assert.deepEqual(actual,expected);counts[table]=actual.length}}finally{sqlite.close()}
 connection.closeSync();instance.closeSync();archive.close();parsed.close();assert.equal(sha(readFileSync(archivePath)),archiveBefore);assert.equal(sha(readFileSync(parsedPath)),parsedBefore);
 const files=['src/db/duck-financial-index-build.ts','src/db/financial-search-index.ts','src/db/parsed-financial-snapshots.ts','src/db/observed-financial-archive.ts','src/observed-financial-snapshots.ts'];
 writeFileSync(join(out,'summary.json'),JSON.stringify({node:process.version,duckdbNodePackage:'2.0.0-r.1',input,first,complete,finalProgress,counts,allColumnsEqual:true,selectionAndProvenanceEqual:true,parserCalls,xmlContentReads:xmlReads,archiveUnchanged:true,parsedStoreUnchanged:true,fileBytes:{duckdb:statSync(path).size,sqlite:statSync(aggregatePath).size},sourceSha256:Object.fromEntries(files.map(f=>[f,sha(readFileSync(f))]))},null,2));console.log({first,complete,counts,parserCalls,xmlReads});
}
main().catch(e=>{console.error(e);process.exitCode=1});
