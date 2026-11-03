/** DuckDB構築用の共通表と、計画・会社別完了記録の定義。型の変換は構築処理で行う。 */
import { financialSearchIndexSchema } from "./financial-search-index";
export const duckFinancialBuildTables = {
  ...financialSearchIndexSchema,
  duck_build_format: "CREATE TABLE duck_build_format(kind TEXT NOT NULL)",
  duck_build_plan:
    "CREATE TABLE duck_build_plan(id TEXT PRIMARY KEY,body TEXT NOT NULL,sha256 TEXT NOT NULL)",
  duck_build_parts:
    "CREATE TABLE duck_build_parts(code TEXT PRIMARY KEY,body TEXT NOT NULL,sha256 TEXT NOT NULL)",
};
