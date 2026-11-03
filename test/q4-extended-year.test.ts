import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve as path} from 'node:path';
import {execFileSync} from 'node:child_process';
import {resolveFinancialReportingBasis as basis,createAutomaticFinancialSnapshots as automatic,createObservedFinancialSnapshots as observed,calculateCagr,CagrMetricId,type DocumentVersionObservation,type ResolvedFinancialReportingMetadata} from '../src/index';
import {reportingInstance as instance} from './fixtures/financial-reporting-basis';
const options={periodCode:'Q4',start:'2023-04-01',end:'2024-06-30',currentEnd:'2024-03-31',quarterStart:'2024-01-01',filing:'2024-05-13'};
const xml=(extra:Parameters<typeof instance>[0]={})=>instance({...options,...extra});
const observation=(extra={})=>({observationId:'a',observedAt:'2024-05-14T00:00:00Z',document:{docID:'A',parentDocID:null,docTypeCode:'140',edinetCode:'E12345',secCode:'10010',periodStart:'2024-01-01',periodEnd:'2024-03-31',submitDateTime:'2024-05-13 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0',...extra}} satisfies DocumentVersionObservation);
const run=(raw=xml(),extra={})=>observed([observation(extra)],[{docID:'A',availableAt:'2024-05-15T00:00:00Z',sourceSha256:createHash('sha256').update(raw).digest('hex'),xml:raw}],{cutoff:'2024-05-16T00:00:00Z'});
it('15ヶ月年度Q4を12ヶ月YTDとして保持し公式一覧の単四半期と照合する',()=>{
 const r=basis(xml(),'A');expect(r).toMatchObject({version:'4',status:'selected',metadata:{reportingPeriodCode:'Q4',periodType:'ytd',fiscalYear:{endDate:'2024-06-30'},period:{startDate:'2023-04-01',endDate:'2024-03-31'},quarterPeriod:{startDate:'2024-01-01',endDate:'2024-03-31'}}});
 if(r.status!=='selected')throw Error();const publicMetadata:ResolvedFinancialReportingMetadata=r.metadata;expect(publicMetadata.reportingPeriodCode).toBe('Q4');
 expect(automatic(xml(),{docID:'A'})).toMatchObject({status:'resolved',details:{status:'created',snapshot:{metadata:{periodType:'ytd',period:{startDate:'2023-04-01',endDate:'2024-03-31'}}}}});
 expect(run()).toMatchObject({unavailableSources:[],records:[{knownAt:'2024-05-15T00:00:00.000Z',result:{status:'resolved'}}]});
 expect(run(xml(),{periodStart:'2023-04-01'}).unavailableSources[0].reason).toBe('period-mismatch');
 expect(run(xml(),{docTypeCode:'120'}).unavailableSources.length).toBe(1);
});
it.each([{end:'2024-03-31'},{quarterStart:undefined},{quarterStart:'2023-10-01'},{periodCode:'Q5'},{periodCode:'Q0'},{form:'第三号様式'}])('未確認profile/四半期不在を推測しない %j',change=>expect(basis(xml(change),'A').status).toBe('unresolved'));
it('四半期の重複/異scope/別issuer/namespaceを採用しない',()=>{
 const raw=xml(),quarter=raw.match(/<xbrli:context id="arbitrary-quarter">[\s\S]*?<\/xbrli:context>/)![0];
 for(const changed of [raw.replace('</xbrli:xbrl>',quarter+'</xbrli:xbrl>'),raw.replace(quarter,quarter.replace('</xbrli:context>','<xbrli:scenario><xbrldi:explicitMember dimension="jppfs_cor:ConsolidatedOrNonConsolidatedAxis">jppfs_cor:NonConsolidatedMember</xbrldi:explicitMember></xbrli:scenario></xbrli:context>')),raw.replace(quarter,quarter.replace('E12345-000','E99999-000')),raw.replace(quarter,quarter.replaceAll('xbrli:','bad:').replace('<bad:context','<bad:context xmlns:bad="urn:bad"'))])expect(basis(changed,'A').status).toBe('unresolved');
});
it('同じ12ヶ月でもannual growthへ混入しない',()=>{
 const raw=xml();const metadata={secCode:'10010',docID:'A',accountingStandard:'J-GAAP' as const,scope:'Consolidated' as const,currency:'JPY' as const,periodType:'ytd' as const,period:{startDate:'2023-04-01',endDate:'2024-03-31'}};
 expect(calculateCagr([{xml:raw,metadata},{xml:raw,metadata:{...metadata,docID:'B'}}],CagrMetricId.NetSales)).toMatchObject({status:'unavailable',reason:'not-annual'});
});
it('IFRS主単体currentも同じ限定profileだけ通す',()=>{expect(automatic(xml({standard:'IFRS',consolidated:'false'}),{docID:'A'})).toMatchObject({status:'resolved',accountingStandard:'IFRS'});});
it('CLIもQ4/YTDとFYを区別する',()=>{const dir=mkdtempSync(join(tmpdir(),'q4-cli-'));try{const file=join(dir,'q4.xbrl');writeFileSync(file,xml());const result=JSON.parse(execFileSync(process.execPath,['--import','tsx',path('src/cli.ts'),'financial-reporting-basis','--file',file,'--doc-id','A','--with-snapshots'],{encoding:'utf8'}));expect(result).toMatchObject({status:'resolved',basis:{metadata:{reportingPeriodCode:'Q4',periodType:'ytd'}}});}finally{rmSync(dir,{recursive:true,force:true});}});

