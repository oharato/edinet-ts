import type { CompanyFinancialComparison, CompanyMetadata, FinancialMetrics } from "../types.js";
import type { ParsedFact, ParsedXbrlDocument } from "../xbrl/parser.js";

// 優先的に検索するタグ（ローカル名）
const NET_SALES_TAGS = [
  "NetSalesSummaryOfBusinessResults",
  "RevenueIFRSSummaryOfBusinessResults",
  "NetSales",
  "Revenue",
  "OperatingRevenue1",
];

const OPERATING_INCOME_TAGS = [
  "OperatingIncomeSummaryOfBusinessResults",
  "OperatingIncomeIFRSSummaryOfBusinessResults",
  "OperatingProfitIFRSSummaryOfBusinessResults",
  "OperatingIncome",
  "OperatingProfit",
];

const ORDINARY_INCOME_TAGS = ["OrdinaryIncomeSummaryOfBusinessResults", "OrdinaryIncome"];

const NET_INCOME_TAGS = [
  "ProfitLossAttributableToOwnersOfParentIFRSSummaryOfBusinessResults",
  "ProfitLossAttributableToOwnersOfParent",
  "NetIncomeSummaryOfBusinessResults",
  "NetIncome",
  "ProfitLoss",
];

const NET_ASSETS_TAGS = [
  "NetAssetsSummaryOfBusinessResults",
  "EquityAttributableToOwnersOfParentIFRSSummaryOfBusinessResults",
  "NetAssets",
  "TotalEquity",
];

const TOTAL_ASSETS_TAGS = [
  "TotalAssetsSummaryOfBusinessResults",
  "TotalAssetsIFRSSummaryOfBusinessResults",
  "Assets",
  "TotalAssets",
];

const OPERATING_CF_TAGS = [
  "NetCashProvidedByUsedInOperatingActivitiesSummaryOfBusinessResults",
  "CashFlowsFromUsedInOperatingActivitiesIFRSSummaryOfBusinessResults",
  "NetCashProvidedByUsedInOperatingActivities",
  "OperatingCashFlow",
];

const INVESTING_CF_TAGS = [
  "NetCashProvidedByUsedInInvestingActivitiesSummaryOfBusinessResults",
  "CashFlowsFromUsedInInvestingActivitiesIFRSSummaryOfBusinessResults",
  "NetCashProvidedByUsedInInvestmentActivities",
  "NetCashProvidedByUsedInInvestingActivities",
];

const CASH_EQUIVALENTS_TAGS = [
  "CashAndCashEquivalentsSummaryOfBusinessResults",
  "CashAndCashEquivalentsIFRSSummaryOfBusinessResults",
  "CashAndCashEquivalents",
  "CashAndDeposits",
];

const DIVIDEND_PER_SHARE_TAGS = [
  "DividendPaidPerShareSummaryOfBusinessResults",
  "CashDividendsPaidPerShare",
];

const EPS_TAGS = [
  "BasicEarningsLossPerShareSummaryOfBusinessResults",
  "BasicEarningsLossPerShareIFRSSummaryOfBusinessResults",
  "BasicEarningsLossPerShare",
];

const BPS_TAGS = [
  "NetAssetsPerShareSummaryOfBusinessResults",
  "NetAssetsPerShareIFRSSummaryOfBusinessResults",
  "NetAssetsPerShare",
];

const EMPLOYEES_TAGS = ["NumberOfEmployees"];

