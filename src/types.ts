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
  operatingCashFlow?: number; // 営業活動キャッシュフロー
  investingCashFlow?: number; // 投資活動キャッシュフロー
  cashAndEquivalents?: number; // 現金及び現金同等物の期末残高
  dividendPerShare?: number; // 1株当たり配当金
  eps?: number; // 1株当たり当期純利益
  bps?: number; // 1株当たり純資産
  numberOfEmployees?: number; // 従業員数
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
  operatingMarginGrowthRate?: number; // 営業利益率の前年比成長率 (例: 0.20 = +20%)
  operatingMarginDelta?: number; // 営業利益率のポイント差 (例: 0.02 = +2%pt)
  salesGrowthRate?: number; // 売上高成長率
  operatingIncomeGrowthRate?: number; // 営業利益成長率

  // キャッシュフロー・安全性・資本効率
  freeCashFlowCurrent?: number; // 当期 フリーキャッシュフロー (営業CF + 投資CF)
  freeCashFlowPrior?: number; // 前期 フリーキャッシュフロー
  equityRatioCurrent?: number; // 当期 自己資本比率 (netAssets / totalAssets)
  equityRatioPrior?: number; // 前期 自己資本比率
  roeCurrent?: number; // 当期 ROE (netIncome / netAssets)
  roaCurrent?: number; // 当期 ROA (netIncome / totalAssets)

  // 1人当たり指標・配当
  operatingIncomePerEmployee?: number; // 従業員1人当たり営業利益 (円/人)
  dividendGrowthRate?: number; // 配当金の前年比成長率
}

/**
 * スクリーニングの抽出・ソート条件
 */
export interface ScreeningCriteria {
  whereClause?: string; // 自由なSQL条件
  minMarginGrowth?: number; // 営業利益率の前年比成長率の下限
  minCurrentMargin?: number; // 当期営業利益率の下限
  minSalesGrowth?: number; // 売上成長率の下限
  minOperatingIncomeGrowth?: number; // 営業利益成長率の下限
  minEquityRatio?: number; // 自己資本比率の下限
  minRoe?: number; // ROEの下限
  minRoa?: number; // ROAの下限
  minFcf?: number; // フリーキャッシュフローの下限
  consolidatedOnly?: boolean; // 連結決算のみを対象にするか
  orderBy?:
    | "margin_growth"
    | "current_margin"
    | "prior_margin"
    | "sales_growth"
    | "operating_income_growth"
    | "equity_ratio"
    | "roe"
    | "roa"
    | "fcf"
    | "per_employee";
  orderDirection?: "asc" | "desc";
  limit?: number;
}
