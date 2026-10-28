# 所有者別状況の分類・単元数・株数

`extractShareholderCategories`は所有者別状況の確認済み表から、分類別の株主数・所有単元数・記載割合と、単元未満株式数を返します。`searchShareholderCategories`と`search-shareholder-categories` CLIで、同じ基準日の特定分類・指標を検索します。`SHAREHOLDER_CATEGORIES_VERSION`は1です。

## 入力・基準日・対象

```ts
import { DisclosureTableKind, ShareholderCategory, ShareholderCategoryMetric,
  extractShareholderCategories, searchShareholderCategories } from "edinet-ts";
const document = {
  xml: savedXml,
  selection: { docID: "SAMPLE", kind: DisclosureTableKind.ShareholderCategories, contextRef: "FilingDateInstant" },
  declarations: [{ tableIndex: reviewedTableIndex, asOf: "2026-03-31", rawSha256: reviewedFragmentHash }]
};
const detail = extractShareholderCategories(document);
const matches = searchShareholderCategories([document], {
  asOf: "2026-03-31", category: ShareholderCategory.ForeignNonIndividuals,
  metric: ShareholderCategoryMetric.OwnershipPercent,
  condition: { operator: "gte", value: 10 }, sort: "value-desc"
});
```

`ShareholdingByShareholderCategoryTextBlock`だけを対象とし、確認済み表位置・基準日・本文全体のhashを宣言します。[本文表API](DISCLOSURE_TABLES.md)と同じ元XML/本文hash、物理セル、context/entity/次元証跡を保持します。本文参照の一致は人が確認した意味の自動認証ではありません。会計基準による財務科目変換はなく、DEIから基準日や種類株式を補完しません。

表の3段見出しより前の日付セル、または物理表が一つの場合の表外本文から西暦の「N年N月N日現在」を読み、宣言基準日と照合します。提出日contextは次元のないinstantで、基準日より前なら採用しません。データセル内の日付は表全体の基準日の根拠へ使いません。複数表の表外日付を各表へ推測で対応付けることもしません。asOfEvidenceは正規化した日付表示と根拠の種類、表内の場合は元セル位置/表示を持ちます。

`disclosureKind: shareholder-category-text-block`は対象factの種類です。書類種別を自動認定した値ではないため、有報だけに限定する場合は呼出側で書類メタデータを選択します。有報の大株主表や大量保有報告の保有者とは合流しません。

## 分類・単位と分母

| 分類ID | 原表の分類 | role |
|---|---|---|
| government | 政府及び地方公共団体 | category |
| financial-institutions | 金融機関 | category |
| financial-instruments-firms | 金融商品取引業者 | category |
| other-corporations | その他の法人 | category |
| foreign-non-individuals | 外国法人等／個人以外 | category |
| foreign-individuals | 外国法人等／個人 | category |
| individuals-and-others | 個人その他 | category |
| reported-total | 計 | reported-total |
| odd-lots | 単元未満株式の状況 | odd-lots |

10列・3段見出し・株主数/所有株式数/割合の3データ行を対象とします。見出しの結合範囲、階層と列順、単元/株/人/％の単位を照合します。先頭に基準日の行がある表と、日付が表外にある表に対応します。未知の分類/単位/書式、結合された数値セル、余分なデータ行等は理由を返して採用しません。

各entryのheadersは原表の見出しセル参照です。「外国法人等」の親見出しと「個人以外/個人」の子見出しを両方保持し、外国の個人を個人以外へ合算しません。合計は原表のまま保持し、分類値と合計を足しません。

| metric | 単位・内容 |
|---|---|
| shareholderCount | persons。原表の株主数 |
| ownedLots | lots。原表の所有単元数 |
| ownedShares | shares。分類別単元数×原表の1単元株式数。単元未満欄は原表の株数そのもの |
| ownershipPercent | percent。原表の所有株式数の割合（10＝10％） |

