# 流動比率で会社を比べる

状態: mainの`b03d4a7`を基準にした確認用Draft PR。未マージ・未リリースです。

流動資産と流動負債を使い、流動比率を計算して会社を絞り込めます。式は**流動資産 ÷ 流動負債**です。流動資産120、流動負債40なら結果は`3`、百分率では300%です。

既存の率指標と同じく、API・JSON・CLIは**小数値で1＝100%、2＝200%**とします。「200%以上」は`value: 2`で指定します。`200`を指定すると20,000%になります。数値は報告された金額に基づく比率です。

既存の金額3項目、主要18指標、従来の21指標検索は変えていません。[用語集](GLOSSARY.md)と[保存ファイルの準備](BALANCE_SHEET_SCREENING.md)も参照してください。

検証の根拠は先行する[実データの確認記録](REAL_DATA_VALIDATION.md)を参照してください。このPRは検証記録の提案を下段とする正式stackの上段として確認します。mainへの取り込みは、GitHubのstack表示・取り込み先を確認して判断してください。

## 1社の比率を確かめる

```ts
import { calculateCurrentRatio, createBalanceSheetSnapshot,
    AccountingStandard, ConsolidationScope } from "edinet-ts";

const snapshot = createBalanceSheetSnapshot(xml, {
    secCode: "1001", docID: "SYNTHETIC1", instant: "2025-03-31",
    scope: ConsolidationScope.Consolidated,
    accountingStandard: AccountingStandard.JGAAP, currency: "JPY"
});
const ratio = calculateCurrentRatio(snapshot);
if (ratio.status === "calculated") {
    console.log(ratio.value); // 表示用の近似値。3なら300%
    console.log(ratio.exact); // 例: { numerator: "3", denominator: "1" }
} else {
    console.log(ratio.reason); // 計算しなかった理由
}
console.log(ratio.inputs); // 流動資産・流動負債の原値、採用元と理由
```

識別子と金額の例は合成データです。利用者が保存XBRLと、書類の会社・会計基準・対象日・範囲の対応を確認してください。企業マスターや提出者情報との自動照合はありません。

## 複数社を検索する

```ts
import { screenBalanceSheetSnapshots, BalanceSheetScreeningMetric,
    ComparisonOperator, SortOrder } from "edinet-ts";

const result = screenBalanceSheetSnapshots(snapshots, {
    conditions: [{ metric: BalanceSheetScreeningMetric.CurrentRatio,
        operator: ComparisonOperator.GreaterThanOrEqual, value: 2 }],
    sortBy: BalanceSheetScreeningMetric.CurrentRatio,
    order: SortOrder.Descending, offset: 0, limit: 20
});
console.log(result.rows.map(row => row.derivedMetrics?.currentRatio));
console.log(result.excludedRows, result.diagnostics);
```

`currentRatio`を条件・並べ替えに使うと、その場で再計算した結果を`rows[].derivedMetrics.currentRatio`へ返します。金額の`selections`は3項目のままです。比率を要求しない検索には`derivedMetrics`を付けません。以前の検索結果を再入力しても、入力に付いていた計算済み値は使いません。

流動比率に必要なのは流動資産と流動負債です。負債合計だけが欠けても比率での検索は続け、欠けた理由は`required: false`で記録します。従来どおり条件・並べ替えを省いた場合は、金額3項目がすべて必要です。

## 端末から使う

保存XBRLの一覧を[既存のmanifest形式](BALANCE_SHEET_SCREENING.md)で用意します。ファイル形式や取得方法は変わりません。

```sh
edinet-ts screen-bs --manifest ./inputs/manifest.json \
  --conditions '[{"metric":"currentRatio","operator":"gte","value":2}]' \
  --sort-by currentRatio --order desc --offset 0 --limit 20 --pretty
```

各社を同じ対象日・連結か単体か・会計基準・通貨に揃えてください。この追加機能も日本基準・円の保存書類が対象で、全市場のデータを集める機能ではありません。入力の整合性は、条件で絞る前に検査します。

## 計算しない場合

