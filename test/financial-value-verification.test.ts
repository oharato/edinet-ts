import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {ObservedFinancialArchive,FinancialSearchIndex} from '../src/index';
import {reportingInstance} from './fixtures/financial-reporting-basis';

it.each(['valid','raw','precision','unit','period','context','namespace','source-hash','numeric','safeNumber','cutoff','issuer','sql-standard','sql-scope','sql-period','sql-group','sql-currency','sql-period-start','sql-period-type','sql-edinet','sql-sec','sql-doc'])('独立XML照合は索引の%sを原本から検査する',field=>{
 const dir=mkdtempSync(join(tmpdir(),'financial-value-proof-')),archivePath=join(dir,'archive.sqlite'),indexPath=join(dir,'index.sqlite');
 try{
  const xml=reportingInstance(),sourceSha256=createHash('sha256').update(xml).digest('hex');
  const archive=new ObservedFinancialArchive(archivePath,{compression:'gzip'}),index=new FinancialSearchIndex(indexPath);
  try{
   archive.append([{observationId:'A',observedAt:'2026-06-25T00:00:00Z',document:{docID:'A',docTypeCode:'120',parentDocID:null,edinetCode:'E12345',secCode:'10010',periodStart:'2025-04-01',periodEnd:'2026-03-31',submitDateTime:'2026-06-24 09:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'}}],[{docID:'A',xml,sourceSha256,availableAt:'2026-06-26T00:00:00Z'}]);
   index.materialize('g',archive,{cutoff:'2026-10-28T00:00:00Z',extractorVersion:'test'});
  }finally{index.close();archive.close()}
  const archiveHash=createHash('sha256').update(readFileSync(archivePath)).digest('hex');
  if(field!=='valid'){
   const db=new DatabaseSync(indexPath);
   try{
    const stored=db.prepare("select row_id,body from financial_rows where group_id='balanceSheet'").get()!;
    const row=JSON.parse(stored.body as string),selection=row.snapshot.selections.currentAssets;
    if(field.startsWith('sql-')){const [column,value]=({'sql-standard':['standard','IFRS'],'sql-scope':['scope','NonConsolidated'],'sql-period':['period_end','1900-01-01'],'sql-group':['group_id','details'],'sql-currency':['currency','USD'],'sql-period-start':['period_start','1900-01-01'],'sql-period-type':['period_type','annual'],'sql-edinet':['edinet_code','E99999'],'sql-sec':['sec_code','99990'],'sql-doc':['doc_id','OTHER']} as Record<string,string[]>)[field];db.prepare(`update financial_rows set ${column}=? where row_id=?`).run(value,stored.row_id as string)}
    if(field==='source-hash')row.sourceSha256='a'.repeat(64);
    else if(field==='cutoff')row.knownAt='2027-01-01T00:00:00Z';
    else if(field==='issuer')row.edinetCode='E99999';
    else{
     for(const evidence of [selection.source,...selection.evidence.filter((e:any)=>e.reason==='selected')]){
      if(field==='raw')evidence.raw='101';
      if(field==='precision')evidence.decimals='3';
      if(field==='unit')evidence.unit='iso4217:USD';
      if(field==='period')evidence.period.instant='2025-03-31';
      if(field==='context')evidence.contextRef='unrecorded';
      if(field==='namespace')evidence.namespaceURI='https://example.test/fake';
     }
     if(field==='raw')selection.raw='101';
     if(field==='raw'||field==='safeNumber')selection.safeNumber=101;
     if(field==='period')row.snapshot.metadata.period.instant='2025-03-31';
    }
    if(field==='raw')db.prepare("update financial_values set raw_text='101',numeric_value=101 where row_id=? and metric_id='currentAssets'").run(stored.row_id as string);
    if(field==='numeric'||field==='safeNumber')db.prepare("update financial_values set numeric_value=101 where row_id=? and metric_id='currentAssets'").run(stored.row_id as string);
    // Deliberately bypass index hash validation to test the independent verifier itself.
    db.prepare('update financial_rows set body=? where row_id=?').run(JSON.stringify(row),stored.row_id as string);
   }finally{db.close()}
  }
  const result=spawnSync('python3',[resolve('scripts/roadmap/verify-financial-values.py'),indexPath,archivePath,'g',archiveHash],{encoding:'utf8'});
  if(field==='valid'){expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout)).toMatchObject({selectedValues:5,documents:1,rows:2})}
  else{expect(result.status).toBe(1);expect(result.stdout).toBe('');expect(result.stderr).toContain('Independent financial source verification failed')}
 }finally{rmSync(dir,{recursive:true,force:true})}
});

