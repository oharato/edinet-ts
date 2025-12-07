# edinet-ts

`edinet-ts` は、金融庁の EDINET API v2 を利用して有価証券報告書等のXBRLファイルをダウンロード・解析するための TypeScript ライブラリです。
Pythonライブラリ [BuffettCode/edinet_xbrl](https://github.com/BuffettCode/edinet_xbrl) のロジックをベースに、TypeScript/Node.js 環境向けに移植・最適化を行いました。
複雑なXBRLの構造（Context、Namespace）を意識することなく、主要な財務指標を簡単に抽出できるように設計されています。

## 特徴

*   **TypeScript完全対応**: 型定義完備で、安全な開発が可能です。
*   **EDINET API v2 対応**: 最新のAPI仕様（2024年現在）に対応しています。
*   **主要指標の自動抽出**: 売上高、営業利益などを、連結/単体や期間を自動判定して `number` 型で取得できます。
*   **ハイブリッド検索**: ローカルDB（SQLite）とAPIを組み合わせた高速な過去データ検索が可能です。
*   **ZIP自動解凍**: ダウンロードした書類のZIP解凍とファイル特定を自動化します。

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
const history = await edinet.getFinancialHistory("7203", 5);

history.forEach(h => {
  console.log(`決算日: ${h.periodEnd}`);     // 2024-03-31
  console.log(`提出日: ${h.submitDate}`);    // 2024-06-25
  console.log(`売上高: ${h.metrics.netSales}`);
  console.log(`営業利益: ${h.metrics.operatingIncome}`);
});
```

### セットアップ (DB構築)
時系列分析を使用する場合、初回のみ以下のコマンドでデータベースを構築してください（所要時間: 約20分）。
```bash
# .envに EDINET_API_KEY=xxx を設定してから実行
npx tsx scripts/seed.ts
```

---

### 2. 書類単体のダウンロード (Downloader)

DBを使用せず、APIを直接叩いて最新の書類などをダウンロードする場合の使用方法です。

```typescript
import { EdinetXbrlDownloader, EdinetDocumentType } from "edinet-ts";

const downloader = new EdinetXbrlDownloader({
  apiKey: "YOUR_API_KEY",
  enableRateLimit: true
});

// 特定企業（例：トヨタ 7203）の最新の有価証券報告書をダウンロード
const xbrlPath = await downloader.downloadByTicker("7203", "./downloads");

// 特定の日付・書類種別を指定してダウンロード（例: 半期報告書）
await downloader.downloadByTicker("7203", "./downloads", "2024-11-14", EdinetDocumentType.SemiAnnualReport);
```

### 3. XBRL解析 (Parser)

ダウンロードしたXBRLファイルを解析し、`KeyMetrics` を抽出します。

```typescript
import { EdinetXbrlParser } from "edinet-ts";
import * as fs from "fs";

const xml = fs.readFileSync(xbrlPath, "utf-8");
const parser = new EdinetXbrlParser();
const data = parser.parse(xml);

const metrics = data.getKeyMetrics();
console.log(`売上高: ${metrics.netSales}`);
console.log(`営業利益: ${metrics.operatingIncome}`);
// ...
```

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

### 4. 詳細なデータアクセス (Advanced)

`getJppfsCor()` (財務諸表) や `getLargeShareholdingInfo()` (大量保有) などを使用して、より詳細なデータにアクセスできます。

```typescript
// 大量保有報告書の解析例
const info = data.getLargeShareholdingInfo();
if (info.holdingRatio) {
    console.log(`提出者: ${info.filerName}`);
    console.log(`保有割合: ${info.holdingRatio}%`);
}
```

## License

```text
Copyright (c) 2025 oharato
Copyright (c) 2018 Buffett Code

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
```
