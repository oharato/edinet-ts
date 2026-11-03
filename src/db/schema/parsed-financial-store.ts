/** 原本hashと抽出条件に結び付いた解析結果・行・値を保持するSQLite定義。 */
export const parsedFinancialStoreSchema = {
  parsed_format: "CREATE TABLE parsed_format(kind TEXT NOT NULL)",
  parsed_extractions:
    "CREATE TABLE parsed_extractions(id TEXT PRIMARY KEY,doc_id TEXT NOT NULL,source_sha256 TEXT NOT NULL,state TEXT NOT NULL,parsed_at TEXT NOT NULL,body TEXT NOT NULL,sha256 TEXT NOT NULL)",
  parsed_by_source: "CREATE INDEX parsed_by_source ON parsed_extractions(doc_id,source_sha256,id)",
  parsed_rows:
    "CREATE TABLE parsed_rows(extraction TEXT NOT NULL,row_id TEXT NOT NULL,group_id TEXT NOT NULL,edinet_code TEXT NOT NULL,sec_code TEXT NOT NULL,standard TEXT NOT NULL,scope TEXT NOT NULL,currency TEXT NOT NULL,period_start TEXT NOT NULL,period_end TEXT NOT NULL,period_type TEXT NOT NULL,amendment_target TEXT,body TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(extraction,row_id))",
  parsed_values:
    "CREATE TABLE parsed_values(extraction TEXT NOT NULL,row_id TEXT NOT NULL,metric_id TEXT NOT NULL,metric_order INTEGER NOT NULL,available INTEGER NOT NULL,numeric_value REAL,raw_text TEXT,status TEXT NOT NULL,reason TEXT NOT NULL,failure_kind TEXT,unit TEXT,decimals TEXT,body TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(extraction,row_id,metric_id))",
};
