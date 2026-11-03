import {afterEach,expect,it,vi} from 'vitest';
import * as sdk from '../src/index';
import {EdinetXbrlParser} from '../src/edinet-xbrl-parser';
import * as details from '../src/financial-detail-screening';
import * as ifrsBs from '../src/ifrs-balance-sheet-screening';
import {IfrsBalanceSheetMetricId} from '../src/ifrs-balance-sheet-registry';
import {reportingInstance as xml} from './fixtures/financial-reporting-basis';
afterEach(()=>vi.restoreAllMocks());
it.each(['Japan GAAP','IFRS'])('%sは1parseで公開XML入口の全結果/原値/来歴と一致する',standard=>{
 const raw=xml({standard}),spy=vi.spyOn(EdinetXbrlParser.prototype,'parse');
 const actual=sdk.createAutomaticFinancialSnapshots(raw,{docID:'A'});
 expect(spy).toHaveBeenCalledTimes(1);
 const basis=sdk.resolveFinancialReportingBasis(raw,'A');if(basis.status!=='selected')throw Error();
 const common={secCode:'10010',docID:'A',scope:'Consolidated' as const,currency:'JPY' as const};
 const expected={status:'resolved',accountingStandard:standard==='IFRS'?'IFRS':'J-GAAP',basis,inputXmlSha256:basis.inputXmlSha256,targetCurrency:'JPY',
  balanceSheet:{status:'created',snapshot:standard==='IFRS'?sdk.createIfrsBalanceSheetSnapshot(raw,{...common,accountingStandard:'IFRS',instant:basis.metadata.instant},Object.values(IfrsBalanceSheetMetricId)):sdk.createBalanceSheetSnapshot(raw,{...common,accountingStandard:'J-GAAP',instant:basis.metadata.instant})},
  details:{status:'created',snapshot:standard==='IFRS'?sdk.createIfrsFinancialDetailSnapshot(raw,{...common,accountingStandard:'IFRS',period:basis.metadata.period,periodType:basis.metadata.periodType}):sdk.createFinancialDetailSnapshot(raw,{...common,accountingStandard:'J-GAAP',period:basis.metadata.period,periodType:basis.metadata.periodType})}};
 expect(actual).toEqual(expected);
 // The public J-GAAP detail default also includes instant metrics only for instant metadata.
 expect(spy).toHaveBeenCalledTimes(4);
 if(actual.status==='resolved'&&actual.details.status==='created'){
  actual.details.snapshot.metadata.secCode='99990';
  expect(sdk.createAutomaticFinancialSnapshots(raw,{docID:'A'})).toEqual(expected);
 }
});
it('内部object/XML helperをroot SDKへ公開せず既存value exportを維持する',()=>{
 for(const name of ['createFinancialDetailSnapshotFromObject','createIfrsBalanceSheetSnapshotFromObject','createIfrsFinancialDetailSnapshotFromObject','parseFinancialReportingObject'])expect(sdk).not.toHaveProperty(name);
 for(const [name,value] of Object.entries({...details,...ifrsBs}))if(!name.endsWith('FromObject'))expect(sdk[name as keyof typeof sdk]).toBe(value);
});
it.each([{standard:'US GAAP'},{standard:'IFRS',consolidated:'false'},{duplicateDuration:true},{noInstant:true},{noDuration:true}])('保留/対象外/context欠落でも同じXMLを再parseしない %j',options=>{
 const spy=vi.spyOn(EdinetXbrlParser.prototype,'parse');sdk.createAutomaticFinancialSnapshots(xml(options),{docID:'A'});expect(spy).toHaveBeenCalledTimes(1);
});
