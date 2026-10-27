# 連続する12か月決算の売上高・営業利益前年比を比べる

状態: 売上高は#38でmain統合済み。この変更で営業利益の別API/CLIを追加します。未リリース。公開CI・統合状態は対応PRを参照してください。

同じ会社の前年と当年の売上高から、`(当年−前年)/前年`を計算します。単位は小数で、`0.2`が20%増、`0`が変化なし、`-0.2`が20%減です。対象はJ-GAAP・JPYの一般事業の売上高と営業利益です。APIと条件IDはそれぞれ独立し、純利益・EPS・配当・CAGRへ一般化しません。既存18指標/21検索、BS3、SQLite形式を変更しません。

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


## 営業利益の前年比を比べる

営業利益は、主な営業活動で得た利益です。ここでは`MetricId.OperatingIncome`の日本基準の直接記載`jppfs_cor:OperatingIncome`を使います。企業独自の似た名前の項目や、セグメント別の利益を合算・代用しません。連結と単体、対象企業、期間、円の単位がそろう条件は売上高と同じです。

```ts
import {
  calculateAnnualOperatingIncomeGrowth, screenAnnualOperatingIncomeGrowth,
  AnnualOperatingIncomeGrowthMetricId, ComparisonOperator, SortOrder,
  type AnnualOperatingIncomePair
} from "edinet-ts";

declare const pair: AnnualOperatingIncomePair;
const result = calculateAnnualOperatingIncomeGrowth(pair);
if (result.status === "calculated") console.log(result.value, result.exact);
else console.log(result.reason);

const found = screenAnnualOperatingIncomeGrowth([pair], {
  conditions: [{ metric: AnnualOperatingIncomeGrowthMetricId.OperatingIncomeGrowth,
    operator: ComparisonOperator.GreaterThanOrEqual, value: 0.2 }],
  order: SortOrder.Descending, offset: 0, limit: 20
});
```

単位は同じ小数比率で、`0.2`が20%増です。前期が正なら当期0は-100%、当期が負なら-100%未満も保持します。**前期が0または赤字なら算出しません。** 赤字から黒字への回復を、通常の成長率として勝手に表現しないためです。欠損・曖昧な値も0にせず、元の選択理由とともに除外します。

入力は上の売上高用pair一覧と同じ形式です。コマンドと条件IDだけを変えます。

```sh
node dist/cli.js screen-operating-income-growth --manifest /tmp/local-growth/pairs.json --conditions '[{"metric":"operatingIncomeGrowth","operator":"gte","value":0.2}]' --order desc --limit 20 --pretty
```

API・CLIの両方で、条件は5演算のAND、順序は正確な分数で比較し、同率は会社コード順です。ページ前件数・除外理由を返します。売上高用の`AnnualGrowthMetricId.NetSalesGrowth`と`screen-sales-growth`は維持し、新しい条件IDを旧APIへ混ぜません。保存JSONの21指標やSQLiteの形式は変更していません。

### 入力と出典の固定

両APIはpair・metadata・period・検索設定を一度取得して固定し、XML文字列も一度取得した同じ値を解析とhashに使います。遅延読込みのgetterが違うXMLを返しても、解析した値と記録したhashが食い違うことを防ぎます。

入力の会社コード・書類ID・会計基準は利用側の宣言です。同じ書類IDでも、渡された2つのXMLが同じbytesである保証はありません。各XMLのhashを個別に返しますが、公式原本との対応や原本真正性の認証にはなりません。

### 営業利益で確認した実データの範囲

保存済み2社の2026年有報にある2025/2026年度の**単体**の4原値を、別のPython ElementTreeで読み取った値・context・企業識別と照合しました。2組の率は独立したPython Fractionと一致し、16通りの条件・順序・ページも一致しました。ビルド済みCLIでも2社の順序・ページを確認し、原本2件は不変でした。

同じ2社の**連結**は両期とも営業利益の候補が複数あるため、2組とも`unavailable-input`として除外しました。候補を勝手に一つ選ぶ規則は追加していません。単体の確認を連結へ一般化しません。

これは2026年有報の前年列を含むXML突合と算術確認です。2025年に別提出されたXBRL原本、今回の営業利益のPDF表示値との独立照合、全市場の充足率は未確認です。実原本・金額・計算結果データをGitへ含めず、新規取得・DB/cache変更もしていません。

追加60件（営業利益API56・CLI4）を含む全1,847テスト、本体/公開API例の型検査、clean build、Python保存保護5件が成功。独立合成1,070確認とビルド済み/CJS1,126確認も成功しました。上の869件は#38当時の検証記録です。


## 追加実装: 親会社株主利益・CAGR・平均資産利益率（2026-10-28）

この作業ツリーで実装した未リリースのAPIです。全体ロードマップ段階3の一部です。計算ROEは[別API](AVERAGE_EQUITY_RETURN.md)、根拠付きEPS/配当は[株式基準付き計算](PER_SHARE_GROWTH.md)で追加しました。自動分割換算とROICは残工程です。

- `calculateAnnualNetIncomeGrowth(pair)` / `screenAnnualNetIncomeGrowth(pairs, options)`は`netIncomeGrowth`の別IDで、既存前年比と同じ連続12暦月・J-GAAP・JPY・正の前年を使います。CLIは`screen-net-income-growth`。
- `calculateCagr(documents, CagrMetricId.NetSales)` / `screenCagr(series, metricId, options)`は売上高・営業利益・親会社株主利益のCAGRです。2〜21件の連続12暦月を明示し、3年なら4原値が必要です。途中の欠損・負値・期間飛びを無視しません。最初の0は不可、最後の0は-100%。
- CAGRの`exact`は`{numerator, denominator, root}`で、算式は`(numerator/denominator)^(1/root)-1`です。無理数を正確な十進数だと扱いません。同じ期間集合の条件は閾値の累乗との分数比較、順序は倍率の分数比較で処理します。`value`は表示用の近似です。
- `calculateAverageAssetsReturn(input, metricId)` / `screenAverageAssetsReturn(inputs, metricId, options)`は、明示した利益÷期首期末平均総資産です。IDは`netIncomeToAverageAssets`/`operatingIncomeToAverageAssets`/`ordinaryIncomeToAverageAssets`。掲載ROA/ROEとは区別します。`input`は`income`（annualのfile内容/metadata）、`opening`/`closing`（instantのXML/metadata）で、期首は開始日前日、期末は終了日を指定します。期首不在を期末だけで補いません。負資産・ゼロ平均・unsafe・企業/期間/scope/基準の混在は理由付きで不可。条件/順序は正確な分数を使います。

CAGR CLI:

```sh
node dist/cli.js screen-cagr --manifest series.json --metric netSalesCagr \
  --conditions '[{"operator":"gte","value":0.1}]' --order desc --limit 20
```

`series.json`は`[[{file,metadata}, ...], ...]`で、各内側配列が1社の古い年度→新しい年度です。最大100社・各2〜21原本、ファイル/合計容量は既存CLIの上限を使います。相対fileはmanifest基準。原本・manifestを変更せず、設定/入力エラーは内容を表示せず終了1です。この節の売上/利益CAGRと平均資産利益率は合成fixtureで確認しており、その実企業でのPDF独立照合は未完了です。EPS/配当の限定実原本照合はリンク先に分けて記録します。
