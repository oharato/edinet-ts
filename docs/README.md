# ドキュメント

原本を試す、選択規則を調べる、保存・更新を運用する、の順に必要なページを選べます。

## 試す

- [最初の解析とAPI例](../README.md)
- [CLIの最小JSON例](guide/CLI_INPUT_EXAMPLES.md)
- [原本から保存・検索まで](guide/EDINET_DB_COMPARISON.md)
- [用語](guide/GLOSSARY.md)

## 仕様を調べる

- [提供機能と制約](specs/REQUIREMENTS.md)
- [アーキテクチャの全体像](specs/ARCHITECTURE.md)
- [処理経路・値の選択](specs/SPECIFICATIONS.md)
- [コード配置と呼出経路](specs/SOURCE_LAYOUT.md)
- [原本・解析結果・検索DBの構造](specs/storage/FINANCIAL_DATA_MODEL.md)
- [財務値の選択](specs/financial/METRIC_SELECTION.md) / [会計基準](specs/financial/FINANCIAL_REPORTING_BASIS.md)
- [開示表](specs/disclosures/DISCLOSURE_TABLES.md) / [企業情報](specs/companies/COMPANY_MASTER.md)
- [Storeと索引](specs/storage/FINANCIAL_SEARCH_INDEX.md)
- [設計判断](specs/adr/0001-local-distribution.md) / [外部入力の採否](specs/decisions/EXTERNAL_DATA_DECISIONS.md)

## 保存・更新を運用する

- [実行環境](ops/RUNTIME_AND_SQLITE.md)
- [取得から検索まで](ops/DUCK_FINANCIAL_CYCLE.md) / [CLI](ops/DUCK_FINANCIAL_CLI.md)
- [原本照合](ops/DUCK_FINANCIAL_VERIFICATION.md) / [復旧](ops/DUCK_FINANCIAL_RECOVERY.md)
- [公開と切戻し](ops/DUCK_FINANCIAL_PRODUCTION.md) / [保持](ops/DUCK_FINANCIAL_RETENTION.md)
- [法人番号の日次更新](ops/CORPORATE_REGISTRY_DAILY.md)
- [固定配布物の作成・保持](ops/LOCAL_ARTIFACTS.md)

## 作業を確認する

- [残作業と優先順位](plans/REMAINING_WORK.md)
- [再構築計画](plans/CODEBASE_AND_DOCS_REORGANIZATION.md)
- [過去の依頼・計画・検証記録](history/README.md)
