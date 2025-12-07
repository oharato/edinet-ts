# 今後の実装予定 (TODO)

本プロジェクトで将来的の実装を検討している機能一覧です。

## 1. 横断的検索機能 (Horizontal Analysis)
*   銘柄コード（Ticker）を指定しない「市場全体の分析」を可能にします。
    *   **大量保有報告書検索**: ウォーレン・バフェットなどの著名投資家（提出者）名での検索。
    *   **イベント検索**: TOB（公開買付）などの特定の書類種別による検索。
    *   **IPO/ETF分析**: 証券コードが付与される前、または特殊なコードを持つ主体の分析。
    *   **実装方針**:
        *   DBスキーマ拡張: `filer_name`, `doc_type_code` へのインデックス追加。
        *   API追加: `findDocumentsByFiler()`, `findDocumentsByType()`。
        *   doc_type_code を型として定義する

## 2. CLIツール (Command Line Interface) - [x] Implemented
*   `edinet-ts download`: 書類のダウンロード
*   `edinet-ts parse`: ローカルxBRLの解析
*   `edinet-ts get`: ダウンロードと解析を一括実行 (Local DB対応)

## 3. npmへの公開
*   CI/CDパイプラインの構築 (GitHub Actions)
*   npm registry へのパブリッシュ

