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

const ORDINARY_INCOME_TAGS = [
  "OrdinaryIncomeSummaryOfBusinessResults",
  "OrdinaryIncome",
];

const NET_INCOME_TAGS = [
  "ProfitLossAttributableToOwnersOfParentIFRSSummaryOfBusinessResults",
  "ProfitLossAttributableToOwnersOfParent",
  "NetIncomeSummaryOfBusinessResults",
  "NetIncome",
  "ProfitLoss",
];

export class FinancialExtractor {
  public extract(doc: ParsedXbrlDocument): CompanyFinancialComparison {
    const metadata = this.extractMetadata(doc);

    // 連結データがあるか判定（連結のCurrentYearDurationで売上または営業利益が存在するか）
    const hasConsolidated = this.hasFactForScope(doc, "CurrentYearDuration", true);
    const scopeSuffix = hasConsolidated ? "" : "_NonConsolidatedMember";

    const currentContextId = `CurrentYearDuration${scopeSuffix}`;
    const priorContextId = `Prior1YearDuration${scopeSuffix}`;

    const currentMetrics = this.extractMetricsForContext(doc, currentContextId, hasConsolidated);
    const priorMetrics = this.extractMetricsForContext(doc, priorContextId, hasConsolidated);

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
    };
  }

  private extractMetadata(doc: ParsedXbrlDocument): CompanyMetadata {
    const companyName =
      doc.dei.get("FilerNameInJapaneseDEI") ||
      doc.dei.get("CompanyName") ||
      "Unknown Company";

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
      doc.dei.get("CurrentFiscalYearEndDateDEI") ||
      doc.dei.get("PeriodEndDate") ||
      "";

    return {
      edinetCode,
      securityCode,
      companyName,
      periodEnd,
    };
  }

  private hasFactForScope(doc: ParsedXbrlDocument, contextId: string, isConsolidated: boolean): boolean {
    return doc.facts.some(
      (f) =>
        f.contextRef === contextId &&
        (NET_SALES_TAGS.includes(f.name) || OPERATING_INCOME_TAGS.includes(f.name)),
    );
  }

  private extractMetricsForContext(
    doc: ParsedXbrlDocument,
    contextId: string,
    isConsolidated: boolean,
  ): FinancialMetrics {
    const netSales = this.findFirstNumericFact(doc, NET_SALES_TAGS, contextId);
    const operatingIncome = this.findFirstNumericFact(doc, OPERATING_INCOME_TAGS, contextId);
    const ordinaryIncome = this.findFirstNumericFact(doc, ORDINARY_INCOME_TAGS, contextId);
    const netIncome = this.findFirstNumericFact(doc, NET_INCOME_TAGS, contextId);

    return {
      netSales,
      operatingIncome,
      ordinaryIncome,
      netIncome,
      isConsolidated,
    };
  }

  private findFirstNumericFact(
    doc: ParsedXbrlDocument,
    candidateTags: string[],
    contextId: string,
  ): number | undefined {
    for (const tag of candidateTags) {
      // 完全一致（ローカル名）かつコンテキストID一致
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
