# IFRSの貸借対照表3項目を原記載から読む

状態: 専用抽出APIは#55でmainへ統合し、取り込み後CIも成功しました。本変更でIFRS専用のメモリ検索とCLIを追加します。DB保存とは別です。

IFRS（国際財務報告基準）の連結書類から、流動資産・流動負債・負債合計の直接記載を読みます。内訳を合算したり、負債合計から差し引いて流動負債を推定したりしません。候補が欠ける場合は0で埋めず、同じ対象に複数候補がある場合も勝手に一つへ決めません。

## 読む項目と根拠

| 定数 / ID | 正式なタグ |
|---|---|
| `IfrsBalanceSheetMetricId.CurrentAssets` / `currentAssets` | `jpigp_cor:CurrentAssetsIFRS` |
| `IfrsBalanceSheetMetricId.CurrentLiabilities` / `currentLiabilities` | `jpigp_cor:TotalCurrentLiabilitiesIFRS` |
| `IfrsBalanceSheetMetricId.TotalLiabilities` / `totalLiabilities` | `jpigp_cor:LiabilitiesIFRS` |

金融庁の[2018年公開資料](https://www.fsa.go.jp/search/20180316.html)の本体タクソノミと、[2026年版の公式本体ZIP](https://www.fsa.go.jp/search/20251111/1c_Taxonomy.zip)に含まれる、2018-03-31版・2025-11-01版のXSDを確認しました。3項目は金額型・期末の値・数値を持つ項目として定義されています。`CurrentLiabilitiesIFRS`という推測した別名は使いません。

流動区分は単に「1年以内」という意味だけではありません。通常の営業循環や表示方式も関係します。[IFRS財団のIAS 1／IFRS 18対照資料](https://www.ifrs.org/content/dam/ifrs/project/primary-financial-statements/ifrs-standard/reference-material-for-ifrs18.pdf)の19–21ページを参照できます。このAPIは会社の区分を再計算せず、指定した直接タグだけを選びます。流動性順の表示などで該当項目がない場合も補完しません。

## API

```ts
import { EdinetXbrlParser, IfrsBalanceSheetMetricId,
    AccountingStandard, ConsolidationScope } from "edinet-ts";

const object = new EdinetXbrlParser().parse(xml, "SYNTHETIC-IFRS");
const result = object.selectIfrsBalanceSheetMetric(
    IfrsBalanceSheetMetricId.TotalLiabilities,
    {
        accountingStandard: AccountingStandard.IFRS,
        scope: ConsolidationScope.Consolidated,
        period: { instant: "2025-03-31" }
    }
);
if (result.status === "selected") console.log(result.raw, result.source);
```

書類IDと期末は合成例です。会計基準は利用者が元書類で確認して指定します。タグの存在だけで、その書類の基準を推定しません。対象は連結・指定期末の値・JPYです。通貨を指定する引数はなく、原本の単位が`iso4217:JPY`であることを確認します。外貨換算はしません。

原文字列、採用状態、採用できない理由、タグ・名前空間・context・entity・単位・decimals等の出典を返します。`safeNumber`は安全に数値へ変換できる場合だけ付きます。巨大な整数や精度を失う数値も、原文字列を失わず扱います。nil、不在、0、曖昧な候補を区別します。

専用辞書`IFRS_BALANCE_SHEET_REGISTRY`の版は`"1"`です。名前空間は正規の`jpigp` URIと日付を確認し、2018-03-31より前の版や旧`ifrs-full`、企業独自タグを代用しません。日付の形式を認めることは、その年の全タクソノミに対する検証済みという意味ではありません。

IFRS以外は`unsupported-standard`、単体など連結以外は`unsupported-semantics`を返し、その入口では候補を選びません。J-GAAPの既存3項目の辞書・版・返却契約は変更しません。

## 今回は含めないもの

既存のBS3 snapshot、流動比率、差分取り込み、SQLiteは日本基準向けのままです。同じID表記だからといって、IFRSの選択結果をこれらへ混ぜないでください。IFRSのメモリ検索は下の専用APIを使います。IFRSの保存・比率計算は後続工程です。

公式2版を基にした合成入力と、IFRS実原本・PDFでの照合は別です。実IFRS原本、途中の全年度・全版、金融業全般、実複数社での比較、全市場の充足率は未検証です。今回、原本取得や既存DB更新は行いません。


## 検証結果

Node26.12.1/npm12.2.1で全2,116テスト（既存2,007＋追加109）、本体/利用例の型検査、build、保存保護Python5件が成功しました。連結範囲などの設定を一度だけ固定する再現テストを含みます。独立確認はsource142、公開ESM142とCommonJS3の計145確認が成功しました。lint設定はありません。公式タクソノミに基づく合成検証であり、実IFRS原本やPDFの照合完了とは区別します。


## 同じ期末のIFRS企業を読み比べる

`createIfrsBalanceSheetSnapshot()`は原文字列・3項目の採用状態・metadataと、解析したXML文字列のSHA-256を返します。SHA-256は入力が同じかを確認する印であり、原本の真正性や申告した会社・書類番号との対応を証明するものではありません。

`screenIfrsBalanceSheetDocuments()`は、明示した原本集合だけをメモリ上で検索します。IFRS専用metadataを使い、日本基準の型へ置き換えません。

```ts
import { screenIfrsBalanceSheetDocuments, IfrsBalanceSheetMetricId,
    ComparisonOperator, SortOrder } from "edinet-ts";

const base = { instant: "2025-03-31", scope: "Consolidated" as const,
    accountingStandard: "IFRS" as const, currency: "JPY" as const };
const result = screenIfrsBalanceSheetDocuments([
    { xml: xmlA, metadata: { ...base, secCode: "1001", docID: "SYNTHETIC-A" } },
    { xml: xmlB, metadata: { ...base, secCode: "1002", docID: "SYNTHETIC-B" } }
], {
    conditions: [{ metric: IfrsBalanceSheetMetricId.CurrentAssets,
        operator: ComparisonOperator.GreaterThanOrEqual, value: 1000 }],
    sortBy: IfrsBalanceSheetMetricId.CurrentAssets,
    order: SortOrder.Descending, offset: 0, limit: 20
});
```

会社コード・書類番号・金額は合成例です。`xmlA`と`xmlB`にはそれぞれの会社の原本を渡します。4桁の証券コードは既存の検索と同様、末尾0を付けた5桁にそろえます。基準・連結範囲・通貨・期末は呼出側の宣言で、元書類で確認してください。

- 条件はAND、`gte/lte/gt/lt/eq`の5種類。指定項目の昇順・降順、同値時の会社コード/書類番号順、ページ指定に対応します。
- 条件と並べ替えがなければ3項目すべてを必要とします。指定があれば、使った項目だけが必須です。未使用項目の欠損は診断に残しても行を除外しません。
- 必要項目が欠損・非対応・曖昧・不安全な数値なら除外し、0では埋めません。0や負数の直接記載は絶対値化せず保ちます。safeNumberが付く値だけを検索に使います。
- `total`はページ指定前の一致数、`excludedRows`は必要な数値が使えない行数、`filteredRows`は条件不一致の行数です。`reasonCounts`は項目ごとの診断件数なので、除外行数とは異なります。
- 期末の混在、IFRS以外、単体、JPY以外、同じ会社/書類の複数指定、同じentityを別会社コードに使う入力は、絞り込み前に拒否します。最新書類を代わりに選びません。

原本と検索条件は各100件以下です。性能保証や全市場DBではありません。外部で作ったsnapshotを受け入れて検索する機能、原本の自動取得、訂正後の選択、流動比率、SQL保存は含めません。

### CLIの入力

```json
[
  { "file": "company-a.xbrl", "metadata": {
      "secCode": "1001", "docID": "SYNTHETIC-A", "instant": "2025-03-31",
      "scope": "Consolidated", "accountingStandard": "IFRS", "currency": "JPY"
  } }
]
```

```sh
node dist/cli.js screen-ifrs-bs --manifest /tmp/local-ifrs/files.json --sort-by currentAssets --order desc --limit 20 --pretty
```

相対fileは一覧JSONの場所を基準にします。一覧100件/2MiB、原本1件64MiB/合計256MiB、厳密なUTF-8と通常ファイルへの解決を要求します。シンボリックリンクを一律に拒否する機能ではありません。原本のUTF-8 BOMは落とさずに解析・hashへ渡します。APIのhashは渡されたXML文字列のUTF-8表現で、呼出側が先に文字列を加工した場合は加工後の印です。

成功はJSONと終了0、入力不正は元内容を転載しない定型stderrと終了1です。終了0でも除外理由を確認してください。原本・既存DB・キャッシュは変更しません。実IFRS原本の取得や照合は行っていないため、この検索の確認も合成入力による仕様検証です。

### 検索の確認結果

Node26.12.1/npm12.2.1で全2,194テスト（既存2,116＋API71＋CLI7）、本体と利用例の型検査、build、保存保護Python5件が成功しました。独立source522確認と入力固定等8確認、公開ESM/CJS各533確認（計1,066）、built CLI8確認も成功しています。UTF-8 BOMを含む解析用hashと入力不変を確認しました。これらは合成入力の結果で、実IFRS原本・PDFとの照合や性能測定の結果ではありません。lint設定はありません。
