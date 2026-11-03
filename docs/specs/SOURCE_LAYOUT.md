# ソースコードの読み方

公開APIの入口は [`src/index.ts`](../../src/index.ts)、CLIの入口は [`src/cli.ts`](../../src/cli.ts) です。内部の配置を変えても、`import { ... } from "edinet-ts"` と `node dist/cli.js` は同じ入口を使います。

## 処理の種類で探す

原本のbyteを読む処理はcore、値や開示表の意味を扱う処理はdomain、通信・ファイル・DB・実行工程はplatformに分けています。CLIは入力を受け取り、これらの公開処理へ渡します。

| 場所                                          | 入力と役割                                                     |
| --------------------------------------------- | -------------------------------------------------------------- |
| `src/core/parser/`                            | XML文字列からcontext・単位・factを読み、解析オブジェクトを作る |
| `src/core/archive/`                           | 渡されたZIP/圧縮byteを検査・展開する                           |
| `src/core/taxonomy/`                          | taxonomyから生成した項目型                                     |
| `src/core/numbers/`・`src/core/text/`         | 数値分数と文字列の共通処理                                     |
| `src/domain/financial/`                       | 指標の採用、基準・期間の判定、計算、snapshot、絞り込み         |
| `src/domain/disclosures/`                     | 事業、人的資本、ガバナンス、保有情報ごとの開示表抽出           |
| `src/domain/companies/`・`src/domain/edinet/` | 渡された企業マスター・会社情報・書類一覧の解釈と比較           |
| `src/platform/client/edinet/`                 | EDINETへのHTTP、一覧取得、原本キャッシュ、企業マスター取得     |
| `src/platform/registry/`                      | 国税庁の原記録、取得・署名確認、履歴再構成                     |
| `src/platform/db/engines/`                    | SQLite/DuckDBの接続・検査・復旧                                |
| `src/platform/db/stores/`                     | 財務、企業、法人番号、開示、metadataごとの保存・読取           |
| `src/platform/db/schema/`                     | 主要テーブルと索引のDDL                                        |
| `src/platform/pipeline/`                      | 原本取得・解析・索引構築・独立照合・再開の工程とjob            |
| `src/platform/queries/`                       | Storeを使う企業比較・財務検索                                  |
| `src/platform/files/`・`locks/`・`archive/`   | 保持ファイル、排他、ZIPファイルの読取                          |
| `src/cli/`・`src/cli/help/`                   | 引数・入力JSON・コマンドと型のヘルプ                           |

`EdinetXbrlObject` の既存メソッドは、domainの選択処理を呼ぶ互換入口です。採用や計算の規則はdomainにあります。 ZIPのpathを受け取る既存の版選択APIも、実ファイルの読取をplatformへ渡します。`fetchEdinetCompanyMaster` のHTTP部分は [platformの取得関数](../../src/platform/client/edinet/fetch-company-master.ts)、CSVの解析と時点検索は [domainの企業マスター](../../src/domain/companies/company-master.ts) に分けています。

型と処理は機能の近くへ置き、`model/`・`service/`・`logic/` のような一律の層は追加していません。全体の流れは[アーキテクチャ](ARCHITECTURE.md)を参照してください。

## よく使う処理の入口

| 調べたい処理                               | 最初に読むファイル                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| EDINETから書類を取得する                   | [`platform/client/edinet/api-client.ts`](../../src/platform/client/edinet/api-client.ts)                                                               |
| XMLを解析する                              | [`core/parser/parse-xbrl.ts`](../../src/core/parser/parse-xbrl.ts)                                                                                     |
| 値の採用理由を調べる                       | [`domain/financial/extraction/select-metric-facts.ts`](../../src/domain/financial/extraction/select-metric-facts.ts)                                   |
| 日本基準・IFRS、連結・単体、期間を判定する | [`domain/financial/extraction/resolve-reporting-basis.ts`](../../src/domain/financial/extraction/resolve-reporting-basis.ts)                           |
| 訂正書類の採用根拠を調べる                 | [`domain/financial/selection/select-financial-source-versions.ts`](../../src/domain/financial/selection/select-financial-source-versions.ts)           |
| 取得済みデータからDuckDB候補を作る         | [`platform/pipeline/build-duck-financial-cycle.ts`](../../src/platform/pipeline/build-duck-financial-cycle.ts)                                         |
| 検索DBの値を原本XMLから独立に照合する      | [`platform/pipeline/verification/verify-source-values.ts`](../../src/platform/pipeline/verification/verify-source-values.ts)                           |
| 原本照合後に正式catalogを切り替える        | [`platform/pipeline/verification/verify-duck-financial-publication.ts`](../../src/platform/pipeline/verification/verify-duck-financial-publication.ts) |

