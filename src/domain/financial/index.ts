// Existing public API names only; leaf implementation helpers stay private.
export {
  BalanceSheetDiffStatus,
  BalanceSheetValueComparison,
  compareBalanceSheetVersions,
} from "../../platform/queries/financial/compare-balance-sheet-versions";
export type {
  BalanceSheetComparisonIssue,
  BalanceSheetMetricDiff,
  BalanceSheetVersionDiff,
} from "../../platform/queries/financial/compare-balance-sheet-versions";
export {
  CagrMetricId,
  PerShareGrowthMetricId,
  calculateCagr,
  calculatePerShareGrowth,
  screenCagr,
  screenPerShareGrowth,
} from "./analysis/annual-cagr";
export type {
  BasicCagrMetricId,
  CagrCondition,
  CagrPoint,
  CagrResult,
  CagrScreeningOptions,
  CagrUnavailableReason,
  PerShareAnnualPair,
  PerShareCagrMetricId,
  PerShareGrowthResult,
} from "./analysis/annual-cagr";
export {
  AnnualNetIncomeGrowthMetricId,
  calculateAnnualNetIncomeGrowth,
  screenAnnualNetIncomeGrowth,
} from "./analysis/annual-net-income-growth";
export type {
  AnnualNetIncomeDocument,
  AnnualNetIncomeGrowthCondition,
  AnnualNetIncomeGrowthResult,
  AnnualNetIncomeGrowthScreeningOptions,
  AnnualNetIncomeGrowthScreeningResult,
  AnnualNetIncomeMetadata,
  AnnualNetIncomePair,
  AnnualNetIncomePoint,
} from "./analysis/annual-net-income-growth";
export {
  AnnualOperatingIncomeGrowthMetricId,
  calculateAnnualOperatingIncomeGrowth,
  screenAnnualOperatingIncomeGrowth,
} from "./analysis/annual-operating-income-growth";
export type {
  AnnualOperatingIncomeDocument,
  AnnualOperatingIncomeGrowthCondition,
  AnnualOperatingIncomeGrowthResult,
  AnnualOperatingIncomeGrowthScreeningOptions,
  AnnualOperatingIncomeGrowthScreeningResult,
  AnnualOperatingIncomeMetadata,
  AnnualOperatingIncomePair,
  AnnualOperatingIncomePoint,
} from "./analysis/annual-operating-income-growth";
export {
  AnnualGrowthMetricId,
  AnnualGrowthUnavailableReason,
  calculateAnnualRevenueGrowth,
  screenAnnualRevenueGrowth,
} from "./analysis/annual-revenue-growth";
export type {
  AnnualGrowthCondition,
  AnnualGrowthScreeningOptions,
  AnnualGrowthScreeningResult,
  AnnualRevenueDocument,
  AnnualRevenueGrowthResult,
  AnnualRevenueMetadata,
  AnnualRevenuePair,
  AnnualRevenuePoint,
} from "./analysis/annual-revenue-growth";
export {
  AverageAssetsReturnMetricId,
  calculateAverageAssetsReturn,
  screenAverageAssetsReturn,
} from "./analysis/average-assets-return";
export type {
  AverageAssetsReturnInput,
  AverageAssetsReturnOptions,
  AverageAssetsReturnResult,
  AverageAssetsReturnUnavailableReason,
} from "./analysis/average-assets-return";
export {
  calculateAverageEquityReturn,
  screenAverageEquityReturn,
} from "./analysis/average-equity-return";
export type {
  AverageEquityReturnInput,
  AverageEquityReturnReason,
  AverageEquityReturnResult,
} from "./analysis/average-equity-return";
export { ROIC_DEBT_METRICS, calculateRoic, screenRoic } from "./analysis/roic";
export type {
  RoicCapitalDeclaration,
  RoicCapitalDocument,
  RoicDebtMetricId,
  RoicInput,
  RoicResult,
  RoicUnavailableReason,
} from "./analysis/roic";
export { selectLocalClosingPrice } from "./analysis/select-local-closing-price";
export type {
  LocalClosingPriceResult,
  LocalPriceRequest,
  LocalPriceRow,
} from "./analysis/select-local-closing-price";
export type {
  PerShareAnnualDocument,
  ShareBasis,
  ShareBasisAssessment,
  ShareBasisProofKey,
} from "./analysis/share-basis";
export {
  adjustPerShareValuesForSplits,
  reconstructAnnualDividendPerShare,
} from "./analysis/share-split-adjustment";
export type {
  AdjustedPerSharePoint,
  AnnualDividendPayment,
  AnnualDividendPaymentStatus,
  AnnualDividendReconstructionOptions,
  AnnualDividendReconstructionResult,
  AnnualDividendUnavailableReason,
  ReconstructedAnnualDividendPayment,
  ShareSplitAdjustmentOptions,
  ShareSplitAdjustmentResult,
  ShareSplitEvent,
  ShareSplitLedger,
  ShareSplitSource,
  ShareSplitUnavailableReason,
} from "./analysis/share-split-adjustment";
export { ValuationMetricId, calculateValuation, screenValuation } from "./analysis/valuation";
export type {
  PriceShareBasis,
  ValuationInput,
  ValuationResult,
  ValuationUnavailableReason,
} from "./analysis/valuation";
export {
  BALANCE_SHEET_REGISTRY,
  BALANCE_SHEET_REGISTRY_VERSION,
} from "./extraction/balance-sheet-metric-definitions";
export type { BalanceSheetMetricId } from "./extraction/balance-sheet-metric-definitions";
export {
  DEFAULT_FINANCIAL_DETAIL_METRICS,
  FINANCIAL_DETAIL_REGISTRY,
  FINANCIAL_DETAIL_REGISTRY_VERSION,
  FinancialDetailMetricId,
} from "./extraction/detail-metric-definitions";
export {
  DEFAULT_IFRS_BALANCE_SHEET_METRICS,
  IFRS_BALANCE_SHEET_REGISTRY,
  IFRS_BALANCE_SHEET_REGISTRY_VERSION,
  IfrsBalanceSheetMetricId,
} from "./extraction/ifrs-balance-sheet-metric-definitions";
export {
  DEFAULT_IFRS_FINANCIAL_DETAIL_METRICS,
  IFRS_FINANCIAL_DETAIL_REGISTRY,
  IFRS_FINANCIAL_DETAIL_REGISTRY_VERSION,
  IfrsFinancialDetailMetricId,
} from "./extraction/ifrs-detail-metric-definitions";
export {
  AccountingStandard,
  METRIC_REGISTRY,
  METRIC_REGISTRY_VERSION,
  MetricId,
} from "./extraction/metric-definitions";
export type { MetricDefinition, MetricUnit } from "./extraction/metric-definitions";
export {
  FINANCIAL_REPORTING_BASIS_VERSION,
  resolveFinancialReportingBasis,
} from "./extraction/resolve-reporting-basis";
export type {
  FinancialReportingBasis,
  FinancialReportingBasisField,
  FinancialReportingBasisIssue,
  ReportingBasisEvidence,
  ReportingBasisFieldSelection,
  ResolvedFinancialReportingMetadata,
} from "./extraction/resolve-reporting-basis";
export {
  identicalMetricFacts,
  selectDefinedMetricFact,
  selectMetricFact,
  toSafeMetricNumber,
} from "./extraction/select-metric-facts";
export type {
  FactSelectionEvidence,
  FactSelectionResult,
  MetricFactBehavior,
  MetricSelectionOptions,
  SelectionReason,
} from "./extraction/select-metric-facts";
export {
  ComparisonOperator,
  ConsolidationScope,
  FinancialPeriodType,
  SortOrder,
} from "./financial-types";
export { measureFinancialDetailCoverage } from "./screening/measure-detail-coverage";
export type {
  CoverageDocument,
  FinancialCoverageState,
  FinancialDetailCoverageInput,
} from "./screening/measure-detail-coverage";
export {
  BalanceSheetScreeningMetric,
  CURRENT_RATIO_DEFINITION,
  calculateCurrentRatio,
  createBalanceSheetSnapshot,
  screenBalanceSheetSnapshots,
} from "./screening/screen-balance-sheets";
export type {
  BalanceSheetCondition,
  BalanceSheetDiagnostic,
  BalanceSheetScreeningOptions,
  BalanceSheetScreeningResult,
  BalanceSheetScreeningRow,
  BalanceSheetSnapshot,
  BalanceSheetSnapshotMetadata,
  CurrentRatioResult,
  CurrentRatioUnavailableReason,
} from "./screening/screen-balance-sheets";
export {
  createFinancialDetailSnapshot,
  screenFinancialDetailDocuments,
} from "./screening/screen-financial-details";
export type {
  FinancialDetailCondition,
  FinancialDetailDiagnostic,
  FinancialDetailDocument,
  FinancialDetailMetadata,
  FinancialDetailScreeningOptions,
  FinancialDetailScreeningResult,
  FinancialDetailSnapshot,
} from "./screening/screen-financial-details";
export {
  FINANCIAL_SCREENING_METRICS,
  calculateFinancialMetrics,
  screenFinancialSnapshots,
} from "./screening/screen-financial-snapshots";
export type {
  DerivedFinancialMetrics,
  FinancialCondition,
  FinancialScreeningMetric,
  FinancialScreeningOptions,
  FinancialScreeningResult,
  FinancialSnapshot,
} from "./screening/screen-financial-snapshots";
export {
  IFRS_BALANCE_SHEET_SCREENING_MAX_CONDITIONS,
  IFRS_BALANCE_SHEET_SCREENING_MAX_DOCUMENTS,
  createIfrsBalanceSheetSnapshot,
  screenIfrsBalanceSheetDocuments,
} from "./screening/screen-ifrs-balance-sheets";
export type {
  IfrsBalanceSheetCondition,
  IfrsBalanceSheetDiagnostic,
  IfrsBalanceSheetDocument,
  IfrsBalanceSheetMetadata,
  IfrsBalanceSheetScreeningOptions,
  IfrsBalanceSheetScreeningResult,
  IfrsBalanceSheetSnapshot,
} from "./screening/screen-ifrs-balance-sheets";
export {
  IFRS_FINANCIAL_DETAIL_SCREENING_MAX_CONDITIONS,
  IFRS_FINANCIAL_DETAIL_SCREENING_MAX_DOCUMENTS,
  createIfrsFinancialDetailSnapshot,
  screenIfrsFinancialDetailDocuments,
} from "./screening/screen-ifrs-financial-details";
export type {
  IfrsFinancialDetailCondition,
  IfrsFinancialDetailDiagnostic,
  IfrsFinancialDetailDocument,
  IfrsFinancialDetailMetadata,
  IfrsFinancialDetailScreeningOptions,
  IfrsFinancialDetailScreeningResult,
  IfrsFinancialDetailSnapshot,
} from "./screening/screen-ifrs-financial-details";
export {
  normalizeFinancialDetailSnapshot,
  screenFinancialDetailSnapshots,
} from "./screening/screen-saved-financial-details";
export {
  FINANCIAL_VERSION_POLICY,
  authenticateFinancialVersionEvidence,
  financialVersionEvidenceManifestSha256,
  readFinancialVersionProof,
  verifyFinancialVersionContext,
} from "./selection/select-financial-source-versions";
export type {
  AuthenticatedFinancialVersionContext,
  FinancialVersionDecision,
  FinancialVersionEvidenceBundle,
  FinancialVersionEvidenceInput,
  FinancialVersionHoldReason,
  FinancialVersionIdentity,
  FinancialVersionOptions,
  FinancialVersionProof,
  FinancialVersionRuntimeBinding,
  FinancialVersionSourceProof,
  FinancialVersionZipEvidence,
  FinancialVersionZipProof,
} from "./selection/select-financial-source-versions";
export { createAutomaticFinancialSnapshots } from "./snapshots/create-financial-snapshots";
export type {
  AutomaticFinancialSnapshotOptions,
  AutomaticFinancialSnapshots,
} from "./snapshots/create-financial-snapshots";
export {
  OBSERVED_FINANCIAL_SNAPSHOT_VERSION,
  createObservedFinancialSnapshots,
} from "./snapshots/create-observed-snapshots";
export type {
  ObservedFinancialSnapshotOptions,
  ObservedFinancialSnapshotRecord,
  ObservedFinancialSource,
  ObservedFinancialSourceReason,
} from "./snapshots/create-observed-snapshots";
export { createSourceBackedObservedFinancialSnapshots } from "./snapshots/create-versioned-snapshots";
export type { SourceBackedObservedFinancialSnapshots } from "./snapshots/create-versioned-snapshots";
