import * as Root from "edinet-ts";
import * as Core from "edinet-ts/core";
import * as Financial from "edinet-ts/financial";
import * as Disclosures from "edinet-ts/disclosures";
import * as Companies from "edinet-ts/companies";
import * as Platform from "edinet-ts/platform";
import * as Registry from "edinet-ts/registry";
const parserConstructor: typeof Root.EdinetXbrlParser = Core.EdinetXbrlParser;
const parser: Root.EdinetXbrlParser = new parserConstructor();
const parse: Root.EdinetXbrlParser["parse"] = parser.parse;
const object: Root.EdinetXbrlObject = new Core.EdinetXbrlObject();
const metric: Root.EdinetXbrlObject["selectMetric"] = object.selectMetric;
const financial: typeof Root.screenFinancialSnapshots = Financial.screenFinancialSnapshots;
const table: typeof Root.extractDisclosureTables = Disclosures.extractDisclosureTables;
const company: typeof Root.queryCompanyMaster = Companies.queryCompanyMaster;
const companyFetcher: typeof Root.fetchEdinetCompanyMaster = Companies.fetchEdinetCompanyMaster;
const index: typeof Root.FinancialSearchIndex = Platform.FinancialSearchIndex;
const registry: typeof Root.CorporateRegistryStore = Registry.CorporateRegistryStore;
const snapshot: Companies.CompanyMasterSnapshot = {} as Root.CompanyMasterSnapshot;
const selected: Financial.FactSelectionResult = {} as Root.FactSelectionResult;
const facilities: Disclosures.FacilityDetailsExtraction = {} as Root.FacilityDetailsExtraction;
const corporateRecord: Registry.CorporateRegistryRecord = {} as Root.CorporateRegistryRecord;
void [
  parse,
  metric,
  financial,
  table,
  company,
  companyFetcher,
  index,
  registry,
  snapshot,
  selected,
  facilities,
  corporateRecord,
];
