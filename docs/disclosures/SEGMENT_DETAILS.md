# セグメントの直接明細と期間・役割別検索

セグメント表の売上・利益・資産などを、期間と列の役割ごとに読みます。報告セグメント、合計、調整額、財務諸表計上額を分けて検索します。

`extractSegmentDetails`は連結セグメント本文の確認済み表から、原表の各列と直接値を返します。`searchSegmentDetails`/`search-segments`は同一期・同じ列の役割を選んで検索します。`SEGMENT_DETAILS_VERSION`は1です。

## 指標と役割

| 指標ID | 元表の意味 | 期間の扱い |
|---|---|---|
| externalRevenueJPY | 外部顧客への売上高 | duration |
| intersegmentRevenueJPY | セグメント間の内部売上高又は振替高 | duration |
| revenueJPY | 売上高の「計」 | duration |
| profitJPY | セグメント利益又は損失 | duration |
| assetsJPY | セグメント資産 | 宣言期間の期末 |
| depreciationJPY | 減価償却費 | duration |
| assetAdditionsJPY | 有形固定資産及び無形固定資産の増加額 | duration |

元表の見出しから`reported-segment`（報告セグメント）・`reported-total`（記載合計）・`adjustment`（調整額）・`financial-statement-total`（連結財務諸表計上額）を区別します。検索ではroleを必須とし、合計や調整を通常のセグメント件数へ混ぜません。

表示名は元文字列、identityはsource-column-onlyです。名称の一致を年度間・企業間の同じ事業IDと認定しません。

`measurementDefinition: reported-not-normalized`です。セグメント利益を自動で営業利益/EBITDAへ統一しません。測定方法や変更の注記はsourceの本文に保持し、企業間で同じ定義かは別に確認する必要があります。

## 原表の期間と横分割

```ts
import { extractSegmentDetails, searchSegmentDetails, DisclosureTableKind, SegmentMetric } from "edinet-ts";
const period = { startDate: "2025-04-01", endDate: "2026-03-31" };
const document = {
  xml: savedXml,
  selection: { docID: "SAMPLE", kind: DisclosureTableKind.Segments, contextRef: "CurrentYearDuration" },
  accountingStandard: "J-GAAP" as const,
  declarations: [{ period, tableIndexes: [2, 3], rawSha256: reviewedFragmentHash }]
};
const details = extractSegmentDetails(document);
const matches = searchSegmentDetails([document], {
  period, role: "reported-segment",
  conditions: [{ metric: SegmentMetric.ProfitJPY, operator: "gt", value: 1_000_000_000 }],
  sort: { metric: SegmentMetric.ProfitJPY, order: "desc" }
});
```

同じTextBlock/contextに当期と前期の表が含まれます。contextの期間を全表へ付けず、原書類を確認して期間ごとの物理表番号と本文hashを宣言します。

横分割された報告セグメントと集計表は同じ宣言へ入れます。本文hash・表の存在・日付記載・context期間との前後を照合しますが、宣言の意味や日付と個々の表の対応を自動認定したことにはしません。

別の箇所にも同じ日付があるだけでは宣言の正しさは保証されません。

横分割の対応は行番号ではなく、認識した項目名ごとに行います。ある表にない行を別表から複製しません。1つの表を二重に割り当てたり、同じ期間を別宣言で重ねたりする入力は拒否します。同一グループ内の同じ集計役割/同じ正規化見出しの二重採用も診断して、その期の列を採用しません。未確認の表はnot-reviewed、未知のレイアウト/単位は不採用理由を残します。

対象は専用の連結セグメントタグ、J-GAAPの確認済み宣言、正しいduration・無次元のcontext、[本文表API](DISCLOSURE_TABLES.md)の対応namespace/構造だけです。企業拡張次元、IFRS/US、単体の表、全表形式への対応は保証しません。

## 値と出典

- 元のXML hash/本文hash、タグ・context・提出者entity・次元出典、本文と全物理セルをsourceに保持します。各列は表番号/列番号/見出しセルを、各値は元金額のセル番号/rawを持ちます。
- 百万円の単位を宣言グループ内で確認し、十進文字列で円へ換算します。横分割の片側に単位がない場合も、確認した同一グループの単位だけを使います。別グループ/別の表から単位を拾って補いません。
- セグメントだけは`△`/ASCII `-`/Unicode `−`による負数を明示採用し、元表記を保持。既存の設備/主要顧客の非負数規則は変更しません。
- 合計・調整・財務諸表計上額も直接記載値です。内訳を足して作ったり、丸め差を消すよう合計を上書きしたりしません。円への単位換算で元表示の丸めを復元もしません。
- 行不在はrow-absent、ダッシュ/空欄はそれぞれ非数値、同じ項目の複数行はambiguous-rowで全候補を保持。数値が複数行/列に結合されていればmerged-data-cellとし、各列へ重複計上しません。未対応の行はunrecognized-rowで残します。

## 検索とCLI

期間と役割を必須にし、指標の5演算AND条件・表示名の文字列部分一致・金額順・offset/limitを扱います。条件は円単位。

十進分数で厳密比較し、同値はdocID/contextRef/元表の列順です。役割外はfiltered、該当役割で数値条件/順序に必要な値が不採用ならexcludedです。

本文や表グループ自体の不採用はextractionsの状態/diagnosticsに残します。0件を「該当事業なし」とは解釈しません。

```sh
edinet-ts search-segments --manifest files.json \
  --start 2025-04-01 --end 2026-03-31 --role reported-segment \
  --conditions '[{"metric":"profitJPY","operator":"gt","value":1000000000}]' \
  --sort-by profitJPY --order desc --pretty
```

manifestはfile/selection/accountingStandard/declarationsの配列。fileはmanifestからの相対パスです。原本/提出者の重複、対象期間を持たない入力、過剰件数を検索前に拒否し、訂正系列の原本選択は先に行います。knownAtや当時の開示範囲の自動判定、名称/事業構成変更の自動追跡とは別です。

最大100原本/合計256MiB、1原本100期間宣言・1期間20物理表、検索全体100,000物理セル/10,000列、条件100件/ページ1,000件。追加の通信・DB更新・外部有料データ取得はありません。

## 実原本による限定確認

> 以下は各検証を実施した時点の記録です。件数・配布先・未確認範囲を含めて読み、現在の稼働状態とは分けてください。

既存エクシオ/ミライトの2025/2026年4原本から、8期間・68列（報告セグメントと集計役割を含む）を確認しました。7指標476選択は数値368/ダッシュ60/行不在48。元XMLの本文hash・行名・セル参照と独立照合しています。

4PDFの8ページを画像で確認し、PDF表示行から独立に読み取った全368数値と円換算、60ダッシュ、48行不在が一致しました。対象はエクシオ2025年119/120、2026年122/123、ミライト2025年125/126、2026年123/124ページです。

16の負数も原値を保持し、丸め差のある合計を再計算していません。2年度×4役割の8検索の結果・順序・除外も独立期待値と一致しました。

未完了: 期間・分割表関係の自動認定、全表形式/業種、企業拡張タグの直接次元/DTS解決、測定定義/事業構成変更の自動比較、DB索引、全市場品質。これらと受注/関係会社等の残工程を続け、全体ロードマップの完了とは区別します。

最終確認: Node 26.12.1で全89ファイル・2,881テスト（1ワーカー）、公開API型検査、buildに成功。source/公開buildの全8期68列JSONが同等、実2社の公開CLI/API検索JSONも同等。公開CJSのAPI/版番号も確認済みです。
