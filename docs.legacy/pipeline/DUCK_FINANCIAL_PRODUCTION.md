# DuckDB本番運用

2026-11-03。ユーザーの本番サービス・正式catalog切替指示に基づく。原本・旧runtime・旧候補を保持する。実連続2日の受入は引き続き[手動手順](DUCK_FINANCIAL_MANUAL_DAILY_ACCEPTANCE.md)で行う。

## 正式な参照先

同ホストの本番rootは `/home/oharato/workspace/edinet-ts/data/production/duck-financial`。`publication.sqlite` が正式catalogです。現在の索引・原本・入力hash・明示policy・CASの設定ファイルは、`deployment.json` の `publicationConfig` で指定します。同じ記録に固定SDK、Node、日次設定、サービス、検証記録、切戻し先を保存します。初回の `publication-config.json` とPython照合記録は当時の証跡として保持しています。設定やDBはGitへ含めない。

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

既存の `edinet-roadmap-daily-financial-preparation.service` は、固定SDKの `run-daily-duck-financial-cycle.mjs` を呼ぶ構成へ変更済みです。専用の日次設定・共有解析Store・出力rootを用い、途中の旧SQLite日次handoffは書き換えない。既存の5分周期timerを再開する。metadata serviceも固定した同じSDKの既存metadataコマンドへ更新する。

SDKはdist/scripts/src/package lock・README・LICENSEを通常ファイルで保持し、runtimeの依存は専用ディレクトリへ`npm ci --omit=dev`で展開します。Node 26.13.0とnpm 12.2.1を固定し、Pythonは使いません。API keyは既存metadata設定のenvPathからだけ読みます。

日次の準備・取得・構築を自動継続する。正式catalogの更新は上記の明示公開操作として分け、日次の部分完了・未検証候補・別世代を自動で正式化しない。終了75は既存排他との競合であり、lockファイルを消して回避しない。出力先/一時領域の34 GiB留保と追加容量guardも維持する。

### 容量待ちと停止を見分ける

serviceの終了0だけでは、取得や構築の完了とは判断できません。ログのJSONが `status: "acquisition-paused", reason: "disk-reserve"` なら、容量保護による待機です。timerが有効なら次の時刻に同じ固定候補から再開を試みます。実行中は前回終了時のJSONが最後のログに残るため、現在のPID・開始時刻と取得jobの進捗も合わせて確認してください。

```sh
systemctl --user show edinet-roadmap-daily-financial-preparation.service \
  -p ActiveState -p MainPID -p ExecMainStartTimestamp -p ExecMainExitTimestamp -p ExecMainStatus
systemctl --user show edinet-roadmap-daily-financial-preparation.timer \
  -p ActiveState -p NextElapseUSecRealtime
journalctl --user -u edinet-roadmap-daily-financial-preparation.service -n 20 --no-pager
```

原本取得の入口では、出力先と一時領域の空きに **34 GiB＋候補の `archive.sqlite`＋`source-job.sqlite` のサイズ** が必要です。SDKが検査用の私有コピーを作るため、空きが34 GiBを超えていても待機します。`archive.sqlite` は取得原本、`source-job.sqlite` は書類ごとの取得状態・試行履歴を保存するDBです。取得に伴って原本DBが増えるので、入口を一度通過するだけの余白では完了まで足りない場合があります。後段の解析・DuckDB構築にはさらに別の出力容量が必要です。

容量を整理するときは、停止・非参照を確認した再生成可能な検証用依存などに限定し、再生成元のlockfile・配布物と整理前の一覧を残します。原本、失敗記録、正式世代、切戻し先、稼働runtimeは保持します。通常のtimer再試行で進捗が増えたことを確認し、待機を成功や故障へ読み替えたり、留保値を下げたりしません。

## 切戻し

切替前のunitは本番rootの`rollback/units`、設定・catalogの切替前コピーとhashは同じrollback記録へ保持する。問題があれば新財務timer/serviceを停止し、保存unitを戻してdaemon-reloadする。旧SQLite serviceの再開は保存済み旧設定・旧runtimeを組で使う。

正式候補を以前の公開候補へ戻す場合は、その候補の検証記録・固定SDK・原本を用いて上記activateを実行し、expectedActiveへ現在候補IDを指定する。初回の「参照なし」へ戻す際は停止・排他・副ファイル不存在を確認して、保存した切替前catalogを復元する。DBを編集して履歴を削除しない。詳細な実行結果とhashはdeployment.jsonと検証ログを参照する。

## TypeScript版への更新結果（2026-11-03）

[PR #70](https://github.com/oharato/edinet-ts/pull/70)をmainへマージしました（merge commit `1b1262c8f81d75a7c7f0c4925b466505455d3cf9`）。稼働SDKは `837d1aba0c9a763d9eb018b66c3db89ccee7afc2` の固定実行treeです。実装とその固定版の全体テスト5,472件・ESM4件・型・整形・lint・CodeQL・依存監査が成功しています。

新しい独立SAX照合器で7,408原本・14,816行・38,598採用値・43,340 factを照合し、全値digest `1603fa0869b896f6efb6c9468b3cd9d4c9c05396eb9eb0c51bf5b37580b11bae` が旧照合結果に一致しました。照合器と依存モジュールのhashも採用runtimeと一致します。検証記録の場所はdeployment.jsonの `sourceVerificationRecord` です。既存のPython記録を書き換えて流用していません。

旧日次処理の追加取得1,300原本は、元poolの全宣言・圧縮内容・観測を保った別poolへ引き継ぎました。追加内容のgzip展開後SHA、元候補との宣言・取得時刻の一致、入力DBの不変を独立に確認しています。旧日次候補・設定・進捗は保持し、新しいSDKは別の日次rootを使います。証跡は `node-runtime-837d1aba0c9a/retained-source-audit.json` です。

metadataと財務serviceは新runtimeでそれぞれ終了0を確認しました。財務の最初の結果は一覧100,000観測までの `partial` です。これは日次候補の完成・正式公開・連続2日運転の合格を意味しません。両timerは切替前の有効・稼働状態へ戻しています。正式catalogのactiveと履歴、検索DBの全hashは更新前後で同一です。

今回の更新直前のDuckDB用unitはdeployment.jsonの `previousRuntimeUnits`、最初のSQLite用unitは `unitsBackup` にあります。どの世代へ戻すかに対応したunit・設定・SDKを組で使ってください。

日次一覧の凍結時刻より後に取得した原本は、準備時の時刻条件では転記されません。そのため、上記1,300原本は当日の書込可能な取得cacheへ別途転記しました。元の取得時刻と原観測、凍結入力・handoff・取得jobを保持し、SDKの再利用経路で扱います。証跡は `node-runtime-837d1aba0c9a/late-source-cache-transfer.json` です。

さらに、一覧根拠を確認済みの訂正親93書類を20件単位で取得し、失敗0・全93原本のhash検査と保存を確認しました。対応する原観測111件が日次候補と一致することを確認してからcacheへ転記しています。これを旧cutoffでの採用や金額照合の合格とは扱いません。`data/roadmap/missing-parent-source-job-20261103/completion.json` に記録しています。転記後は財務serviceと元のtimerを再開しました。翌日の固定poolへの継承は[残作業](../plans/REMAINING_WORK.md)で追跡します。
