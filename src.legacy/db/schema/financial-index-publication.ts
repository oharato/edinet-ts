/** 公開候補・切替履歴・現在の候補を保持するSQLite catalogの定義。 */
export const financialPublicationSchema = {
  publication_format: "CREATE TABLE publication_format(kind TEXT NOT NULL)",
  publication_candidates:
    "CREATE TABLE publication_candidates(id TEXT PRIMARY KEY,body TEXT NOT NULL,sha256 TEXT NOT NULL)",
  publication_history:
    "CREATE TABLE publication_history(sequence INTEGER PRIMARY KEY,previous_id TEXT,publication_id TEXT NOT NULL,body TEXT NOT NULL,sha256 TEXT NOT NULL)",
  publication_active:
    "CREATE TABLE publication_active(singleton INTEGER PRIMARY KEY CHECK(singleton=1),publication_id TEXT NOT NULL,sequence INTEGER NOT NULL,sha256 TEXT NOT NULL)",
};
