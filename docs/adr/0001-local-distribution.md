# ADR 0001: 配布物の作成・保持をローカルで行う

状態: 採用済み。判断の基準: [PR #19](https://github.com/oharato/edinet-ts/pull/19)（2026-10-10）。資料整理日: 2026-10-22。

## 背景と判断

GitHubの配布物保存を増やさず、固定sourceとlockfileからローカルで配布物を再現し保持する。GitHub CIではsourceの型・テストを確認し、配布物を作るESM統合検証はローカルの完全なテストに含める。

手動workflowも公開・tag・npm/GitHub Packages配布を行わず、ローカル手順を案内する。既存の公開物は削除しない。配布物は世代別に保持し、hash検証後にcurrentをatomicに切り替える。失敗時は前世代を残す。

## 帰結

source更新時は、固定commit・配布物hash・利用先vendor/provenanceを明示的に更新して検証する必要がある。ライブラリのmain更新だけで利用先に自動反映しない。新しい認証・公開・定期実行はこの判断に含めない。

現在の手順は [ローカル配布物](../nuc7-local-artifacts.md)、当時の検証記録は [固定配布物の検証](../history/2026-10-10-fixed-artifact-validation.md)。旧公開手順は [失効資料](../history/NPM_PUBLISH.md) として残す。
