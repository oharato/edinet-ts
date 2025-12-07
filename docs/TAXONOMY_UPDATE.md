# タクソノミの更新手順

EDINETタクソノミが更新された場合（通常、毎年3月頃に新しいバージョンが公示されます）、本ライブラリの型定義を追従させるには以下の手順を実行してください。

## 前提条件

*   Node.js (v18以上推奨)
*   `unzip` コマンド (Linux/Mac環境の場合、日本語ファイル名対応のために `unzip -O cp932` が使用されます)

## 手順

### 1. タクソノミURLの確認と更新

金融庁の[EDINETタクソノミ公表ページ](https://www.fsa.go.jp/search/search01.html)を確認し、最新のタクソノミ（例: 2024年版）のZIPファイルURLを取得します。

`scripts/fetch_taxonomy.ts` を開き、 `TAXONOMY_URL` 定数を更新してください。

```typescript
// scripts/fetch_taxonomy.ts
const TAXONOMY_URL = "https://www.fsa.go.jp/search/202Xxxxx/1c_Taxonomy.zip";
```

### 2. 勘定科目リスト (Account List) の入手

同様に、同ページから「勘定科目リスト」のExcelファイル URL を取得し、手動でダウンロードするか、スクリプトを更新して `taxonomy/AccountList.xlsx` として配置します。

※ 現在の `scripts/fetch_taxonomy.ts` はZIPのダウンロードのみを自動化しています。`AccountList.xlsx` は手動更新が必要です。

```bash
# 例: 2024年版のAccount Listを上書き保存
curl -o taxonomy/AccountList.xlsx https://www.fsa.go.jp/search/202X/1f_AccountList.xlsx
```

### 3. タクソノミのダウンロードと解凍

以下のコマンドを実行し、タクソノミファイルを `taxonomy/` ディレクトリに展開します。

```bash
npx tsx scripts/fetch_taxonomy.ts
```

### 3. 型定義の生成

#### 3-1. 財務諸表本表 (jppfs_cor)
`AccountList.xlsx` から `src/types/taxonomy.ts` を生成します。

```bash
npx tsx scripts/generate_types.ts
```

実行後、 `src/types/taxonomy.ts` が更新されます。

#### 3-2. 企業情報本表 (jpcrp_cor)
`taxonomy/` フォルダ内のXSD定義から `src/types/jpcrp_taxonomy.ts` およびドキュメントを生成します。

```bash
npx tsx scripts/generate_types_jpcrp.ts
```

### 4. ドキュメントの更新

#### 4-1. 財務諸表 (JPPFS)
```bash
npx tsx scripts/generate_doc_taxonomy.ts
```

実行後、 `docs/TAXONOMY_JPPFS_COR.md` が更新されます。

### 6. テストと検証

更新された型定義を使用して、ビルドやテストが通ることを確認します。

```bash
# テストの実行
npm test

# 特に型カバレッジのテストを確認
npx vitest run test/type_coverage.test.ts
```

### 6. コミットとリリース

変更内容をコミットし、新しいバージョンとしてリリースしてください。

## スクリプトの構成

*   `scripts/fetch_taxonomy.ts`: タクソノミZIPのダウンロードと、日本語ファイル名を考慮した解凍を行います。
*   `scripts/generate_types.ts`: `AccountList.xlsx` を解析し、 `jppfs_cor` 名前空間の項目を抽出してインターフェースを生成します。
*   `scripts/generate_doc_taxonomy.ts`: `AccountList.xlsx` から `jppfs_cor` 項目の一覧ドキュメント (`docs/TAXONOMY_JPPFS_COR.md`) を生成します。
*   `scripts/inspect_account_list.ts`: Excelファイルの構造（カラム位置など）が変わった場合に、中身を確認するための補助スクリプトです。
