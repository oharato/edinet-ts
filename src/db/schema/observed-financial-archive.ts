/** 原観測・原本と、互換用の旧抽出記録を保持するSQLite定義。 */
export const observedFinancialArchiveSchema = {
  archive_format: "CREATE TABLE archive_format(kind TEXT NOT NULL)",
  archive_observations:
    "CREATE TABLE archive_observations(id TEXT PRIMARY KEY,doc_id TEXT NOT NULL,parent_doc_id TEXT,edinet_code TEXT,observed_ms INTEGER NOT NULL,body TEXT NOT NULL,sha256 TEXT NOT NULL)",
  archive_observation_company:
    "CREATE INDEX archive_observation_company ON archive_observations(edinet_code,doc_id)",
  archive_observation_parent:
    "CREATE INDEX archive_observation_parent ON archive_observations(parent_doc_id,doc_id)",
  archive_observation_document:
    "CREATE INDEX archive_observation_document ON archive_observations(doc_id)",
  archive_sources:
    "CREATE TABLE archive_sources(id TEXT PRIMARY KEY,doc_id TEXT NOT NULL,available_ms INTEGER NOT NULL,body TEXT NOT NULL,sha256 TEXT NOT NULL)",
  archive_source_lookup:
    "CREATE INDEX archive_source_lookup ON archive_sources(doc_id,available_ms)",
  archive_contents: "CREATE TABLE archive_contents(sha256 TEXT PRIMARY KEY,xml BLOB NOT NULL)",
  archive_extractions:
    "CREATE TABLE archive_extractions(id TEXT PRIMARY KEY,body TEXT NOT NULL,sha256 TEXT NOT NULL)",
};
