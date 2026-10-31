import {resolveFinancialReportingBasis, createAutomaticFinancialSnapshots, type ResolvedFinancialReportingMetadata} from '../../src/index';
export function readCurrentQ4(xml:string,docID:string):ResolvedFinancialReportingMetadata|undefined {
 const basis=resolveFinancialReportingBasis(xml,docID);
 if(basis.status==='selected'&&basis.metadata.reportingPeriodCode==='Q4') {
  const code:'Q4'=basis.metadata.reportingPeriodCode;
  const kind:'annual'|'ytd'=basis.metadata.periodType;
  void code;void kind;
  return basis.metadata;
 }
 return undefined;
}
export const automatic=createAutomaticFinancialSnapshots;
// @ts-expect-error Q5 is not an authenticated period code.
const unsupported:ResolvedFinancialReportingMetadata['reportingPeriodCode']='Q5';
void unsupported;
