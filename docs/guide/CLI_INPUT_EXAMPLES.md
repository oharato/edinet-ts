# CLIの入力JSONとエラーの直し方

基本操作は `edinet-ts --help`、個別の引数は `edinet-ts <command> --help` で確認できます。リポジトリでビルドした場合は `edinet-ts` の代わりに `node dist/cli.js` を使います。

## screen-bs

`manifest.json` は次の配列です。`file` はmanifestからの相対パスで、通常のUTF-8 XBRL原本を指定します。コード・書類ID・期末・連結区分・会計基準は、その原本に対応する実際の値へ置き換えます。

```json
[
  {
    "file": "source.xbrl",
    "secCode": "72030",
    "docID": "S100TEST",
    "instant": "2026-03-31",
    "scope": "Consolidated",
    "accountingStandard": "J-GAAP"
  }
]
```

```sh
node dist/cli.js screen-bs --manifest manifest.json --pretty
```

manifestは100件以下です。ファイルを見つけられない場合はパス、JSON構文エラーなら括弧・カンマ・引用符を確認してください。「manifestの3件目：instantが不正です」は配列の3要素目の期末日を指します。日付は実在する `YYYY-MM-DD` にします。原本の内容とmetadataが一致しない場合は、採用できない理由も結果で確認します。値やエラーを消すために期末を手修正しません。

## screen-duck-financial-index

`cohort.json` は比較する世代・基準・範囲・期間を指定します。世代IDと期末は、利用する検証済みDBに保存されている値を使ってください。以下は形式の例で、この世代が同梱されているという意味ではありません。

```json
{
  "generation": "your-generation",
  "group": "balanceSheet",
  "accountingStandard": "J-GAAP",
  "scope": "Consolidated",
  "currency": "JPY",
  "period": { "instant": "2026-03-31" }
}
```

```sh
node dist/cli.js screen-duck-financial-index --db index.duckdb \
  --cohort cohort.json --metrics currentAssets --limit 10 --pretty
```

`--metrics` には対象世代に保存済みの指標を指定します。`details` の期間は `startDate` と `endDate` を使います。期間の種類を限定するときは、保存された行に対応する `periodType` も指定します。形式の詳細は[検索索引仕様](../specs/storage/FINANCIAL_SEARCH_INDEX.md)を参照してください。

cohortのファイル不在・JSON構文不正は、それぞれ別の診断になります。項目や比較条件が不正なときはperiod・基準・scopeと検索条件を確認してください。DBの不在・破損や保存世代との不一致も、単に0件という成功結果にはなりません。診断へ入力本文やAPIキーを転載しません。
