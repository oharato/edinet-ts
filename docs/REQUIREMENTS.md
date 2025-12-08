# 要件定義書 (REQUIREMENTS.md)

本ドキュメントでは、`edinet-ts` ライブラリの利用者が期待できる機能および利用に必要な環境要件について記述します。

## 1. プロジェクトの目的

`edinet-ts` は、日本の金融庁が提供する EDINET API v2 を利用し、有価証券報告書などの XBRL (eXtensible Business Reporting Language) データを効率的かつ直感的に扱うための TypeScript ライブラリです。

## 2. システム要件

利用者は以下の環境を用意する必要があります。

*   **Runtime**: Node.js (推奨 v18以上)
*   **Language**: TypeScript / JavaScript
*   **Network**: EDINET API (`api.edinet-fsa.go.jp`) へのHTTPSアクセスが可能であること
*   **API Key**: EDINET API の利用には、金融庁への登録により発行される「サブスクリプションキー (API Key)」が必要です。

## 3. 機能要件

ライブラリは以下の主要機能を提供します。

### 3.1 ファイルのダウンロード
*   **Ticker指定ダウンロード**: 証券コード（例: 7203）を指定することで、最新の有価証券報告書を自動的に検索しダウンロードします。
*   **ZIP処理**: ダウンロードされた `.zip` アーカイブを自動的に展開し、解析対象となる `.xbrl` ファイルを特定します。
*   **API v2 対応**: 2024年現在の最新API仕様に準拠し、適切な認証（ヘッダー/クエリパラメータ）を行います。

### 3.2 XBRL解析 (Parsing)
*   **XML解析**: 複雑なXML構造を持つXBRLファイルをパースし、操作可能なオブジェクトに変換します。
*   **名前空間の抽象化**: `jppfs_cor` (財務諸表本表), `jpcrp_cor` (企業情報) などの名前空間プレフィックスの違いを内部で吸収します。

### 3.3 データ抽出

本ライブラリでは、以下の2通りの方法でデータを抽出できます。

#### A. 主要指標の一括取得 (`getKeyMetrics`)

`getKeyMetrics()` メソッドを使用すると、以下の財務指標を、連結/単体や期間を自動判定（連結優先、最新年度）して抽出できます。
J-GAAP（日本基準）と IFRS（国際会計基準）の両方に対応しており、タグの違いを吸収します。

| プロパティ名 | 日本語項目名 | 対応する主なXBRLタグ (J-GAAP / IFRS) |
| :--- | :--- | :--- |
| `netSales` | 売上高 / 収益 | `NetSales`, `Revenue`, `RevenueIFRSSummary...` |
| `operatingIncome` | 営業利益 | `OperatingIncome`, `OperatingIncomeIFRSSummary...` |
| `ordinaryIncome` | 経常利益 | `OrdinaryIncome` (日本基準のみ) |
| `netIncome` | 当期純利益 | `ProfitLossAttributableToOwnersOfParent`, `ProfitLoss...IFR...` |
| `netAssets` | 純資産 | `NetAssets`, `EquityAttributableToOwnersOfParent...` |
| `totalAssets` | 総資産 | `Assets`, `TotalAssetsIFRSSummary...` |
| `operatingCashFlow` | 営業CF | `NetCashProvidedByUsedInOperatingActivities` etc. |
| `investingCashFlow` | 投資CF | `NetCashProvidedByUsedInInvestmentActivities` etc. |
| `financingCashFlow` | 財務CF | `NetCashProvidedByUsedInFinancingActivities` etc. |
| `cashAndEquivalents` | 現金同等物残高 | `CashAndCashEquivalents` etc. |
| `earningsPerShare` | EPS (1株益) | `BasicEarningsLossPerShare` etc. |
| `bookValuePerShare` | BPS (1株資産) | `NetAssetsPerShare`, `EquityAttributable...PerShare` |
| `equityToTotalAssetsRatio`| 自己資本比率 | `EquityToTotalAssetsRatio`, `RatioOfOwnersEquity...` |
| `rateOfReturnOnEquity` | ROE | `RateOfReturnOnEquity`, `RateOfReturnOnEquityIFR...` |
| `priceEarningsRatio` | PER (株価収益率) | `PriceEarningsRatio...` (XBRLに含まれる場合のみ) |
| `payoutRatio` | 配当性向 | `PayoutRatio...` |
| `numberOfIssuedShares` | 発行済株式総数 | `TotalNumberOfIssuedShares` etc. |
| `dividendPaidPerShare` | 1株当たり配当 | `DividendPaidPerShare...` |

#### B. 定性情報の取得 (`getQualitativeInfo`)

以下の定性情報（テキストブロック）を取得できます。各項目はHTMLタグを含む文字列として返されます。

| プロパティ名 | 日本語項目名 | 主な内容 |
| :--- | :--- | :--- |
| `businessPolicy` | 経営方針等 | 経営方針、経営環境及び対処すべき課題 |
| `businessRisks` | 事業等のリスク | 事業展開上のリスク要因 |
| `financialAnalysis` | 経営者による分析 | 財政状態、経営成績及びキャッシュ・フローの状況の分析 |
| `businessDescription` | 事業の内容 | 事業の系統図や内容の説明 |
| `companyHistory` | 沿革 | 会社の沿革 |
| `researchAndDevelopment`| 研究開発活動 | 研究開発の状況 |

#### D. 大量保有報告書の解析 (`getLargeShareholdingInfo`)
大量保有報告書（変更報告書・訂正報告書含む）から、以下の情報を抽出できます。

*   **提出者名**: `filerName`
*   **発行者名**: `issuerName` (提出対象会社)
*   **保有割合**: `holdingRatio` (%)
*   **直前保有割合**: `prevHoldingRatio` (%)

```typescript
// 例
const info = doc.getLargeShareholdingInfo();
console.log(`${info.issuerName} の株を ${info.holdingRatio}% 保有`);
```

### 3.4 CLIツール
ライブラリの機能をコマンドラインから直接利用できるCLIを提供します。

*   **`get` コマンド**: ティッカーまたは日付指定で書類を取得・解析し、JSONを出力します。
*   **`download` コマンド**: 書類を指定ディレクトリにダウンロードします。
*   **ローカルDBキャッシュ**: メタデータをSQLiteにキャッシュし、高速な検索を実現します。

### 3.5 型安全なタクソノミアクセス (`getJppfsCor`)

EDINETタクソノミ（2024年版）の「財務諸表本表 (jppfs_cor)」に含まれる **1,800項目以上** の財務項目を、型定義付きで直接取得できます。

*   **完全な型定義**: `JppfsCorTaxonomy` インターフェースにより、入力補完（IntelliSense）が利用可能です。
*   **コンテキスト自動解決**: 連結/単体、最新年度のデータを自動的に探索します。

```typescript
// 例
const taxonomy = doc.getJppfsCor();
console.log(taxonomy.CashAndDeposits); // 現金及び預金
console.log(taxonomy.BuildingAndStructures); // 建物及び構築物
```

## 4. 非機能要件
*   **型安全性**: すべての主要APIは TypeScript で型定義され、開発時の補完と安全性を保証します。
*   **依存関係**: 外部依存は最小限に抑え (`fast-xml-parser`, `adm-zip` 等)、軽量性を維持します。
