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
*   **Human/AI Friendly**: `--help-types` で型定義とドキュメントを生成可能。開発者の参照用としてはもちろん、AIエージェントに仕様を理解させるためのコンテキストとしても最適です。

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

### 6. 詳細なデータアクセス (Advanced)

`getJppfsCor()` (財務諸表) や `getLargeShareholdingInfo()` (大量保有) などを使用して、より詳細なデータにアクセスできます。

```typescript
// 大量保有報告書の解析例
const info: LargeShareholdingInfo = data.getLargeShareholdingInfo();
if (info.holdingRatio) {
    console.log(`提出者: ${info.filerName}`);
    console.log(`保有割合: ${info.holdingRatio}%`);
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

> **Note**: `LargeShareholding` を指定した場合、大量保有報告書(340)、変更報告書(350)、訂正報告書(360)のすべてが対象となります。
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
| `holdingRatio` | **保有割合** (%) | 大量保有報告書の場合のみ |
| `prevHoldingRatio` | 直前保有割合 (%) | 大量保有報告書の場合または変更報告書 |
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

詳細な設計や運用に関するドキュメントは `docs/` ディレクトリにあります。

*   **[要件定義書 (REQUIREMENTS.md)](docs/REQUIREMENTS.md)**: 提供機能、システム要件、APIカバレッジ。
*   **[技術仕様書 (SPECIFICATIONS.md)](docs/SPECIFICATIONS.md)**: アーキテクチャ、クラス設計、アルゴリズム詳細。
*   **[タクソノミ更新手順 (TAXONOMY_UPDATE.md)](docs/TAXONOMY_UPDATE.md)**: 毎年更新されるEDINETタクソノミへの追従手順。
*   **[npmパブリッシュ手順 (NPM_PUBLISH.md)](docs/NPM_PUBLISH.md)**: リリースとデプロイのフロー（Trusted Publishing設定含む）。
*   **[会社四季報スクリーニング対応表 (SHIKIHO_SCREENING_MAP.md)](docs/SHIKIHO_SCREENING_MAP.md)**: 四季報オンラインのスクリーニング項目と本ライブラリでの取得方法の対応表。
*   **タクソノミ定義書**:
    *   **[財務諸表本表 (TAXONOMY_JPPFS_COR.md)](docs/TAXONOMY_JPPFS_COR.md)**: `jppfs_cor` 名前空間の全項目定義。
    *   **[企業情報 (TAXONOMY_JPCRP_COR.md)](docs/TAXONOMY_JPCRP_COR.md)**: `jpcrp_cor` 名前空間の全項目定義。

## License

```text
Copyright (c) 2025 oharato
Copyright (c) 2018 Buffett Code

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
```
