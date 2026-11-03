# 各機能の実装時点の確認記録

仕様の冒頭から移した日付付きの実装・検証記録です。本文と件数を保持しています。現在の着手順は[残作業](../../../plans/REMAINING_WORK.md)を参照してください。

## docs/companies/COMPANY_MASTER.md

[現在の説明](../../../specs/companies/COMPANY_MASTER.md)

各節のAPI・入力条件は区別します。検証件数と配布物の記録は実施当時のもので、現在の全体検証や稼働状態を示しません。

## docs/development/OFFLINE_FINANCIAL_VERIFICATION.md

[現在の説明](../../../ops/OFFLINE_FINANCIAL_VERIFICATION.md)

状態: main `3e43048`（#35統合済み）を基準に、この版で追加する品質確認用runnerです。未リリース。2026-10-24更新。

## docs/disclosures/CONTEXT_DIMENSION_TRACES.md

[現在の説明](../../../specs/disclosures/CONTEXT_DIMENSION_TRACES.md)

実装時の記録: 実装・ローカル検証済み（main統合前）。財務値の選択規則や既存contextの返値は変更しません。

## docs/disclosures/LARGE_HOLDING.md

[現在の説明](../../../specs/disclosures/LARGE_HOLDING.md)

各節のAPI・入力条件は区別します。検証件数と配布物の記録は実施当時のもので、現在の全体検証や稼働状態を示しません。

## docs/disclosures/SUBSIDIARY_HUMAN_CAPITAL.md

[現在の説明](../../../specs/disclosures/SUBSIDIARY_HUMAN_CAPITAL.md)

各節のAPI・入力条件は区別します。検証件数と配布物の記録は実施当時のもので、現在の全体検証や稼働状態を示しません。

## docs/financial/BALANCE_SHEET.md

[現在の説明](../../../specs/financial/BALANCE_SHEET.md)

各節のAPI・入力条件は区別します。検証件数と配布物の記録は実施当時のもので、現在の全体検証や稼働状態を示しません。

## docs/pipeline/BALANCE_SHEET_VERSION_DIFF.md

[現在の説明](../../../specs/storage/BALANCE_SHEET_VERSION_DIFF.md)

状態: main `ecb6c66`（#34統合済み）を基準に、この版で追加する読み取り比較機能です。未リリース。2026-10-24更新。

## docs/pipeline/DOCUMENT_RELATIONS.md

[現在の説明](../../../specs/edinet/DOCUMENT_RELATIONS.md)

実装時の記録: 実装・ローカル検証済み（main統合前）。取得・DB更新・最新版の自動選択は行いません。

## docs/pipeline/DOWNLOAD_SAFETY.md

[現在の説明](../../../specs/edinet/DOWNLOAD_SAFETY.md)

実装時の記録: この変更で追加する入力・保存検査。`download()`と`fetchXbrl()`を対象に、通常ZIPの読み取りと異常時の保存保護を合成データで検証します。実際のEDINETから新たに取得したZIPや、全市場での互換性の確認ではありません。

## docs/pipeline/FINANCIAL_DETAIL_STORE.md

[現在の説明](../../../specs/storage/FINANCIAL_DETAIL_STORE.md)

実装時の記録: この変更で追加する試験用API。専用Storeの追加115テストを含む全1,493テスト・型・build・保存保護と独立レビューが成功しています。

## docs/pipeline/PARSED_FINANCIAL_STORE.md

[現在の説明](../../../specs/storage/PARSED_FINANCIAL_STORE.md)

2026-10-31。取得用SQLite・検索用DuckDB計画のP1として追加する内部モジュール。既存の原本DB・取得ジョブDBは変更せず、専用ファイルを作る。通常読取にXMLは不要。

## docs/specs/companies/COMPANY_PROFILE.md

[現在の説明](../../../specs/companies/COMPANY_PROFILE.md)

状態: #40でmainへ統合済みのAPI/CLI。2026-10-24更新。未リリース。

## docs/ops/FINANCIAL_INCREMENTAL_IMPORT.md

[現在の説明](../../../ops/FINANCIAL_INCREMENTAL_IMPORT.md)

状態: 差分取り込みAPIは#33、ローカル原本CLIは#34でmain `ecb6c66`へ統合済みです。未リリースです。2026-10-24更新。

## docs/specs/financial/FINANCIAL_DETAILS.md

[現在の説明](../../../specs/financial/FINANCIAL_DETAILS.md)

状態: 既定5項目は#37でmainへ統合済み。明示して読むCF3項目も#39でmainへ統合済みです。借入金・社債・リースの直接7残高も#42でmainへ統合済みです。PL追加明細5項目は#66でmainへ統合済みです。未リリース。2026-10-28更新。

## docs/specs/disclosures/WORKFORCE.md

[現在の説明](../../../specs/disclosures/WORKFORCE.md)

状態: 既定の給与は#41、明示して読む年齢・勤続年数は#44でmainへ統合済みです。従業員数の明示取得・検索は#53でmainへ統合済みです。平均臨時雇用人員の明示取得・検索は#64、人的資本だけの同一重複採用は#65でmainへ統合済みです。未リリース。2026-10-28更新。

## docs/specs/storage/FINANCIAL_SQLITE_STORE.md

[現在の説明](../../../specs/storage/FINANCIAL_SQLITE_STORE.md)

状態: #30/#31が正式stack #32からmain `a5fb840`へ統合済みの小規模試作です。未リリースです。既存の書類一覧DBとは別の、試験用DBだけを使っています。

## docs/specs/financial/ANNUAL_REVENUE_GROWTH.md

[現在の説明](../../../specs/financial/ANNUAL_REVENUE_GROWTH.md)

この作業ツリーで実装した未リリースのAPIです。全体ロードマップ段階3の一部です。

## docs/specs/companies/COMPANY_PROFILE.md

[現在の説明](../../../specs/companies/COMPANY_PROFILE.md)

## 公式コードリストの観測マスター（2026-10-28、未リリース）

## README.md

[現在の説明](../../../../README.md)

2026-11-03にnpm 1.1.17でCLIのhelp・原本解析と下の最初のTypeScript例を確認しました。保存JSONの検索（`screen`）など、リポジトリ版にだけある機能もあります。
