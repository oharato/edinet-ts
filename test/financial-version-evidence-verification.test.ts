import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
import {authenticateFinancialVersionEvidence,financialVersionEvidenceManifestSha256,readFinancialVersionProof} from '../src/financial-version-selection';
import {reportingInstance} from './fixtures/financial-reporting-basis';
import {ObservedFinancialArchive} from '../src/db/observed-financial-archive';
import {FinancialSearchIndex} from '../src/db/financial-search-index';
import {FinancialIndexBuild} from '../src/db/financial-index-build';
import {DatabaseSync} from 'node:sqlite';

const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const canonical=(v:any):string=>JSON.stringify((function sort(x:any):any{return Array.isArray(x)?x.map(sort):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x})(v));
const digest=(v:any)=>sha(canonical(v));
const script=resolve('scripts/roadmap/verify-financial-version-evidence.py');
async function fixture(dir:string,retainOriginalFiling=false){
 const observations:any[]=[],sources:any[]=[],evidence:any[]=[];
 for(let ordinal=1;ordinal<=3;ordinal++){
  const docID=['ROOT','LEAF2','LEAF3'][ordinal-1],day=`2026-0${ordinal+5}-24`,flags=ordinal===1?'false':'true';
  const extra='<xbrli:unit id="pure"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit>'+['NumberOfSubmissionDEI','AmendmentFlagDEI','ReportAmendmentFlagDEI','XBRLAmendmentFlagDEI','IdentificationOfDocumentSubjectToAmendmentDEI'].map((tag,i)=>`<d:${tag} contextRef="filing"${i===0?' unitRef="pure" decimals="0"':''}>${[String(ordinal),flags,flags,'false',ordinal===1?'':'ROOT'][i]}</d:${tag}>`).join('');
  const xml=reportingInstance({filing:retainOriginalFiling?'2026-06-24':day,extra});
  observations.push({observationId:docID,observedAt:day+'T12:00:00Z',listDate:day,document:{docID,docTypeCode:ordinal===1?'120':'130',parentDocID:ordinal===1?null:'ROOT',edinetCode:'E12345',secCode:'10010',periodStart:ordinal===1?'2025-04-01':null,periodEnd:ordinal===1?'2026-03-31':null,submitDateTime:day+' 09:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0',xbrlFlag:'1',formCode:'030000',legalStatus:'1'}});
  sources.push({docID,xml,sourceSha256:sha(xml),availableAt:day+'T13:00:00Z'});
  if(ordinal===1)continue;
  const suffix=`_E12345-000_2026-03-31_0${ordinal}_${day}`,preferred=`jpcrp030000-asr${suffix}.xbrl`,header=`jpcrp030000-asr_header${suffix}.htm`,honbun=`jpcrp030000-asr_honbun${suffix}.htm`;
  const zip=new JSZip();
  zip.file('XBRL/PublicDoc/'+preferred,xml);
  zip.file('XBRL/PublicDoc/'+header,'<html>訂正報告書の添付インラインXBRL</html>');
  zip.file('XBRL/PublicDoc/'+honbun,'<html>当期財務諸表</html>');
  zip.file('PublicDoc/correction.htm','<html>訂正事項</html>');
  zip.file('XBRL/PublicDoc/manifest_PublicDoc.xml',`<manifest xmlns="http://disclosure.edinet-fsa.go.jp/2013/manifest"><tocComposition><item ref="i" extrole="http://disclosure.edinet-fsa.go.jp/role/jpcrp/rol_CabinetOfficeOrdinanceOnDisclosureOfCorporateInformationEtcFormNo3AnnualSecuritiesReport"/></tocComposition><list><instance id="i" type="PublicDoc" preferredFilename="${preferred}"><ixbrl>${header}</ixbrl><ixbrl>${honbun}</ixbrl></instance></list></manifest>`);
  const raw=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),path=join(dir,docID+'.zip');writeFileSync(path,raw);
  evidence.push({docID,path,sha256:sha(raw),receivedAt:day+'T12:30:00Z'});
 }
 const input={cutoff:'2026-10-31T00:00:00Z',observations,sources,evidence};
 const bundle={...input,evidenceManifestSha256:financialVersionEvidenceManifestSha256(input)};
 const context=await authenticateFinancialVersionEvidence(bundle),proof=readFinancialVersionProof(context);
 expect(proof.decisions[0]).toMatchObject({status:'selected-source',selectedDocID:'LEAF3'});
 return {bundle,proof,binding:{bundle,context}};
}
function rehash(bundle:any,proof:any){
 proof.observationsSha256=digest(bundle.observations);
 proof.sourcesSha256=digest(bundle.sources.map(({docID,sourceSha256,availableAt}:any)=>({docID,sourceSha256,availableAt})));
 proof.evidenceSha256=digest(bundle.evidence.map(({docID,sha256,receivedAt}:any)=>({docID,sha256,receivedAt})));
 bundle.evidenceManifestSha256=proof.evidenceManifestSha256=digest({cutoff:bundle.cutoff,observationsSha256:proof.observationsSha256,sourcesSha256:proof.sourcesSha256,evidenceSha256:proof.evidenceSha256});
 for(const d of proof.decisions)if(d.status==='selected-source'){const {sha256:_,...body}=d;d.sha256=digest(body)}
 const {sha256:_,...body}=proof;proof.sha256=digest(body);
}
it.each(['valid','original-filing-instant','file-adapter','manifest-pin','source-hash','raw-target','raw-duplicate-target','raw-namespace','raw-scope','raw-ordinal','raw-period','raw-counter-unit','raw-counter-local-namespace','raw-counter-precision','raw-document-form','ordinal','identity','known-at','chain','observation','observation-omitted-field','observation-status','format','third-sibling','official-parent','official-period','official-status','zip-bytes','zip-trailing','zip-cover-text','zip-body-text','zip-filename','zip-role','member-manifest','cover','metadata-selected','missing-sibling'])('原ZIP/XML/公式観測から金融版根拠を独立再認証する: %s',async field=>{
 const dir=mkdtempSync(join(tmpdir(),'financial-version-verifier-'));
 try{
  const {bundle,proof}=await fixture(dir,field==='original-filing-instant'),b:any=bundle,p:any=proof,d=p.decisions[0];
  if(field==='source-hash')b.sources[1].xml+=' ';
  if(field==='raw-target'){
   b.sources[1].xml=b.sources[1].xml.replace('>ROOT</d:Identification','>UNRELATED</d:Identification');
   b.sources[1].sourceSha256=d.sourceVersions[1].sourceSha256=sha(b.sources[1].xml);
  }
  if(['raw-duplicate-target','raw-namespace','raw-scope','raw-ordinal','raw-period','raw-counter-unit','raw-counter-local-namespace','raw-counter-precision','raw-document-form'].includes(field)){
   let xml=b.sources[1].xml;
   if(field==='raw-duplicate-target')xml=xml.replace('</xbrli:xbrl>','<d:IdentificationOfDocumentSubjectToAmendmentDEI contextRef="filing">ROOT</d:IdentificationOfDocumentSubjectToAmendmentDEI></xbrli:xbrl>');
   if(field==='raw-namespace')xml=xml.replace('xmlns:d="http://disclosure.edinet-fsa.go.jp/taxonomy/jpdei/2013-08-31/jpdei_cor"','xmlns:d="http://example.test/fake"');
   if(field==='raw-scope')xml=xml.replace('>true</d:WhetherConsolidated','>false</d:WhetherConsolidated');
   if(field==='raw-ordinal')xml=xml.replace('>2</d:NumberOfSubmissionDEI>','>3</d:NumberOfSubmissionDEI>');
   if(field==='raw-period')xml=xml.replace('>2026-03-31</d:CurrentPeriodEndDateDEI>','>2025-03-31</d:CurrentPeriodEndDateDEI>');
   if(field==='raw-counter-unit')xml=xml.replace('<xbrli:measure>xbrli:pure</xbrli:measure>','<xbrli:measure>iso4217:JPY</xbrli:measure>');
   if(field==='raw-counter-local-namespace')xml=xml.replace('<xbrli:measure>xbrli:pure</xbrli:measure>','<xbrli:measure xmlns:p="http://example.test/fake">p:pure</xbrli:measure>');
   if(field==='raw-document-form')xml=xml.replace('>第三号様式</d:DocumentTypeDEI>','>第五号様式</d:DocumentTypeDEI>');
   if(field==='raw-counter-precision')xml=xml.replace('unitRef="pure" decimals="0"','unitRef="pure" decimals="2"');
   b.sources[1].xml=xml;b.sources[1].sourceSha256=d.sourceVersions[1].sourceSha256=sha(xml);
  }
  if(field==='ordinal')d.sourceVersions[1].ordinal=3;
  if(field==='identity')d.sourceVersions[1].identity.issuer='E99999';
  if(field==='known-at')d.knownAt='2026-06-25T00:00:00Z';
  if(field==='chain')d.selected.chainDocIDs=['ROOT','LEAF2','LEAF3'];
  if(field==='observation')d.selected.observation.document.edinetCode='E99999';
  if(field==='observation-omitted-field')delete d.selected.observation.document.edinetCode;
  if(field==='observation-status')d.selected.observation.statuses.withdrawalStatus.code='2';
  if(field==='format')d.selected.formatAvailability.formats.xbrl={state:'not-provided',code:'0'};
  if(field==='third-sibling')b.observations.push({...structuredClone(b.observations[2]),observationId:'LEAF4',document:{...b.observations[2].document,docID:'LEAF4'}});
  if(field==='official-parent')b.observations[1].document.parentDocID='UNRELATED';
  if(field==='official-period')b.observations[1].document.periodEnd='2025-03-31';
  if(field==='official-status')b.observations[1].document.withdrawalStatus='2';
  if(field==='zip-bytes')writeFileSync(b.evidence[0].path,'not zip');
  if(field==='zip-trailing'){
   const bytes=Buffer.concat([readFileSync(b.evidence[0].path),Buffer.from('trailing')]);
   writeFileSync(b.evidence[0].path,bytes);b.evidence[0].sha256=d.sourceVersions[1].zip.rawResponseSha256=sha(bytes);
  }
  if(['zip-cover-text','zip-body-text','zip-filename','zip-role'].includes(field)){
   const zip=await JSZip.loadAsync(readFileSync(b.evidence[0].path)),zp=d.sourceVersions[1].zip;
   if(field==='zip-cover-text')zip.file(zp.cover.path,'<html>本表のみの訂正</html>');
   if(field==='zip-body-text')zip.file(zp.correctionBody.path,'<html>本文なし</html>');
   if(field==='zip-role'){const name='XBRL/PublicDoc/manifest_PublicDoc.xml',manifest=await zip.file(name)!.async('string');zip.file(name,manifest.replace('http://disclosure.edinet-fsa.go.jp/role/jpcrp/','http://example.test/'));zp.role=zp.role.replace('http://disclosure.edinet-fsa.go.jp/role/jpcrp/','http://example.test/')}
   if(field==='zip-filename')zip.file('XBRL/PublicDoc/invalid_ordinal.htm','<html>extra</html>');
   const raw=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});writeFileSync(b.evidence[0].path,raw);
   b.evidence[0].sha256=zp.rawResponseSha256=sha(raw);
   const parsed=await JSZip.loadAsync(raw),members=[];
   for(const entry of Object.values(parsed.files))if(!entry.dir){const data=await entry.async('nodebuffer'),sizes=(entry as any)._data;members.push({name:entry.name,dir:false,compressedSize:sizes.compressedSize,uncompressedSize:sizes.uncompressedSize,sha256:sha(data)})}
   zp.memberManifestSha256=digest(members);zp.memberCount=members.length;
   zp.manifestSha256=sha(await parsed.file('XBRL/PublicDoc/manifest_PublicDoc.xml')!.async('nodebuffer'));
   zp.cover.sha256=sha(await parsed.file(zp.cover.path)!.async('nodebuffer'));
   zp.correctionBody.sha256=sha(await parsed.file(zp.correctionBody.path)!.async('nodebuffer'));
   for(const doc of zp.inlineDocuments)doc.sha256=sha(await parsed.file(doc.name)!.async('nodebuffer'));
  }
  if(field==='member-manifest')d.sourceVersions[1].zip.memberManifestSha256='a'.repeat(64);
  if(field==='cover')d.sourceVersions[1].zip.cover.sha256='b'.repeat(64);
  if(field==='metadata-selected')p.metadataSelection.decisions[0].status='selected';
  if(field==='missing-sibling')b.sources.splice(1,1);
  rehash(b,p);
  if(field==='file-adapter')for(const s of b.sources){s.file=join(dir,s.docID+'.xbrl');writeFileSync(s.file,s.xml);delete s.xml}
  const bundlePath=join(dir,'bundle.json'),proofPath=join(dir,'proof.json');writeFileSync(bundlePath,JSON.stringify(b));writeFileSync(proofPath,JSON.stringify(p));
  const result=spawnSync('python3',[script,'--bundle',bundlePath,'--proof',proofPath,'--expected-manifest-sha256',field==='manifest-pin'?'0'.repeat(64):b.evidenceManifestSha256],{encoding:'utf8'});
  if(['valid','original-filing-instant','file-adapter'].includes(field)){expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout)).toMatchObject({selectedSourceDecisions:1,heldDecisions:0,documentsChecked:3,zipFilesChecked:2,zipMembersChecked:10,financialValuesValidated:false,networkRequests:0})}
  else{expect(result.status).toBe(1);expect(result.stdout).toBe('');expect(result.stderr).toContain('Independent financial version evidence verification failed')}
 }finally{rmSync(dir,{recursive:true,force:true})}
});
it('最適化実行は検査前に拒否する',()=>{
 const result=spawnSync('python3',['-O',script],{encoding:'utf8'});
 expect(result.status).toBe(1);expect(result.stderr).toContain('requires assertions');
});


