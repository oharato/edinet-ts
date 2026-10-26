# 今後の実装予定 (TODO)

本プロジェクトで将来的の実装を検討している機能一覧です。

棚卸し: 2026-10-26。各項目の状態は、コードと公開情報で確認した範囲を明記します。

## 1. 横断的検索機能 (Horizontal Analysis) - [x] ローカルDB検索は実装済み
*   銘柄コード（Ticker）を指定しない「市場全体の分析」を可能にします。
    *   **大量保有報告書検索**: ウォーレン・バフェットなどの著名投資家（提出者）名での検索。
    *   **イベント検索**: TOB（公開買付）などの特定の書類種別による検索。
    *   **IPO/ETF分析**: 証券コードが付与される前、または特殊なコードを持つ主体の分析。
    *   **実装方針の状態**:
        *   DBスキーマ拡張: `filer_name`, `doc_type_code` へのインデックス追加。 **実装済み**（`src/db/edinet-repository.ts`）。
        *   API追加: `findDocumentsByFiler()`, `findDocumentsByType()`。 **実装済み**（`src/edinet.ts`）。ただし検索対象はローカルDBで、DBへ取り込んだ書類だけが対象です。検索だけでDBが自動補完されるわけではありません（[仕様](docs/SPECIFICATIONS.md)）。
        *   doc_type_code を型として定義する: **実装済み**（`EdinetDocumentType`）。
    *   APIから直接横断検索する形: **実装済み**（DBキャッシュ補完つき）。検索前に対象期間のうちDBに無い日だけ書類一覧APIから補い、結果をDBへ保存します。書類一覧APIは1日分を1リクエストで返すため、コストは銘柄数ではなく日数に比例します。DBへ保存しない純粋な直接検索は未実装です。
*   横断検索は2つのレベルに分けて考えます。
    *   **メタデータレベルの横断検索**: 書類一覧の属性（提出者・種別・提出日）だけでの検索。上の `findDocumentsByFiler()` / `findDocumentsByType()` がこのレベルで、安価に広い範囲を探せます。APIから直接行う形もこのレベルです。
    *   **本体レベルの横断検索**: XBRL本体の値（財務指標・人的資本など）での検索。書類ごとに取得と解析が要るため重く、現在の実装は「明示した原本の集合」に対するスクリーニング（[BS横断検索](docs/BALANCE_SHEET_SCREENING.md)等）がこのレベルです。市場全体を対象にする場合は、まずメタデータレベルで候補を絞ってから本体を取得する二段構えを前提にします。

## 2. CLIツール (Command Line Interface) - [x] Implemented
*   `edinet-ts download`: 書類のダウンロード
*   `edinet-ts parse`: ローカルxBRLの解析
*   `edinet-ts get`: ダウンロードと解析を一括実行 (Local DB対応)

## 3. npmへの公開 - [x] 公開済み（現行の配布方針はローカル配布）
*   CI/CDパイプラインの構築 (GitHub Actions): source checks等は **構築済み**。
*   npm registry へのパブリッシュ: `edinet-ts` 1.1.17 が公開されていることを確認しました（2026-10-26）。
*   現在の配布方針は [ADR 0001](docs/adr/0001-local-distribution.md) のローカル配布です（[手順](docs/nuc7-local-artifacts.md)）。手動workflowもtag・release・npm/GitHub Packagesへの新規公開は行いません。
