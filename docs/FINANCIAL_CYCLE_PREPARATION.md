# 財務取得計画の再開可能な準備

`scripts/roadmap/prepare-financial-cycle.mjs` は、固定した一覧原観測と保存済みXBRL原本から別候補の `FinancialSourceJob` を準備する運用補助です。通信、財務値の検証、公開切替は行いません。SDKの公開APIではありません。

Node 26.12.1でbuild済みのdistを使用します。設定JSONの全ファイルパスは絶対パスとし、入力は通常の単一リンクファイル、出力は新しい専用ディレクトリを指定します。

```sh
node scripts/roadmap/prepare-financial-cycle.mjs /absolute/path/config.json
```

設定は `version: 1`、`metadataPath`、安定した `sourceId`、固定末尾 `throughSequence`、`sourceArchivePath`、原本poolの物理 `sourceArchiveSha256`、原本の取得時刻上限 `availableBy`、`outputDirectory`、既存のFinancialSourceJob入力形式の `input`（id/cutoff/population）を指定します。取得時刻上限はcutoff以前で、cutoffは未来にできません。対象原観測はcutoff以前の閉じた一覧日のみです。別のcutoffや母集団には別の出力先を作成します。

日次metadataと接続する場合は `metadataCheckpointPath` も指定します。版3の完了checkpoint、当日の提供元probe、昨日までの完了、未処理通知日0、固定末尾の一致を要求します。根拠不明通知は消さず、件数と元checkpoint本文を入力証跡に保存します。翌日のmetadata処理がcheckpointを更新しても、途中の準備は保存済み証跡を使って再開します。旧版の完了checkpointへ証跡を後付けせず、metadata controllerが新たに確認してから使用します。

CLIは出力先に対するflockを取得し、日次checkpoint指定時はその排他も取得します。競合はexit 75です。関数を直接呼ぶ場合は呼出し側で同じ排他を取得します。処理中に原本poolを更新しないでください。

出力は次の通りです。

- `input.json`: 設定、原観測prefixのhash/件数、Node/SQLite/SDK/運用コードの指紋、任意の日次完了証跡。
- `preparation.json`: 原観測cursor、原本転送cursorと全IDの連鎖hash、完了時の計画hash・監査結果。
- `archive.sqlite`: 固定原観測と時刻上限内の保存済み原本。
- `source-job.sqlite`: 不足原本を含む取得計画。

原観測1000件、原本100件ごとに永続化します。原本はSDKの転送上限256MiBと一件ごとのcommitに従います。DB commit直後の停止では旧cursorから冪等に再投入します。各起動は既定でそれぞれ100ページまで処理し、残りがあればstatus partialを返します。同じ設定で再実行してください。`--max-observation-pages` / `--max-source-pages` は各1〜1000です。SIGINT/SIGTERMは境界で中断し、再開できます。

進捗JSONはatomic rename/fsyncとchecksumで保存します。保存済み設定/ソフトウェア指紋が異なる再開を拒否します。原本転送後、候補の件数/原本ID集合を照合し、計画を作成してreadOnly監査を行います。既にpreparedなら固定計画の一致を確認して同じreceiptを返します。この再投入確認は、後続取得で変わるアーカイブ全体の再監査ではありません。次段階の取得完了後に別途監査が必要です。

空き容量は出力先と一時領域で32GiB+2GiBを維持し、読取用の私有コピー等に必要な追加容量も開始前に確認します。pool全体のコピー/指紋確認があるため、時刻上限で除外する原本が多くても開始費用はpool全体に依存します。出力やpoolの自動削除はありません。

日次自動runnerへの接続、原本poolの更新と保存寿命管理、取得後の最終cutoffからの再構築、財務値の品質判定・公開は後続工程です。この準備の成功を実日次運用や財務値の正しさの証明には使いません。

## 日次収集からの自動引継ぎ

`run-daily-financial-preparation.mjs` は、有限年次取得の全task完了・unit停止と、当日の日次metadataの完了を確認し、上記の準備を起動します。設定は `version: 1`、`metadataConfigPath`（既存日次設定）、`sourceArchivePath`（完了した取得のアーカイブ）、`populationPath`（完全な保存済み企業マスターJSON）、そのファイルの `populationSha256`、`outputDirectory` です。パスはすべて絶対パスです。

```sh
node scripts/roadmap/run-daily-financial-preparation.mjs /absolute/path/daily-financial-config.json
```

出力先に対する排他の後、実metadata checkpointの排他を取得します。年次の計画/hash・原本パスを照合し、日次の完了末尾・probe・通知cursorを検査します。母集団は保存済み公式マスターの上場区分から、閉じた一覧日と完了時刻に適合する観測だけを選びます。保存観測の基準日を当日へ書き換えず、マスターのネット更新は行いません。

`handoff.json` に設定/運用コードの指紋、元checkpoint本文/物理hash、母集団ファイルhash、準備設定を先に永続化します。cutoffと原本取得時刻上限には日次runの完了時刻を使います。以降の起動ではこの引継ぎを再利用し、別日のmetadataや新たな母集団を途中へ混ぜません。別設定や変更した運用コードでの再開は拒否するため、運用時はruntimeを固定します。

その後、`metadata-completion.json` と `preparation-config.json` を復元可能な凍結入力として作り、`candidate/` に準備します。完了ならstatus preparedとnextStage source-acquisitionを返します。同じ出力先は未消化の単一候補に対応し、翌日もその候補を保持します。取得/解析/品質/公開や保存寿命管理が接続されるまでは、別日の候補を自動で増やしません。候補を削除して新しい日次処理の代わりにする運用も行いません。

定期起動はmetadata処理と別のoneshot/timerを使えます。排他競合75や準備のpartialは次の定期起動で再試行します。1回の上限は既定の原観測100ページ/原本100ページです。SIGINT/SIGTERMで中断できます。通信や公開はこの引継ぎ処理では行いません。実行ログに記録する待機状態は、取得や財務値検証の完了を意味しません。
