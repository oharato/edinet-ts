# 実行環境とSQLite/DuckDB

2026-11-03更新。このページは現在のリポジトリのコードを対象にしています。固定済みの旧配布物は、その配布物に記録された実行環境を使ってください。

## 必要な環境

- Node.js 26.13.0以上、npm 12.2.1以上。開発では [`.node-version`](../../.node-version) と [`package.json`](../../package.json) の指定を使います。
- TypeScript・ライブラリの版は `package.json`、解決済みの依存と取得元・integrityは `package-lock.json` に固定します。
- Pythonは不要です。原本照合、法人番号の取得・署名検証、SQLite退避、ローカル配布物作成もNodeで実行します。
- DuckDBを使う機能にはoptional依存の `@duckdb/node-api` が必要です。通常のXML解析・SQLite APIはdriverなしでも使えます。
- Linuxの運用スクリプトは `flock` を使います。法人番号の署名検証にはGnuPGが必要です。一般のXBRL解析ではこれらを呼びません。

## ビルドと検査

```sh
npm ci
npm run build
npm run format:check
npm run lint
npx --no-install tsc --project test/types/tsconfig.json
npm test -- --maxWorkers=1 --testTimeout=30000
npm run security
```

GitHubのCodeQLはTypeScript/JavaScriptとActionsを検査します。Pythonのソースと実行依存は撤去済みのため、Python向けの検査設定も外しています。依存の脆弱性は `npm run security` とaudit workflowで検査します。

テストの容量条件や固定配布物の扱いは[テスト手順](../../scripts/README.md#全体テスト)を参照してください。SDKのbuildは古いdistを消してから生成します。開発用の整形はoxfmt、静的検査はoxlintを使用します。

## 保存形式と既存DB

SQLiteにはNode標準の `node:sqlite` を使います。同期処理のAPIを維持し、型定義との差は [`node-sqlite.ts`](../../src/platform/db/engines/sqlite/node-sqlite.ts) で吸収します。SQLへの値の受け渡しはprepared statementを使います。

財務データでは、原本・観測履歴・解析済み結果・公開catalogをSQLite、検索用の世代をDuckDBへ保存します。[具体的なデータ構造](../specs/storage/FINANCIAL_DATA_MODEL.md)と[定義ファイルの場所](../specs/SOURCE_LAYOUT.md#テーブル定義を探す)を参照してください。

保存形式はファイル内のformatとschema、内容のhashで検査します。ライブラリの版番号だけを変えて既存DBを互換とみなす処理にはしていません。readOnlyでは既存ファイルを検査して読み、書込み可能な経路はtransactionと失敗時のrollbackを使います。

今回のソース配置変更はテーブル定義の置き場所を変えるものです。SQL文字列は同一で、既存DBを開くための移行操作は追加していません。

## 固定配布物と過去の記録

古い固定sourceの再現は[ローカル配布物の手順](LOCAL_ARTIFACTS.md)を使います。その手順のNode 26.12.1指定は、当時の配布物hashを再現するための条件です。現在の開発環境の指定とは用途が異なります。

[2026-10-22の更新記録](../history/archive/NODE_SQLITE_UPDATE_2026-10-22.md)は当時の依存・検証件数を保持しています。本番の固定runtimeとサービスの状態は[本番運用](DUCK_FINANCIAL_PRODUCTION.md)を参照してください。
