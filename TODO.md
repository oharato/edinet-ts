# 今後の実装予定 (TODO)

本プロジェクトで将来的に実装を検討している機能一覧です。

## 1. IFRS (国際会計基準) 対応
*   現在は J-GAAP (日本基準) のタグ (`jppfs_cor`, `jpcrp_cor`) を中心に対応しています。
*   IFRS採用企業のXBRL (`ifrs-full` 等) からも主要指標を抽出できるようにマッピングを追加予定です。

## 2. CLIツール (Command Line Interface)
*   コードを書かずにターミナルから直接利用できるCLIツールの提供。
    *   例: `edinet-ts download --ticker 7203`
    *   例: `edinet-ts parse --file report.xbrl --format json`

## 3. 取得指標の拡充
*   現在は主要6指標 (`NetSales`, `OperatingIncome`, `OrdinaryIncome`, `NetIncome`, `NetAssets`, `TotalAssets`) のみに対応しています。
*   以下のような詳細な指標への対応を検討中です。
    *   キャッシュフロー計算書 (OperatingCF, InvestingCF, FinancingCF)
    *   一株当たり情報 (EPS, BPS)
    *   セグメント情報

## 4. 型定義の完全網羅
*   現在は主要なタグのみサポートしていますが、EDINETタクソノミ全定義からの型生成スクリプトを作成し、完全な型安全性を提供することを目指します。

## 5. パフォーマンス最適化
*   大量のXBRLファイル（数千社分）を一括処理する際のメモリ使用量と速度の最適化。
*   ストリーム処理の導入検討。
