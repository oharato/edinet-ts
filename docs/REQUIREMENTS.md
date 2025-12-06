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
*   **主要指標抽出 (`getKeyMetrics`)**: 以下の財務データを、連結・単体・期間を自動判定して抽出します。
    *   売上高 (NetSales)
    *   営業利益 (OperatingIncome)
    *   経常利益 (OrdinaryIncome)
    *   当期純利益 (NetIncome)
    *   純資産 (NetAssets)
    *   総資産 (TotalAssets)
*   **コンテキスト自動判定**: `CurrentYearDuration` や `Prior1YearInstant` といったID文字列を知らなくても、「期間」「連結/単体」といった論理条件でデータを検索できます。

## 4. 非機能要件
*   **型安全性**: すべての主要APIは TypeScript で型定義され、開発時の補完と安全性を保証します。
*   **依存関係**: 外部依存は最小限に抑え (`fast-xml-parser`, `adm-zip` 等)、軽量性を維持します。
