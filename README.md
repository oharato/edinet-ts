# edinet-ts

`edinet-ts` は、金融庁の EDINET API v2 を利用して有価証券報告書等のXBRLファイルをダウンロード・解析するための TypeScript ライブラリです。
Pythonライブラリ [BuffettCode/edinet_xbrl](https://github.com/BuffettCode/edinet_xbrl) のロジックをベースに、TypeScript/Node.js 環境向けに移植・最適化を行いました。
複雑なXBRLの構造（Context、Namespace）を意識することなく、主要な財務指標を簡単に抽出できるように設計されています。

## 特徴

*   **TypeScript完全対応**: 型定義完備で、安全な開発が可能です。
*   **EDINET API v2 対応**: 最新のAPI仕様（2024年現在）に対応しています。
*   **主要指標の自動抽出**: 売上高、営業利益などを、連結/単体や期間を自動判定して `number` 型で取得できます。
*   **ZIP自動解凍**: ダウンロードした書類のZIP解凍とファイル特定を自動化します。

## インストール

```bash
npm install edinet-ts
```

## 使い方

### 1. XBRLファイルのダウンロード

EDINET API を使用するには、APIキー（Subscription-Key）が必要です。

```typescript
import { EdinetXbrlDownloader } from "edinet-ts";

// EDINET_API_KEY 環境変数が設定されている場合、引数は不要です
const downloader = new EdinetXbrlDownloader();

// 明示的に渡す場合
// const apiKey = process.env.EDINET_API_KEY || "YOUR_API_KEY";
// const downloader = new EdinetXbrlDownloader(apiKey);

// 特定企業（例：トヨタ 7203）の最新の有価証券報告書をダウンロード
// 指定したディレクトリに保存し、XBRLファイルのパスを返します
// 第2引数のディレクトリも省略可（EDINET_DOWNLOAD_DIRがある場合）
const xbrlPath: string | null = await downloader.downloadByTicker("7203", "./downloads");

if (xbrlPath) {
  console.log(`Downloaded to: ${xbrlPath}`);
}

// （応用）書類種別を指定してダウンロード
// 例: 四半期報告書、半期報告書、大量保有報告書など
import { EdinetDocumentType } from "edinet-ts";

// トヨタの半期報告書 (160) を検索・ダウンロード
await downloader.downloadByTicker("7203", "./downloads", "2024-11-14", EdinetDocumentType.SemiAnnualReport);
```

### 2. データ解析と主要指標の取得 (Easy Mode)

XBRLファイルを解析し、主要な財務指標を抽出します。

```typescript
import { EdinetXbrlParser } from "edinet-ts";
import * as fs from "fs";

// ダウンロードしたファイルを読み込み
// （ブラウザ等の場合は fetchXbrl で取得した文字列などを渡します）
const xml = fs.readFileSync(xbrlPath, "utf-8");

const parser = new EdinetXbrlParser();
const data = parser.parse(xml);

const metrics: KeyMetrics = data.getKeyMetrics();

console.log(`売上高: ${metrics.netSales}`);
console.log(`営業利益: ${metrics.operatingIncome}`);
console.log(`経常利益: ${metrics.ordinaryIncome}`);
console.log(`当期純利益: ${metrics.netIncome}`);
console.log(`純資産: ${metrics.netAssets}`);
console.log(`総資産: ${metrics.totalAssets}`);
```

#### 取得可能な指標一覧 (`KeyMetrics` インターフェース)

| プロパティ名 | 日本語名 | 備考 |
| :--- | :--- | :--- |
| `netSales` | 売上高 | |
| `operatingIncome` | 営業利益 | |
| `ordinaryIncome` | 経常利益 | IFRSでは一般的ではないため取得できない場合があります |
| `netIncome` | 当期純利益 | 親会社株主に帰属する当期純利益 |
| `netAssets` | 純資産 | |
| `totalAssets` | 総資産 | |
| `operatingCashFlow` | 営業CF | 営業活動によるキャッシュ・フロー |
| `investingCashFlow` | 投資CF | 投資活動によるキャッシュ・フロー |
| `financingCashFlow` | 財務CF | 財務活動によるキャッシュ・フロー |
| `cashAndEquivalents` | 現預金 | 現金及び現金同等物の期末残高 |
| `earningsPerShare` | EPS | 1株当たり当期純利益 |
| `bookValuePerShare` | BPS | 1株当たり純資産 |
| `equityToTotalAssetsRatio` | 自己資本比率 | |
| `rateOfReturnOnEquity` | ROE | 自己資本利益率 |
| `priceEarningsRatio` | PER | 株価収益率（XBRLに含まれる場合のみ） |
| `payoutRatio` | 配当性向 | |
| `numberOfIssuedShares` | 発行済株式総数 | |
| `dividendPaidPerShare` | 1株当たり配当 | |

## Environment Variables

*   `EDINET_API_KEY`: EDINET API v2 の利用キー (推奨)
*   `EDINET_DOWNLOAD_DIR`: XBRLファイルのデフォルトダウンロード先ディレクトリ
    *   この変数を設定すると、`download` や `downloadByTicker` メソッドで保存先ディレクトリを省略できます。

```typescript
// EDINET_DOWNLOAD_DIR="downloads", EDINET_API_KEY="xxx" と設定されている場合
const downloader = new EdinetXbrlDownloader();
// ディレクトリ引数を省略可能
await downloader.downloadByTicker("7203");
```

```

### 3. 型安全なデータアクセス (Type-Safe Mode)

EDINETタクソノミに基づいた型定義（4000項目以上）を利用して、安全かつ補完の効く状態でデータを取得できます。

#### 財務諸表 (JPPFS)
`getJppfsCor()` は、貸借対照表や損益計算書などの財務諸表本表（General Commercial and Industrial）に対応しています。

```typescript
const jppfs = data.getJppfsCor();

// IDEで補完が効きます
// 連結・単体、最新年度・過去年度を自動で検索して最適な値を返します
console.log(`現金及び預金: ${jppfs.CashAndDeposits}`);
console.log(`売上高: ${jppfs.NetSales}`);
console.log(`棚卸資産: ${jppfs.Inventories}`);

if (jppfs.OperatingIncome) {
    console.log(`営業利益: ${jppfs.OperatingIncome}`);
}
```

#### 企業情報 (JPCRP)
`getJpcrpCor()` は、有価証券報告書の企業情報（大株主の状況、役員の状況、配当政策など）に対応しています。

```typescript
const jpcrp = data.getJpcrpCor();

// IFRS採用企業の主要指標もここに含まれる場合があります
if (jpcrp.DividendPolicyTextBlock) {
    console.log(`配当政策: ${jpcrp.DividendPolicyTextBlock}`);
}

console.log(`大株主の状況: ${jpcrp.MajorShareholdersTextBlock}`);
```

#### 大量保有報告書 (Large Shareholding)
`getLargeShareholdingInfo()` を使用すると、大量保有報告書や変更報告書から提出者・保有割合などを抽出できます。

```typescript
// 大量保有報告書のXBRLをパースした後...
// 大量保有報告書のXBRLをパースした後...
const info: LargeShareholdingInfo = data.getLargeShareholdingInfo();

if (info.holdingRatio) {
    console.log(`提出者: ${info.filerName}`);
    console.log(`発行者: ${info.issuerName}`);
    console.log(`保有割合: ${info.holdingRatio}% (前回: ${info.prevHoldingRatio}%)`);
}
```

### 4. 詳細なデータアクセス (Advanced Mode)

特定のXBRLタグや、細かいコンテキスト（単体のみ指定など）を取得したい場合に使用します。

```typescript
// 例: 単体の売上高を明示的に取得
// contextRefのIDではなく、条件を指定して検索できます
const nonConsSalesContext = data.findContext({ 
    type: "Duration", 
    scope: "NonConsolidated" 
});

if (nonConsSalesContext) {
    const rawData = data.getDataByContextRef("jppfs_cor:NetSales", nonConsSalesContext.id);
    console.log(`単体売上高: ${rawData?.value}`);
}
```

### 5. 期間指定検索と最新書類の自動特定

日付ピンポイントではなく、期間指定や「最新の書類」を検索する便利機能です。

#### `searchPeriod(startDate, endDate, typeFilter?)`
指定した期間内の書類リストを取得します。

```typescript
// 2024年11月の全ての半期報告書を取得
const docs: EdinetDocument[] = await downloader.searchPeriod("2024-11-01", "2024-11-30", EdinetDocumentType.SemiAnnualReport);
```

#### `findLatest(ticker, type, lookbackDays?)`
指定した銘柄の最新の書類を、過去に遡って検索します。提出日が不明な場合に便利です。

```typescript
// 過去90日以内のトヨタ(7203)の最新の半期報告書を探す
const latestDoc: EdinetDocument | null = await downloader.findLatest("7203", EdinetDocumentType.SemiAnnualReport, 90);

if (latestDoc) {
    console.log(`見つかりました: ${latestDoc.docDescription} (${latestDoc.docID})`);
    // そのままダウンロードへ
    await downloader.download(latestDoc.docID, "./downloads");
}
```

## クレジット / ライセンス

本ライブラリは、Buffett Code氏によって開発されたPythonライブラリ [BuffettCode/edinet_xbrl](https://github.com/BuffettCode/edinet_xbrl) をベースに作成された TypeScript ポートです。

- Original Author: Buffett Code
- Original License: Apache License 2.0
- Changes: Ported logic from Python to TypeScript, adjusted specifically for Node.js environment.

### License

```text
Copyright (c) 2025 oharato
Copyright (c) 2018 Buffett Code

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
