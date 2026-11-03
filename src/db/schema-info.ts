export interface ColumnDefinition {
  name: string; // SQLカラム名
  type: string; // DuckDBの型
  unit: string; // 単位・表記
  description: string; // 人間・AI向けの説明
  example: string; // 条件指定の例
}

export interface QueryExample {
  title: string;
  description: string;
  sql: string;
}

export const SCREENING_COLUMNS: ColumnDefinition[] = [
  {
    name: "security_code",
    type: "VARCHAR",
    unit: "コード文字列",
    description: "証券コード (例: '2371')",
    example: "security_code = '2371'",
  },
  {
    name: "company_name",
    type: "VARCHAR",
    unit: "文字列",
    description: "会社名",
    example: "company_name LIKE '%カカクコム%'",
  },
  {
    name: "period_end",
    type: "VARCHAR",
    unit: "YYYY-MM-DD",
    description: "決算期末日",
    example: "period_end >= '2024-01-01'",
  },
  {
    name: "is_consolidated",
    type: "BOOLEAN",
    unit: "true / false",
    description: "連結決算かどうか (単体のみは false)",
    example: "is_consolidated = true",
  },
  {
    name: "operating_margin_current",
    type: "DOUBLE",
    unit: "小数比率 (0.15 = 15%)",
    description: "当期 営業利益率 (営業利益 / 売上高)",
    example: "operating_margin_current >= 0.15",
  },
  {
    name: "operating_margin_growth_rate",
    type: "DOUBLE",
    unit: "小数比率 (0.20 = +20%)",
    description: "営業利益率の前年比成長率 ((当期-前期)/前期)",
    example: "operating_margin_growth_rate >= 0.20",
  },
  {
    name: "free_cash_flow_current",
    type: "DOUBLE",
    unit: "円 (10億 = 1000000000)",
    description: "当期 フリーキャッシュフロー (営業CF + 投資CF)",
    example: "free_cash_flow_current > 1000000000",
  },
  {
    name: "equity_ratio_current",
    type: "DOUBLE",
    unit: "小数比率 (0.50 = 50%)",
    description: "当期 自己資本比率 (純資産 / 総資産)",
    example: "equity_ratio_current >= 0.50",
  },
  {
    name: "roe_current",
    type: "DOUBLE",
    unit: "小数比率 (0.10 = 10%)",
    description: "当期 自己資本利益率 ROE (当期純利益 / 純資産)",
    example: "roe_current >= 0.10",
  },
  {
    name: "roa_current",
    type: "DOUBLE",
    unit: "小数比率 (0.05 = 5%)",
    description: "当期 総資産利益率 ROA (当期純利益 / 総資産)",
    example: "roa_current >= 0.05",
  },
  {
    name: "operating_income_per_employee",
    type: "DOUBLE",
    unit: "円/人 (1000万 = 10000000)",
    description: "従業員1人当たり営業利益 (労働生産性)",
    example: "operating_income_per_employee >= 10000000",
  },
  {
    name: "dividend_per_share_current",
    type: "DOUBLE",
    unit: "円/株",
    description: "当期 1株当たり配当金",
    example: "dividend_per_share_current >= 50",
  },
  {
    name: "dividend_growth_rate",
    type: "DOUBLE",
    unit: "小数比率 (0.10 = +10%)",
    description: "1株配当金の前年比成長率 (増配判定)",
    example: "dividend_growth_rate > 0",
  },
  {
    name: "cash_and_equivalents_current",
    type: "DOUBLE",
    unit: "円",
    description: "当期 現金及び現金同等物の期末残高",
    example: "cash_and_equivalents_current >= 5000000000",
  },
  {
    name: "sales_growth_rate",
    type: "DOUBLE",
    unit: "小数比率 (0.10 = +10%)",
    description: "売上高の前年比成長率",
    example: "sales_growth_rate >= 0.10",
  },
  {
    name: "operating_income_growth_rate",
    type: "DOUBLE",
    unit: "小数比率 (0.20 = +20%)",
    description: "営業利益の前年比成長率",
    example: "operating_income_growth_rate >= 0.20",
  },
  {
    name: "net_sales_current",
    type: "DOUBLE",
    unit: "円",
    description: "当期 売上高 / 営業収益",
    example: "net_sales_current >= 10000000000",
  },
  {
    name: "operating_income_current",
    type: "DOUBLE",
    unit: "円",
    description: "当期 営業利益",
    example: "operating_income_current >= 1000000000",
  },
  {
    name: "net_assets_current",
    type: "DOUBLE",
    unit: "円",
    description: "当期 純資産 (自己資本)",
    example: "net_assets_current >= 5000000000",
  },
  {
    name: "total_assets_current",
    type: "DOUBLE",
    unit: "円",
    description: "当期 総資産",
    example: "total_assets_current >= 10000000000",
  },
  {
    name: "operating_cf_current",
    type: "DOUBLE",
    unit: "円",
    description: "当期 営業活動キャッシュフロー",
    example: "operating_cf_current > 0",
  },
  {
    name: "investing_cf_current",
    type: "DOUBLE",
    unit: "円",
    description: "当期 投資活動キャッシュフロー",
    example: "investing_cf_current < 0",
  },
  {
    name: "eps_current",
    type: "DOUBLE",
    unit: "円/株",
    description: "当期 1株当たり当期純利益 (EPS)",
    example: "eps_current >= 100",
  },
  {
    name: "bps_current",
    type: "DOUBLE",
    unit: "円/株",
    description: "当期 1株当たり純資産 (BPS)",
    example: "bps_current >= 1000",
  },
  {
    name: "number_of_employees",
    type: "INTEGER",
    unit: "人",
    description: "従業員数",
    example: "number_of_employees <= 500",
  },
];

export const QUERY_EXAMPLES: QueryExample[] = [
  {
    title: "利益率が20%以上伸びた高収益企業",
    description: "営業利益率が前年より20%以上伸び、当期の利益率も15%以上の企業",
    sql: "operating_margin_growth_rate >= 0.20 AND operating_margin_current >= 0.15",
  },
  {
    title: "高FCF創出 & 高ROE企業",
    description: "フリーキャッシュフローがプラスで、ROEが15%以上の筋肉質企業",
    sql: "free_cash_flow_current > 0 AND roe_current >= 0.15",
  },
  {
    title: "高生産性企業（社員1人当たり営業利益1,500万円以上）",
    description: "従業員1人当たりの稼ぐ力が極めて高い少数精鋭企業",
    sql: "operating_income_per_employee >= 15000000",
  },
  {
    title: "増配 & 健全財務企業",
    description: "前年比で増配しており、自己資本比率が60%以上の企業",
    sql: "dividend_growth_rate > 0 AND equity_ratio_current >= 0.60",
  },
  {
    title: "売上・利益のダブル成長企業",
    description: "売上高が前年比10%以上成長、営業利益が20%以上成長",
    sql: "sales_growth_rate >= 0.10 AND operating_income_growth_rate >= 0.20",
  },
];
