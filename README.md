# edinet-ts

`edinet-ts` は、会社が金融庁のEDINETへ提出した書類を読み、売上・利益・資産などの数値をプログラムから使えるようにする道具です。
Pythonライブラリ [BuffettCode/edinet_xbrl](https://github.com/BuffettCode/edinet_xbrl) のロジックをベースに、TypeScript/Node.js 環境向けに移植・最適化を行いました。
1社の数値を読む使い方と、手元に保存した複数社の数値を条件で探す使い方があります。数値が書かれた日付や会社の範囲を指定し、元の記載も確認できます。

## 初めて使う方へ

- まず [用語集](docs/GLOSSARY.md) で、連結・単体・欠損などの意味を確認できます。
- 使い方を選ぶときは [資料の入口](docs/README.md) を参照してください。
- 複数社の検索には、利用者が用意した保存データを使います。取り出せなかった数値は0に置き換えず、理由を確認します。
- 今回の追加機能はまだreleaseしていません。npm配布版の説明と、作業中の機能の説明を区別してください。

## 特徴

*   **TypeScript完全対応**: 型定義完備で、安全な開発が可能です。
*   **EDINET API v2 対応**: 金融庁の書類一覧・ダウンロード機能を利用します。
*   **財務数値の取得**: 主要数値を手早く読む既存機能と、会社の範囲・日付を指定して元の記載を確認する機能があります。
*   **書類の検索**: 手元のデータベース（SQLite）に保存した書類一覧を検索できます。
*   **ZIP自動解凍**: ダウンロードした書類のZIP解凍とファイル特定を自動化します。
*   **操作の説明**: `--help`・`--help-types` でコマンドや出力項目を確認できます。

## 必要な実行環境

**Node.js 26.12.1以上 / npm 12.2.1以上** が必要です。以前のNode.jsでは動かなくなる変更です。外部SQLite依存を標準 `node:sqlite` に置換しています。採用版・既存DB互換・型定義の制約・開発環境の分離は [Node・SQLiteの手順](docs/RUNTIME_AND_SQLITE.md) を参照してください。

## インストール

```bash
npm install edinet-ts
```

## 使い方

### 1. 財務・業績データの時系列分析 (Recommended)

過去の有価証券報告書から、売上高や利益などの主要指標を時系列で取得できます。
この機能を使用するには、メタデータ検索用のローカルDBが必要です（セットアップ手順参照）。

```typescript
import { Edinet } from "edinet-ts";

// 1. クライアントの初期化
const edinet = new Edinet({
  apiKey: "YOUR_API_KEY", // 環境変数 EDINET_API_KEY も可
  enableRateLimit: true
});

// 2. トヨタ自動車(7203)の過去5年分の有価証券報告書を取得
const history: FinancialHistory[] = await edinet.getFinancialHistory("7203", 5);

history.forEach(h => {
  console.log(`決算日: ${h.periodEnd}`);     // 2024-03-31
  console.log(`提出日: ${h.submitDate}`);    // 2024-06-25
  console.log(`売上高: ${h.metrics.netSales}`);
  console.log(`営業利益: ${h.metrics.operatingIncome}`);
});
```

### 2. 横断的検索 (Horizontal Analysis)

特定の銘柄ではなく、市場全体のイベントや投資家の動向を検索する機能です。

対象期間のうちローカルDBに無い日は、検索の前に書類一覧APIから補ってDBへ保存します（APIキーが必要です）。補完に失敗した日はDBにある範囲だけで検索します。提出が0件の日は取得済みを記録できないため、次回も再取得します。

```typescript
// A. 提出者名で検索 (例: 著名投資家やファンド)
// "バークシャー" を含む提出者が提出した全ての書類を取得
import { EdinetMetadata } from "edinet-ts";
const filerDocs: EdinetMetadata[] = await edinet.findDocumentsByFiler("バークシャー");

// B. 書類種別で検索 (例: 公開買付届出書によるTOB検知)
// 直近30日間に提出された "公開買付届出書" (240) を全て取得
import { EdinetDocumentType } from "edinet-ts";
const tobDocs: EdinetMetadata[] = await edinet.findDocumentsByType(EdinetDocumentType.TenderOfferStatement, 30);
```

### 保存済み財務値のオフライン横断検索

`screenFinancialSnapshots` / CLI `screen` は、保存済み主要18指標と計算指標（営業利益率・純利益率・FCF）で、銘柄ごとの最新書類にAND条件・並べ替え・ページングを適用します。入力は明示的な `FinancialSnapshot[]` で、ネットワーク取得は行いません。

```sh
edinet-ts screen --file ./snapshots.json \
  --conditions '[{"metric":"operatingMargin","operator":"gte","value":0.1}]' \
  --sort-by freeCashFlow --limit 20 --pretty
```

利益率は小数（0.1=10%）、金額は入力の単位を保持します。派生値には `getKeyMetricsWithSources()` の来歴と `periodType` が必要で、同一context・期間・scope・通貨を検証できない場合は計算しません。入力の作成例、対応項目、EDINET DBとの二軸比較と制約は [比較・改善資料](docs/EDINET_DB_COMPARISON.md)。残作業・依存・受入条件は [改善計画](docs/plans/EDINET_TS_ROADMAP.md) を参照してください。

### セットアップ (DB構築)
時系列分析や横断的検索を使用する場合、初回のみ以下のコマンドでデータベースを構築してください（所要時間: 約20分）。
```bash
# .envに EDINET_API_KEY=xxx を設定してから実行
npx tsx scripts/seed.ts
```

#### ライブラリ経由での実行 (Programmatic Seeding)
他のアプリケーションやスクリプトからSeeding機能を呼び出すことも可能です。

```typescript
import { EdinetInfoSeeder } from "edinet-ts";

const seeder = new EdinetInfoSeeder({
  apiKey: process.env.EDINET_API_KEY,
  dbPath: "./data/edinet.db",
  
  // 差分更新（Incremental Update）
  // 既にDBにメタデータが存在する日付の処理をスキップします（デフォルト: false）
  skipExisting: true,

  // 進捗状況のコールバック
  // status: "skipped" | "processed" | "error"
  onProgress: (current, total, date, status) => {
    console.log(`${date}: ${status} (${current}/${total})`);
  }
});

await seeder.run();
```

---

### 3. 書類単体のダウンロード (Downloader)

DBを使用せず、APIを直接叩いて最新の書類などをダウンロードする場合の使用方法です。

```typescript
import { EdinetXbrlDownloader, EdinetDocumentType } from "edinet-ts";

const downloader = new EdinetXbrlDownloader({
  apiKey: "YOUR_API_KEY",
  enableRateLimit: true
});

// 特定企業（例：トヨタ 7203）の最新の有価証券報告書をダウンロード
const xbrlPath: string | null = await downloader.downloadByTicker("7203", "./downloads");

// 特定の日付・書類種別を指定してダウンロード（例: 半期報告書）
await downloader.downloadByTicker("7203", "./downloads", "2024-11-14", EdinetDocumentType.SemiAnnualReport);
```

書類一覧の型・区分の正規化、不正応答の扱いと互換性は [書類一覧 API の応答境界](docs/DOCUMENT_LIST_VALIDATION.md) を参照してください。

### 4. ローカルキャッシュ (Local Caching)

`Edinet` クラスおよび `EdinetXbrlDownloader` は、ダウンロードしたXBRLファイルをローカルに保存し、次回以降の実行時にキャッシュとして利用します。

*   **仕組み**: `rootDir` (デフォルト: `./downloads`) に `[DocID]/` ディレクトリが作成され、その中にある `.xbrl` ファイルが再利用されます。
*   **メリット**:
    *   2回目以降の実行が爆発的に高速化されます（数秒→数十ミリ秒）。
    *   APIへの不要なリクエストを防ぎ、レート制限に引っかかるリスクを低減します。
*   **注意**: キャッシュディレクトリを削除すると、次回実行時に再度ダウンロードが行われます。

### 5. XBRL解析 (Parser)

ダウンローダーで取得したXBRLファイルを解析し、`KeyMetrics` を抽出します。

```typescript
import { EdinetXbrlParser } from "edinet-ts";
import * as fs from "fs";

const xml = fs.readFileSync(xbrlPath, "utf-8");
const parser = new EdinetXbrlParser();
const data = parser.parse(xml);

const metrics: KeyMetrics = data.getKeyMetrics();
console.log(`売上高: ${metrics.netSales}`);
console.log(`営業利益: ${metrics.operatingIncome}`);
// ...
```

金額・キャッシュフローは連結コンテキストがある場合、その範囲だけを探索します。対応タグが見つからなければ単体値で補わず `undefined` を返します。1株当たり・株式数・配当・比率は互換性のため従来の単体フォールバックを維持します。判定方法・固定IDの扱い・制限は[主要指標抽出ロジック](docs/SPECIFICATIONS.md#32-主要指標抽出ロジック-getkeymetrics)を参照してください。

#### 取得可能な指標一覧 (`KeyMetrics`)
| プロパティ名 | 日本語名 |
| :--- | :--- |
| `netSales` | 売上高 |
| `operatingIncome` | 営業利益 |
| `ordinaryIncome` | 経常利益 |
| `netIncome` | 当期純利益 |
| `netAssets` | 純資産 |
| `totalAssets` | 総資産 |
| `operatingCashFlow` | 営業CF |
| `investingCashFlow` | 投資CF |
| `financingCashFlow` | 財務CF |
| (その他多数: EPS, BPS, ROE, 配当など) | |

#### 定性的情報の取得 (`QualitativeInfo`)

財務数値だけでなく、事業リスクや経営分析などのテキスト情報も抽出できます。
**HTMLタグとエスケープされたHTML実体参照は自動的に除去され、クリーンなテキストとして取得できます。**

```typescript
import { EdinetXbrlParser, QualitativeInfo } from "edinet-ts";

const parser = new EdinetXbrlParser();
const data = parser.parse(xml);

const qualInfo: QualitativeInfo = data.getQualitativeInfo(); // HTMLタグが自動除去される
console.log(`事業等のリスク: ${qualInfo.businessRisks}`); // クリーンなテキスト
console.log(`経営者による分析: ${qualInfo.financialAnalysis}`);
console.log(`研究開発活動: ${qualInfo.researchAndDevelopment}`);
```

**取得可能なテキスト情報:**
- `businessPolicy`: 事業の方針、事業環境及び対処すべき課題
- `businessRisks`: 事業等のリスク
- `financialAnalysis`: 経営者による財政状態、経営成績及びキャッシュ・フローの状況の分析
- `businessDescription`: 事業の内容
- `companyHistory`: 沿革
- `researchAndDevelopment`: 研究開発活動
- `corporateGovernance`: コーポレート・ガバナンスの状況等
- `operationsOverview`: 業績等の概要
- `capitalResourcesAnalysis`: 資本の財源及び資金の流動性
- `criticalContracts`: 経営上の重要な契約等
- `employeesInformation`: 従業員の状況

> **注:** EDINET XBRLファイルに含まれるHTMLタグ（`&lt;p&gt;`、`&lt;h3&gt;` など）やHTML実体参照（`&amp;apos;`、`&nbsp;` など）は自動的にデコード・除去されます。これにより、テキスト解析やAI処理に適したクリーンなテキストデータを取得できます。

#### 共通メタデータの取得 (`CommonMetadata`)

書類の基本的なメタデータ（提出者名、提出日など）を取得できます。

```typescript
const metadata = data.getCommonMetadata();
console.log(`提出者: ${metadata.filerName}`);
console.log(`書類名: ${metadata.docDescription}`);
console.log(`提出日: ${metadata.submitDate}`);
```

> **Note**: `docID` (書類管理ID) はXBRLファイルの内容自体には含まれていないため、このメソッドからは空文字が返されます。`docID` が必要な場合は、ファイル名やAPIレスポンスから取得してください。

#### 大株主情報の取得 (`ShareholderInfo`)

有価証券報告書に含まれる大株主の状況を構造化データとして取得できます。

```typescript
const shareholders = data.getMajorShareholders();
shareholders.forEach(s => {
    console.log(`株主名: ${s.name}`);
    console.log(`持株数: ${s.numberOfShares}`);
    console.log(`比率の原値: ${s.ownershipRatio}（単位未検証）`);
});
```

旧APIの比率は単位を検証しない原値です。pure単位なら0.2037は20.37％に相当します。百分率・基準日・分母と注記引用を区別する場合は、[大株主の明細API](docs/MAJOR_SHAREHOLDER_DETAILS.md)を使用してください。

**四半期報告書・半期報告書への対応:**
パーサーは、有価証券報告書（年次）だけでなく、四半期報告書（docTypeCode: 140）や半期報告書（docTypeCode: 160）にも対応しています。これらの報告書では文書固有の名前空間（例: `jpcrp040300-q2r_*`）が使用されることがありますが、パーサーは自動的に名前空間を識別して正しくデータを抽出します。

```typescript
// 四半期報告書の例
const docId = 'S100WE54'; // 四半期報告書
const xbrlText = await downloader.fetchXbrl(docId);
const parsed = parser.parse(xbrlText);

// 四半期報告書でも同じAPIで取得可能
const qualInfo = parsed.getQualitativeInfo();
const metrics = parsed.getKeyMetrics();
```

### 6. 詳細なデータアクセス (Advanced)

`getJppfsCor()` (財務諸表) や `getLargeShareholdingInfo()` (大量保有) などを使用して、より詳細なデータにアクセスできます。

```typescript
// 大量保有報告書の解析例
const info: LargeShareholdingInfo = data.getLargeShareholdingInfo();
if (info.holdingRatio !== undefined) {
    console.log(`提出者: ${info.filerName}`);
    console.log(`保有割合の原値: ${info.holdingRatio}（単位・集計範囲未検証）`);
}
```

一次大量保有の表紙・分母・連名合計・訂正と観測cutoffを確認する場合は、[出典付き一次明細API](docs/LARGE_HOLDING_REPORT.md)を使用してください。旧getterは先頭候補の原値で、報告全体の合計とは限りません。
- [一次大量保有の訂正版選択と原本観測](docs/LARGE_HOLDING_VERSIONS.md)
- [政策保有株式の直接記載と逆引き](docs/POLICY_SHAREHOLDINGS.md)
- [役員の現任・予定と原表の明細](docs/OFFICER_DETAILS.md)
- [役員報酬の区分集計・個人総額・会社別内訳](docs/OFFICER_REMUNERATION.md)
- [IFRS連結の直接PL・CF明細](docs/IFRS_FINANCIAL_DETAILS.md)
- [DEIから財務基準・当期を確定する](docs/FINANCIAL_REPORTING_BASIS.md)
- [観測・原本・解析結果の財務アーカイブ](docs/OBSERVED_FINANCIAL_ARCHIVE.md)
- [固定世代からの直接財務SQL検索](docs/FINANCIAL_SEARCH_INDEX.md)
- [母集団全件の分割構築・再開・世代集約](docs/FINANCIAL_INDEX_BUILD.md)
- [不足財務原本の取得・差分確認と再開](docs/FINANCIAL_SOURCE_ACQUISITION.md)
- [全社の原本取得計画・試行履歴・再開](docs/FINANCIAL_SOURCE_JOB.md)

#### dataMap への直接アクセス

パースされた全てのXBRLデータには、`dataMap` プロパティを通じて直接アクセスすることも可能です。
`dataMap` は `ReadonlyMap<string, readonly EdinetData[]>` 型で、XBRL内の全要素がキー（タグ名）とデータのペアで格納されています。

```typescript
import { EdinetXbrlParser } from "edinet-ts";
import * as fs from "fs";

const xml = fs.readFileSync(xbrlPath, "utf-8");
const parser = new EdinetXbrlParser();
const data = parser.parse(xml);

// dataMap のサイズを確認
console.log(`パースされたキー数: ${data.dataMap.size}`);

// 特定のキーからデータを取得
const netSalesData = data.dataMap.get('jppfs_cor:NetSales');
if (netSalesData && netSalesData.length > 0) {
    console.log(`NetSales値: ${netSalesData[0].value}`);
    console.log(`コンテキスト: ${netSalesData[0].contextRef}`);
}

// 全キーを列挙
for (const [key, values] of data.dataMap) {
    console.log(`${key}: ${values.length}個のエントリ`);
}
```

> **注意**: `dataMap` は JavaScript の `Map` オブジェクトです。`Object.keys(data.dataMap)` は空配列を返すため、`data.dataMap.size` や `data.dataMap.keys()` を使用してください。
> 
> 通常のデータ取得には、`getDataList()`、`getDataByContextRef()`、`getKeyMetrics()` などの専用メソッドの使用を推奨します。これらのメソッドは型安全で、より使いやすいインターフェースを提供します。

#### フォールバック処理 (Fallback Strategy)

四半期報告書や半期報告書など、一部の書類では標準的な名前空間（`jpcrp_cor`など）が使用されず、独自の拡張名前空間が使用される場合があります。
`getQualitativeInfo()` などは内部で自動的にフォールバック処理を行いますが、手動で特定のタグを取得したい場合は `getDataListByTagName()` を使用してください。

```typescript
// 名前空間を無視してタグ名のみで検索
// 例: "jpcrp040300-q2r_...:BusinessRisksTextBlock" のような独自タグもヒットします
const risks = data.getDataListByTagName("BusinessRisksTextBlock");

if (risks.length > 0) {
    console.log(risks[0].value); // 生のHTMLが含まれる場合があります
}
```

## CLIツール (Command Line Interface)

`edinet-ts` は、コードを書かずにターミナルから直接利用できるCLIツールを提供しています。

### 1. `get`: ダウンロード & 解析 (推奨)
ローカルDB（Seed Index）を使用して書類を高速に検索し、ダウンロードと解析を一括で行います。

```bash
# 証券コード 3031 の直近の有価証券報告書を取得
npx edinet-ts get --ticker 3031 --pretty

# 大量保有報告書（変更報告書・訂正報告書含む）を当日分すべて取得
# (ティッカー指定なしで実行すると API から直接リストを取得します)
npx edinet-ts get --type LargeShareholding --verbose
```

> **Note**: `LargeShareholding` を指定した場合、大量保有報告書と変更報告書（どちらも種別コード350）と、訂正大量保有報告書(360)が対象となります。変更報告書に独立した種別コードはなく、初回との区別は様式コード（010002等）で行います。340は訂正別途買付け禁止の特例を受けるための申出書であり、対象外です。
> また、大量保有報告書はAPIの仕様上、提出対象会社（発行体）のティッカーで検索することが難しいため、`--ticker` を指定せずに日付指定で一括取得することをお勧めします。

#### レスポンスのキー仕様
`get` コマンドは以下のプロパティを含むJSON配列を返します。

| キー名 | 説明 | 備考 |
| :--- | :--- | :--- |
| `docID` | 書類管理ID | 例: S100WE54 |
| `filerName` | 提出者名 | RIZAPなど |
| `edinetCode` | 提出者のEDINETコード | 例: E00518 (*API経由のみ*) |
| `docDescription` | 書類名/件名 | 例: 有価証券報告書... |
| `submitDate` | 提出日 | YYYY-MM-DD |
| `issuerName` | **発行者名** | 大量保有報告書の場合のみ (例: Bitcoin Japan) |
| `holdingRatio` | 保有割合の先頭原値（単位・集計範囲未検証） | 大量保有報告書の場合のみ |
| `prevHoldingRatio` | 直前保有割合の先頭原値（単位・集計範囲未検証） | 大量保有報告書の場合または変更報告書 |
| `netSales` | 売上高 | 財務数値 (単位: 円) |
| `operatingIncome` | 営業利益 | 財務数値 |
| `netIncome` | 当期純利益 | 財務数値 |
| `...` | その他財務指標 | `KeyMetrics` 参照 |

#### 型定義とレスポンス形式の確認

`--help-types` オプションを使用すると、各書類種別（有価証券報告書、大量保有報告書など）で返されるJSONの完全な型定義、キー名、日本語ラベルの一覧を確認できます。開発時のリファレンスとしてご活用ください。

```bash
npx edinet-ts get --help-types
```

### 2. `download`: 一括ダウンロード
特定の日付や銘柄の書類をダウンロードします。

```bash
# 2024-06-25 の書類を一括ダウンロード
npx edinet-ts download --date 2024-06-25

# 証券コードを指定してダウンロード
npx edinet-ts download --ticker 7203,9984
```

### 3. `parse`: ファイル解析
ローカルにあるXBRLファイルを解析してJSONを出力します。

```bash
npx edinet-ts parse --file ./downloads/report.xbrl --pretty
```

詳細なオプションは `npx edinet-ts --help` で確認できます。

## ドキュメント (Documents)

[文書索引](docs/README.md) から、現行仕様・利用方法・比較と、計画・設計判断・履歴を参照できます。

* [要件・提供機能](docs/REQUIREMENTS.md) / [技術仕様](docs/SPECIFICATIONS.md)
* [EDINET DB比較・21指標辞書](docs/EDINET_DB_COMPARISON.md) / [他ライブラリ設計調査](docs/EDINET_LIBRARY_RESEARCH.md)
* [改善計画と受入条件](docs/plans/EDINET_TS_ROADMAP.md)
* [タクソノミ更新手順](docs/TAXONOMY_UPDATE.md) / [財務諸表本表](docs/TAXONOMY_JPPFS_COR.md) / [企業情報](docs/TAXONOMY_JPCRP_COR.md)
* [ローカル配布物の作成・保持](docs/nuc7-local-artifacts.md)

## License

```text
Copyright (c) 2025 oharato
Copyright (c) 2018 Buffett Code

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
```

## nuc7 local artifacts

See [local build, retention, validation and cutover](docs/nuc7-local-artifacts.md).

### 指標の原値・採用理由を取得する追加API

18指標の辞書 `METRIC_REGISTRY` と `xbrlObject.selectMetric(id, { accountingStandard, scope, period })` は、明示条件に適合するfactを `selected / missing / unsupported / ambiguous` と来歴付きで返します。巨大整数等はdecimal文字列の原値を保持し、numberへの安全な往復が確認できる場合だけ `safeNumber` を返します。会計基準は呼出元で確認が必要です。既存KeyMetricsの選択規則は維持します。利用例・単位・制約は [指標辞書・厳密選択](docs/METRIC_SELECTION.md) を参照してください。

J-GAAPの流動資産・流動負債・負債合計は、既存主要指標とは別の `selectBalanceSheetMetric()` で取得できます。[BS直接fact正規化](docs/BALANCE_SHEET_NORMALIZATION.md)を参照してください。円・指定日・連結か単体かの指定が必要です。IFRSと、既存21指標検索への登録は未対応です。

mainで使える検索機能は、保存した複数社を流動資産・流動負債・負債合計で絞り、金額順に並べます。`screenBalanceSheetSnapshots()` / CLI `screen-bs`を使い、同じ日付・範囲の書類を自分で揃えます。[使い方と入力ファイル一覧](docs/BALANCE_SHEET_SCREENING.md)を参照してください。

流動比率は、mainの `calculateCurrentRatio()` と検索項目 `currentRatio` を使います。単位は小数で、`2`が200%です。[計算・検索・CLIの使い方](docs/CURRENT_RATIO.md)を参照してください（#28でmainへ統合済み）。

指定したローカル原本を財務DBへ取り込むAPIは#33でmainへ統合済みです。原本のハッシュ計算と取り込み予定の確認を行うCLI `import-bs --dry-run`も#34でmainへ統合済みです。[入力例・使い方・試験DBの保護](docs/FINANCIAL_INCREMENTAL_IMPORT.md)を参照してください。

この版では、保存済みの2つの解析結果について、数値・採用状態・出典の違いを説明するAPIとCLI `diff-bs`も利用できます。[比較できる条件と使い方](docs/BALANCE_SHEET_VERSION_DIFF.md)を参照してください。

保存済み原本を使って、取り込み→再open検索→同一コードでの版ラベル変更→版比較を一続きに確認できます。[明示入力だけのオフライン検証手順](docs/OFFLINE_FINANCIAL_VERIFICATION.md)を参照してください。原本と金額入り期待値はGit外で指定し、一時DBだけを使います。

固定資産・固定負債・現金及び預金・売上原価・販管費の直接5項目を、出典付きで読み、明示した複数社で検索できます。CFの減価償却費・設備取得支出2種類・法人税等支払額・配当金支払額・長期借入金返済も、項目を明示して読めます。税引前利益は完全一致重複を証跡付きで採用し、旧JSONの曖昧判定は保持します。[APIとscreen-details](docs/FINANCIAL_DETAILS.md)を参照してください。既存BS3/21指標やSQLite形式は変更しません。

連続する12暦月決算の売上高前年比を、出典・計算不可理由付きで求め、分数で正確に絞り込めます。[年次売上高のAPIとscreen-sales-growth](docs/ANNUAL_REVENUE_GROWTH.md)を参照してください。前年0・負値、年度飛び、曖昧な候補は率0で埋めません。

原本に記載された会社名・企業コード・会計基準名は、[会社情報APIとcompany-profileコマンド](docs/COMPANY_PROFILE.md)で出典付きで確認できます。業種・市場の企業マスターや名称変更履歴とは分けて扱います。

提出会社単体の平均年間給与は、[人的資本APIとscreen-workforce](docs/WORKFORCE.md)で原値と出典を確認し、同じ期末の明示した会社集合で検索できます。給与の注記や対象社員の範囲は元書類で確認してください。

借入金・社債・リースの7残高も、[直接財務項目の明示選択](docs/FINANCIAL_DETAILS.md)で原記載を別々に確認できます。合計額や欠けた内訳は推測しません。

原本の会社情報は、[screen-companies](docs/COMPANY_PROFILE.md#明示した複数社の情報を探す)で会社名・コード・決算月からも検索できます。明示した書類集合の検索であり、最新の企業マスターを自動作成する機能ではありません。

平均年齢・勤続年数の年タグも、[人的資本の明示選択](docs/WORKFORCE.md)で原値と出典を読めます。既定の給与1項目は変えず、月への換算はしません。

原本から作った財務snapshotは、[screen-details-json](docs/FINANCIAL_DETAILS.md)で保存後も原値・出典の内部整合を検査して検索できます。元XMLの真正性や解析版を認証する機能とは分けています。
