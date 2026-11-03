# edinet-ts

EDINETの開示書類から、財務数値や会社情報を読み取るTypeScript / Node.jsライブラリです。保存済みのXBRLを解析するほか、書類の取得、複数社の条件検索、出典を残したデータ保存に使えます。

[BuffettCode/edinet_xbrl](https://github.com/BuffettCode/edinet_xbrl) をもとに開発しています。

## 何をしたいですか？

| 目的                                       | 使う機能                                       | 次に読むところ                                    |
| ------------------------------------------ | ---------------------------------------------- | ------------------------------------------------- |
| 手元の書類から売上や利益を読む             | `EdinetXbrlParser`                             | [最小の利用例](#保存済みの書類を読む)             |
| 期間・連結区分を指定し、採用理由も確認する | `selectMetric()`                               | [条件を指定して値を選ぶ](#条件を指定して値を選ぶ) |
| EDINETから書類を取得する                   | `EdinetXbrlDownloader`、CLI `get` / `download` | [書類を取得する](#書類を取得する)                 |
| 保存済みの複数社を条件で探す               | `screenFinancialSnapshots()`、CLI `screen`     | [保存済みの値を検索する](#保存済みの値を検索する) |
| 会社情報・株主・役員・人的資本を読む       | 分野別の明細API                                | [ドキュメント一覧](docs/README.md)                |
| 処理とデータ構造を理解する                 | 解析・抽出・取得保存のつながり                 | [全体の仕組み](docs/specs/ARCHITECTURE.md)        |
| 原本の収集から検索データの公開まで運用する | アーカイブ・索引構築・公開API                  | [保存・公開の工程](docs/ops/DOCUMENT_PIPELINE.md) |

```mermaid
flowchart LR
    EDINET[EDINET] -->|APIキーで取得| XML[手元のXBRL原本]
    XML --> Parse[解析・値の選択]
    Parse --> Value[値・対象期間・出典]
    Value --> Save[保存したデータ集合]
    Save --> Search[条件検索・比較]
```

書類の取得には通信が必要です。保存済み原本の解析と、保存済みデータの検索はオフラインで実行できます。検索対象の会社・書類は利用者が用意します。

解析は `edinet-ts/core`、財務計算は `edinet-ts/financial` など、[機能別の入口](docs/specs/SOURCE_LAYOUT.md)から同じ公開名をimportできます。従来の `edinet-ts` とCLIも引き続き使えます。

## インストールと実行環境

このチェックアウトのコードは **Node.js 26.13.0以上 / npm 12.2.1以上** を使います。Pythonの準備は不要です。SQLiteにはNode標準の `node:sqlite` を使用します。[環境と既存DBの互換性](docs/ops/RUNTIME_AND_SQLITE.md)も確認してください。

### npm配布版を使う

空の作業ディレクトリでインストールし、そのディレクトリからCLIを起動します。

```sh
npm install edinet-ts
npx edinet-ts --help
# 自分で用意した原本を解析
npx edinet-ts parse --file ./report.xbrl --pretty
```

以下はリポジトリ版の使い方です。npm配布版にないコマンドは、次の手順でリポジトリをビルドして試してください。[対応機能と制約](docs/specs/REQUIREMENTS.md)に、各機能の入力と対応範囲をまとめています。

### このリポジトリを試す

リポジトリ直下で次を実行します。

```sh
npm ci
npm run build
node dist/cli.js --help
```

まず同梱の過去のサンプルを解析します。APIキー・DB・自前の原本は不要です。

```sh
node dist/cli.js parse --file test/test_data/CJ_2371_kakakucom.xbrl --pretty
```

出力には次の値が含まれます。

```json
{ "netSales": 45089432000, "operatingIncome": 21161251000 }
```

これは同梱サンプルの記載で、現在の業績ではありません。このfixtureはリポジトリ用で、npm配布版には同梱していません。以下のCLI例もリポジトリでビルドしたコードを使います。

## 保存済みの書類を読む

XBRLファイルがあれば、APIキーやデータベースの準備は不要です。次の例を `read-report.mts` に保存し、Nodeで `node read-report.mts` と実行します。npm利用者はインストールした作業ディレクトリ、リポジトリ利用者はビルド済みのリポジトリ直下へ保存してください。

```ts
import { readFileSync } from "node:fs";
import { EdinetXbrlParser } from "edinet-ts";

const xml = readFileSync("./report.xbrl", "utf8");
const document = new EdinetXbrlParser().parse(xml);
const metrics = document.getKeyMetrics();

console.log(metrics.netSales); // 売上高。取得できない場合はundefined
console.log(metrics.operatingIncome); // 営業利益
console.log(document.getQualitativeInfo().businessRisks); // 事業等のリスク
```

CLIでも同じファイルを解析できます。

```sh
node dist/cli.js parse --file ./report.xbrl --pretty
```

`getKeyMetrics()` は主要18指標をまとめて読む入口です。金額・キャッシュフローは連結を優先し、選んだ範囲に値がなくても単体の値で補いません。一部の1株指標などは従来の代替探索を行うため、**全項目の期間・連結区分が揃う保証はありません**。[項目一覧](docs/specs/REQUIREMENTS.md#主要18指標)と[選択規則](docs/specs/SPECIFICATIONS.md#32-主要指標抽出ロジック-getkeymetrics)を参照してください。

## 条件を指定して値を選ぶ

比較する期間や連結区分を揃えたいときは、`selectMetric()` を使います。次の例は、元書類で日本基準・連結・対象期間を確認済みであることを前提としています。

```ts
import { readFileSync } from "node:fs";
import { EdinetXbrlParser } from "edinet-ts";

const xml = readFileSync("./report.xbrl", "utf8");
const document = new EdinetXbrlParser().parse(xml);
const result = document.selectMetric("netSales", {
  accountingStandard: "J-GAAP",
  scope: "Consolidated",
  period: { startDate: "2024-04-01", endDate: "2025-03-31" },
});

if (result.status === "selected") {
  console.log(result.raw); // 精度を保った数値文字列
  console.log(result.safeNumber); // 安全に数値化できる場合だけ設定
  console.log(result.source); // 採用したタグ・期間・単位など
} else {
  console.log(result.status, result.reason);
}
```

取得できない値は0に置き換えず、`missing`（値がない）、`unsupported`（対応外）、`ambiguous`（候補を決められない）を区別します。[指定方法と対応範囲](docs/specs/financial/METRIC_SELECTION.md)を参照してください。

原本の基本情報（DEI）から会計基準・当期を判定する入口もあります。手動指定との使い分けは[基準と期間の自動判定](docs/specs/financial/FINANCIAL_REPORTING_BASIS.md)で説明しています。

## 書類を取得する

EDINETから取得する場合はAPIキーが必要です。CLIでは環境変数 `EDINET_API_KEY`、または作業ディレクトリの `.env` に設定します。

```sh
export EDINET_API_KEY="自分のAPIキー"
# まず1社の最新書類を探し、取得して解析
node dist/cli.js get --ticker 7203 --save-dir ./downloads --pretty
```

この1社の取得にseedは必須ではありません。ticker指定の `get` はローカル一覧DBを優先し、見つからなければ既定90日をAPIで探索します。探索幅は `--lookback` で変更できますが、ローカルDB検索には適用されません。tickerとdateは併用しません。`download` は該当書類がなければ `Not found`、`get --ticker` は探索期間で見つからなければ `No document found` と表示します。日付・書類種別・探索幅を確認してください。通信・解析の失敗があれば終了コード1を返します。

```sh
# 指定日の書類をダウンロード
node dist/cli.js download --ticker 7203 --date 2024-06-25

# 指定日の大量保有報告書・訂正報告書を取得して解析
node dist/cli.js get --date 2024-06-25 --type LargeShareholding --pretty

# コマンドと出力項目を確認
node dist/cli.js get --help
node dist/cli.js get --help-types
```

大量保有報告書の提出者と、保有対象の会社は別です。保有対象の証券コードで取得できるとは限りません。報告書の分類・比率・訂正版の扱いは[大量保有の明細API](docs/specs/disclosures/LARGE_HOLDING.md)を参照してください。

最近60日取引表は[原本限定取引API](docs/specs/disclosures/LARGE_HOLDING_TRANSACTIONS.md)で別に読めます。数量・割合・単価の単位や、提供metadataの取得時刻を自動認証しません。

プログラムから1社の書類を取得する例:

```ts
import { EdinetXbrlDownloader } from "edinet-ts";

const downloader = new EdinetXbrlDownloader({
  apiKey: process.env.EDINET_API_KEY,
  enableRateLimit: true,
});
const path = await downloader.downloadByTicker("7203", "./downloads");
console.log(path); // 見つからなければnull
```

取得済みの原本は `rootDir`（既定は `./downloads`）内の書類別フォルダから再利用されます。削除すると次回は再取得します。保存・展開の制限は[ダウンロードの仕様](docs/specs/edinet/DOWNLOAD_SAFETY.md)を参照してください。

### 過去の書類を探すための一覧DB

複数年度の履歴検索をする場合は、`getFinancialHistory()` などが参照するローカル一覧DBを用意します。これは最初の1社を取得する手順より広い範囲を収集する操作です。リポジトリのビルドとAPIキーの設定後、必要な場合だけ実行してください。

```sh
npx tsx scripts/seed.ts
node dist/cli.js get --ticker 7203 --pretty
```

このスクリプトは過去5年分の一覧を取得します。所要時間は取得範囲と通信状況によって変わります。プログラムから期間を指定する場合は `EdinetInfoSeeder` を使います。

```ts
import { Edinet } from "edinet-ts";

const edinet = new Edinet({ apiKey: process.env.EDINET_API_KEY });
try {
  const history = await edinet.getFinancialHistory("7203", 5);
  for (const item of history) {
    console.log(item.periodEnd, item.metrics.netSales);
  }
} finally {
  edinet.close();
}
```

`getFinancialHistory()` の第2引数は取得件数の上限です。連続する5年度や訂正反映済みの履歴を保証するものではありません。

提出者名を探す `findDocumentsByFiler()`、書類種別を探す `findDocumentsByType()` は、検索前に一覧の不足日をAPIから補います。0件の日も取得記録を残しますが、当日は後から提出されるため再取得します。通信失敗時には保存済みの範囲で検索が続く場合があります。[一覧取得と完了の判定](docs/specs/SPECIFICATIONS.md#一覧の保存と取得完了の判定)を参照してください。

## 保存済みの値を検索する

`parse` の出力だけでは `screen` の入力にはなりません。書類ID・期間・scopeなどを確認し、出典付きsnapshotを作って保存します。[原本から検索入力を作る手順](docs/guide/EDINET_DB_COMPARISON.md#ローカルファイルからの使用例)を参照してください。

CLI `screen` は、利用者が用意した `FinancialSnapshot[]` のJSONを読み、複数社に条件・並べ替え・件数制限を適用します。検索中にEDINETからデータを集める処理はありません。

```sh
node dist/cli.js screen --file ./snapshots.json \
  --conditions '[{"metric":"operatingMargin","operator":"gte","value":0.1}]' \
  --sort-by freeCashFlow --limit 20 --pretty
```

この例は「営業利益率10%以上」を条件に、FCF順で最大20件を返します。利益率は `0.1 = 10%` です。計算には、同じ期間・連結区分・通貨の値であることを確認できる出典が必要です。[入力JSONの作り方と検索項目](docs/guide/EDINET_DB_COMPARISON.md#ローカルファイルからの使用例)を参照してください。

流動比率、財務明細、前年比などは専用APIを使います。対応する入力形式はAPIごとに異なるため、[財務機能の一覧](docs/README.md#財務値の抽出計算)から選んでください。

## SQLiteとDuckDBで保存・検索する

原本・取得履歴・解析済み結果・公開catalogはSQLite、検索用の世代はDuckDBへ保存します。既存の同期SQLite APIも利用できます。具体的な行と値の例は[財務データ構造の説明](docs/specs/storage/FINANCIAL_DATA_MODEL.md)を参照してください。

以下は検証済み検索DBを構築した後の読取例です。空の環境では先に[固定原本からの構築手順](docs/ops/DUCK_FINANCIAL_CYCLE.md)を確認し、必要な原本・解析Store・検索世代を用意してください。DBや世代は同梱されていません。

```ts
import { DuckFinancialSearchIndex } from "edinet-ts";

const index = await DuckFinancialSearchIndex.open("data/search.duckdb");
try {
  console.log(await index.quality("listed-current"));
} finally {
  await index.close();
}
```

`listed-current` は構築時に付けた世代IDの例です。実際に保存したIDへ置き換えてください。

`ParsedFinancialStore` / `ParsedFinancialJob` は版付き解析結果の保存・再開、`DuckFinancialIndexBuild` は固定入力からの候補構築、`DuckFinancialPublicationReader` はcatalog切替後の明示reloadに対応します。検索readerは初回に全件検査し、同じ私有snapshot内で監査結果を再利用します。

DuckDB機能にはoptional依存 `@duckdb/node-api@2.0.0-r.1` が必要です。driverなしでも通常import・SQLite APIは利用できます。

```sh
node dist/cli.js duck-financial-index-quality --db data/search.duckdb --generation listed-current
node dist/cli.js duck-financial-index-generation --db data/search.duckdb --generation listed-current
node dist/cli.js screen-duck-financial-index --db data/search.duckdb --cohort cohort.json --metrics costOfSales
node dist/cli.js duck-financial-publication-status --catalog data/publication.sqlite --db data/search.duckdb
```

[読取CLI](docs/ops/DUCK_FINANCIAL_CLI.md)、[非同期reader](docs/specs/storage/DUCK_FINANCIAL_SEARCH_INDEX.md)、[独立原本照合gate](docs/ops/DUCK_FINANCIAL_VERIFICATION.md)、[移行計画・未完了事項](docs/history/archive/plans/SQLITE_DUCKDB_IMPLEMENTATION_PLAN.md)を参照してください。特定ホストの切替・検証結果と手動受入は[本番運用記録](docs/ops/DUCK_FINANCIAL_PRODUCTION.md)で管理します。

固定原本からの作成は `node dist/cli.js build-duck-financial-cycle --config cycle.json --max-documents 100 --max-companies 100 --max-batches 10` で分割再開できます。共有の解析済みSQLiteを再利用し、候補には構築用の固定snapshotを保存します。出力先・共有Storeのflock排他と既存相当の容量余裕を要求します。構築だけではmetadata最新性や原本照合の合格にせず、正式切替は行いません。[設定と運用](docs/ops/DUCK_FINANCIAL_CYCLE.md)を参照してください。

## 数値を使う前に確認すること

- **対象を揃える:** 会社、連結・単体、会計基準、期間、単位を確認します。同じ期末日でも、単四半期と累計では意味が違います。
- **0と不明を分ける:** `undefined` や未採用の結果は、実際の0ではありません。
- **比率の単位を確認する:** 旧大株主・大量保有getterの比率は単位未検証の原値です。そのまま `%` を付けず、必要に応じて出典付き明細APIを使います。
- **出典と検証範囲を確認する:** 出典情報は値の選択過程を追うためのものです。原本の真正性や全市場データの正しさを証明するものではありません。

## 詳細資料と開発

- [ドキュメント案内](docs/README.md): 目的別の入口と全資料。
- [提供機能と制約](docs/specs/REQUIREMENTS.md): 対応範囲、主要指標・テキスト項目。
- [用語集](docs/guide/GLOSSARY.md): 財務・XBRL・保存処理の用語。
- [ソースコードの読み方](docs/specs/SOURCE_LAYOUT.md): フォルダの役割とテーブル定義の場所。
- [技術仕様](docs/specs/SPECIFICATIONS.md): 処理の流れ、選択規則、保存の仕組み。
- [テスト手順](scripts/README.md#全体テスト) / [タクソノミ更新](docs/ops/TAXONOMY_UPDATE.md)。
- [今後の計画](docs/history/archive/plans/EDINET_TS_ROADMAP.md) / [ローカル配布物の作成](docs/ops/LOCAL_ARTIFACTS.md)。

## ライセンス

[Apache License 2.0](LICENSE)。Copyright (c) 2025 oharato / Copyright (c) 2018 Buffett Code。