sharesPerLotは見出しの1単元株式数を保持します。分類別の株数換算は整数演算で行い、元単元数と単元株式数のセル参照/算式を残します。安全に表現できる場合だけsafeNumberも付けます。100株以外も同じ算式を使い、単元未満の株数をさらに100倍することはありません。

割合の分母は`reported-whole-lot-total`として表内の「計」の所有単元数セルを参照します。単元未満株式を含む発行済株式総数や、自己株式を除く大株主表の分母へ変更しません。記載割合と丸め差を保持し、人数/単元数から割合を再計算しません。

空欄・ダッシュ・非対応数値は0へ置換しません。人数/単元数/株数は非負の整数表示に限定し、小数や注釈、内側の空白、全角数字を勝手に変換しません。割合は0〜100の単独数値のみを採用します。単元数が不明なら換算株数も不明とします。単元未満欄は株数だけを値にし、人数・単元数・割合は`missing/not-applicable-to-odd-lots`です。元のダッシュを含む全セルはsourceにも残ります。

自己株式、証券保管振替機構名義、信託口の扱いは原注記を保持し、分類や分母から自動で控除しません。登録名義と実質保有者の同定は別工程です。種類株式との同一性は`shareClassIdentification: not-established`です。tableIndexごとに別グループとして返し、複数表を全社の普通株式として合算しません。

## 検索・CLI・上限

asOf/category/metricが必須で、conditionは選択指標の単位です。異なる単元株式数の表を株数で比べる場合はownedSharesを選びます。比較/並べ替えは正確な分数を使い、同額は書類ID順/原表順を維持します。数値不明と適用外はexcludedに理由を残し、基準日/分類/条件外はfilteredへ分けます。matchedはページ適用前の記載数であり、企業数や株主の実人数を合計した値ではありません。

```sh
node dist/cli.js search-shareholder-categories --manifest manifest.json \
  --as-of 2026-03-31 --category foreign-non-individuals --metric ownershipPercent \
  --condition '{"operator":"gte","value":10}' --sort value-desc
```

manifestはfile/selection/declarationsの配列で、fileはmanifestの所在から解決します。APIは100原本/256MiB/100,000物理セル/10,000記載、各原本は100宣言まで。表の重複宣言、原本重複、同一提出者の重複を拒否し、訂正系列は先に選びます。offsetは0以上、limitは既定100/最大1,000です。CLIは共通読取り上限を使い、失敗入力はログへ表示しません。通信や既存DBの変更はありません。

## 確認範囲と残工程

既存のエクシオ/ミライト各2025・2026年提出原本と、弘電社/ピーエス・コンストラクション/若築建設の2026年提出原本、計7原本を使用しました。分類49・原表合計7・単元未満7の計63記載で、原XMLの175値セル・77見出し参照、直接157数値・18ダッシュと50件の株数換算を独立処理で照合しました。PDF7ページでも全157数値・18ダッシュ、単元未満の適用外表示14件、7基準日/7単元株式数が一致しました。画像で分類・単位・分母の表を確認し、2年度×4条件の8検索の結果・順序・除外も独立期待値と一致しました。今回の調査は保存済みデータだけを使い、新規通信/費用は発生していません。

全書式/和暦、種類株式の同定、実質保有者、割合分母の他表との自動照合、有報大株主/大量保有報告の明細、政策保有、役員/報酬、永続索引などは未完了です。固定配布物e673e8aへの最終反映も別工程です。全体計画6bの完了とはしません。

追加後の検証: 全95ファイル・3,046テスト（Node26.12.1/1ワーカー）、公開API型検査、build成功。source/buildの実7原本63記載のJSONは同等で、表外本文7件も独立XML処理と一致。5社の政府分類の人数条件で公開CLI/APIの採用1件・ダッシュ除外4件を含む全JSONが一致し、公開CJSの関数/定数も確認しました。
