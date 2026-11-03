# ソースコードの読み方

公開APIの入口は [`src/index.ts`](../../src/index.ts)、CLIの入口は [`src/cli.ts`](../../src/cli.ts) です。内部の配置を変えても、`import { ... } from "edinet-ts"` と `node dist/cli.js` は同じ入口を使います。

## 処理の種類で探す

| 場所                        | 役割                                                                |
| --------------------------- | ------------------------------------------------------------------- |
| `src/edinet/`               | EDINET APIとの通信、書類一覧、取得ファイルの検査とキャッシュ        |
| `src/xbrl/`                 | XMLの入力検査、XBRLの読み取り、期間・単位・連結区分の手掛かりの抽出 |
| `src/financial/extraction/` | 対応タグの定義、財務指標の採用、会計基準・報告期間の判定            |
| `src/financial/snapshots/`  | 原本や解析済み結果から、出典を持つ保存用の財務行を作る処理          |
| `src/financial/selection/`  | 複数の提出版・訂正書類から、根拠に基づいて採用する原本を決める処理  |
| `src/financial/analysis/`   | 成長率、ROA、ROE、ROIC、株式分割、株価との比較などの計算            |
| `src/financial/screening/`  | 財務行を条件・並び順・件数で絞る処理                                |
| `src/companies/`            | 企業マスター、会社情報、法人番号との対応、業種比較                  |
| `src/companies/registry/`   | 法人番号の原記録、全国版・差分の取得、署名検証、履歴の再構成        |
| `src/disclosures/`          | 株主・役員・設備・人的資本など、開示表の読み取り                    |
| `src/pipeline/`             | 取得・保存・構築の呼出順、途中再開、公開前の照合                    |
| `src/db/`                   | SQLite/DuckDBの保存・検索・世代管理・復旧                           |
| `src/db/schema/`            | 財務データの主要テーブルと索引のDDL定義                             |
| `src/cli/`                  | 引数の読み取りとSDK呼出し。実際の処理は各機能へ渡す                 |
| `src/utils/`                | 複数の機能で共有する小さな数値処理・ファイル検査                    |
| `src/types/`                | タクソノミから生成した型                                            |

型と処理は機能ごとに近くへ置きます。たとえば財務共通の型は [`financial-types.ts`](../../src/financial/financial-types.ts)、保存操作は `db/`、工程の制御は `pipeline/` です。`model/`・`service/`・`logic/` という層に一律に分割する構成にはしていません。

## よく使う処理の入口

| 調べたい処理                               | 最初に読むファイル                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| EDINETから書類を取得する                   | [`edinet/api-client.ts`](../../src/edinet/api-client.ts)                                                                             |
| XMLを解析する                              | [`xbrl/parse-xbrl.ts`](../../src/xbrl/parse-xbrl.ts)                                                                                 |
| 値の採用理由を調べる                       | [`financial/extraction/select-metric-facts.ts`](../../src/financial/extraction/select-metric-facts.ts)                               |
| 日本基準・IFRS、連結・単体、期間を判定する | [`financial/extraction/resolve-reporting-basis.ts`](../../src/financial/extraction/resolve-reporting-basis.ts)                       |
| 訂正書類の採用根拠を調べる                 | [`financial/selection/select-financial-source-versions.ts`](../../src/financial/selection/select-financial-source-versions.ts)       |
| 取得済みデータからDuckDB候補を作る         | [`pipeline/build-duck-financial-cycle.ts`](../../src/pipeline/build-duck-financial-cycle.ts)                                         |
| 検索DBの値を原本XMLから独立に照合する      | [`pipeline/verification/verify-source-values.ts`](../../src/pipeline/verification/verify-source-values.ts)                           |
| 原本照合後に正式catalogを切り替える        | [`pipeline/verification/verify-duck-financial-publication.ts`](../../src/pipeline/verification/verify-duck-financial-publication.ts) |

日次運転や署名検証などの実行コマンドは [`scripts/README.md`](../../scripts/README.md) を参照してください。運用スクリプトは設定・排他・実行予算を扱い、SDKの処理を呼びます。単独実行するTypeScriptの拡張子は `.mts` で、Nodeが直接実行します。

## 代表的な2つの呼出し経路