export class FinancialExtractor {
  public extract(doc: ParsedXbrlDocument): CompanyFinancialComparison {
    const metadata = this.extractMetadata(doc);

    // 連結データがあるか判定
    const hasConsolidated = this.hasFactForScope(doc, "CurrentYearDuration");
    const scopeSuffix = hasConsolidated ? "" : "_NonConsolidatedMember";

    const currentDurationId = `CurrentYearDuration${scopeSuffix}`;
    const priorDurationId = `Prior1YearDuration${scopeSuffix}`;
    const currentInstantId = `CurrentYearInstant${scopeSuffix}`;
    const priorInstantId = `Prior1YearInstant${scopeSuffix}`;

    const currentMetrics = this.extractMetricsForContext(
      doc,
      currentDurationId,
      currentInstantId,
      hasConsolidated,
    );
    const priorMetrics = this.extractMetricsForContext(
      doc,
      priorDurationId,
      priorInstantId,
      hasConsolidated,
    );

    // 利益率・成長率の計算
    const operatingMarginCurrent =
      currentMetrics.netSales && currentMetrics.operatingIncome !== undefined
        ? currentMetrics.operatingIncome / currentMetrics.netSales
        : undefined;

    const operatingMarginPrior =
      priorMetrics.netSales && priorMetrics.operatingIncome !== undefined
        ? priorMetrics.operatingIncome / priorMetrics.netSales
        : undefined;

    const operatingMarginDelta =
      operatingMarginCurrent !== undefined && operatingMarginPrior !== undefined
        ? operatingMarginCurrent - operatingMarginPrior
        : undefined;

    const operatingMarginGrowthRate =
      operatingMarginCurrent !== undefined &&
      operatingMarginPrior !== undefined &&
      operatingMarginPrior !== 0
        ? (operatingMarginCurrent - operatingMarginPrior) / Math.abs(operatingMarginPrior)
        : undefined;

    const salesGrowthRate =
      currentMetrics.netSales !== undefined &&
      priorMetrics.netSales !== undefined &&
      priorMetrics.netSales !== 0
        ? (currentMetrics.netSales - priorMetrics.netSales) / Math.abs(priorMetrics.netSales)
        : undefined;

    const operatingIncomeGrowthRate =
      currentMetrics.operatingIncome !== undefined &&
      priorMetrics.operatingIncome !== undefined &&
      priorMetrics.operatingIncome !== 0
        ? (currentMetrics.operatingIncome - priorMetrics.operatingIncome) /
          Math.abs(priorMetrics.operatingIncome)
        : undefined;

    // 自己資本比率 (NetAssets / TotalAssets)
    const equityRatioCurrent =
      currentMetrics.netAssets !== undefined &&
      currentMetrics.totalAssets !== undefined &&
      currentMetrics.totalAssets > 0
        ? currentMetrics.netAssets / currentMetrics.totalAssets
        : undefined;

    const equityRatioPrior =
      priorMetrics.netAssets !== undefined &&
      priorMetrics.totalAssets !== undefined &&
      priorMetrics.totalAssets > 0
        ? priorMetrics.netAssets / priorMetrics.totalAssets
        : undefined;

    // ROE (NetIncome / NetAssets)
    const roeCurrent =
      currentMetrics.netIncome !== undefined &&
      currentMetrics.netAssets !== undefined &&
      currentMetrics.netAssets > 0
        ? currentMetrics.netIncome / currentMetrics.netAssets
        : undefined;

    // ROA (NetIncome / TotalAssets)
    const roaCurrent =
      currentMetrics.netIncome !== undefined &&
      currentMetrics.totalAssets !== undefined &&
      currentMetrics.totalAssets > 0
        ? currentMetrics.netIncome / currentMetrics.totalAssets
        : undefined;

    // フリーキャッシュフロー (営業CF + 投資CF)
    const freeCashFlowCurrent =
      currentMetrics.operatingCashFlow !== undefined &&
      currentMetrics.investingCashFlow !== undefined
        ? currentMetrics.operatingCashFlow + currentMetrics.investingCashFlow
        : undefined;

    const freeCashFlowPrior =
      priorMetrics.operatingCashFlow !== undefined && priorMetrics.investingCashFlow !== undefined
        ? priorMetrics.operatingCashFlow + priorMetrics.investingCashFlow
        : undefined;

    // 従業員1人当たり営業利益 (営業利益 / 従業員数)
    const operatingIncomePerEmployee =
      currentMetrics.operatingIncome !== undefined &&
      currentMetrics.numberOfEmployees !== undefined &&
      currentMetrics.numberOfEmployees > 0
        ? currentMetrics.operatingIncome / currentMetrics.numberOfEmployees
        : undefined;

    // 配当成長率
    const dividendGrowthRate =
      currentMetrics.dividendPerShare !== undefined &&
      priorMetrics.dividendPerShare !== undefined &&
      priorMetrics.dividendPerShare > 0
        ? (currentMetrics.dividendPerShare - priorMetrics.dividendPerShare) /
          priorMetrics.dividendPerShare
        : undefined;

    return {
      metadata,
      current: currentMetrics,
      prior: priorMetrics,
      operatingMarginCurrent,
      operatingMarginPrior,
      operatingMarginGrowthRate,
      operatingMarginDelta,
      salesGrowthRate,
      operatingIncomeGrowthRate,
      equityRatioCurrent,
      equityRatioPrior,
      roeCurrent,
      roaCurrent,
      freeCashFlowCurrent,
      freeCashFlowPrior,
      operatingIncomePerEmployee,
      dividendGrowthRate,
    };
  }

