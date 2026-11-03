/** 構築世代・検索行・指標値の共通定義。DuckDB構築でもこの列構成を使う。 */
export const financialSearchIndexSchema = {
  financial_index_format: "CREATE TABLE financial_index_format(kind TEXT NOT NULL)",
  financial_generations:
    "CREATE TABLE financial_generations(id TEXT PRIMARY KEY,body TEXT NOT NULL,sha256 TEXT NOT NULL)",
  financial_rows:
    "CREATE TABLE financial_rows(generation TEXT NOT NULL,row_id TEXT NOT NULL,group_id TEXT NOT NULL,standard TEXT NOT NULL,scope TEXT NOT NULL,currency TEXT NOT NULL,period_start TEXT NOT NULL,period_end TEXT NOT NULL,period_type TEXT NOT NULL,edinet_code TEXT NOT NULL,sec_code TEXT NOT NULL,doc_id TEXT NOT NULL,sha256 TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(generation,row_id))",
  financial_cohort:
    "CREATE INDEX financial_cohort ON financial_rows(generation,group_id,standard,scope,currency,period_start,period_end,period_type,sec_code,doc_id)",
  financial_values:
    "CREATE TABLE financial_values(generation TEXT NOT NULL,row_id TEXT NOT NULL,metric_id TEXT NOT NULL,available INTEGER NOT NULL,numeric_value REAL,raw_text TEXT,status TEXT NOT NULL,reason TEXT NOT NULL,failure_kind TEXT,metric_order INTEGER NOT NULL,PRIMARY KEY(generation,row_id,metric_id))",
  financial_metric_range:
    "CREATE INDEX financial_metric_range ON financial_values(generation,metric_id,available,numeric_value,row_id)",
};
