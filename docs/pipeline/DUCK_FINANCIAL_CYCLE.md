# 固定原本から解析・検索DuckDBを構築する

2026-10-31。移行計画P7の作成入口。現在の入力は既存取得処理が用意した固定原本SQLite。取得制御・metadata最新性の証明・検証付き切替のCLI統合は継続する。

```sh
edinet-ts build-duck-financial-cycle --config /absolute/cycle.json \
  --max-documents 100 --max-companies 100 --max-batches 10
```

```json
{
  "version": 1,
  "archivePath": "/data/fixed-archive.sqlite",
  "parsedStorePath": "/data/parsed.sqlite",
  "outputDirectory": "/data/candidates/day-1",
  "build": {
    "id": "day-1",
    "generation": "day-1",
    "archiveSha256": "64桁の実archive指紋",
    "population": {
      "asOf": "2026-10-31",
      "observedAt": "2026-10-31T00:00:00Z",
      "source": "固定した対象会社一覧",
      "sourceSha256": "64桁の一覧指紋",
      "edinetCodes": ["E12345"]
    },
    "options": {
      "cutoff": "2026-10-31T12:00:00Z",
      "extractorVersion": "daily-parser-1",
      "sourceCommit": "40桁の固定source commit"
    }
  }
}
```

パスは正規の絶対パス。出力先の親と共有Storeの親は既存の正規ディレクトリとし、原本・共有Storeは候補ディレクトリの外へ置く。入力例の指紋文字列は実際の値に置き換える。

## 保存と再開

- `parsedStorePath` は日次候補間で共有する版付き解析済みSQLite。同じ原本hash・SDK/解析/対応表版・項目集合は再解析しない。
- 候補内の `input.json` は入力・SDK指紋を固定する。別入力・別SDKを同じ出力先へ混ぜない。解析キーの版はSDK全ファイルとpackage manifest、指定extractorVersionの指紋を含み、元の指定版もinputへ残す。
- `parse-job.sqlite` はその候補の解析計画。部分処理後も結果は共有Storeへ原本単位で保存される。
- 解析が揃った時点で共有Storeを閉じ、候補内の `parsed-snapshot.sqlite` を作る。以後の構築はこの固定snapshotだけを使う。別日が共有Storeへ追加しても、旧候補を同じ入力から再開できる。
- `index.duckdb` は会社単位のtransactionとreceiptで再開する。構築完了後は全件検査・CHECKPOINT・closeを経て品質候補を `publication.sqlite` へ保存する。
- `build.json` は同じ入力・世代・品質・候補へ一致する完成記録。同内容の再実行はこの記録と実DBを照合して返す。

各limitは1〜100。max-batchesは各段階で同じ原本コピー・Store・native接続を保持する回数で、既定1。同一セッションの複数バッチ間でも入力・SDK・容量を確認する。partialは保存済み進捗で、同じコマンドを再実行する。signalは原本/会社の境界で処理し、開始済みtransactionの結果を保持する。

候補snapshotは構築再開のための一時的な固定入力で、恒常的な検索DBを二重保存する設計ではない。完了後の保持整理はP8で参照と復旧条件を確認して行う。原本や共有Storeを自動削除しない。

## 排他・容量・境界

CLIは既存日次運用と同じ `/usr/bin/flock` を使い、候補lock→共有Store lockの順に非待機で取得する。競合は終了75。no-forkでworker自身がlockを保持し、親CLIが消えてもworker実行中の排他を維持する。signalはworkerへ伝え、lockを持つworkerの終了でOSが解放する。`--locked` は既存運用同様の内部用で、通常は指定しない。

SDK `buildDuckFinancialCycle` を直接呼ぶ側は同じ二つの排他を保持する。既存相当の34 GiB＋原本/解析snapshot分の容量余裕を出力先とtmp領域で要求し、guardを下げて処理を押し通さない。native spillは私有一時ディレクトリへ保存し、通常終了で削除する。

未知の既存出力先、未知ファイル、リンク、別入力・SDK、原本指紋不一致、改変receiptを拒否する。snapshotは共有Storeを閉じ、副ファイルなしとcopy前後の同一性・schemaを確認してから確定する。未確定tmpは候補排他の下で回収する。

**builtは正式切替を意味しない。** 固定archiveだけではmetadata最新性を証明しないため `metadataCurrentForCutoff: false` とblockerを返す。原本照合も未実施とし、publicationEligibleはfalse。qualityの条件も維持する。検証記録と取得側のmetadata証跡を結ぶ日次/正式切替入口はP7の残件。