it('Python最適化で検証assertを除去した実行は入力を読む前に拒否する',()=>{
 const result=spawnSync('python3',['-O',resolve('scripts/roadmap/verify-financial-values.py')],{encoding:'utf8'});
 expect(result.status).toBe(1);expect(result.stdout).toBe('');expect(result.stderr).toContain('requires assertions');
});

it.each(['matching','missing','empty','unrelated','self','duplicate','mixed-empty','row-chain','row-root','row-observations','original-target'])('数値と保存hashが整合しても訂正来歴の%sを独立検査する',field=>{
 const dir=mkdtempSync(join(tmpdir(),'financial-lineage-proof-')),archivePath=join(dir,'archive.sqlite'),indexPath=join(dir,'index.sqlite');
 const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
 const canonical=(value:any):string=>JSON.stringify((function sort(v:any):any{return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v})(value));
 const target=(value:string)=>`<d:IdentificationOfDocumentSubjectToAmendmentDEI contextRef="filing">${value}</d:IdentificationOfDocumentSubjectToAmendmentDEI>`;
 const original=field==='original-target';
 try{
  const parentXml=reportingInstance(),leafXml=reportingInstance({filing:'2026-07-01',extra:target('A')});
  const archive=new ObservedFinancialArchive(archivePath,{compression:'gzip'}),index=new FinancialSearchIndex(indexPath);
  try{
   const document={docID:'A',docTypeCode:'120',parentDocID:null,edinetCode:'E12345',secCode:'10010',periodStart:'2025-04-01',periodEnd:'2026-03-31',submitDateTime:'2026-06-24 09:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'};
   archive.append([{observationId:'root',observedAt:'2026-07-02T00:00:00Z',document},...original?[]:[{observationId:'correction',observedAt:'2026-07-02T00:00:00Z',document:{...document,docID:'B',docTypeCode:'130',parentDocID:'A',periodStart:null,periodEnd:null,submitDateTime:'2026-07-01 09:00'}}]],
    [{docID:'A',xml:parentXml,sourceSha256:sha(parentXml),availableAt:'2026-07-03T00:00:00Z'},...original?[]:[{docID:'B',xml:leafXml,sourceSha256:sha(leafXml),availableAt:'2026-07-03T00:00:00Z'}]]);
   const report=index.materialize('g',archive,{cutoff:'2026-10-28T00:00:00Z',extractorVersion:'test'});
   expect(report.selection.selected).toHaveLength(1);expect(report.rows).toHaveLength(2);
  }finally{index.close();archive.close()}
  // Start from a valid SDK-selected correction, then change only the raw DEI target.
  // Repair source declarations, content hashes, rows and generation hashes: financial amounts remain untouched.
  const docID=original?'A':'B';
  const replacement=field==='missing'?'':field==='empty'?target(''):field==='unrelated'?target('OTHER'):field==='self'?target('B'):field==='duplicate'?target('A')+target('A'):field==='mixed-empty'?target('A')+target(''):original?target('OTHER'):target('A');
  const xml=original?parentXml.replace('</xbrli:xbrl>',replacement+'</xbrli:xbrl>'):leafXml.replace(target('A'),replacement),newHash=sha(xml);
  const raw=new DatabaseSync(archivePath),db=new DatabaseSync(indexPath);
  try{
   const source=raw.prepare('select * from archive_sources where doc_id=?').get(docID)!;const declaration={...JSON.parse(source.body as string),sourceSha256:newHash},sourceBody=canonical(declaration),id=sha(sourceBody);
   raw.prepare('delete from archive_sources where id=?').run(source.id as string);
   raw.prepare('insert into archive_sources values(?,?,?,?,?)').run(id,docID,source.available_ms as number,sourceBody,sha(canonical([id,sourceBody])));
   raw.prepare('insert or ignore into archive_contents values(?,?)').run(newHash,gzipSync(Buffer.from(xml)));
   const generation=JSON.parse(db.prepare("select body from financial_generations where id='g'").get()!.body as string);
   for(const stored of db.prepare("select * from financial_rows where generation='g'").all()){
    const row=JSON.parse(stored.body as string);row.sourceSha256=newHash;
    if(field==='row-chain'){row.chainDocIDs=['OTHER','B'];row.rootDocID='OTHER'}
    if(field==='row-root')row.rootDocID='OTHER';
    if(field==='row-observations')row.observationIds=['not-the-selected-observation'];
    const body=canonical(row),metadata=['g',stored.row_id,stored.group_id,stored.standard,stored.scope,stored.currency,stored.period_start,stored.period_end,stored.period_type,stored.edinet_code,stored.sec_code,stored.doc_id],digest=sha(canonical([metadata,body]));
    db.prepare('update financial_rows set body=?,sha256=? where generation=? and row_id=?').run(body,digest,'g',stored.row_id as string);
    generation.rows.find((r:any)=>r.id===stored.row_id).sha256=digest;
   }
   const body=canonical(generation);db.prepare("update financial_generations set body=?,sha256=? where id='g'").run(body,sha(canonical(['g',body])));
  }finally{raw.close();db.close()}
  // A genuine index reader still validates every row/hash; rejection must come from raw lineage verification.
  const checked=new FinancialSearchIndex(indexPath,{readOnly:true});try{expect(checked.quality('g').values.available).toBe(5)}finally{checked.close()}
  const archiveHash=sha(readFileSync(archivePath)),result=spawnSync('python3',[resolve('scripts/roadmap/verify-financial-values.py'),indexPath,archivePath,'g',archiveHash],{encoding:'utf8'});
  if(['matching','missing','empty','original-target'].includes(field)){
   expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout)).toMatchObject({method:'python-sqlite-gzip-elementtree-direct-facts-lineage-generic-dei-sql-v5',selectedValues:5,lineageRowsChecked:2,explicitTargetDocumentsChecked:field==='matching'?1:0,legacyCorrectionDocumentsWithoutTarget:['missing','empty'].includes(field)?1:0});
  }else{expect(result.status).toBe(1);expect(result.stdout).toBe('');expect(result.stderr).toContain('Independent financial source verification failed')}
 }finally{rmSync(dir,{recursive:true,force:true})}
});

