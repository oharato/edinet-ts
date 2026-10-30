# 開発用スクリプト

`scripts` ディレクトリには、データ生成、テスト、データベース構築などのための各種ユーティリティスクリプトが含まれています。

## 主要スクリプト

### 1. 型ドキュメント自動生成 (`generate-type-docs.ts`)

TypeScriptのソースコードから型定義ドキュメントを自動生成します。CLIの `--help-types` で表示される情報はここから生成されます。

- **実行**: `npm run generate-type-docs` (またはビルド時に自動実行)
- **入力**: `src/edinet-xbrl-object.ts`, `src/types/*.ts` など
- **出力**: `src/utils/type-doc-defs.ts` (データ定義のみ)
- **仕組み**: `ts-morph` を使用してインターフェース定義とJSDocコメントを解析し、プログラムで利用可能な定数定義に変換します。

### 2. データベースの初期構築 (`seed.ts`)

メタデータ検索用のローカルSQLiteデータベースを構築します。

- **実行**: `npx tsx scripts/seed.ts`
- **機能**: 過去5年分（または指定期間）の書類一覧APIを叩き、ローカルDBにメタデータを保存します。

### 3. タクソノミ生成 (`generate_types.ts`, `generate_types_jpcrp.ts`)

EDINETタクソノミファイル（XBRL定義）からTypeScriptの型定義を生成します。

- **`generate_types.ts`**: 財務諸表本表 (`jppfs_cor`) 用
- **`generate_types_jpcrp.ts`**: 企業内容等の開示に関する内閣府令 (`jpcrp_cor`) 用

## 調査・検証用スクリプト (`scripts/debug/`)

開発中の動作検証や特定のデータの調査に使用するスクリプト群は `scripts/debug/` ディレクトリに配備されています。

- **`inspect_*.ts`**: 実際のEDINETデータを取得して内容を確認するためのスクリプト
- **`verify_*.ts`**: 生成された指標やロジックの正当性を検証するスクリプト

## メンテナンス手順

### 新しいインターフェースをドキュメントに追加する場合

1. `scripts/generate-type-docs.ts` を編集します。
2. `interfaceConfig` または `documentTypeConfig` 配列に対象のファイルパスとインターフェース名を追加します。
3. `npm run generate-type-docs` を実行して `src/utils/type-doc-defs.ts` を再生成します。
4. CLIのヘルプコマンドを実行して、正しく表示されることを確認します。

### 生成されるファイルについて

- **`src/utils/type-doc-defs.ts`**: 自動生成されます。**手動で編集しないでください。**
- **`src/utils/type-doc-helpers.ts`**: ヘルパー関数群です。こちらは手動で管理される静的なファイルです。

## 固定年次取得の実行補助

`roadmap/acquisition-batch-control.mjs` は固定runtimeの取得scriptが使う補助です。単体ではDBや通信を開きません。既存SDKの上限100件と同じ取得順のprefixを使い、20件単位の停止判定・3試行上限、本文取得前後の32GiB+2GiB空き容量確認を保ちます。キャッシュ即時返却時も停止signalを処理するためevent loopへ制御を返します。

固定runtimeへのコピー、全ファイルmanifest、実行scriptの指紋とunitの引継ぎは [専用サービス](../docs/pipeline/ROADMAP_RUNTIME.md)を参照してください。稼働runtime内のファイルを直接更新する運用は行いません。

`isSourceReady` は構築待機側が使う検査です。現在のsystemd unit PID・期待する取得scriptのSHA-256・固定計画・正確なscript argvが一致した場合だけ、新workerの初期summaryと認めます。古いsummaryや同名に似たパスを起動完了の証拠として使いません。

## 日次metadata収集

`roadmap/daily-metadata-control.mjs` と `roadmap/run-daily-metadata.mjs` は別metadata forkの観測を追記する運用補助です。`roadmap/daily-metadata-notices.mjs` は保存通知から既知の過去一覧日を追加し、通知cursor/identity/対象日と不明通知を保持します。固定年次計画が完了して取得unitが停止するまでAPI通信せず、当日probe・JST日次256要求・再開checkpoint・flock・34GiB容量余裕を使います。秘密値を出力せず、既存年次アーカイブや公開SDKは変更しません。固定runtime/configと定期起動の条件は [書類同期](../docs/pipeline/FINANCIAL_DOCUMENT_SYNC.md#専用日次収集の運用補助)を参照してください。

## 全体テスト

`.node-version` の Node 26.12.1 と `package.json` の npm 12.2.1 を使用し、リポジトリ直下で実行します。バージョン管理ツールの設定だけでなく、`node --version` と `npm --version` の出力も確認してください。

```sh
npm run build
npx --no-install tsc --noEmit
npx --no-install tsc --project test/types/tsconfig.json
npm test -- --maxWorkers=1 --exclude 'data/**' --exclude 'artifacts/**'
python3 scripts/test_artifact_store.py
```

`data/` と `artifacts/` の固定配布物には過去のソースとテストが含まれるため、現在のソースの検証から除外します。`test/` 以下はESM・CLI・SQLiteを含めて実行します。ESMテストが古い `dist/` を参照しないよう、先にビルドしてください。

CLIテストは子プロセスを起動します。`spawnSync` の `error.code` が `EPERM` なら、実行環境の子プロセス制限を確認してください。終了状態だけで成功と判断せず、子プロセス起動を許可した環境で再実行します。
