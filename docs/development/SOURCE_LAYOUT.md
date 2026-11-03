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

## テーブル定義を探す

| 保存対象                         | 定義ファイル                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| 一覧の観測履歴・原本XML          | [`observed-financial-archive.ts`](../../src/db/schema/observed-financial-archive.ts)   |
| 解析結果・解析済みの行と値       | [`parsed-financial-store.ts`](../../src/db/schema/parsed-financial-store.ts)           |
| 検索世代・財務行・指標値         | [`financial-search-index.ts`](../../src/db/schema/financial-search-index.ts)           |
| DuckDBの構築計画・会社別完了記録 | [`duck-financial-build.ts`](../../src/db/schema/duck-financial-build.ts)               |
| 公開候補・正式参照・切替履歴     | [`financial-index-publication.ts`](../../src/db/schema/financial-index-publication.ts) |

これらは `CREATE TABLE` / `CREATE INDEX` の文字列です。保存クラスはこの定義を読み、作成時と既存ファイルを開くときに形式を検査します。DuckDBは検索表の共通定義を使い、構築時に型を対応させます。

今回の配置変更ではSQL文字列をそのまま移しています。会社マスターや法人番号など、上表以外の用途のDDLは対応する `src/db/` の保存クラスにあります。実際の行と値の例は [財務データ構造の説明](../pipeline/FINANCIAL_DATA_MODEL.md) を参照してください。
