# 過去の計画・調査・検証記録

過去の依頼、計画、実装経過、検証結果を `archive/` に保存しています。

使い方は[文書案内](../README.md)、現在の着手順は[残作業と優先順位](../plans/REMAINING_WORK.md)を参照してください。

## 調べたい記録を選ぶ

| 記録                                                                                                                                                                                                                                          | 用途                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [2026-10-28までの全体計画](archive/ROADMAP_2026-10-28.md)                                                                                                                                                                                     | 元の全段階・詳細受入条件・提案順                               |
| [2026-10-28〜30の実装経過](archive/IMPLEMENTATION_LOG_2026-10-30.md)                                                                                                                                                                          | 機能追加順、当時のテスト件数・原本照合・配布状況               |
| [解消済みのPR取り込み順](archive/PENDING_BRANCHES.md)                                                                                                                                                                                         | #24〜#28の提案・検証・統合経緯                                 |
| [依存の選定判断](archive/DEPENDENCY_DECISIONS.md)                                                                                                                                                                                             | 2026-10-22の候補比較。採用版はpackage.jsonと実行環境資料を参照 |
| [他EDINETライブラリの調査](archive/EDINET_LIBRARY_RESEARCH.md)                                                                                                                                                                                | 2026-10-22の設計調査。現在の機能保証ではない                   |
| [固定配布物の検証](archive/2026-10-10-fixed-artifact-validation.md)                                                                                                                                                                           | 2026-10-10の固定sourceに対する確認                             |
| [失効したnpm公開手順](archive/NPM_PUBLISH.md)                                                                                                                                                                                                 | 実行しない。現在はローカル配布方針                             |
| [過去の四季報比較](archive/comparisons/SHIKIHO_SCREENING_MAP.md)                                                                                                                                                                              | 当時の比較。現行APIの一覧ではない                              |
| 過去の依頼 [1](archive/requests/REQUESTS_01.md)・[2](archive/requests/REQUESTS_02.md)・[3](archive/requests/REQUESTS_03.md)・[4](archive/requests/REQUESTS_04.md)・[5](archive/requests/REQUESTS_05.md)・[6](archive/requests/REQUESTS_06.md) | 当時の要望・設計案                                             |

2026-10-30の整理では、現行の使い方を財務・会社・開示表・パイプライン・開発の各ディレクトリへ移し、関連APIを一つの資料へ統合しました。参照リンクと生成スクリプト・CIのパスも更新しています。旧パスと元の本文はGit履歴で確認できます。

## 今回まとめた計画・検証・旧運用

- [実際の決算書と数値を照らし合わせた結果](archive/validation/REAL_DATA_VALIDATION.md)
- [固定年次計画と日次更新を実行する専用サービス](archive/ops/ROADMAP_RUNTIME.md)
- [stock-dataのDuckDB財務snapshot利用](archive/ops/STOCK_DATA_DUCKDB_MIGRATION.md)
- [取得用DuckDBの検証計画](archive/plans/DUCKDB_ACQUISITION_VALIDATION.md)
- [DuckDB 2.0 検証計画](archive/plans/DUCKDB_VALIDATION.md)
- [edinet-ts 改善計画](archive/plans/EDINET_TS_ROADMAP.md)
- [財務明細正規化の実装候補と受入計画](archive/plans/FINANCIAL_NORMALIZATION.md)
- [全体ロードマップの実装状況](archive/plans/IMPLEMENTATION_STATUS.md)
- [取得用SQLite・検索用DuckDBへの改善実装計画](archive/plans/SQLITE_DUCKDB_IMPLEMENTATION_PLAN.md)
- [各機能の実装時点の確認記録](archive/validation/IMPLEMENTATION_CHECKS_2026-11-03.md)
