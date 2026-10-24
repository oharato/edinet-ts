# IFRSの貸借対照表3項目を原記載から読む

状態: 実装・ローカル検証済み（main統合前）。日本基準向けの保存・検索機能とは別の、値を選ぶAPIです。

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

既存のBS3 snapshot、流動比率、条件検索、CLI、差分取り込み、SQLiteは日本基準向けのままです。同じID表記だからといって、IFRSの選択結果をこれらへ混ぜないでください。連結・通貨・基準・期末の整合を保証した検索・保存は後続工程です。

公式2版を基にした合成入力と、IFRS実原本・PDFでの照合は別です。実IFRS原本、途中の全年度・全版、金融業全般、複数社比較、全市場の充足率は未検証です。今回、原本取得や既存DB更新は行いません。


## 検証結果

Node26.12.1/npm12.2.1で全2,116テスト（既存2,007＋追加109）、本体/利用例の型検査、build、保存保護Python5件が成功しました。連結範囲などの設定を一度だけ固定する再現テストを含みます。独立確認はsource142、公開ESM142とCommonJS3の計145確認が成功しました。lint設定はありません。公式タクソノミに基づく合成検証であり、実IFRS原本やPDFの照合完了とは区別します。