日次運転や署名検証などの実行コマンドは [`scripts/README.md`](../../scripts/README.md) を参照してください。運用スクリプトは設定・排他・実行予算を扱い、SDKの処理を呼びます。単独実行するTypeScriptの拡張子は `.mts` で、Nodeが直接実行します。

## 代表的な2つの呼出し経路

以下は処理順を追うための入口です。全APIがこの経路を通るわけではありません。通信・メモリ内処理・保存の全体図は[技術仕様](SPECIFICATIONS.md#処理の全体像)を参照してください。

### ローカルXMLから主要指標を返す

| 順序 | 関数・呼出元                                                      | ここで行うこと                                                                                |
| ---- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1    | [`run-cli.ts`](../../src/cli/run-cli.ts) の `parse` action        | `--file` のXMLを読み、`new EdinetXbrlParser().parse(content)` を呼ぶ。通信やDB保存はしない    |
| 2    | [`EdinetXbrlParser.parse()`](../../src/core/parser/parse-xbrl.ts) | 入力を検査し、`parseContexts()`・`parseUnits()`・`traverse()` の順でcontext・単位・factを読む |
| 3    | [`EdinetXbrlObject`](../../src/core/parser/xbrl-document.ts)      | タグごとの複数候補を保持する。`getKeyMetrics()` が `extractKeyMetrics()` の既定規則で値を選ぶ |
| 4    | `parse` actionへ戻る                                              | JSONを標準出力へ返す。`--output` 指定時は結果ファイルへ保存する                               |

代表テストは[`edinet-xbrl-parser.test.ts`](../../test/edinet-xbrl-parser.test.ts)です。同梱XMLをParserで読み、`getKeyMetrics()` の主要指標を確認します。期間・連結/単体・追加次元・候補の優先順は[`key-metrics-scope.test.ts`](../../test/key-metrics-scope.test.ts)が解析済みオブジェクトを組み立てて確認します。CLIのオプション全体を検証するテストではありません。条件を指定した採否理由を追う場合は `EdinetXbrlObject.selectMetric()` → [`selectMetricFact()`](../../src/domain/financial/extraction/select-metric-facts.ts) と[厳密選択テスト](../../test/metric-selection.test.ts)を読みます。

### 固定原本から検索候補を作り、検証して公開する

この経路の入力は取得済みの固定アーカイブです。取得工程と排他の要件は[構築手順](../ops/DUCK_FINANCIAL_CYCLE.md)を参照してください。

| 順序 | 関数・ファイル                                                                                                                                       | ここで行うこと                                                                                                                                                                                                                               |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | [`buildDuckFinancialCycle()`](../../src/platform/pipeline/build-duck-financial-cycle.ts)                                                             | 入力・SDKの指紋を固定し、解析計画を作って `ParsedFinancialJob.runNext()` を呼ぶ                                                                                                                                                              |
| 2    | [`ParsedFinancialJob.runNext()`](../../src/platform/pipeline/financial/jobs/parsed-financial-job.ts)                                                 | 同じ版の解析結果があれば再利用。なければ `ObservedFinancialArchive.readSource()` → [`createAutomaticFinancialSnapshots()`](../../src/domain/financial/snapshots/create-financial-snapshots.ts) → `ParsedFinancialStore.put()` の順に保存する |
| 3    | [`DuckFinancialIndexBuild.begin() / runNext()`](../../src/platform/pipeline/financial/jobs/duck-financial-index-build.ts)                            | 固定した解析済みStoreのsnapshotとアーカイブを読み、会社ごとの採用結果と検索行をDuckDBへ構築する                                                                                                                                              |
| 4    | `buildDuckFinancialCycle()` 内の [`FinancialIndexPublication.prepareAsync()`](../../src/platform/db/stores/financial/financial-index-publication.ts) | 完成したreaderで品質を調べ、catalogに公開候補を登録する。正式参照は変えない                                                                                                                                                                  |
| 5    | [`recordDuckFinancialValueVerification()`](../../src/platform/pipeline/verification/verify-duck-financial-publication.ts)                            | 別の明示操作。固定候補の値を[原本XMLの独立読取](../../src/platform/pipeline/verification/verify-source-values.ts)で照合し、証跡を保存する                                                                                                    |
| 6    | 同ファイルの `activateVerifiedDuckFinancialPublication()`                                                                                            | 証跡と原本照合を再確認し、`expectedActive` を条件にcatalogの正式参照を切り替える                                                                                                                                                             |
| 7    | [`DuckFinancialPublicationReader.open() / reload()`](../../src/platform/db/stores/financial/duck-financial-publication-reader.ts) → `screen()`       | catalogと一致する固定DuckDBを開き、正式世代を検索する。既存readerは明示的なreloadまで旧snapshotを維持する                                                                                                                                    |

代表テストは[`duck-financial-cycle.test.ts`](../../test/duck-financial-cycle.test.ts)です。解析と構築の分割再開、同じ解析結果の再利用、構築後も `financialValuesValidated: false`・`publicationEligible: false` であることを確認します。原本照合付きの正式切替は[`duck-financial-verification.test.ts`](../../test/duck-financial-verification.test.ts)、readerの切替は[`duck-financial-publication-reader.test.ts`](../../test/duck-financial-publication-reader.test.ts)で別に確認します。上表の5〜7は構築関数の自動的な副作用ではありません。

## SQLiteとDuckDBのコードの境界

現行の継続運転はSQLiteに一覧観測・原本・解析済みStore・公開catalogを持ち、検索候補をDuckDBに構築します。[`DuckFinancialSearchIndex`](../../src/platform/db/stores/financial/duck-financial-search-index.ts) と公開readerは非同期です。一方、既存の [`FinancialSearchIndex`](../../src/platform/db/stores/financial/financial-search-index.ts) と [`PublishedFinancialIndex`](../../src/platform/db/stores/financial/sqlite-financial-publication-reader.ts) は同期SQLite APIとして残しています。

検索の正規化・品質検査などの共通処理は `FinancialIndexReadQueries`（`financial-search-index.ts`）にあり、SQLite側は同期、DuckDB側は非同期でSQLを実行します。DBエンジンごとに財務指標の採用規則を作り直す構成ではありません。現行の構成は[技術仕様](SPECIFICATIONS.md#current-storage)、移行日や実環境の更新履歴は[本番運用記録](../ops/DUCK_FINANCIAL_PRODUCTION.md)で確認できます。

## テーブル定義を探す

| 保存対象                         | 定義ファイル                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| 一覧の観測履歴・原本XML          | [`observed-financial-archive.ts`](../../src/platform/db/schema/observed-financial-archive.ts)   |
| 解析結果・解析済みの行と値       | [`parsed-financial-store.ts`](../../src/platform/db/schema/parsed-financial-store.ts)           |
| 検索世代・財務行・指標値         | [`financial-search-index.ts`](../../src/platform/db/schema/financial-search-index.ts)           |
| DuckDBの構築計画・会社別完了記録 | [`duck-financial-build.ts`](../../src/platform/db/schema/duck-financial-build.ts)               |
| 公開候補・正式参照・切替履歴     | [`financial-index-publication.ts`](../../src/platform/db/schema/financial-index-publication.ts) |

これらは `CREATE TABLE` / `CREATE INDEX` の文字列です。保存クラスはこの定義を読み、作成時と既存ファイルを開くときに形式を検査します。DuckDBは検索表の共通定義を使い、構築時に型を対応させます。

配置整理時にはSQL文字列を変更せず移動しました。会社マスターや法人番号など、上表以外の用途のDDLは対応する `src/platform/db/stores/` の保存クラスにあります。実際の行と値の例は [財務データ構造の説明](storage/FINANCIAL_DATA_MODEL.md) を参照してください。

## 機能別の公開入口

既存の `import { ... } from "edinet-ts"` は全公開名を保持します。機能別に読む場合は、次のsubpathも使えます。

| import先                | 公開する機能                           | facade                                                          |
| ----------------------- | -------------------------------------- | --------------------------------------------------------------- |
| `edinet-ts/core`        | 解析オブジェクト、書類情報、taxonomy型 | [`core/index.ts`](../../src/core/index.ts)                      |
| `edinet-ts/financial`   | 財務値の選択・計算・snapshot・検索条件 | [`financial/index.ts`](../../src/domain/financial/index.ts)     |
| `edinet-ts/disclosures` | 開示表の抽出・照合                     | [`disclosures/index.ts`](../../src/domain/disclosures/index.ts) |
| `edinet-ts/companies`   | 企業マスター・会社情報・企業比較       | [`companies/index.ts`](../../src/domain/companies/index.ts)     |
| `edinet-ts/platform`    | EDINET取得・Store・索引・運用工程      | [`platform/index.ts`](../../src/platform/index.ts)              |
| `edinet-ts/registry`    | 法人番号の取得・検査・Store・履歴      | [`registry/index.ts`](../../src/platform/registry/index.ts)     |

各facadeは従来の公開名をnamed/type exportで束ねています。内部モジュールへ追加したhelperが自動的に公開されることはありません。既存の解析メソッドやStoreに伴う依存関係はそのままで、rootからのimportも全機能を読みます。CLIの `node dist/cli.js` は同じ入口です。