it.each(['2024-05-31','2024-09-30'])('延長年度%sもQ4の実境界で確定し15ヶ月へ固定しない',end=>expect(basis(xml({end}),'A')).toMatchObject({status:'selected',metadata:{reportingPeriodCode:'Q4',fiscalYear:{endDate:end},periodType:'ytd'}}));
it('通常Q4対応はwhole-attached v1のannual/HYQ2 profileを拡張しない',async()=>{
 const {financialVersionEvidenceFixture,signFinancialVersionBundle,sourceHash}=await import('./fixtures/financial-version-evidence');
 const {authenticateFinancialVersionEvidence,readFinancialVersionProof}=await import('../src/financial-version-selection');
 const b=await financialVersionEvidenceFixture();for(const o of b.observations){o.document.docTypeCode=o.document.parentDocID?'150':'140';if(!o.document.parentDocID){o.document.periodStart='2026-01-01';o.document.periodEnd='2026-03-31';o.document.formCode='040300';}}
 for(const source of b.sources){const s=source as {xml:string;sourceSha256:string};s.xml=s.xml.replace('>FY</d:TypeOfCurrentPeriodDEI>','>Q4</d:TypeOfCurrentPeriodDEI>').replace('>第三号様式</d:DocumentTypeDEI>','>第四号の三様式</d:DocumentTypeDEI>').replace('>2026-03-31</d:CurrentFiscalYearEndDateDEI>','>2026-06-30</d:CurrentFiscalYearEndDateDEI>');s.xml=s.xml.replace('</xbrli:xbrl>','<xbrli:context id="q4"><xbrli:entity><xbrli:identifier scheme="http://disclosure.edinet-fsa.go.jp">E12345-000</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2026-01-01</xbrli:startDate><xbrli:endDate>2026-03-31</xbrli:endDate></xbrli:period></xbrli:context></xbrli:xbrl>');s.sourceSha256=sourceHash(s.xml);expect(basis(s.xml,source.docID).status).toBe('selected');}
 expect(readFinancialVersionProof(await authenticateFinancialVersionEvidence(signFinancialVersionBundle(b))).decisions[0]).toMatchObject({status:'held',reason:'unsupported-form-or-status'});
});

it.each(['Japan GAAP','IFRS'])('%s Q4の主群欠落は実quarterの認証と分離する',standard=>{
 for(const [change,missing,retained,reason] of [
  [{noDuration:true},'details','balanceSheet','current-period-context-absent'],
  [{noInstant:true},'balanceSheet','details','current-period-context-absent'],
  [{duplicateDuration:true},'details','balanceSheet','duplicate-current-period-context'],
 ] as const){
  const raw=xml({standard,...change});expect(basis(raw,'A').status).toBe('selected');
  const result=automatic(raw,{docID:'A'});expect(result.status).toBe('resolved');
  if(result.status!=='resolved')throw Error();expect(result[missing]).toMatchObject({status:'unavailable',reason});expect(result[retained]).toMatchObject({status:'created'});
 }
});

it('Q4の主BS重複も他群を捨てず群別unavailableにする',()=>{
 const raw=xml(),instant=raw.match(/<xbrli:context id="arbitrary-instant">[\s\S]*?<\/xbrli:context>/)![0],duplicate=raw.replace('</xbrli:xbrl>',instant+'</xbrli:xbrl>');
 expect(basis(duplicate,'A').status).toBe('selected');expect(automatic(duplicate,{docID:'A'})).toMatchObject({status:'resolved',balanceSheet:{status:'unavailable',reason:'duplicate-current-period-context'},details:{status:'created'}});
});