| 理由 | 扱い |
|---|---|
| `missing-input` | どちらかの金額が欠損。0で補いません |
| `ambiguous-input` | 候補を一つに決められません |
| `unsupported-input` | 単位・項目等が未対応。元の選択結果に詳しい理由を残します |
| `unsafe-input` | 元の数値を安全にnumberへ往復できません。巨大な入力同士でも計算しません |
| `zero-denominator` | 流動負債が0。無限大にしません |
| `negative-input` | 流動資産または流動負債が負値。比率を作りません。流動資産0・流動負債が正なら比率0は有効です |
| `unsafe-result` | 商が最大安全整数を超える、表示値が非有限、正の商が0へ小さくなりすぎる等 |

会社・対象日・範囲・単位や採用元が矛盾する入力は、未計算の返値ではなく入力エラーです。正当な欠損・重複候補などは理由付きの未計算結果になり、比率を必要とする検索から除外します。金額検索だけなら、従来どおり0や負値を保持します。

検索の`diagnostics`には金額の問題と計算値の問題をそれぞれ残します。`reasonCounts`は従来の4分類のままで、指標ごとの診断件数です。たとえば分子の欠損と比率の未計算は2件の診断になりますが、除外した会社は1社です。

## 精度と境界値

`value`は表示用の近似numberです。一方、`exact`は**報告された十進金額の商**を約分した分数です。元の値は`safeNumber`との十進往復が一致することを検査し、短い十進表現から標準のBigIntで分数を作ります。外部の数値ライブラリは追加していません。

条件判定・並べ替えには分数の交差積を使います。表示値を先に四捨五入してから比べません。JSONの数値条件は、そのnumberの文字列表現が示す十進数として扱います。指数表記も使えます。

- `0.3 ÷ 0.1`は厳密には3なので、`eq 3`に一致します。
- `1 ÷ 3`の表示近似値`0.3333333333333333`は、厳密な1/3とは異なります。その近似値を`eq`条件へ戻しても一致しません。範囲条件を使う際も、この違いを考慮してください。
- numberで同じ表示になった2社でも、分数が異なれば本来の大小順で並べます。同じ分数なら従来の証券コード順です。

分数が正確でも、元の開示金額の精度を高めたわけではありません。百万円単位に丸めた金額から求めた比率には、その元の丸めが残ります。`decimals`は精度で、倍率ではありません。将来の別資料や訂正、物理的な原本の真正性まで、この計算で確認できるわけではありません。

## 確認範囲

合成データで、0・負値・分母0・欠損・曖昧候補・外貨・不安全な数値・極小値・安全整数上限・元情報の混在・閾値境界・同値順・ページ指定・CLI・従来検索の互換性を検証しました。

Node 26.12.1 / npm 12.2.1でbuild、型検査、型の使用例、全528テスト（新規39件）、保存保護のPython 5件が成功しました。独立レビューで、古い計算値を再入力した場合の扱いを修正し、回帰テストを追加しています。lintの設定はありません。

実データでは、エクシオグループとミライト・ワンの2025年・2026年3月末をそれぞれ同じ日付の2社集合にしました。既存XBRLのコピーから計算した4つの比率を、企業公式PDFの流動資産・流動負債の表示値からPython標準の`Fraction`で別に計算した期待値と照合し、約分後の分数が4件とも一致しました。Pythonの`Decimal`（精度60桁）は表示用の参考値に使い、条件の期待値は分数で判定しています。

- [エクシオ2026年有報](https://www.exeo.co.jp/wp-content/uploads/2026/06/yuuhou202603.pdf): 流動資産はPDF85頁、流動負債は86頁（冊子82・83頁）。
- [ミライト・ワン2026年有報](https://contents.xj-storage.jp/xcontents/AS99169/28ca282f/b014/46b2/8e6d/1cd3c175b56d/S100YG40.pdf): 流動資産はPDF86頁、流動負債は87頁（冊子も同じ）。

PDFは百万円表示で、計算は両項目を同じ単位のまま比べています。両時点とも2026年有報の当期・前期比較列を使った、**表示金額から求めた流動比率の確認**です。PDFに掲載された流動比率という別の指標値との一致を主張するものではありません。2025年当時のXBRL原本・全市場・他の基準・元金額の丸め誤差は、この確認の対象外です。

この独立期待値に基づくAPIの条件・並び順64件、ビルド済みCLIの比率条件・並び順・ページ指定8件も成功しました。原本・金額・個別の計算結果と詳細の照合記録はGit管理外に保持しています。新規取得・認証・費用・既存DBの変更・依存追加はありません。
