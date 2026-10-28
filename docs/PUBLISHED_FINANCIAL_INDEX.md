# 公開snapshotによる財務検索と再ロード

`PublishedFinancialIndex` は、[公開catalog](FINANCIAL_INDEX_PUBLICATION.md)で選ばれた候補を実索引と照合し、検査済みのreadOnly snapshotで検索する読取側の入口です。検索結果に公開候補/世代/品質の指紋を付け、利用者が検索ごとに未公開の世代を指定しない形で接続します。

## 読取snapshotをロードする

```ts
import {PublishedFinancialIndex} from "edinet-ts";

const reader = new PublishedFinancialIndex("data/publication.sqlite", "data/financial-index.sqlite");
try {
  const result = reader.screen({
    group: "details", accountingStandard: "J-GAAP", scope: "Consolidated", currency: "JPY",
    period: {startDate: "2025-04-01", endDate: "2026-03-31"}, periodType: "annual"
  }, {metricIds: ["costOfSales"], sortBy: "costOfSales", order: "desc", limit: 100});
  console.log(result.snapshot, result.total, result.rows);
} finally {
  reader.close();
}
```

constructorはcatalogのreadOnlyコピーから現在候補を読み、索引のreadOnlyコピー全体の品質が保存候補と一致することを検査します。公開候補がない場合、任意の最新世代を採用せず失敗します。対象ファイルのパスはconstructor時に絶対パスへ固定します。

検索条件は[通常の財務索引cohort/検索条件](FINANCIAL_SEARCH_INDEX.md)と同じですが、cohortの `generation` は指定できません。検査した候補の世代へ固定します。条件・並び・ページ・診断、欠損/非対応/曖昧/unsafeの扱いは既存SQL検索を再利用します。金額や異なる基準/期間を合算しません。

戻り値は通常の `rows / total / excludedRows / filteredRows / diagnostics / reasonCounts` と、次の `snapshot` です。行が0件の場合も、どの公開snapshotで検索したかを返します。

| field | 内容 |
|---|---|
| `publication` | 検査済み公開候補ID |
| `generation` / `generationSha256` | 固定世代IDと内容指紋 |
| `qualitySha256` | 公開候補が保持する全品質の指紋 |
| `cutoff` | 固定財務世代の観測cutoff |
| `populationCompanies` | 公開候補の宣言母集団数。今回のcohort/条件で返る会社数とは別 |

`snapshot()` で現在の読取metadata、`quality()` でロード時に検査した全品質を確認できます。返したmetadata/品質を呼出元が変更しても内部の候補は変わりません。公開条件そのものはcatalog候補に保持します。この入口が条件を緩めたり、未指定指標の充足を推測したりすることはありません。

## 公開切替と再ロード

別処理がcatalogを新候補へ切り替えても、既存readerは読取中のsnapshotを維持します。`reader.reload()` がcatalogと索引の新しいreadOnlyコピーを開き、候補/全品質を再検査してから読取側を切り替えます。既存snapshotを先に閉じません。

新候補の本文が壊れている、索引がない、候補が実索引と違う等のロード/検査失敗は例外で通知します。この場合は既存の検査済み読取snapshotを維持します。呼出元は失敗を記録して、どのsnapshotを使っているかを確認できます。検査失敗を成功扱いにして別世代へ移しません。

旧公開候補へ復帰した場合も再ロードで取り込みます。新しい未公開世代を同じ索引へ追加しても、それだけではreaderの検索世代を変更しません。読取側の切替は一つの同期呼出し内で行い、その後の検索結果には同じ読取snapshotのmetadataを付けます。

各readerは索引コピーを保持するため、長期稼働では使い終わったreaderを `close()` します。closeは繰返し可能で、close後の検索/確認/再ロードは拒否します。ロード/再ロードは全本文の検査とDBコピーを含むため、リクエストごとに繰り返さず、読取側の起動・世代切替時に使います。自動監視・timer・サービス再起動は別の運用です。

## CLI

```sh
edinet-ts screen-published-financial-index --catalog data/publication.sqlite \
  --db data/financial-index.sqlite --cohort cohort.json --query query.json --pretty
```

cohortは `generation` を含めない比較条件、queryは `metricIds / conditions / sortBy / order / offset / limit` のJSONで、それぞれ2MiB以下です。公開候補・実索引を確認してからJSONを返します。候補なし、不正条件、本文/指紋の不一致は入力内容を表示しないstderrと終了1。0行/値の保留は通常の検索診断として返します。元のcatalog/索引を書き換えません。

## 実データ確認と残工程

前段で確認した限定4社/5実原本/25採用値のcatalogと索引をコピーして確認しました。旧→新→旧の各公開状態で、6 cohort×3条件の計54検索が直接SQL検索・source/builtで一致。読取側は明示reloadまで旧snapshotを保持し、CLIの3出力、metadata/品質の防御的コピー、CommonJS、配布物NodeNext型検査も確認しました。元の検証catalog/索引はbyte不変です。

合成した値10→30の新世代追加/公開切替と旧候補復帰、壊れた新本文・索引ファイル不在でのreload失敗と旧読取継続、公開候補なし、世代の検索条件注入、readOnly・closeも試験しています。実サービスへのロード/再ロードの接続、固定vendor更新、全市場の必要期間/指標の品質と本番運用は残工程です。

独立SQLite/JSON処理でも54検索の公開snapshot/指紋、SQL条件・順序・ページ・projection、切替履歴5件と元artifactのhashが一致しました。全132ファイル/3,630テスト、ビルド、公開型・配布物NodeNext型検査、認証値混入の非表示検査が成功しています。
