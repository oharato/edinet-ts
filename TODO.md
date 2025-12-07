# 今後の実装予定 (TODO)

本プロジェクトで将来的に実装を検討している機能一覧です。

## 1. CLIツール (Command Line Interface)
*   コードを書かずにターミナルから直接利用できるCLIツールの提供求。
    *   例: `edinet-ts download --ticker 7203`
    *   例: `edinet-ts parse --file report.xbrl --format json`

## 2. npmへの公開
*   CI/CDパイプラインの構築 (GitHub Actions)
*   npm registry へのパブリッシュ

## 3. 型定義のさらなる拡充 (jpcrp_cor)
*   現在は財務諸表本表 (`jppfs_cor`) のみを型定義しています。
*   企業情報 (`jpcrp_cor`) には、役員情報、大株主の状況、設備の状況など膨大な情報が含まれています。これらに対しても型安全なアクセスを提供することを検討します。

## 4. ブラウザ/Edge ランタイム対応
*   現在は `fs` モジュールや `adm-zip` に依存しているため、Node.js 環境でのみ動作します。
*   Web Standard API (Fetch, checkt) への移行や、Isomorphic対応を行い、Cloudflare Workers やブラウザ上でも動作するように改良することを検討します。
