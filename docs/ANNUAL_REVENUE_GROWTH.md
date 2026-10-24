# 連続する12か月決算の売上高前年比を比べる

状態: #38でmainへ統合済みのAPI/CLIです。未リリース。2026-10-24更新。

同じ会社の前年と当年の売上高から、`(当年−前年)/前年`を計算します。単位は小数で、`0.2`が20%増、`0`が変化なし、`-0.2`が20%減です。今回はJ-GAAP・JPYの一般事業売上高だけで、純利益・EPS・配当・CAGRへ一般化しません。既存18指標/21検索、BS3、SQLite形式を変更しません。

## 比較する期間と原本を明示する

各期間は**月初から12暦月の月末まで**で、前年終了日の翌日が当年開始日である必要があります。例えば4月1日〜翌3月31日、1月1日〜12月31日です。2月末が28日/29日になる閏年も扱います。年度ラベルだけの年差、半年/YTD/単四半期、52/53週決算、変則決算、年度飛びや重なりを推測して合わせません。

会社コード・連結/単体・基準・通貨、採用factのentity（対象企業識別情報）が揃う必要があります。年次分類`annual`も利用側が明示し、さらに期間の形と隣接性を検査します。会社コードと公式原本の対応や、どちらが訂正後かを自動証明する機能ではありません。

同じ有報の当期/前年列でも、別提出原本同士でも、明示した2つの期間を指定できます。書類IDが同じことだけでは拒否しません。保存していない過去の原本や当時公表値を復元したことにはしません。現在の報告書の前年列が組み替えられたかどうかの自動判定もありません。

## 計算する/しないを理由で分ける

`calculateAnnualRevenueGrowth(pair)`は、両原本を既存の厳密な`MetricId.NetSales`選択器で読みます。原値・採用状態/理由・context/単位・出典を`previous`/`current`に保持します。候補の重複を足したり、先頭だけで計算したりしません。

| 理由 | 計算しないケース |
|---|---|
| `unsupported-standard` | J-GAAP以外 |
| `incompatible-metadata` / `incompatible-entity` | 会社や範囲、採用値の対象企業が異なる |
| `not-annual` | 時点値、年次以外の分類 |
| `unsupported-annual-period` | 月初〜12暦月末ではない |
| `non-consecutive-periods` | 年度飛び、逆順、重なり等 |
| `unavailable-input` | 欠損・未対応・曖昧。元選択理由も返す |
| `unsafe-input` | 原値が安全なnumberへ往復できない |
| `zero-base` | 前年0（-0も含む） |
| `negative-base` | 前年が負。符号の解釈を勝手に決めない |
| `unsafe-result` | 表示値が有限・安全上限を満たさない |

`status: "unavailable"`は率0を意味しません。当年0は前年正値なら-100%、当年負値も前年正値なら符号を保持し、-100%未満になる場合があります。金額の符号を反転・絶対値化しません。不正日付・未知フィールド・不正XML等の入力設定エラーは例外です。

採用値の安全な十進表現をBigInt分数へ変換し、差と商を分数で計算します。numberで先に引き算しません。`exact`の分子分母が条件判定・順序の根拠で、表示`value`は近似です。入力の報告精度を高める計算ではありません。

`inputXmlSha256`は**入力XML文字列**をUTF-8として求めたSHA256です。CLIのUTF-8読取/BOM処理後の文字列であり、元ファイルbyte列のハッシュや真正性の証明とは区別してください。

## API

```ts
import { calculateAnnualRevenueGrowth, screenAnnualRevenueGrowth, AnnualGrowthMetricId,
    ComparisonOperator, SortOrder, type AnnualRevenuePair } from "edinet-ts";

declare const pair: AnnualRevenuePair; // previous/currentそれぞれ{ xml, metadata }
const result = calculateAnnualRevenueGrowth(pair);
if (result.status === "calculated") console.log(result.value, result.exact);
else console.log(result.reason, result.previous.selection, result.current.selection);

const found = screenAnnualRevenueGrowth([pair], {
    conditions: [{ metric: AnnualGrowthMetricId.NetSalesGrowth,
        operator: ComparisonOperator.GreaterThanOrEqual, value: 0.2 }],
    order: SortOrder.Descending, offset: 0, limit: 20
});
```

