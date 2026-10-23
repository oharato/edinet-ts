# 指標辞書と厳密なfact選択

`METRIC_REGISTRY` と `EdinetXbrlObject.selectMetric()` は主要18指標のための追加APIです。
既存 `getKeyMetrics()` / `getKeyMetricsWithSources()` の選択順・fallback・number返値は維持しています。
この追加APIをscreeningへ自動適用する変更は含みません。

## 利用例

```ts
import { EdinetXbrlParser, METRIC_REGISTRY, MetricId, AccountingStandard, ConsolidationScope } from "edinet-ts";

const object = new EdinetXbrlParser().parse(xml);
const result = object.selectMetric(MetricId.NetSales, {
    accountingStandard: AccountingStandard.JGAAP,
    scope: ConsolidationScope.Consolidated,
    period: { startDate: "2024-04-01", endDate: "2025-03-31" }
});
if (result.status === "selected") {
    console.log(result.raw);        // 例: "123.4500"（decimal原値）
    console.log(result.safeNumber); // 例: 123.45。精度を失う場合はundefined
    console.log(result.source);    // namespace/context/period/dimensions/unit/decimals
}
console.log(result.reason, result.evidence);
console.log(METRIC_REGISTRY.netSales);
```

`MetricId.NetSales`・`AccountingStandard.JGAAP` は、値の補完とタイプミス検出に使える定数です。同名の `MetricId`・`AccountingStandard` 型もexportしています。従来の `"netSales"`・`"J-GAAP"` も同じ文字列union型で使えます。`ConsolidationScope.Consolidated` / `.NonConsolidated`も利用できます。JSONの値や指標IDは変わりません。[他の入力定数と直書きの調査結果](TYPED_OPTIONS.md)も参照してください。`test/types/metric-selection.ts` で正常例と誤字の型エラーを固定し、CIでも型検査します。

会計基準は**呼出元が元書類で確認した宣言**です。DEIからの自動判定・宣言の照合は未実装です。
単体は `scope: ConsolidationScope.NonConsolidated`、時点指標は `period: { instant: "2025-03-31" }` を明示します。
期間は開始日と終了日の両方を照合するため、終了日が同じ半期と通年を混ぜません。
年次・YTD・単四半期の自動分類、最新年度の推測、過去の訂正書類選択は行いません。

## 指標辞書の契約

安定IDは `keyof KeyMetrics` と同じ18項目です。辞書versionは `METRIC_REGISTRY_VERSION`（現在 `"1"`）。
各定義はID、decimal型、単位、instant/duration、会計基準別候補タグと対応可否、fallback方針を持ちます。
配列・定義・辞書はfreezeしています。既存の候補タグから独立実装したもので、外部ライブラリのmappingは取り込んでいません。

| 単位 | 指標 |
|---|---|
| JPY | 売上高、営業利益、経常利益、純利益、純資産、総資産、営業/投資/財務CF、現金同等物 |
| JPY/share | EPS、BPS、1株配当 |
| shares | 発行済株式数 |
| pure | 自己資本比率、ROE、PER、配当性向 |

比率はXBRLの `xbrli:pure` のraw値を採用し、百分率への変換や100倍/100分の1の補正を行いません。
JPY/shareは単一JPY分子と単一shares分母のdivideだけを扱います。他の複合単位、外貨換算、scale推測は未対応です。
IFRSの純資産/BPS候補は親会社持分との意味差の精査が残るため `unsupported-semantics` とします。
US-GAAPと企業拡張タグの対応は未実装です。銀行・保険専用タグを一般事業会社タグへ推測対応しません。

候補タグの順序は辞書の配列で定義します。指定基準・期間・scopeに適合する最初の候補で判定を終えます。
**後続候補との値の照合や、不採用理由の網羅的監査ではありません。** `evidence` は探索時点までのfactと理由です。
上位候補のnil・未知単位・精度属性不正・曖昧さを、下位候補で黙って補いません。
連結→単体、期間、通貨、会計基準、namespaceをまたぐfallbackは行いません。

## 結果と理由

| status | 意味と主なreason |
|---|---|
| selected | `selected` または `selected-raw-only`。原値と採用元を返す |
| missing | `tag-absent`、`context-mismatch`、`nil`。0で補わない |
| unsupported | `unsupported-standard`、`unsupported-semantics`、`unknown-namespace`、`unknown-context`、`unsupported-context`、`unsupported-entity`、`unsupported-dimensions`、`unsupported-unit`、`invalid-period`、`invalid-decimal`、`invalid-decimals`、`raw-unavailable` |
| ambiguous | `duplicate-context`、`multiple-facts`。XML内の順序で値を決めない |

`selected` 以外ではraw/numberを結果の採用値として公開しません。未採用factの原値は `evidence` に残ります。
`selected` でも巨大整数やdecimalの精度を保てない値では `safeNumber` がありません。
同じcontext IDの重複は同値でも曖昧です。同じ期間・scopeの別context IDや同一context内に複数の適合factがある場合も曖昧です。
明細次元のfactは全社合計の候補から除外して理由を残し、全社値があればそちらを採用します。

採用元/証跡は元キー、namespace prefix/URI、contextRef、entity identifier/scheme、period、scope、dimensionsと元scenario/segment、unitRef/解決単位、raw、decimals、nil、reasonを持ちます。
単位ID重複やunit/measure内の未知xbrli URIは単位未対応とします。単体次元は公式jppfs URIの `ConsolidatedOrNonConsolidatedAxis` / `NonConsolidatedMember` の対だけを採用します。context定義の欠落、typed dimension、不明scenario、context内の局所namespace再定義も保守的に拒否します。
標準prefixと公式EDINET taxonomy URIの形式を照合しますが、全taxonomy年度で意味・充足率を検証した保証ではありません。
別prefixのtaxonomyタグは現段階で標準タグの代用にしません。

## 原値とnumber

パーサーの `parseTagValue: false` により、`EdinetData.rawValue` にdecimalのテキストを保存します。
`rawDecimals` は `INF`・負数等の属性表記、`nil` はXML Schema-instance URIに基づいたtrue/1を保持します。
`value` も文字列であり、早期number変換による巨大整数の丸めを避けます。XMLパーサーの通常の空白trim・entity展開後の値であり、元XMLのバイト列の保存ではありません。
旧コンストラクター引数は維持していますが、raw/namespaceのない手動 `put()` データを厳密APIは推測して採用しません。

`toSafeMetricNumber()` はdecimal構文、有限値、安全整数の絶対値範囲、number→decimal文字列の往復一致を検査します。
`0.1` などの二進浮動小数点での**完全な表現や演算結果の厳密性を保証しません**。正確なdecimal演算にはrawを利用してください。
`9007199254740993`、`0.10000000000000001` 等をnumberで返さず、指数表記・桁区切り・非数はdecimalとして採用しません。
`decimals` は来歴であり値の倍率ではありません。欠落はundefinedのまま保持し、精度を推測しません。

## 検証の範囲

合成fixtureで18指標の単位/期間型、J-GAAP/限定IFRS/未対応US、entity不明/混在・scheme差、period構造の混在/重複、nil/0、巨大整数・高精度decimal、重複context/fact/unit、外貨、単体、明細/typed dimension、不明namespace、不正日付、同日終了の半期と通年を検証します。
同梱カカクコムXBRLの売上を旧APIと照合しています。外部取得・認証・新依存はありません。
これはP0の小さな基盤であり、全市場充足率、銀行/保険、全IFRS対応、基準自動判定、訂正履歴、元書類照合の全領域を完了した意味ではありません。
