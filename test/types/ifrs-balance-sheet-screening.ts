import {createIfrsBalanceSheetSnapshot,screenIfrsBalanceSheetDocuments,IfrsBalanceSheetMetricId,AccountingStandard,ConsolidationScope,ComparisonOperator,type IfrsBalanceSheetMetadata,type BalanceSheetSnapshotMetadata} from '../../src/index';
const metadata:IfrsBalanceSheetMetadata={secCode:'1001',docID:'SYNTHETIC',instant:'2025-03-31',scope:ConsolidationScope.Consolidated,accountingStandard:AccountingStandard.IFRS,currency:'JPY'};
const result=createIfrsBalanceSheetSnapshot('<synthetic/>',metadata);
const hash:string=result.inputXmlSha256;
const found=screenIfrsBalanceSheetDocuments([{xml:'<synthetic/>',metadata}],{conditions:[{metric:IfrsBalanceSheetMetricId.CurrentAssets,operator:ComparisonOperator.GreaterThanOrEqual,value:100}]});
// @ts-expect-error IFRSのmetadataをJ-GAAP専用の契約へ渡せません。
const wrong:BalanceSheetSnapshotMetadata=result.metadata;
const extended=createIfrsBalanceSheetSnapshot('<synthetic/>',metadata,[IfrsBalanceSheetMetricId.NoncurrentAssets]);
const legacyStatus:string=extended.selections.currentAssets.status;
const extraStatus:string|undefined=extended.selections.noncurrentAssets?.status;
void legacyStatus;void extraStatus;void hash;void found;void wrong;
