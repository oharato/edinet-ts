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
