/** Compare every published row/value hash and diagnostic with direct XML extraction using the exact build SDK. */
import {strict as assert} from 'node:assert';
import {readFileSync,writeFileSync,mkdirSync,existsSync,statSync,statfsSync,createReadStream} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const sha=value=>createHash('sha256').update(value).digest('hex');
const read=path=>JSON.parse(readFileSync(path,'utf8'));
async function fileHash(path){const digest=createHash('sha256');for await(const bytes of createReadStream(path))digest.update(bytes);return digest.digest('hex')}
async function main(){
 const sdk=resolve(process.argv[2]),cycle=resolve(process.argv[3]),out=resolve(process.argv[4]);assert(!existsSync(out));
 const marker=read(join(cycle,'input.json')),saved=read(join(cycle,'build.json'));assert.equal(marker.inputSha256,sha(canonical(marker.input)));assert.equal(saved.body?.status,'built');assert.equal(saved.body.indexPath,join(cycle,'index.duckdb'));assert.equal(saved.inputSha256,marker.inputSha256);assert.equal(saved.sha256,sha(canonical([saved.inputSha256,saved.body])));
 const {duckFinancialSdkSha256}=await import(pathToFileURL(join(sdk,'dist/duck-financial-cycle.js')).href);assert.equal(duckFinancialSdkSha256(),marker.input.sdkSha256,'SDK differs from build');
 const {ObservedFinancialArchive,DuckFinancialSearchIndex}=await import(pathToFileURL(join(sdk,'dist/index.js')).href),{projectFinancialIndexGeneration}=await import(pathToFileURL(join(sdk,'dist/db/financial-search-index.js')).href),input=marker.input.build;
 const space=statfsSync(cycle,{bigint:true});assert(space.bavail*space.bsize>=34n*1024n**3n+BigInt(statSync(marker.input.archivePath).size),'Direct verification disk reserve');
 mkdirSync(out,{mode:0o700});const started=performance.now(),archive=new ObservedFinancialArchive(marker.input.archivePath,{readOnly:true});let reader;
 const maps=Object.fromEntries(['decisions','selected','ignored','unavailableSources','unresolvedRecords','unavailableGroups'].map(k=>[k,new Map()]));
 const merge=(name,values,key)=>{for(const item of values){const id=key(item),old=maps[name].get(id);if(old!==undefined)assert.equal(canonical(old),canonical(item),`${name} conflict ${id}`);maps[name].set(id,item)}};
 let companies=0,rowCount=0,valueCount=0;
 try{
  assert.equal(archive.snapshotSha256(),input.archiveSha256);reader=await DuckFinancialSearchIndex.open(saved.body.indexPath);const report=await reader.generation(input.generation),byCompany=new Map();
  for(const row of report.rows){const code=row.metadata[9];if(!byCompany.has(code))byCompany.set(code,[]);byCompany.get(code).push(row)}
  for(const code of input.population.edinetCodes){
   const direct=projectFinancialIndexGeneration(input.generation,archive.createSnapshots({...input.options,edinetCodes:[code]})).report;
   assert.equal(canonical(direct.rows),canonical(byCompany.get(code)??[]),`Direct XML rows/values differ: ${code}`);
   const {edinetCodes:_codes,...provenance}=direct.provenance,{edinetCodes:_all,...expected}=report.provenance;assert.equal(canonical(provenance),canonical(expected));
   for(const name of ['decisions','selected'])merge(name,direct.selection[name],v=>v.rootDocID);merge('ignored',direct.selection.ignored,v=>v.observationId);
   for(const name of ['unavailableSources','unresolvedRecords'])merge(name,direct[name],v=>v.docID);merge('unavailableGroups',direct.unavailableGroups,v=>v.docID+':'+v.group);
   companies++;rowCount+=direct.rows.length;valueCount+=direct.rows.reduce((n,r)=>n+r.metrics.length,0);
   writeFileSync(join(out,'progress.json'),JSON.stringify({companies,total:input.population.edinetCodes.length,rowCount,valueCount,elapsedMs:performance.now()-started})+'\n');
   await new Promise(done=>setImmediate(done));
  }
  for(const name of Object.keys(maps)){const actual=[...maps[name]].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,v])=>v),expected=['decisions','selected','ignored'].includes(name)?report.selection[name]:report[name];assert.equal(canonical(actual),canonical(expected),`Direct diagnostics differ: ${name}`)}
  assert.equal(rowCount,report.rows.length);assert.equal(duckFinancialSdkSha256(),marker.input.sdkSha256);assert.equal(await fileHash(marker.input.archivePath),input.archiveSha256);
  writeFileSync(join(out,'summary.json'),JSON.stringify({node:process.version,sdkSha256:marker.input.sdkSha256,inputSha256:marker.inputSha256,archiveUnchanged:true,companies,rowCount,valueCount,allDirectRowsValuesAndDiagnosticsEqual:true,elapsedMs:performance.now()-started,maxRssKiB:process.resourceUsage().maxRSS,scope:'same SDK direct XML path versus parsed SQLite/DuckDB; independent Python value verification remains required'},null,2)+'\n');
  console.log(JSON.stringify({companies,rowCount,valueCount,equal:true}));
 }finally{try{await reader?.close()}finally{archive.close()}}
}
main().catch(error=>{console.error(error);process.exitCode=1});