以下は処理順を追うための入口です。全APIがこの経路を通るわけではありません。通信・メモリ内処理・保存の全体図は[技術仕様](../SPECIFICATIONS.md#処理の全体像)を参照してください。

### ローカルXMLから主要指標を返す

| 順序 | 関数・呼出元                                               | ここで行うこと                                                                                |
| ---- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1    | [`run-cli.ts`](../../src/cli/run-cli.ts) の `parse` action | `--file` のXMLを読み、`new EdinetXbrlParser().parse(content)` を呼ぶ。通信やDB保存はしない    |
| 2    | [`EdinetXbrlParser.parse()`](../../src/xbrl/parse-xbrl.ts) | 入力を検査し、`parseContexts()`・`parseUnits()`・`traverse()` の順でcontext・単位・factを読む |
| 3    | [`EdinetXbrlObject`](../../src/xbrl/xbrl-document.ts)      | タグごとの複数候補を保持する。`getKeyMetrics()` が `extractKeyMetrics()` の既定規則で値を選ぶ |
| 4    | `parse` actionへ戻る                                       | JSONを標準出力へ返す。`--output` 指定時は結果ファイルへ保存する                               |

代表テストは[`edinet-xbrl-parser.test.ts`](../../test/edinet-xbrl-parser.test.ts)です。同梱XMLをParserで読み、`getKeyMetrics()` の主要指標を確認します。期間・連結/単体・追加次元・候補の優先順は[`key-metrics-scope.test.ts`](../../test/key-metrics-scope.test.ts)が解析済みオブジェクトを組み立てて確認します。CLIのオプション全体を検証するテストではありません。条件を指定した採否理由を追う場合は `EdinetXbrlObject.selectMetric()` → [`selectMetricFact()`](../../src/financial/extraction/select-metric-facts.ts) と[厳密選択テスト](../../test/metric-selection.test.ts)を読みます。

### 固定原本から検索候補を作り、検証して公開する

この経路の入力は取得済みの固定アーカイブです。取得工程と排他の要件は[構築手順](../pipeline/DUCK_FINANCIAL_CYCLE.md)を参照してください。

| 順序 | 関数・ファイル                                                                                                             | ここで行うこと                                                                                                                                                                                                                        |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | [`buildDuckFinancialCycle()`](../../src/pipeline/build-duck-financial-cycle.ts)                                            | 入力・SDKの指紋を固定し、解析計画を作って `ParsedFinancialJob.runNext()` を呼ぶ                                                                                                                                                       |
| 2    | [`ParsedFinancialJob.runNext()`](../../src/db/parsed-financial-job.ts)                                                     | 同じ版の解析結果があれば再利用。なければ `ObservedFinancialArchive.readSource()` → [`createAutomaticFinancialSnapshots()`](../../src/financial/snapshots/create-financial-snapshots.ts) → `ParsedFinancialStore.put()` の順に保存する |
| 3    | [`DuckFinancialIndexBuild.begin() / runNext()`](../../src/db/duck-financial-index-build.ts)                                | 固定した解析済みStoreのsnapshotとアーカイブを読み、会社ごとの採用結果と検索行をDuckDBへ構築する                                                                                                                                       |
| 4    | `buildDuckFinancialCycle()` 内の [`FinancialIndexPublication.prepareAsync()`](../../src/db/financial-index-publication.ts) | 完成したreaderで品質を調べ、catalogに公開候補を登録する。正式参照は変えない                                                                                                                                                           |
| 5    | [`recordDuckFinancialValueVerification()`](../../src/pipeline/verification/verify-duck-financial-publication.ts)           | 別の明示操作。固定候補の値を[原本XMLの独立読取](../../src/pipeline/verification/verify-source-values.ts)で照合し、証跡を保存する                                                                                                      |
| 6    | 同ファイルの `activateVerifiedDuckFinancialPublication()`                                                                  | 証跡と原本照合を再確認し、`expectedActive` を条件にcatalogの正式参照を切り替える                                                                                                                                                      |
| 7    | [`DuckFinancialPublicationReader.open() / reload()`](../../src/db/duck-financial-publication-reader.ts) → `screen()`       | catalogと一致する固定DuckDBを開き、正式世代を検索する。既存readerは明示的なreloadまで旧snapshotを維持する                                                                                                                             |

代表テストは[`duck-financial-cycle.test.ts`](../../test/duck-financial-cycle.test.ts)です。解析と構築の分割再開、同じ解析結果の再利用、構築後も `financialValuesValidated: false`・`publicationEligible: false` であることを確認します。原本照合付きの正式切替は[`duck-financial-verification.test.ts`](../../test/duck-financial-verification.test.ts)、readerの切替は[`duck-financial-publication-reader.test.ts`](../../test/duck-financial-publication-reader.test.ts)で別に確認します。上表の5〜7は構築関数の自動的な副作用ではありません。

## SQLiteとDuckDBのコードの境界

現行の継続運転はSQLiteに一覧観測・原本・解析済みStore・公開catalogを持ち、検索候補をDuckDBに構築します。[`DuckFinancialSearchIndex`](../../src/db/duck-financial-search-index.ts) と公開readerは非同期です。一方、既存の [`FinancialSearchIndex`](../../src/db/financial-search-index.ts) と [`PublishedFinancialIndex`](../../src/db/sqlite-financial-publication-reader.ts) は同期SQLite APIとして残しています。

検索の正規化・品質検査などの共通処理は `FinancialIndexReadQueries`（`financial-search-index.ts`）にあり、SQLite側は同期、DuckDB側は非同期でSQLを実行します。DBエンジンごとに財務指標の採用規則を作り直す構成ではありません。現行の構成は[技術仕様](../SPECIFICATIONS.md#current-storage)、移行日や実環境の更新履歴は[本番運用記録](../pipeline/DUCK_FINANCIAL_PRODUCTION.md)で確認できます。

## テーブル定義を探す

| 保存対象                         | 定義ファイル                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| 一覧の観測履歴・原本XML          | [`observed-financial-archive.ts`](../../src/db/schema/observed-financial-archive.ts)   |
| 解析結果・解析済みの行と値       | [`parsed-financial-store.ts`](../../src/db/schema/parsed-financial-store.ts)           |
| 検索世代・財務行・指標値         | [`financial-search-index.ts`](../../src/db/schema/financial-search-index.ts)           |
| DuckDBの構築計画・会社別完了記録 | [`duck-financial-build.ts`](../../src/db/schema/duck-financial-build.ts)               |
| 公開候補・正式参照・切替履歴     | [`financial-index-publication.ts`](../../src/db/schema/financial-index-publication.ts) |

これらは `CREATE TABLE` / `CREATE INDEX` の文字列です。保存クラスはこの定義を読み、作成時と既存ファイルを開くときに形式を検査します。DuckDBは検索表の共通定義を使い、構築時に型を対応させます。

配置整理時にはSQL文字列を変更せず移動しました。会社マスターや法人番号など、上表以外の用途のDDLは対応する `src/db/` の保存クラスにあります。実際の行と値の例は [財務データ構造の説明](../pipeline/FINANCIAL_DATA_MODEL.md) を参照してください。
