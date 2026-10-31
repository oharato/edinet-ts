# DuckDB候補の独立原本照合と切替

2026-10-31。移行計画P6。正式な日次制御・配布物への接続はP7。

品質catalogの `activateAsync` は従来SDKと同じ品質/pointer操作で、独立原本照合を実行しない。DuckDB候補を照合して切り替える入口は `scripts/roadmap/duck-financial-value-verification.ts` の `recordDuckFinancialValueVerification`、`validateDuckFinancialValueVerification`、`activateVerifiedDuckFinancialPublication`。

## 照合の流れ

1. 固定readOnlyのDuckDB readerと保存候補の品質・世代・原本/計画指紋を確認する。条件未達候補は切り替えない。
2. `withVerificationProjection` で私有一時SQLiteへ全財務行・全指標値・同じ世代manifestを転記する。XMLを再読込せず、最大100件・payload64 MiBで転記する。
3. 一時SQLiteの全品質を再検査し、DuckDBの検査済み品質と完全一致することを確認する。
4. 既存の `verify-financial-values.py` を `python3 -I` で実行する。SDKをimportせずSQLite/gzip/ElementTreeで採用値と原本を照合する。
5. 成功・失敗・signal中断のいずれでも一時SQLiteを削除する。closeは実行中のprojection/callbackを待つ。

一時SQLiteは既存照合器へ渡すためのもので、恒常的な検索DBの二重保存ではない。原本XMLを読むのは明示した独立照合時で、通常検索やDuckDB構築では読まない。原本ファイル全体の指紋も前後検査するため、切替時のI/OはP7で測定する。

## 記録と正式な切替入口

記録version2はengine、候補ID/候補本文hash、取得入力hash、DuckDBファイルhash、世代hash、原本hash、構築計画hash、品質hash、独立照合器hash、照合件数・全照合値のhash、検証時刻を保持する。解析版・対応表版・解析済みStoreは世代と構築計画の指紋へ結合される。別候補・別取得入力・別snapshotの記録を流用しない。

`activateVerifiedDuckFinancialPublication` は記録がないと拒否する。記録のhash・結合先・照合器版を確認した後、全採用値の独立照合を再実行し、保存されたchecksと一致した場合だけcatalogのCAS切替を呼ぶ。切戻しも戻り先の記録・原本・品質を同じ入口で再検査する。単なる成功フラグや、checksを変更してrecord hashだけ作り直した記録では切り替わらない。

原本は単一リンクの通常ファイル・正規の絶対パス・副ファイルなしを要求する。recordPathも正規の絶対パス。呼出側は既存の日次制御と同じ候補排他を保持し、固定inputSha256とsignalを渡す。P7で既存の日次commandへ接続する。

これは保存された直接XBRL採用値の照合で、PDF金額照合、科目意味の網羅、未採用/欠損値の未開示認証を代替しない。原本・照合器が検証中に変わった場合は停止する。Pythonは既存のfail-closedな未対応条件も維持する。

## 読取側のreload

`DuckFinancialPublicationReader.open(catalog,file)` は候補をロード・全件検査し、catalogの現在候補へ一致することを確認する。`reload(catalog,file)` は新readerの構築と照合が成功してから参照を差し替える。ファイル不在・破損・別世代・activeなしなら旧snapshotを保持する。

catalog切替だけでは開いたreaderを変更しない。新しいcatalog状態を渡して明示reloadする。既存readOnly catalogの私有コピーは自動追随しない。旧snapshot上で開始した検索を終えてから旧接続を閉じる。reload同時実行は拒否し、closeはreloadと検索が安全に終了するのを待つ。

`screen` はgenerationを除いたcohortを受け、現在候補の世代を固定する。明示generationの混在を拒否する。世代・品質・publicationの返却値は呼出側で変更しても内部状態に影響しない。

## 証跡

```sh
node node_modules/tsx/dist/cli.mjs scripts/verify-duck-financial-verification.ts \
  data/benchmarks/duck-financial-index-build-20261031-v8 \
  data/benchmarks/parsed-financial-snapshots-20261031/input.sqlite \
  <新規出力先>
```

最終証跡は `data/benchmarks/duck-financial-verification-20261031-v3/summary.json`。日本基準/IFRSの実原本2件、4行中の採用値8件・根拠16件を照合し、記録欠落の拒否、検証済み旧→新→旧の3履歴、元DuckDB/原本archive不変を確認した。既存の欠損値を許容した明示policyによる専用catalogの試験で、本番公開・全社品質合格ではない。

専用試験は原本照合/再実行、記録欠落・別候補・別入力・記録改変・照合器hash不一致・原本変更・条件未達・副ファイル・中断、projectionの一致/削除/close、reload失敗時の維持・切戻し・同時実行・closeを含む。全社・日次・package/CLI・利用先・SIGKILL復旧はP7で検証する。

## SDKへの同梱

`recordDuckFinancialValueVerification`、`validateDuckFinancialValueVerification`、`activateVerifiedDuckFinancialPublication` と入力型をSDKから公開する。従来の `scripts/roadmap/duck-financial-value-verification.ts` はSDK実装への再exportとして維持する。

Python照合器の正本は引き続き `scripts/roadmap/verify-financial-values.py`。`npm run prepare-financial-verifier` がソース実行用と配布用の `assets/verify-financial-values.py` へコピーする。通常のbuild/testはこの準備を実行する。実行時は同梱ファイルだけを参照し、リポジトリのスクリプトへ戻らない。利用環境には `python3` が必要。

照合開始時と終了時に原本DBの副ファイルを拒否する。検証記録の日時はUTCの正規ISO形式を要求する。このSDK入口の同梱は、取得一覧の最新性や日次handoffの保証・全社受入検証・本番切替の完了を意味しない。
