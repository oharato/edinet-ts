# DuckDB本番運用

2026-11-03。ユーザーの本番サービス・正式catalog切替指示に基づく。原本・旧runtime・旧候補を保持する。実連続2日の受入は引き続き[手動手順](DUCK_FINANCIAL_MANUAL_DAILY_ACCEPTANCE.md)で行う。

## 正式な参照先

同ホストの本番rootは `/home/oharato/workspace/edinet-ts/data/production/duck-financial`。`publication.sqlite` が正式catalog、`publication-config.json` が索引・原本・入力hash・明示policy・CASの設定。`deployment.json` に固定SDK、Node/Python、サービス、検証記録、切戻し先を記録する。設定やDBはGitへ含めない。

従来の財務serviceは候補構築用で、共通の正式catalogは未設定だった。初回公開は既存の全社検証済み候補（cutoffは2026-10-30）のコピーを使用する。これはその時点の保存snapshotであり、11月3日時点の新しい開示を網羅したと扱わない。

## 明示した移行policy

既存の欠損・診断を保持した移行をユーザーが承認したため、初回の固定世代に対して次の上限を設定する。SDKの既定policyは変更しない。将来の候補へ件数を自動追随させたり、nilを0へ変換したりしない。

| 条件                             |   値 |
| -------------------------------- | ---: |
| minimumCompaniesWithUsableValues | 3777 |
| maxUnavailableSources            |   36 |
| maxUnresolvedSelections          |  571 |
| maxUnavailableSelections         |  109 |
| maxUnresolvedRecords             |   19 |
| maxUnavailableGroups             |    4 |
| maxDuplicateCohortIdentifiers    |    0 |
| maxUnavailableValues             | 3100 |

## 公開コマンド

固定SDKの `scripts/roadmap/run-duck-financial-publication.mjs` に正規の絶対configパスとmodeを渡す。

```sh
node /absolute/fixed-sdk/scripts/roadmap/run-duck-financial-publication.mjs /absolute/publication-config.json record
node /absolute/fixed-sdk/scripts/roadmap/run-duck-financial-publication.mjs /absolute/publication-config.json activate
node /absolute/fixed-sdk/scripts/roadmap/run-duck-financial-publication.mjs /absolute/publication-config.json status
```

`record` は原本から独立照合して記録し、正式参照を変更しない。`activate` は記録と採用値を再照合してからexpectedActiveのCASで変更する。`status` は正式catalogと索引の一致を読み取る。config/catalog/index/archiveの排他を取り、候補指紋やpolicyの不一致・照合なし・CAS不一致は拒否する。出力に秘密情報を含めない。

config version 1は `indexPath`、`catalogPath`、`recordPath`、`archivePath`、`generation`、`candidateId`、`inputSha256`、`indexSha256`、`generationSha256`、`policy`、`expectedActive` を全て指定する。初回のexpectedActiveはnull、以後は実際の直前候補IDを明示する。別の候補は別の検証記録を使う。

## 稼働サービス

既存の `edinet-roadmap-daily-financial-preparation.service` のExecStartを、固定SDKの `run-daily-duck-financial-cycle.mjs` へ変更する。専用の日次設定・共有解析Store・出力rootを用い、途中の旧SQLite日次handoffは書き換えない。既存の5分周期timerを再開する。metadata serviceも固定した同じSDKの既存metadataコマンドへ更新する。

SDKはdist/scripts/src/package lockを通常ファイルで保持し、runtimeの依存は専用ディレクトリへ`npm ci --omit=dev`で展開する。Node 26.13.0、Python 3.15.2、npm 12.2.1を固定する。API keyは既存metadata設定のenvPathからだけ読む。

日次の準備・取得・構築を自動継続する。正式catalogの更新は上記の明示公開操作として分け、日次の部分完了・未検証候補・別世代を自動で正式化しない。終了75は既存排他との競合であり、lockファイルを消して回避しない。出力先/一時領域の34 GiB留保と追加容量guardも維持する。

## 切戻し

切替前のunitは本番rootの`rollback/units`、設定・catalogの切替前コピーとhashは同じrollback記録へ保持する。問題があれば新財務timer/serviceを停止し、保存unitを戻してdaemon-reloadする。旧SQLite serviceの再開は保存済み旧設定・旧runtimeを組で使う。

正式候補を以前の公開候補へ戻す場合は、その候補の検証記録・固定SDK・原本を用いて上記activateを実行し、expectedActiveへ現在候補IDを指定する。初回の「参照なし」へ戻す際は停止・排他・副ファイル不存在を確認して、保存した切替前catalogを復元する。DBを編集して履歴を削除しない。詳細な実行結果とhashはdeployment.jsonと検証ログを参照する。
