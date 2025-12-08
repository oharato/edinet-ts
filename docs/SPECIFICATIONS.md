# 技術仕様書 (SPECIFICATIONS.md)

本ドキュメントでは、`edinet-ts` の内部アーキテクチャ、クラス設計、および主要なアルゴリズムについて記述します。開発者がライブラリの拡張やデバッグを行う際の参照資料とすることを目的とします。

## 1. ソフトウェア・アーキテクチャ

本ライブラリは、大きく分けて「ダウンロード層」と「解析層」の2層で構成されています。

```mermaid
graph TD
    User[利用者] --> Facade[Edinet]
    Facade --> Repo[EdinetRepository]
    Facade --> Downloader[EdinetXbrlDownloader]
    Facade --> Parser[EdinetXbrlParser]
    
    Repo -->|Metadata Cache| DB[(SQLite)]
    Downloader -->|Rate Limited| API[EDINET API]
    Downloader -->|XBRL File| FS[FileSystem]
    FS --> Parser
    Parser -->|Returns| Object[EdinetXbrlObject]
    Object -->|getKeyMetrics()| Metrics[KeyMetrics]
```

## 2. クラス設計


### 2.0 `Edinet` (Facade)
ライブラリのエントリーポイントです。

*   **役割**: ユーザーに対する高レベルなAPIを提供し、`Downloader`、`Parser`、`Repository` を透過的に組み合わせます。
*   **ハイブリッド検索**: `findDocuments` 系メソッドでは、まずローカルDB (`EdinetRepository`) を検索し、ヒットしなければAPIにフォールバック、あるいは指定された期間のAPIデータを取得してDBを更新します。

### 2.1 `EdinetXbrlDownloader`
EDINET API v2 との通信を担当します。

*   **役割**: 書類一覧API (`/api/v2/documents.json`) から特定企業の最新書類（コード: 030000 など）を検索し、書類取得API (`/api/v2/documents/{docID}`) からZIPを取得します。
*   **ZIP処理**: `jszip` を使用し、アーカイブ内のファイル構成から `.xbrl` ファイルを探索します。
    *   **優先順位**: `PublicDoc` ディレクトリ内のXBRLを最優先とし、次にルートディレクトリ、サブディレクトリの順で探索します。これにより、監査報告書 (`AuditDoc`) などのノイズを除去します。
*   **認証**: APIキーを `Subscription-Key` ヘッダーまたはクエリパラメータとして付与します。
*   **レート制限**: `RateLimiter` により、APIへのリクエストを（デフォルトで）1秒間に1回以下に制限します。

### 2.2 `EdinetXbrlParser`
XBRLファイルの構文解析を担当します。

*   **依存ライブラリ**: `fast-xml-parser`
*   **Context解析**: データ読み込みの前に、まず `<xbrli:context>` 要素を走査し、`ContextParser` を用いてコンテキストIDと論理的意味（期間・範囲）のマッピングを作成します。
*   **データ解析**: XMLツリーを再帰的にトラバースし、数値データやテキストデータを抽出して `EdinetXbrlObject` に格納します。

### 2.3 `EdinetXbrlObject`
解析されたXBRLデータを保持するデータコンテナです。

*   **データ構造**:
    *   `dataMap`: `Map<Key, EdinetData[]>` - タグ名をキーとしたデータのリスト（同名タグが複数コンテキストで存在するため）。
    *   `contextMap`: `Map<ID, EdinetContext>` - コンテキストIDから定義情報（期間、連結/単体区分）へのマップ。
*   **検索ロジック (`findContext`)**:
    *   指定された条件（Type: `Duration`/`Instant`, Scope: `Consolidated`/`NonConsolidated`）に合致するコンテキストIDを `contextMap` から検索します。
    *   複数の候補がある場合、日付が最も新しいものを「当期」とみなして返します。

### 2.4 `EdinetDataUtil`
XMLノードから属性や値を安全に取り出すためのユーティリティです。

*   **役割**: `unknown` 型のノードに対して Type Guard を適用し、安全に `.text` や属性値 (`@_contextRef`) を取得します。
*   **名前空間**: タグ名に含まれる名前空間プレフィックス（`jppfs_cor:` 等）はそのまま保持しますが、値の取得時には構造の違いを吸収します。

### 2.5 `EdinetRepository` (SQLite)
メタデータ管理を担当します。

*   **技術スタック**: `better-sqlite3` を使用。
*   **スキーマ (edinet.db)**:
    *   `documents`: 書類管理ID、提出者名、書類種別、提出日時などを格納。
    *   `filers`: EDINETコードと提出者名のマッピング（将来拡張用）。
*   **役割**: 過去の日付指定検索を高速化し、APIの負荷を軽減します。
    *   **導入の経緯**: EDINET API v2 は「日付指定」の検索には適していますが、「特定企業の過去5年分」といった**ティッカーベースの時系列検索**を直接行うAPIが存在しません。
    *   そのため、過去の提出書類リスト（メタデータ）をローカルDBに蓄積し、インデックスを貼ることで、`get -t 7203` のようなティッカー検索を数ミリ秒で実行可能にしました。また、都度APIを全走査する必要がなくなるため、APIサーバーへの負荷（レート制限）も大幅に削減されます。

## 3. 主要アルゴリズム

### 3.1 コンテキスト判定ロジック
XBRLの `xbrli:context` 要素を以下のように解析します。

1.  **期間 (`xbrli:period`)**:
    *   `startDate` / `endDate` があれば `Duration` (フロー項目用)
    *   `instant` があれば `Instant` (ストック項目用)
2.  **範囲 (`xbrli:scenario` / `xbrli:segment`)**:
    *   `xbrldi:explicitMember` に `NonConsolidatedMember` が含まれていれば `NonConsolidated` (単体)。
    *   それ以外はデフォルトで `Consolidated` (連結) とみなします（※EDINETの慣習に基づく）。

### 3.2 主要指標抽出ロジック (`getKeyMetrics`)
以下の優先順位でデータを探索します。これにより、連結財務諸表が存在しない企業（単体のみの企業）でも正しくデータを抽出可能です。

1.  `findContext` で「連結」コンテキストを検索し、値があれば採用。
2.  なければ `findContext` で「単体」コンテキストを検索し、値があれば採用。
3.  それでも見つからない場合、後方互換性のため過去の慣習的な固定ID (`CurrentYearDuration` 等) で検索。

### 3.3 ファイル探索ロジック (`findXbrlFileInDir`)
ダウンロードしたZIPには複数のXBRLが含まれる場合があります（例：監査報告書）。
財務データを正しく抽出するため、以下の優先順位で解析対象ファイルを決定します。

1.  ファイル名が `.xbrl` で終わり、かつパスに `PublicDoc` を含むものを最優先。
2.  カレントディレクトリにある `.xbrl`。
3.  サブディレクトリを再帰的に探索（ここでも `PublicDoc` ディレクトリを優先的に探索）。

