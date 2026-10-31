# edinet-ts

EDINETの開示書類から、財務数値や会社情報を読み取るTypeScript / Node.jsライブラリです。保存済みのXBRLを解析するほか、書類の取得、複数社の条件検索、出典を残したデータ保存に使えます。

[BuffettCode/edinet_xbrl](https://github.com/BuffettCode/edinet_xbrl) をもとに開発しています。

## 何をしたいですか？

| 目的 | 使う機能 | 次に読むところ |
|---|---|---|
| 手元の書類から売上や利益を読む | `EdinetXbrlParser` | [最小の利用例](#保存済みの書類を読む) |
| 期間・連結区分を指定し、採用理由も確認する | `selectMetric()` | [条件を指定して値を選ぶ](#条件を指定して値を選ぶ) |
| EDINETから書類を取得する | `EdinetXbrlDownloader`、CLI `get` / `download` | [書類を取得する](#書類を取得する) |
| 保存済みの複数社を条件で探す | `screenFinancialSnapshots()`、CLI `screen` | [保存済みの値を検索する](#保存済みの値を検索する) |
| 会社情報・株主・役員・人的資本を読む | 分野別の明細API | [ドキュメント一覧](docs/README.md) |
| 原本の収集から検索データの公開まで運用する | アーカイブ・索引構築・公開API | [保存・公開の工程](docs/pipeline/DOCUMENT_PIPELINE.md) |

```mermaid
flowchart LR
    EDINET[EDINET] -->|APIキーで取得| XML[手元のXBRL原本]
    XML --> Parse[解析・値の選択]
    Parse --> Value[値・対象期間・出典]
    Value --> Save[保存したデータ集合]
    Save --> Search[条件検索・比較]
```

書類の取得には通信が必要です。保存済み原本の解析と、保存済みデータの検索はオフラインで実行できます。検索対象の会社・書類は利用者が用意します。

## インストールと実行環境

このチェックアウトのコードは **Node.js 26.12.1以上 / npm 12.2.1以上** を使います。SQLiteにはNode標準の `node:sqlite` を使用します。[環境と既存DBの互換性](docs/development/RUNTIME_AND_SQLITE.md)も確認してください。

公開パッケージのインストール:

```sh
npm install edinet-ts
```

このREADMEはリポジトリの現行コードを説明しています。未リリースの機能を含むため、npm配布版で利用できる機能・必要環境とは異なる場合があります。[実装・検証・配布の状況](docs/plans/IMPLEMENTATION_STATUS.md)を確認してください。

このリポジトリのコードを使う場合は、リポジトリ直下で次を実行します。

```sh
npm ci
npm run build
node dist/cli.js --help
```

以下のCLI例は、このビルド済みコードを使用します。

## 保存済みの書類を読む

XBRLファイルがあれば、APIキーやデータベースの準備は不要です。

```ts
import { readFileSync } from "node:fs";
import { EdinetXbrlParser } from "edinet-ts";

const xml = readFileSync("./report.xbrl", "utf8");
const document = new EdinetXbrlParser().parse(xml);
const metrics = document.getKeyMetrics();

console.log(metrics.netSales);        // 売上高。取得できない場合はundefined
console.log(metrics.operatingIncome); // 営業利益
console.log(document.getQualitativeInfo().businessRisks); // 事業等のリスク
```

CLIでも同じファイルを解析できます。

```sh
node dist/cli.js parse --file ./report.xbrl --pretty
```

`getKeyMetrics()` は主要18指標をまとめて読む入口です。金額・キャッシュフローは連結を優先し、選んだ範囲に値がなくても単体の値で補いません。一部の1株指標などは従来の代替探索を行うため、**全項目の期間・連結区分が揃う保証はありません**。[項目一覧](docs/REQUIREMENTS.md#主要18指標)と[選択規則](docs/SPECIFICATIONS.md#32-主要指標抽出ロジック-getkeymetrics)を参照してください。

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
    console.log(result.raw);        // 精度を保った数値文字列
    console.log(result.safeNumber); // 安全に数値化できる場合だけ設定
    console.log(result.source);    // 採用したタグ・期間・単位など
} else {
    console.log(result.status, result.reason);
}
```

取得できない値は0に置き換えず、`missing`（値がない）、`unsupported`（対応外）、`ambiguous`（候補を決められない）を区別します。[指定方法と対応範囲](docs/financial/METRIC_SELECTION.md)を参照してください。

原本の基本情報（DEI）から会計基準・当期を判定する入口もあります。手動指定との使い分けは[基準と期間の自動判定](docs/financial/FINANCIAL_REPORTING_BASIS.md)で説明しています。

## 書類を取得する

EDINETから取得する場合はAPIキーが必要です。CLIでは、環境変数 `EDINET_API_KEY` または `.env` に設定します。

```sh
# 指定日の書類をダウンロード
node dist/cli.js download --date 2024-06-25

# 指定日の大量保有報告書・訂正報告書を取得して解析
node dist/cli.js get --date 2024-06-25 --type LargeShareholding --pretty

# コマンドと出力項目を確認
node dist/cli.js get --help
node dist/cli.js get --help-types
```

大量保有報告書の提出者と、保有対象の会社は別です。保有対象の証券コードで取得できるとは限りません。報告書の分類・比率・訂正版の扱いは[大量保有の明細API](docs/disclosures/LARGE_HOLDING.md)を参照してください。

最近60日取引表は[原本限定取引API](docs/disclosures/LARGE_HOLDING_TRANSACTIONS.md)で別に読めます。数量・割合・単価の単位や、提供metadataの取得時刻を自動認証しません。

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

取得済みの原本は `rootDir`（既定は `./downloads`）内の書類別フォルダから再利用されます。削除すると次回は再取得します。保存・展開の制限は[ダウンロードの仕様](docs/pipeline/DOWNLOAD_SAFETY.md)を参照してください。

### 過去の書類を探すための一覧DB

`getFinancialHistory()` と証券コード指定のCLI `get` は、ローカルの書類一覧DBを使います。リポジトリのビルドとAPIキーの設定後、一覧を取得します。

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

提出者名を探す `findDocumentsByFiler()`、書類種別を探す `findDocumentsByType()` は、検索前に一覧の不足日をAPIから補います。0件の日も取得記録を残しますが、当日は後から提出されるため再取得します。通信失敗時には保存済みの範囲で検索が続く場合があります。[一覧取得と完了の判定](docs/SPECIFICATIONS.md#一覧の保存と取得完了の判定)を参照してください。

## 保存済みの値を検索する

CLI `screen` は、利用者が用意した `FinancialSnapshot[]` のJSONを読み、複数社に条件・並べ替え・件数制限を適用します。検索中にEDINETからデータを集める処理はありません。

```sh
node dist/cli.js screen --file ./snapshots.json \
  --conditions '[{"metric":"operatingMargin","operator":"gte","value":0.1}]' \
  --sort-by freeCashFlow --limit 20 --pretty
```

この例は「営業利益率10%以上」を条件に、FCF順で最大20件を返します。利益率は `0.1 = 10%` です。計算には、同じ期間・連結区分・通貨の値であることを確認できる出典が必要です。[入力JSONの作り方と検索項目](docs/financial/EDINET_DB_COMPARISON.md)を参照してください。

流動比率、財務明細、前年比などは専用APIを使います。対応する入力形式はAPIごとに異なるため、[財務機能の一覧](docs/README.md#財務値の抽出計算)から選んでください。

## 数値を使う前に確認すること

- **対象を揃える:** 会社、連結・単体、会計基準、期間、単位を確認します。同じ期末日でも、単四半期と累計では意味が違います。
- **0と不明を分ける:** `undefined` や未採用の結果は、実際の0ではありません。
- **比率の単位を確認する:** 旧大株主・大量保有getterの比率は単位未検証の原値です。そのまま `%` を付けず、必要に応じて出典付き明細APIを使います。
- **出典と検証範囲を確認する:** 出典情報は値の選択過程を追うためのものです。原本の真正性や全市場データの正しさを証明するものではありません。

## 詳細資料と開発

- [ドキュメント案内](docs/README.md): 目的別の入口と全資料。
- [提供機能と制約](docs/REQUIREMENTS.md): 対応範囲、主要指標・テキスト項目。
- [用語集](docs/GLOSSARY.md): 財務・XBRL・保存処理の用語。
- [技術仕様](docs/SPECIFICATIONS.md): 処理の流れ、選択規則、保存の仕組み。
- [テスト手順](scripts/README.md#全体テスト) / [タクソノミ更新](docs/development/TAXONOMY_UPDATE.md)。
- [今後の計画](docs/plans/EDINET_TS_ROADMAP.md) / [ローカル配布物の作成](docs/development/nuc7-local-artifacts.md)。

## ライセンス

[Apache License 2.0](LICENSE)。Copyright (c) 2025 oharato / Copyright (c) 2018 Buffett Code。


### SQLite取得・DuckDB検索の移行API

原本・取得履歴と解析済み値はSQLite、検証済み検索世代はDuckDBへ保存する移行APIを追加しています。既存の同期APIも利用できます。

```ts
import {DuckFinancialSearchIndex} from "edinet-ts";

const index = await DuckFinancialSearchIndex.open("data/search.duckdb");
try {
    console.log(await index.quality("listed-current"));
} finally {
    await index.close();
}
```

`ParsedFinancialStore` / `ParsedFinancialJob` は版付き解析結果の保存・再開、`DuckFinancialIndexBuild` は固定入力からの候補構築、`DuckFinancialPublicationReader` はcatalog切替後の明示reloadに対応します。検索readerは初回に全件検査し、同じ私有snapshot内で監査結果を再利用します。

DuckDB機能にはoptional依存 `@duckdb/node-api@2.0.0-r.1` が必要です。driverなしでも通常import・SQLite APIは利用できます。

```sh
edinet-ts duck-financial-index-quality --db data/search.duckdb --generation listed-current
edinet-ts duck-financial-index-generation --db data/search.duckdb --generation listed-current
edinet-ts screen-duck-financial-index --db data/search.duckdb --cohort cohort.json --metrics costOfSales
edinet-ts duck-financial-publication-status --catalog data/publication.sqlite --db data/search.duckdb
```

[読取CLI](docs/pipeline/DUCK_FINANCIAL_CLI.md)、[非同期reader](docs/pipeline/DUCK_FINANCIAL_SEARCH_INDEX.md)、[独立原本照合gate](docs/pipeline/DUCK_FINANCIAL_VERIFICATION.md)、[移行計画・未完了事項](docs/plans/SQLITE_DUCKDB_IMPLEMENTATION_PLAN.md)を参照してください。全社・日次・配布先移行の受入は継続中で、本番経路はまだ切り替えていません。


固定原本からの作成は `edinet-ts build-duck-financial-cycle --config cycle.json --max-documents 100 --max-companies 100 --max-batches 10` で分割再開できます。共有の解析済みSQLiteを再利用し、候補には構築用の固定snapshotを保存します。出力先・共有Storeのflock排他と既存相当の容量余裕を要求します。構築だけではmetadata最新性や原本照合の合格にせず、正式切替は行いません。[設定と運用](docs/pipeline/DUCK_FINANCIAL_CYCLE.md)を参照してください。
