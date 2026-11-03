# DuckDB移行後の保存物と整理条件

2026-11-03。P8の保持一覧。正式切替と切戻しの確認前に旧候補を削除しない。実連続2日の検証は[手動日次検証手順](DUCK_FINANCIAL_MANUAL_DAILY_ACCEPTANCE.md)へ移管しており、手動完了の記録が付くまでは未達として扱う。

## 現在の保持対象

ファイル別の実測サイズ・更新時刻・副ファイル有無は `data/benchmarks/duck-financial-final-20261103/retention-inventory.json` に保存した。処理中のファイルのサイズは変わる。この一覧は既知の主要12ファイルの記録であり、外部catalog参照を網羅した証明ではない。

| 保存物                                                                                          | 保持する理由                                     | 整理できる条件                                                                                |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `data/roadmap/compressed-seed-20261030/archive.sqlite`                                          | 日次取得の原本poolと圧縮移行の監査対象           | 本計画の削除対象外                                                                            |
| `data/roadmap/daily-metadata-20261030.sqlite` とcheckpoint                                      | 日次一覧・訂正系列・観測時点の根拠               | 本計画の削除対象外                                                                            |
| `data/roadmap/daily-financial-work-20261030-index-v1/candidate/archive.sqlite`（約16.4 GiB）    | 過去取得候補の原本。検索DBではない               | 容量だけを理由に削除しない。原本保全・参照・代替の全内容を別途検証するまで保持                |
| `data/roadmap/daily-financial-compressed-v2/2026-10-30/candidate/reconstructed/archive.sqlite`  | 過去と最新版の全社比較に使う不変の原本           | 本計画の削除対象外                                                                            |
| `data/benchmarks/duck-financial-full-20261031-v2/candidate/index.duckdb` と`publication.sqlite` | 旧比較候補・品質記録・過去の検証結果の再現       | 正式候補と切戻し先が確定し、どちらにも使わず、全参照を確認した後                              |
| 同候補の`parsed-snapshot.sqlite`、共有`parsed.sqlite`                                           | 旧候補の再開と解析根拠                           | 再開不要、正式・切戻し・検証経路から参照されないことを確認後。新しい解析版のcacheと混同しない |
| `data/benchmarks/duck-financial-final-reader-20261031/comparison/aggregate.sqlite`              | DuckDBと同一世代のSQLite投影。性能比較の共通入力 | 最終性能の比較・初回安定性検証の終了後。再生成元とhashを保存してから                          |
| `data/benchmarks/duck-financial-final-20261103/` のStore・候補                                  | 最新版の全社再構築と検証                         | 処理中は削除しない。結果の確定後に再開・照合・切戻し要件に従って判断                          |
| `data/benchmarks/duck-financial-unified-daily-20261031/days/2026-10-31/`                        | 旧固定SDKによる停止再開検証                      | 凍結handoffと再開の結果を保持。新SDK候補へ混ぜず、完了/中断状態を記録してから整理を判断       |
| 固定SDK・配布tgz・consumerのlockとmanifest                                                      | SDKとDBの組で再現・切戻しを行う                  | 正式・切戻し・証跡参照がない版だけ。残すtgzとsourceの対応hashを先に固定する                   |
| 独立照合記録・入力/世代manifest・性能log・失敗log                                               | 合格/未達の説明と再現                            | 小さい証跡は保持。容量の大きい再生成物と一括削除しない                                        |

## 削除前の確認

1. 正式catalogのactiveと切戻し先、両方のSDK・原本・照合記録・generationを一覧化する。検証用catalogのactiveを正式参照と推測しない。
2. 利用先のvendor/provenance、サービスのExecStart、設定、日次handoff、build receipt、reader reload手順からの参照を確認する。停止中serviceの設定から参照されていれば、停止中という理由だけで削除しない。
3. 手動日次検証2日分と切戻しの成功記録を確認し、再開に必要なStore/snapshotを区別する。
4. 対象ファイルを開くprocessがないこと、DBが閉じ副ファイルがないことを確認する。ロックファイルの削除を排他の解除として使わない。
5. 削除対象を絶対パス・サイズ・hash・再生成元・削除理由付きで確定し、削除後に正式参照と切戻しが引き続き読めることを検証する。

この手順のために原本を削除したり、品質gateを緩めたりしない。上の条件を満たさない時点では保持を続け、P8を完了へ変更しない。

## 実施済みの容量整理

2026-11-03に、終了済み取得比較の再生成可能な27ファイル・約3.93 GiBを整理済み。元SQLiteのhashと既存の全列一致結果を再確認し、原本・正式世代・16.4 GiBの旧取得原本は保持した。対象別のhash・容量・再生成元は `data/benchmarks/duckdb-acquisition-20261031/cleanup-20261103.json`。この完了済み整理を、残るP8の正式参照・切戻し確認の代替にはしない。
