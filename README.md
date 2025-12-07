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
const xbrlPath = await downloader.downloadByTicker("7203", "./downloads");

if (xbrlPath) {
  console.log(`Downloaded to: ${xbrlPath}`);
}
```

### 2. データ解析と主要指標の取得 (Easy Mode)

`getKeyMetrics()` を使うと、最も一般的な財務指標を簡単に取得できます。
連結データがあれば連結を優先し、なければ単体データを自動的に探します。

```typescript
import { EdinetXbrlParser } from "edinet-ts";

const parser = new EdinetXbrlParser();
const data = parser.parseFile("./downloads/report.xbrl");

// 主要指標を一括取得
const metrics = data.getKeyMetrics();

console.log(`売上高: ${metrics.netSales}`);          // 円単位 (例: 10000000000)
console.log(`営業利益: ${metrics.operatingIncome}`);
console.log(`経常利益: ${metrics.ordinaryIncome}`);
console.log(`当期純利益: ${metrics.netIncome}`);
console.log(`純資産: ${metrics.netAssets}`);
console.log(`総資産: ${metrics.totalAssets}`);
```

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

### 3. 詳細なデータアクセス (Advanced Mode)

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
