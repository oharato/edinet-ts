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
  isConsolidated: boolean; // 連結か単体か
}

/**
 * 当期・前期の比較財務データと計算された利益率・成長率
 */
export interface CompanyFinancialComparison {
  metadata: CompanyMetadata;
  current: FinancialMetrics;
  prior: FinancialMetrics;

  // 計算指標
  operatingMarginCurrent?: number; // 当期 営業利益率
  operatingMarginPrior?: number; // 前期 営業利益率
  operatingMarginGrowthRate?: number; // 営業利益率の成長率 (例: 0.20 = 前年比+20%)
  operatingMarginDelta?: number; // 営業利益率のポイント差 (例: 0.02 = +2%pt)
  salesGrowthRate?: number; // 売上高成長率
  operatingIncomeGrowthRate?: number; // 営業利益成長率
}

/**
 * スクリーニングの抽出・ソート条件
 */
export interface ScreeningCriteria {
  minMarginGrowth?: number; // 営業利益率の成長率の下限 (例: 0.20 = 20%以上成長)
  minCurrentMargin?: number; // 当期営業利益率の下限 (例: 0.10 = 利益率10%以上)
  minSalesGrowth?: number; // 売上成長率の下限
  minOperatingIncomeGrowth?: number; // 営業利益成長率の下限
  consolidatedOnly?: boolean; // 連結決算のみを対象にするか
  orderBy?:
    | "margin_growth"
    | "current_margin"
    | "prior_margin"
    | "sales_growth"
    | "operating_income_growth";
  orderDirection?: "asc" | "desc";
  limit?: number;
}