## 検証範囲

専用試験では解析→構築の分割再開、cache時XML解析なし、翌日相当の追加1原本だけの解析、共有Store更新後の旧候補再開、同一セッション複数バッチ、未知出力/入力差異、容量不足、中断、receipt/hash・検証フラグの改変拒否を確認する。

実原本由来のCLI検証は `scripts/verify-duck-financial-cycle.ts`。通常のflockラッパーで別processを起動し、解析途中→構築途中→完成→同内容再実行、二つのlockの競合拒否、killされたlock保有processの解放を確認する。これは**DB書込中SIGKILLの復旧試験ではない**。SQLite hot journalとDuckDB WALを含む実強制終了は[復旧仕様](DUCK_FINANCIAL_RECOVERY.md)の追加検証へ実装した。全社・日次制御・利用先の検証は残っている。

## 強制終了後の同じ入力での再開

管理下の解析Store・ジョブ・catalogのjournalは、私有復旧像の全検査と変更前データの退避後に自動復旧する。新規schemaはstagingで初期化する。詳細とSIGKILLの検証範囲は[強制終了復旧](DUCK_FINANCIAL_RECOVERY.md)。未知形式・破損・SDK差異・容量不足を押し通す処理ではない。

## 既存の日次取得からの接続

`scripts/roadmap/build-duck-financial-cycle.mjs` の `buildReconstructedDuckFinancialCycle(config, {parsedStorePath, sourceCommit, maxDocuments, maxCompanies, maxBatches, signal})` は、既存の取得完了監査・固定一覧/原本の再構築を先に実行し、その `buildInput` を新経路へ渡す。`sourceCommit` は固定した40桁の小文字hex、解析済みStoreは共有先の絶対パスを指定する。

呼出元は取得候補・metadataの既存排他を保持し、その後 `config.outputDirectory + '/duckdb.lock'`、`parsedStorePath + '.lock'` の順で保持する。関数単独で排他取得はしない。新候補は `config.outputDirectory + '/duckdb'` に保存し、既存SQLite検索候補と同じ出力ディレクトリを使わない。

`duckdb-handoff.json` は再構築記録のファイルhash・接続スクリプトhash・DuckDB入力を固定する。再開時に異なる原本・解析commit・Store先を混ぜず、構築前後のhandoff変更も拒否する。再構築が部分完了ならその状態を返し、検索構築を開始しない。

日次鮮度は既存の再構築処理が監査した状態だけを引き継ぐ。取得が翌日に跨いで鮮度を保証できない場合はmetadata blockerを残す。完了記録があっても原本照合・品質条件は別途必要で、常に `publicationEligible: false`。この関数は正式参照を変更しない。配布CLIからの日次一括実行と正式切替への接続は残件。

### 排他付き実行コマンド

```sh
node scripts/roadmap/run-acquired-duck-financial-cycle.mjs \
  --config /absolute/path/preparation-config.json \
  --parsed-store /absolute/path/parsed-financial.sqlite \
  --source-commit <40桁の固定commit> \
  --max-documents 20 --max-companies 20 --max-batches 1
```

このコマンドは取得が完了した候補に対して実行する。取得候補、metadata完了記録（指定時）、DuckDB候補、共有解析Storeの順でflockを保持し、再構築と構築を同じ排他区間で行う。競合時は75、入力不正/処理失敗は1、中断は2。部分完了なら同じコマンドで再開する。configは親が読んだ内容hashと排他取得後の子が読んだ内容hashを照合し、入替を拒否する。内部の `--locked` と `--config-sha256` は呼出元から指定しない。

実行には通常build済みのdist、DuckDBのoptional driver、Linuxの `/usr/bin/flock` が必要。既定の構築モードには日次の自動取得開始・原本照合・正式切替・スケジューラ登録を含めない。照合・切替は以下の明示モードで実行する。

### 取得済み候補の照合と正式参照切替

上記コマンドに `--verify` を付けると、品質条件を満たした候補の採用値を原本から照合し、取得候補直下の `duckdb-value-verification.json` に記録する。正式参照は変更しない。