横断検索は企業間の前年/当年の両期間・分類・範囲・基準・通貨を、値による絞り込みの前に検査します。同じ会社の複数pair、別会社への同じ書類IDの再使用を拒否します。最新の組を自動で選びません。

条件はAND、gte/lte/gt/lt/eq。並びは既定降順、同率は会社コード順です。表示値が同じでも異なる分数を区別し、厳密に並べた後にページ指定します。`rows`は計算可能かつ条件一致、`excluded`は計算不可の元選択/出典付き結果、`filteredRows`は計算できても条件不一致、`total`はページ前の一致件数です。`reasonCounts`は計算不可pairの件数です。

## CLI

`screen-sales-growth`へ明示したpair一覧JSONを渡します。相対fileは一覧のフォルダが基準です。次は合成識別子の例で、実企業の金額ではありません。同じ原本の2列を指定する場合は両fileを同じパスにできます。

```json
[
  { "previous": { "file": "previous.xbrl", "metadata": {
      "secCode": "1001", "docID": "SYNTHETIC-PRIOR", "scope": "Consolidated", "accountingStandard": "J-GAAP", "currency": "JPY",
      "periodType": "annual", "period": { "startDate": "2023-04-01", "endDate": "2024-03-31" }
  } }, "current": { "file": "current.xbrl", "metadata": {
      "secCode": "1001", "docID": "SYNTHETIC-CURRENT", "scope": "Consolidated", "accountingStandard": "J-GAAP", "currency": "JPY",
      "periodType": "annual", "period": { "startDate": "2024-04-01", "endDate": "2025-03-31" }
  } } }
]
```

```sh
npm run build
node dist/cli.js screen-sales-growth --manifest /tmp/local-growth/pairs.json --conditions '[{"metric":"netSalesGrowth","operator":"gte","value":0.2}]' --pretty
```

有効な検索はJSONと終了0です。全pairが計算不可でも`excluded`で説明し、率0へ埋めません。入力・企業間の期間混在等はstderrと終了1です。一覧100pair/2MiB、原本1件64MiB・一覧項目ごとの合計256MiBの通常ファイルだけを読み、取得・DB更新はしません。

## 検証と実データで使える範囲

合成fixtureでは、増加/減少/当年0/負数、前年0/負数/unsafe、nil/重複/USD、同docID/単体、閏年/変則/52週/年度飛び、同表示異分数、5演算/順序/page、metadata先行確定、CLIを検証しました。

保存済みエクシオ・ミライトの2026年有報は、当期/前年の売上高に複数候補があり、両pairとも`unavailable-input`、元理由`ambiguous / multiple-facts`を維持しました。重複採用方針は変更していません。この2社で実前年比を算出できたとは報告しません。

別の同梱保存fixture（カカクコム）の2015年4月〜2017年3月の連続2期間では、元XMLの2原fact一致と、独立したPython Fractionの前年比算式一致、27条件/順序を確認しました。これは古い保存fixture内の突合と算術確認で、公式PDFの売上表示値との独立照合ではありません。複数社の計算可能なランキングは合成fixtureの仕様検証です。

実データの重複採用方針、2025年独立提出原本、全市場充足率、52/53週・変則年度対応、純利益/EPS/配当/CAGR/ROA、SQL保存、性能は未検証/別段階です。株式分割調整情報のないEPS/配当を自動計算しません。既存原本・DB・cacheは変更せず、原本・金額をGitへ入れていません。

Node26.12.1で全869テスト（既存821＋新規48）、本体/公開API例の型、build、保存保護Python5件が成功。独立レビュー77件、ビルド済みCLIの算出/除外/不正入力3確認も成功しました。lint設定はありません。