it.each(['valid','partial-args','partial-state','wrong-plan','wrong-archive','mode-lowering','flags-only','stored-proof','metadata-resolved','effective-doc','row-evidence','row-decision','row-source','row-known','row-chain','row-observations','row-root','row-standard','row-scope','row-period','row-instant','row-type','row-security','part-id','part-sha','part-body','part-row-diff','population','population-asof','population-source','population-sourcehash','missing-part','state-proof','state-attempt','state-checkpoint-sha','state-part','state-part-sha','state-count','state-pending','state-finish-plan','state-finish-gen','state-missing-finish','state-plan-hash'])('SDK構築済v2の世代/plan/parts/保存行をPythonだけで再結合する: %s',async field=>{
 const dir=mkdtempSync(join(tmpdir(),'financial-version-sql-verifier-'));
 try{
  const {bundle,proof,binding}=await fixture(dir),archivePath=join(dir,'archive.sqlite'),indexPath=join(dir,'index.sqlite'),statePath=join(dir,'build.sqlite');
  const writer=new ObservedFinancialArchive(archivePath);writer.append(bundle.observations,bundle.sources);writer.close();
  const archive=new ObservedFinancialArchive(archivePath,{readOnly:true}),index=new FinancialSearchIndex(indexPath),build=new FinancialIndexBuild(statePath);
  let planSha256='',archiveSha256='';
  try{
   archiveSha256=archive.snapshotSha256();
   const input={id:'build',generation:'aggregate',archiveSha256,population:{asOf:'2026-10-30',observedAt:bundle.cutoff,source:'test fixture',sourceSha256:'f'.repeat(64),edinetCodes:['E12345']},options:{cutoff:bundle.cutoff,extractorVersion:'independent-evidence-sql-test',financialVersion:{policy:'whole-attached-asr-q2r-v1' as const,evidenceManifestSha256:bundle.evidenceManifestSha256,proofSha256:proof.sha256}}};
   planSha256=build.begin(input).planSha256;
   expect(build.runNext('build',archive,index,{financialVersion:binding})).toMatchObject({completed:1,failed:0});build.finish('build',index);
  }finally{build.close();index.close();archive.close()}
  if(!['valid','partial-args','partial-state','wrong-plan','wrong-archive'].includes(field)){
   const db=new DatabaseSync(indexPath);try{
    const aggregate=JSON.parse(db.prepare("select body from financial_generations where id='aggregate'").get()!.body as string),partID=aggregate.assembly.parts[0].id;
    if(field==='mode-lowering')aggregate.indexVersion='1';
    if(field==='flags-only'){aggregate.financialVersionProof={status:'passed',financialValuesValidated:true,sha256:proof.sha256};aggregate.financialValuesValidated=true;}
    if(field==='stored-proof')aggregate.financialVersionProof.sha256='a'.repeat(64);
    if(field==='metadata-resolved')aggregate.metadataSelection.decisions[0].status='selected';
    if(field==='effective-doc')aggregate.selection.selected[0].observation.document.docID='LEAF2';
    if(field==='part-id')aggregate.assembly.parts[0].id='buildpart:'+'1'.repeat(64);
    if(field==='part-sha')aggregate.assembly.parts[0].sha256='2'.repeat(64);
    if(field==='population')aggregate.assembly.population.edinetCodes=['E99999'];
    if(field==='population-asof')aggregate.assembly.population.asOf='2026-10-29';
    if(field==='population-source')aggregate.assembly.population.source='unreviewed population';
    if(field==='population-sourcehash')aggregate.assembly.population.sourceSha256='9'.repeat(64);
    if(field==='missing-part')db.prepare('delete from financial_generations where id=?').run(partID);
    if(['part-body','part-row-diff'].includes(field)){
     const part=JSON.parse(db.prepare('select body from financial_generations where id=?').get(partID)!.body as string);
     if(field==='part-body')part.provenance.extractorVersion='different';
     else{
      const stored=db.prepare("select row_id,body from financial_rows where generation=? and group_id='details'").get(partID)!,row=JSON.parse(stored.body as string);
      row.snapshot.selections.costOfSales.raw='99';row.snapshot.selections.costOfSales.safeNumber=99;
      const entry=part.rows.find((r:any)=>r.id===stored.row_id),body=canonical(row);entry.sha256=sha(canonical([entry.metadata,body]));db.prepare('update financial_rows set body=?,sha256=? where generation=? and row_id=?').run(body,entry.sha256,partID,stored.row_id as string);
     }
     const body=canonical(part),hash=sha(canonical([partID,body]));db.prepare('update financial_generations set body=?,sha256=? where id=?').run(body,hash,partID);aggregate.assembly.parts[0].sha256=hash;
    }
    if(field.startsWith('row-')){
     const stored=db.prepare("select row_id,body from financial_rows where generation='aggregate' and group_id=?").get(field==='row-instant'?'balanceSheet':'details')!,row=JSON.parse(stored.body as string);
     if(field==='row-evidence')delete row.financialVersionEvidenceSha256;
     if(field==='row-decision')row.financialVersionDecisionSha256='3'.repeat(64);
     if(field==='row-source')row.sourceSha256='4'.repeat(64);
     if(field==='row-known')row.knownAt='2026-06-24T00:00:00Z';
     if(field==='row-chain')row.chainDocIDs=['UNRELATED','LEAF3'];
     if(field==='row-observations')row.observationIds=['ROOT','LEAF3'];
     if(field==='row-root')row.rootDocID='UNRELATED';
     if(field==='row-standard')row.snapshot.metadata.accountingStandard='IFRS';
     if(field==='row-scope')row.snapshot.metadata.scope='NonConsolidated';
     if(field==='row-period')row.snapshot.metadata.period.endDate='2025-03-31';
     if(field==='row-instant')row.snapshot.metadata.period.instant='2025-03-31';
     if(field==='row-type')row.snapshot.metadata.periodType='quarterly';
     if(field==='row-security')row.snapshot.metadata.secCode='99990';
     const entry=aggregate.rows.find((r:any)=>r.id===stored.row_id),body=canonical(row),m=row.snapshot.metadata;
     entry.metadata[3]=m.accountingStandard;entry.metadata[4]=m.scope;entry.metadata[7]=m.period.endDate??m.period.instant;entry.metadata[8]=m.periodType??'';entry.metadata[10]=m.secCode;
     entry.sha256=sha(canonical([entry.metadata,body]));db.prepare("update financial_rows set standard=?,scope=?,period_end=?,period_type=?,sec_code=?,body=?,sha256=? where generation='aggregate' and row_id=?").run(m.accountingStandard,m.scope,m.period.endDate??m.period.instant,m.periodType??'',m.secCode,body,entry.sha256,stored.row_id as string);
    }
    const body=canonical(aggregate);db.prepare("update financial_generations set body=?,sha256=? where id='aggregate'").run(body,sha(canonical(['aggregate',body])));
   }finally{db.close()}
  }
  if(field.startsWith('state-')){
   const db=new DatabaseSync(statePath);try{
    if(field==='state-plan-hash')db.prepare('update financial_build_plans set sha256=?').run('a'.repeat(64));
    else if(field==='state-proof'){
     const row=db.prepare('select id,body from financial_build_plans').get()!,plan=JSON.parse(row.body as string);plan.options.financialVersion.proofSha256='b'.repeat(64);const body=canonical(plan);db.prepare('update financial_build_plans set body=?,sha256=? where id=?').run(body,sha(body),row.id as string);
    }else if(field.startsWith('state-finish-')||field==='state-missing-finish'){
     if(field==='state-missing-finish')db.prepare('delete from financial_build_completions').run();
     else{const row=db.prepare('select build,body from financial_build_completions').get()!,value=JSON.parse(row.body as string);value[field==='state-finish-plan'?'planSha256':'generationSha256']='c'.repeat(64);const body=canonical(value);db.prepare('update financial_build_completions set body=?,sha256=? where build=?').run(body,sha(canonical([row.build,body])),row.build as string)}
    }else{
     const row=db.prepare('select * from financial_build_tasks').get()!,task=JSON.parse(row.body as string);
     if(field==='state-attempt')task.attempts=0;
     if(field==='state-part')task.partID='buildpart:'+'d'.repeat(64);
     if(field==='state-part-sha')task.partSha256='f'.repeat(64);
     if(field==='state-count')task.rowCount=0;
     if(field==='state-pending')task.status='pending';
     const body=canonical(task),hash=field==='state-checkpoint-sha'?'e'.repeat(64):sha(canonical([row.build,row.edinet_code,task.status,body]));db.prepare('update financial_build_tasks set status=?,body=?,sha256=? where build=? and edinet_code=?').run(task.status,body,hash,row.build as string,row.edinet_code as string);
    }
   }finally{db.close()}
  }
  const bundlePath=join(dir,'bundle.json'),proofPath=join(dir,'proof.json');writeFileSync(bundlePath,JSON.stringify(bundle));writeFileSync(proofPath,JSON.stringify(proof));
  const before=sha(readFileSync(indexPath)),stateBefore=sha(readFileSync(statePath)),args=[script,'--bundle',bundlePath,'--proof',proofPath,'--expected-manifest-sha256',bundle.evidenceManifestSha256,'--index',indexPath];
  if(field!=='partial-args')args.push('--generation','aggregate','--expected-plan-sha256',field==='wrong-plan'?'0'.repeat(64):planSha256,'--expected-archive-sha256',field==='wrong-archive'?'0'.repeat(64):archiveSha256);
  if(!['partial-args','partial-state'].includes(field))args.push('--build-state',statePath);
  const result=spawnSync('python3',args,{encoding:'utf8'});
  if(field==='valid'){expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout)).toMatchObject({selectedSourceDecisions:1,indexBinding:{generation:'aggregate',planSha256,archiveSha256,indexUnchanged:true,companyPartsChecked:1,completedCheckpointsChecked:1,buildStateUnchanged:true,storedRowsChecked:2,storedGenerationsChecked:2,financialValuesValidated:false}})}
  else{expect(result.status).toBe(1);expect(result.stdout).toBe('');expect(result.stderr).toContain('Independent financial version evidence verification failed')}
  if(['row-standard','row-scope','row-security'].includes(field))expect(result.stderr).toContain('stored source-backed row evidence binding');
  if(['row-period','row-instant','row-type'].includes(field))expect(result.stderr).toContain('stored source-backed reporting period');
  expect(sha(readFileSync(indexPath))).toBe(before);expect(sha(readFileSync(statePath))).toBe(stateBefore);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
