# 今後の実装予定 (TODO)

本プロジェクトで将来的に実装を検討している機能一覧です。

## 1. ドキュメント種別の拡充
*   現在は有価証券報告書（Annual Report）を主対象としていますが、株価分析に必須となる以下の書類への対応を進めます。
    *   **四半期報告書 / 半期報告書**: 3ヶ月/6ヶ月ごとの進捗確認用。
    *   **大量保有報告書 (5%ルール)**: 著名投資家やアクティビストの動向監視用（最優先）。
    *   **臨時報告書**: M&Aや災害など突発的な事象の確認用。
    *   **有価証券届出書**: IPO/PO情報の取得用。

## 2. 過去データの時系列分析機能
*   最新のデータだけでなく、過去3〜5年分のデータを一括取得・比較できる機能を実装します。
    *   CAGR（年平均成長率）の算出や、季節性（Seasonality）の排除、景気サイクルの判断に不可欠なため。
    *   例: 銘柄コード指定で過去5年分の主要数値を配列で返すAPI。


## 3. APIリクエストの安定化とレートリミット (Reliability)
*   EDINET API v2 の仕様に基づき、アクセス制限周辺の実装を強化します。
    *   **Throttling (流量制限)**: デフォルトで「1秒1リクエスト」等の制限をかけ、IPブロックを回避。
    *   **Retry Strategy (再試行)**: 429 Too Many Requests エラー時の指数関数的バックオフ (Exponential Backoff)。
    *   **Configurable Client**: `EdinetDownloader` のコンストラクタで、レートリミットやリトライ回数を設定可能にする。

## 4. CLIツール (Command Line Interface)
*   コードを書かずにターミナルから直接利用できるCLIツールの提供。
    *   例: `edinet-ts download --ticker 7203 --years 5`
    *   例: `edinet-ts parse --file report.xbrl --format json`

## 4. npmへの公開
*   CI/CDパイプラインの構築 (GitHub Actions)
*   npm registry へのパブリッシュ