  private extractMetadata(doc: ParsedXbrlDocument): CompanyMetadata {
    const companyName =
      doc.dei.get("FilerNameInJapaneseDEI") || doc.dei.get("CompanyName") || "Unknown Company";

    let securityCode = doc.dei.get("SecurityCodeDEI");
    if (securityCode && securityCode.length === 5 && securityCode.endsWith("0")) {
      securityCode = securityCode.substring(0, 4);
    }

    const edinetCode =
      doc.dei.get("EdinetCodeDEI") ||
      doc.dei.get("EDINETCodeDEI") ||
      doc.facts.find((f) => f.name === "identifier")?.value ||
      "";

    const periodEnd =
      doc.dei.get("CurrentFiscalYearEndDateDEI") || doc.dei.get("PeriodEndDate") || "";

    return {
      edinetCode,
      securityCode,
      companyName,
      periodEnd,
    };
  }

  private hasFactForScope(doc: ParsedXbrlDocument, contextId: string): boolean {
    return doc.facts.some(
      (f) =>
        f.contextRef === contextId &&
        (NET_SALES_TAGS.includes(f.name) || OPERATING_INCOME_TAGS.includes(f.name)),
    );
  }

  private extractMetricsForContext(
    doc: ParsedXbrlDocument,
    durationContextId: string,
    instantContextId: string,
    isConsolidated: boolean,
  ): FinancialMetrics {
    const netSales = this.findFirstNumericFact(doc, NET_SALES_TAGS, durationContextId);
    const operatingIncome = this.findFirstNumericFact(
      doc,
      OPERATING_INCOME_TAGS,
      durationContextId,
    );
    const ordinaryIncome = this.findFirstNumericFact(doc, ORDINARY_INCOME_TAGS, durationContextId);
    const netIncome = this.findFirstNumericFact(doc, NET_INCOME_TAGS, durationContextId);
    const operatingCashFlow = this.findFirstNumericFact(doc, OPERATING_CF_TAGS, durationContextId);
    const investingCashFlow = this.findFirstNumericFact(doc, INVESTING_CF_TAGS, durationContextId);
    const dividendPerShare = this.findFirstNumericFact(
      doc,
      DIVIDEND_PER_SHARE_TAGS,
      durationContextId,
    );
    const eps = this.findFirstNumericFact(doc, EPS_TAGS, durationContextId);

    const netAssets = this.findFirstNumericFact(doc, NET_ASSETS_TAGS, instantContextId);
    const totalAssets = this.findFirstNumericFact(doc, TOTAL_ASSETS_TAGS, instantContextId);
    const cashAndEquivalents = this.findFirstNumericFact(
      doc,
      CASH_EQUIVALENTS_TAGS,
      instantContextId,
    );
    const bps = this.findFirstNumericFact(doc, BPS_TAGS, instantContextId);
    const numberOfEmployees = this.findFirstNumericFact(doc, EMPLOYEES_TAGS, instantContextId);

    return {
      netSales,
      operatingIncome,
      ordinaryIncome,
      netIncome,
      netAssets,
      totalAssets,
      operatingCashFlow,
      investingCashFlow,
      cashAndEquivalents,
      dividendPerShare,
      eps,
      bps,
      numberOfEmployees,
      isConsolidated,
    };
  }

  private findFirstNumericFact(
    doc: ParsedXbrlDocument,
    candidateTags: string[],
    contextId: string,
  ): number | undefined {
    for (const tag of candidateTags) {
      const fact = doc.facts.find(
        (f) => f.name === tag && f.contextRef === contextId && f.numericValue !== undefined,
      );
      if (fact && fact.numericValue !== undefined) {
        return fact.numericValue;
      }
    }
    return undefined;
  }
}
