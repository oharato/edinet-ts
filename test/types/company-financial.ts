import {FinancialSearchIndex,screenCompanyFinancials,screenDuckCompanyFinancials,type CompanyMasterSnapshot,type CompanyFinancialScreeningOptions,type CompanyFinancialScreeningResult} from '../../dist/index.js';
const master:CompanyMasterSnapshot={asOf:'2026-10-29',observedAt:'2026-10-29T03:00:00Z',sourceUrl:'https://example.test/master.csv',sourceSha256:'a'.repeat(64),records:[]};
const options:CompanyFinancialScreeningOptions={cohort:{generation:'fixed-generation',group:'details',accountingStandard:'J-GAAP',scope:'Consolidated',currency:'JPY',period:{startDate:'2025-04-01',endDate:'2026-03-31'},periodType:'annual'},company:{asOf:'2026-10-29',industry:'建設業',listingStatus:'listed'},search:{metricIds:['costOfSales'],sortBy:'costOfSales'}};
const result:CompanyFinancialScreeningResult=screenCompanyFinancials('financial.sqlite',[master],options);
const entity:string|undefined=result.rows[0]?.company.edinetCode;
const amount:number|undefined=result.rows[0]?.financial.snapshot.selections.costOfSales?.safeNumber;
if(result.master.status==='available'){const source:string=result.master.sourceSha256;void source}
const reader=new FinancialSearchIndex('financial.sqlite',{readOnly:true});const fingerprint:string=reader.snapshotSha256();reader.close();void [entity,amount,fingerprint];
// @ts-expect-error マスターのknownAtを財務世代と別に指定できない。
const invalid:CompanyFinancialScreeningOptions={...options,company:{...options.company,knownAt:'2027-01-01T00:00:00Z'}};void invalid;

import {compareCompanyFinancialsByIndustry,compareDuckCompanyFinancialsByIndustry,type CompanyIndustryComparisonResult} from '../../dist/index.js';
const comparison:CompanyIndustryComparisonResult=compareCompanyFinancialsByIndustry('financial.sqlite',[master],{cohort:options.cohort,company:options.company,metricIds:['costOfSales']});
const exactMean:string|undefined=comparison.industries[0]?.metrics[0]?.mean.numerator;void exactMean;
const duckScreen:Promise<CompanyFinancialScreeningResult>=screenDuckCompanyFinancials('financial.duckdb',[master],options);
const duckComparison:Promise<CompanyIndustryComparisonResult>=compareDuckCompanyFinancialsByIndustry('financial.duckdb',[master],{cohort:options.cohort,company:options.company,metricIds:['costOfSales']});
void [duckScreen,duckComparison];