it.each(['current-Q4-no-duration','current-Q4-no-instant','current-Q4-14','current-Q4-15','current-Q4-18','q4-no-quarter','q4-fiscal-end','q4-quarter-scope','current-FY','current-HY','current-Q1-ytd','current-zero','legacy-consolidated-IFRS','legacy-standalone-JGAAP','prior-instant','prior-duration','main-consolidated','other-standard','declared-period','period-type','quarterly-type','quarter-range','unknown-code','duplicate-dei','generic-standard','generic-scope','generic-current-chronology','generic-filing-before-current','generic-filing-invalid','generic-start-compact','generic-end-compact','generic-fiscal-end-compact'])('主単体IFRSは技術軸だけで比較期を認証せず%sを原DEIから検査する',field=>{
 const dir=mkdtempSync(join(tmpdir(),'standalone-ifrs-verifier-')),archivePath=join(dir,'archive.sqlite'),indexPath=join(dir,'index.sqlite');
 const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex'),canonical=(v:any):string=>JSON.stringify((function sort(x:any):any{return Array.isArray(x)?x.map(sort):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x})(v));
 const code=field.includes('Q4')||field.startsWith('q4-')?'Q4':['current-HY','prior-duration'].includes(field)?'HY':['current-Q1-ytd','quarterly-type'].includes(field)?'Q1':field==='quarter-range'?'Q2':'FY';
 const end=['FY','Q4'].includes(code)?'2026-03-31':code==='Q1'?'2025-06-30':'2025-09-30',priorEnd=String(Number(end.slice(0,4))-1)+end.slice(4),expectedRows=field==='current-Q4-no-duration'||field==='current-Q4-no-instant'?1:2,expectedValues=field==='current-Q4-no-duration'?3:field==='current-Q4-no-instant'?5:field==='legacy-standalone-JGAAP'?5:8;
 const priorPeriod={startDate:'2024-04-01',endDate:priorEnd},quarterPeriod={startDate:'2025-07-01',endDate:'2025-09-30'};
 const dimensions='<xbrli:scenario><xbrldi:explicitMember dimension="jppfs_cor:ConsolidatedOrNonConsolidatedAxis">jppfs_cor:NonConsolidatedMember</xbrldi:explicitMember></xbrli:scenario>';
 const context=(id:string,period:string)=>`<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://disclosure.edinet-fsa.go.jp">E12345-000</xbrli:identifier></xbrli:entity><xbrli:period>${period}</xbrli:period>${dimensions}</xbrli:context>`;
 const fact=(tag:string,value:number,ref:string)=>`<jpigp_cor:${tag} contextRef="${ref}" unitRef="money" decimals="0">${value}</jpigp_cor:${tag}>`;
 const durationFacts=(ref:string)=>['CostOfSalesIFRS','GrossProfitIFRS','SellingGeneralAndAdministrativeExpensesIFRS','ProfitLossBeforeTaxIFRS','IncomeTaxExpenseIFRS'].map((tag,i)=>fact(tag,(i+1)*10,ref)).join('');
 const prior=context('same-axis-prior-instant',`<xbrli:instant>${priorEnd}</xbrli:instant>`)+context('same-axis-prior-duration',`<xbrli:startDate>${priorPeriod.startDate}</xbrli:startDate><xbrli:endDate>${priorEnd}</xbrli:endDate>`)+['CurrentAssetsIFRS','TotalCurrentLiabilitiesIFRS','LiabilitiesIFRS'].map((tag,i)=>fact(tag,(i+1)*100,'same-axis-prior-instant')).join('')+durationFacts('same-axis-prior-duration');
 const quarter=field==='quarter-range'?context('quarter-only',`<xbrli:startDate>${quarterPeriod.startDate}</xbrli:startDate><xbrli:endDate>${quarterPeriod.endDate}</xbrli:endDate>`)+durationFacts('quarter-only'):'';
 let xml=reportingInstance({standard:field==='legacy-standalone-JGAAP'?'Japan GAAP':'IFRS',consolidated:field==='legacy-consolidated-IFRS'||field.startsWith('generic-')?'true':field==='current-zero'?'0':'false',periodCode:code,currentEnd:end,noDuration:field==='current-Q4-no-duration',noInstant:field==='current-Q4-no-instant',...(code==='Q4'?{end:field==='current-Q4-14'?'2026-05-31':field==='current-Q4-18'?'2026-09-30':'2026-06-30',quarterStart:'2026-01-01'}:{}),extra:prior+quarter});
 try{
  const archive=new ObservedFinancialArchive(archivePath,{compression:'gzip'}),index=new FinancialSearchIndex(indexPath);
  try{
   archive.append([{observationId:'A',observedAt:'2026-06-25T00:00:00Z',document:{docID:'A',docTypeCode:code==='FY'?'120':['Q1','Q4'].includes(code)?'140':'160',parentDocID:null,edinetCode:'E12345',secCode:'10010',periodStart:code==='Q4'?'2026-01-01':'2025-04-01',periodEnd:end,submitDateTime:'2026-06-24 09:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'}}],[{docID:'A',xml,sourceSha256:sha(xml),availableAt:'2026-06-26T00:00:00Z'}]);
   expect(index.materialize('g',archive,{cutoff:'2026-10-28T00:00:00Z',extractorVersion:'test'}).rows).toHaveLength(expectedRows);expect(index.quality('g').values.available).toBe(expectedValues);
  }finally{index.close();archive.close()}
  const replaceDei=(tag:string,value:string)=>{const pattern=new RegExp(`(<d:${tag}[^>]*>)[^<]*(</d:${tag}>)`);expect(pattern.test(xml)).toBe(true);xml=xml.replace(pattern,'$1'+value+'$2');};
  if(field==='q4-no-quarter')xml=xml.replace(/<xbrli:context id="arbitrary-quarter">[\s\S]*?<\/xbrli:context>/,'');
  if(field==='q4-fiscal-end')replaceDei('CurrentFiscalYearEndDateDEI',end);
  if(field==='q4-quarter-scope')xml=xml.replace(/(<xbrli:context id="arbitrary-quarter">[\s\S]*?)<xbrli:scenario>[\s\S]*?<\/xbrli:scenario>/,'$1');
  if(field==='generic-filing-before-current'||field==='generic-filing-invalid')xml=xml.replace(/(<xbrli:context id="filing">[\s\S]*?<xbrli:instant>)[^<]*(<\/xbrli:instant>)/,'$1'+(field==='generic-filing-before-current'?'1900-01-01':'not-a-date')+'$2');
  if(field==='generic-start-compact')replaceDei('CurrentFiscalYearStartDateDEI','20250401');
  if(field==='generic-end-compact')replaceDei('CurrentPeriodEndDateDEI','20260331');
  if(field==='generic-fiscal-end-compact')replaceDei('CurrentFiscalYearEndDateDEI','20260331');
  if(field==='generic-standard')replaceDei('AccountingStandardsDEI','Japan GAAP');
  if(field==='generic-scope')replaceDei('WhetherConsolidatedFinancialStatementsArePreparedDEI','false');
  if(field==='generic-current-chronology')replaceDei('CurrentPeriodEndDateDEI','2000-01-01');
  if(field==='main-consolidated')replaceDei('WhetherConsolidatedFinancialStatementsArePreparedDEI','true');
  if(field==='other-standard')replaceDei('AccountingStandardsDEI','Japan GAAP');
  if(field==='declared-period')replaceDei('CurrentPeriodEndDateDEI','2025-12-31');
  if(field==='unknown-code')replaceDei('TypeOfCurrentPeriodDEI','unknown');
  if(field==='duplicate-dei')xml=xml.replace('</xbrli:xbrl>','<d:AccountingStandardsDEI contextRef="filing">IFRS</d:AccountingStandardsDEI></xbrli:xbrl>');
  const sourceHash=sha(xml),raw=new DatabaseSync(archivePath),db=new DatabaseSync(indexPath);
  try{
   const source=raw.prepare("select * from archive_sources where doc_id='A'").get()!,declaration={...JSON.parse(source.body as string),sourceSha256:sourceHash},sourceBody=canonical(declaration),id=sha(sourceBody);
   raw.prepare('delete from archive_sources where id=?').run(source.id as string);raw.prepare('insert into archive_sources values(?,?,?,?,?)').run(id,'A',source.available_ms as number,sourceBody,sha(canonical([id,sourceBody])));raw.prepare('insert or ignore into archive_contents values(?,?)').run(sourceHash,gzipSync(Buffer.from(xml)));
   const generation=JSON.parse(db.prepare("select body from financial_generations where id='g'").get()!.body as string);
   for(const stored of db.prepare("select * from financial_rows where generation='g'").all()){
    const row=JSON.parse(stored.body as string),meta=row.snapshot.metadata;row.sourceSha256=sourceHash;
    const fakePrior=field==='prior-instant'&&row.group==='balanceSheet'||field==='prior-duration'&&row.group==='details',fakeQuarter=field==='quarter-range'&&row.group==='details';
    if(fakePrior||fakeQuarter){meta.period=fakeQuarter?quarterPeriod:row.group==='balanceSheet'?{instant:priorEnd}:priorPeriod;for(const selection of Object.values(row.snapshot.selections) as any[])if(selection.status==='selected')for(const evidence of [selection.source,...selection.evidence.filter((e:any)=>e.reason==='selected'||e.reason==='selected-raw-only')]){evidence.contextRef=fakeQuarter?'quarter-only':row.group==='balanceSheet'?'same-axis-prior-instant':'same-axis-prior-duration';evidence.period=meta.period;}}
    if(['period-type','quarterly-type','quarter-range'].includes(field)&&row.group==='details')meta.periodType=field==='period-type'?'ytd':'quarterly';
    const body=canonical(row),metadata=['g',stored.row_id,row.group,meta.accountingStandard,meta.scope,meta.currency,meta.period.startDate??'',meta.period.endDate??meta.period.instant,meta.periodType??'',row.edinetCode,meta.secCode,meta.docID],digest=sha(canonical([metadata,body]));
    db.prepare('update financial_rows set period_start=?,period_end=?,period_type=?,body=?,sha256=? where generation=? and row_id=?').run(metadata[6],metadata[7],metadata[8],body,digest,'g',stored.row_id as string);
    const manifest=generation.rows.find((r:any)=>r.id===stored.row_id);manifest.metadata=metadata;manifest.sha256=digest;
   }
   const body=canonical(generation);db.prepare("update financial_generations set body=?,sha256=? where id='g'").run(body,sha(canonical(['g',body])));
  }finally{raw.close();db.close()}
  // All money values, technical dimensions, row hashes and SQL projections remain coherent.
  const checked=new FinancialSearchIndex(indexPath,{readOnly:true});try{expect(checked.quality('g').values.available).toBe(expectedValues)}finally{checked.close()}
  const result=spawnSync('python3',['-I',resolve('scripts/roadmap/verify-financial-values.py'),indexPath,archivePath,'g',sha(readFileSync(archivePath))],{encoding:'utf8'});
  if(field.startsWith('current-')||field.startsWith('legacy-')){expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout)).toMatchObject({method:'python-sqlite-gzip-elementtree-direct-facts-lineage-generic-dei-sql-v5',rows:expectedRows,selectedValues:expectedValues,currentStandaloneIfrsRowsChecked:field.startsWith('legacy-')?0:expectedRows,lineageRowsChecked:expectedRows})}
  else{expect(result.status).toBe(1);expect(result.stdout).toBe('');expect(result.stderr).toContain('Independent financial source verification failed')}
 }finally{rmSync(dir,{recursive:true,force:true})}
});
