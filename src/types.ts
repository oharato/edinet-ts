/**
 * 企業および有価証券報告書の基本メタデータ
 */
export interface CompanyMetadata {
  edinetCode: string;
  securityCode?: string;
  companyName: string;
  periodEnd: string; // YYYY-MM-DD
}

/**
 * 1期間分の財務指標（金額単位: 円）
 */
export interface FinancialMetrics {
  netSales?: number; // 売上高 / 営業収益
  operatingIncome?: number; // 営業利益
  ordinaryIncome?: number; // 経常利益
  netIncome?: number; // 当期純利益 (親会社株主に帰属する当期純利益)
  netAssets?: number; // 純資産 (自己資本)
  totalAssets?: number; // 総資産
  operatingCashFlow?: number; // 営業キャッシュフロー
  isConsolidated: boolean; // 連結か単体か
}

/**
 * 当期・前期の比較財務データと計算された指標・成長率
 */
export interface CompanyFinancialComparison {
  metadata: CompanyMetadata;
  current: FinancialMetrics;
  prior: FinancialMetrics;

  // 収益性・成長率
  operatingMarginCurrent?: number; // 当期 営業利益率
  operatingMarginPrior?: number; // 前期 営業利益率
  operatingMarginGrowthRate?: number; // 営業利益率の成長率 (例: 0.20 = 前年比+20%)
  operatingMarginDelta?: number; // 営業利益率のポイント差 (例: 0.02 = +2%pt)
  salesGrowthRate?: number; // 売上高成長率
  operatingIncomeGrowthRate?: number; // 営業利益成長率

  // 安全性・資本効率
  equityRatioCurrent?: number; // 当期 自己資本比率 (netAssets / totalAssets)
  equityRatioPrior?: number; // 前期 自己資本比率
  roeCurrent?: number; // 当期 ROE (netIncome / netAssets)
}

/**
 * スクリーニングの抽出・ソート条件
 */
export interface ScreeningCriteria {
  whereClause?: string; // 自由なSQL条件 (例: "operating_margin_current > 0.15 AND equity_ratio_current > 0.5")
  minMarginGrowth?: number; // 営業利益率の成長率の下限
  minCurrentMargin?: number; // 当期営業利益率の下限
  minSalesGrowth?: number; // 売上成長率の下限
  minOperatingIncomeGrowth?: number; // 営業利益成長率の下限
  minEquityRatio?: number; // 自己資本比率の下限 (例: 0.50 = 50%以上)
  minRoe?: number; // ROEの下限 (例: 0.10 = 10%以上)
  consolidatedOnly?: boolean; // 連結決算のみを対象にするか
  orderBy?:
    | "margin_growth"
    | "current_margin"
    | "prior_margin"
    | "sales_growth"
    | "operating_income_growth"
    | "equity_ratio"
    | "roe";
  orderDirection?: "asc" | "desc";
  limit?: number;
}
