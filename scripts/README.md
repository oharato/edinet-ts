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