`--publish --catalog /absolute/path/official.sqlite --expected-active <直前の候補IDまたはnull>` は既存の照合記録を再検証して切り替える。catalogは候補ディレクトリと共有入力の外に置く。取得・metadata・DuckDB・解析Storeのロックに続いてcatalogのロックを保持する。初回の参照なしは文字列 `null` を明示する。`--verify` と `--publish` は同時指定できない。

切替前に再構築監査、日次鮮度、品質、同一候補・入力・解析版、原本照合記録、処理中のhandoff不変を確認する。照合記録を切替時に自動作成しない。条件不足はJSONの `verification-blocked` / `publication-blocked` と終了コード1を返す。CAS不一致や検証失敗でも正式参照は変えない。切替成功後、利用側は明示的にreaderをreloadする。別の保持済み候補への切戻しにも、対応する固定入力と直前候補を明示する。

## 日次準備・取得からの一括制御関数

`scripts/roadmap/daily-duck-financial-cycle.mjs` の `runDailyDuckFinancialCycle(settings, options)` は既存の日次準備、取得予算/再試行/容量保護付きの原本取得、監査済み再構築、新しい解析済みSQLite・DuckDB構築を順に呼ぶ。`settings` は既存の日次準備設定のversion 1/2、`options` は `parsedStorePath`・固定 `sourceCommit`、構築batch上限、`signal` と既存処理向けの `readUnitState`・`prepareOptions`・`acquisitionOptions` を受け取る。取得providerは既存の `createFetchXbrl` を `acquisitionOptions` へ渡す。

version 2はDuckDBの完成記録を基準に古い未完了日から再開し、当日が構築済みなら `cycle-complete` を返す。翌日は新しい候補を作り、同じ版・原本の解析結果を共有Storeから再利用する。完成記録のhash・出力先・handoffの日付を確認し、不正な日付・別日の記録・壊れた完成記録を飛ばして新しい候補へ進まない。初回に必要な日次rootはprivate directoryとして作成する。

この関数は排他を自分では取得しない。呼出元は日次root・実metadata checkpoint、および選択した取得候補・DuckDB候補・共有解析Storeの排他を保持する。取得が途中・一時停止・中断なら構築へ進まず、その状態を返す。準備設定の内容が取得/構築中に変わった場合も拒否する。照合・正式切替は明示した別工程で行う。既存SQLite日次コマンドの既定動作は変更しない。

### 日次一括コマンド

```sh
node scripts/roadmap/run-daily-duck-financial-cycle.mjs \
  --config /absolute/path/daily-financial-settings.json \
  --parsed-store /absolute/path/parsed-financial.sqlite \
  --source-commit <40桁の固定commit> \
  --max-acquisition-batches 1 --max-documents 20 --max-companies 20 --max-batches 1
```

既存の日次準備設定version 1/2を読み、固定取得の停止・完了と当日のmetadata完了を確認して、日次準備→原本取得→DuckDB構築を分割実行する。取得が必要な場合だけmetadata設定のenvPathを読み、EDINET_API_KEYで既存downloaderを作成する。通信timeout60秒・downloader独自retryなし、既存取得ジョブの予算・再試行・容量保護を維持する。provider-cacheは選択した日付ディレクトリ内に置き、日次rootの日付一覧へ混ぜない。

日次root→実metadata checkpoint→取得候補→DuckDB候補→共有解析Storeの順で排他を保持する。初回handoff前は単独取得/構築が使える候補がないため、root/metadata排他下で準備し、候補ができた時点で後続ロックを取る。handoffのある再開では準備前から取得候補もロックする。設定内容は排他取得前後でhashを確認する。

Linux flockを子で親から継承したfdに適用し、親がfdを閉じるまで保持する。正常終了・例外・SIGKILLでfdが閉じればOSがロックを解放する。競合75、中断2、その他失敗1。構築の部分完了・取得の待機/一時停止はJSONで返し、同じコマンドで再開する。照合と正式切替は前述の取得済み候補コマンドで明示実行する。既存の日次SQLiteコマンドやサービス登録は変更しない。


実運用設定のguard summaryに相対`archivePath`が残る場合、既存のmigration proof検査は元workspaceを基準に解決する。SDKを別directoryに置いていても、元workspaceをcwdにしてCLIの絶対パスを指定する。cwdの異なるパスを同じ原本と推測して受け入れない。2026-10-31の実設定ではmetadata未完了のため`waiting-for-daily-metadata`となり、取得/構築を開始していない。証跡は`data/benchmarks/duck-financial-unified-daily-20261031/`。
