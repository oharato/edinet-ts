# 解析済みSQLiteから検索用DuckDBを構築する

2026-10-31。独立計画のP3。通常検索・正式切替への接続はP4以降。

`DuckFinancialIndexBuild` は、固定readOnlyの `ObservedFinancialArchive` と `ParsedFinancialStore` から会社単位で候補DuckDBを構築する。原本DBから読むのは一覧観測・原本宣言・本文の存在だけで、XML本文・XMLパーサーは使用しない。

## 入力と採用

`begin(input, parsedSha256)` は既存の構築計画と解析済みStore指紋を固定する。対象会社・cutoff・原本archive指紋・解析版・source commit・対応表版・明細条件を一致させる。新しい原本に対応する解析結果がなければ欠損として残し、古い原本・旧解析版へ戻らない。

一覧の書類選択、原本利用可能時刻、会社・証券コード、期間、訂正対象の照合は既存XML経路と共有する。解析結果の書類ID・入力hashも照合する。同時刻に異なる原本が存在する場合は採用しない。解析済みStoreは完全な結果と列の一致を検査して返す。

`createParsedFinancialSnapshots` が採用処理を行い、`projectFinancialIndexGeneration` がSQLiteと共通の財務行・値・根拠・manifestへ変換する。DuckDBの整数はBIGINT、数値はDOUBLE。会社別の中間世代の財務行を重複保存しない。

## 保存・再開・完了

- 呼出側が専用のDuckDB接続を渡し、接続とinstanceの寿命を管理する。新規空DBまたは本builderの候補だけを受け付ける。
- `runNext` は1〜100会社を処理する。会社の財務行・指標値・完了receiptは同じtransactionで保存し、失敗時は会社全体をrollbackする。
- 再open時は保存済みreceiptから再開する。commit成功直後に呼出側へ例外が返っても、同じ会社を重複投入しない。
- 同じinstanceの二重実行を拒否し、会社間でsignalを確認する。専用接続を他処理と共用しない。
- `finish` は対象会社が揃ったこと、receipt・財務行・指標値のhashと件数を検査し、完成manifestをtransactionで保存する。
- 完了監査の行本文・指標原文は最大100件・合計128 MiBごとに読む。manifest等のメタデータはメモリへ保持する。全社の最大RSSはP7で測定する。

`finished` は構築完了を表す。品質・独立原本照合の合格や、利用者が参照する正式世代への切替を意味しない。原本や旧世代は削除しない。

## 検証と残工程

専用テストは会社単位のrollback、再接続、commit直後の例外、signal・二重実行、計画改変、財務行・値・receiptの改変拒否、無関係なDBの拒否、100件を超える行・指標の分割監査を確認する。選択処理のテストは日本基準・IFRS・訂正対象・期間・未来原本・版/条件分離を含む。

実原本検証スクリプト:

```sh
node node_modules/tsx/dist/cli.mjs scripts/verify-duck-financial-index-build.ts \
  data/benchmarks/parsed-financial-snapshots-20261031 \
  data/benchmarks/parsed-financial-job-20261031 \
  <新規出力先>
```

入力の小標本archiveから、現在の解析版で別の解析済みSQLiteを作成した後、XML読込・パーサーを禁止してDuckDBを構築する。接続とinstanceを閉じて再開し、同じ入力のSQLite集約世代と全列比較する。最終証跡は `data/benchmarks/duck-financial-index-build-20261031-v8/summary.json`。実2社・4行・18指標で全列一致、構築中XML読込/解析0回、入力archive・解析済みStore不変を確認した。小標本のファイル容量から全社削減率を推定しない。

Node driverはoptional依存 `@duckdb/node-api@2.0.0-r.1` に固定。既存同期APIや `src/index.ts` の公開exportsにはまだ接続していない。安全な候補ファイルの開閉・完全なschema検査・非同期readerはP4、検証再利用はP5、正式catalogと原本照合gateはP6、全社・日次・SIGKILL復旧・配布はP7、旧データ整理はP8で行う。

## 全社の直接解析との比較

`node scripts/verify-duck-financial-direct.mjs <固定SDKディレクトリ> <完成したcycleディレクトリ> <新規証跡ディレクトリ>` は、構築時のSDK指紋が一致する配布コードで、原本を会社別に直接解析し直す。読取専用DuckDBの初回全体監査後、直接経路で生成した全行・全指標のhash、値/根拠を含む本文hash、採用/保留/欠損等の全診断を照合する。

解析済みStoreを期待値にせず、XML解析経路との差を検出する。同一のパーサー・選択/投影処理を使うため、パーサー自体の独立した金額認証は別のPython照合で行う。会社ごとにprogressを保存し、全社一致後だけsummaryを作る。固定入力と完成記録のhash、SDK指紋、終了時の原本hashも確認する。

完成前の候補には実行しない。34 GiBの保護余裕と原本コピー分の容量を確認し、構築処理と大容量の私有コピーを重ねない。

## 全社検証の連鎖実行

`python3 scripts/verify-duck-financial-full.py --pid <実構築worker PID> --sdk <固定SDK> --run <batch-002.jsonを保存する実行directory> --node <Node26実行path> --output <新規directory>` はLinux pidfdで実workerの終了を待つ。PID番号の再利用やstatusファイルだけで完了を推定しない。

終了後のbatch結果がbuiltの場合だけ、直接XML比較→独立Python原本照合→同一世代のreader性能比較を逐次実行する。検証スクリプトは開始時に出力配下へ固定コピーし、hashと各段階の終了コード・時間・stdout/stderr・time記録を保存する。容量保護付きの各検証を直列にし、大容量コピーを重ねない。失敗時は後続へ進まず、中断時は実行中の検証childを終了させる。待機中の制御を止めても元の構築workerは終了させない。

原本照合単独は `node scripts/verify-duck-financial-raw.mjs <固定SDK> <完成cycle> <新規証跡directory>`。SDK同梱Pythonを利用し、全available値の検証件数が品質APIのavailable件数と一致することも確認する。catalogを変更せず、品質未達候補を正式承認した扱いにはしない。

制御の最終状態 `validation-finished-not-publication-approved` は検証連鎖の完了を示す。速度/RSS/容量の受入基準や正式切替の承認は別途必要。
