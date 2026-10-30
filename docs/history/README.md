# 過去の計画・調査・検証記録

ここには、過去の計画・調査結果・実装経過を残しています。以前の判断や検証の根拠を追うときに使ってください。本文の「現在」「未実装」「確認待ち」は、記録した時点の状態です。

使い方を調べる場合は[文書索引](../README.md)、残作業を確認する場合は[全体計画](../plans/EDINET_TS_ROADMAP.md)と[実装状況](../plans/IMPLEMENTATION_STATUS.md)へ進んでください。

## 調べたい記録を選ぶ

| 記録 | 用途 |
|---|---|
| [2026-10-28までの全体計画](ROADMAP_2026-10-28.md) | 元の全段階・詳細受入条件・提案順 |
| [2026-10-28〜30の実装経過](IMPLEMENTATION_LOG_2026-10-30.md) | 機能追加順、当時のテスト件数・原本照合・配布状況 |
| [解消済みのPR取り込み順](PENDING_BRANCHES.md) | #24〜#28の提案・検証・統合経緯 |
| [依存の選定判断](DEPENDENCY_DECISIONS.md) | 2026-10-22の候補比較。採用版はpackage.jsonと実行環境資料を参照 |
| [他EDINETライブラリの調査](EDINET_LIBRARY_RESEARCH.md) | 2026-10-22の設計調査。現在の機能保証ではない |
| [固定配布物の検証](2026-10-10-fixed-artifact-validation.md) | 2026-10-10の固定sourceに対する確認 |
| [失効したnpm公開手順](NPM_PUBLISH.md) | 実行しない。現在はローカル配布方針 |
| [過去の四季報比較](comparisons/SHIKIHO_SCREENING_MAP.md) | 当時の比較。現行APIの一覧ではない |
| 過去の依頼 [1](requests/REQUESTS_01.md)・[2](requests/REQUESTS_02.md)・[3](requests/REQUESTS_03.md)・[4](requests/REQUESTS_04.md)・[5](requests/REQUESTS_05.md)・[6](requests/REQUESTS_06.md) | 当時の要望・設計案 |

2026-10-30の整理では、現行の使い方を財務・会社・開示表・パイプライン・開発の各ディレクトリへ移し、関連APIを一つの資料へ統合しました。参照リンクと生成スクリプト・CIのパスも更新しています。旧パスと元の本文はGit履歴で確認できます。
