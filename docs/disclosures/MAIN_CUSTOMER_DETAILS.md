# 主要顧客の記載明細と逆引き

主要顧客表から顧客名・売上高・関連セグメントを取り出します。検索結果は原表の記載単位であり、重複を除いた法人一覧ではありません。

`extractMainCustomerDetails`は`InformationForEachOfMainCustomersTextBlock`の確認済み3列表を、顧客名・売上高・関連セグメントの記載単位で返します。`searchMainCustomerDetails`と`search-main-customers` CLIで、同じ対象期間・連単の明示原本集合を検索できます。

`MAIN_CUSTOMER_DETAILS_VERSION`は1です。

## 入力と出典

```ts
import { extractMainCustomerDetails, searchMainCustomerDetails, DisclosureTableKind } from "edinet-ts";
const document = {
  xml: savedXml,
  selection: { docID: "SAMPLE", kind: DisclosureTableKind.MainCustomers, contextRef: "CurrentYearDuration" },
  accountingStandard: "J-GAAP" as const,
  scope: "Consolidated" as const,
  proof: { rawSha256: reviewedFragmentHash }
};
const detail = extractMainCustomerDetails(document);
const matches = searchMainCustomerDetails([document], {
  period: { startDate: "2025-04-01", endDate: "2026-03-31" }, scope: "Consolidated",
  customerContains: "顧客名", revenue: { operator: "gte", value: 60_000_000_000 }, sort: "revenue-desc"
});
```

原表を読んで単位・基準・連単を確認し、[本文表API](DISCLOSURE_TABLES.md)の本文hashをproofに指定します。hashの原本内参照を検査し、基準/範囲の宣言を返します。

hash照合は宣言の意味の自動認証ではありません。J-GAAP、正しいduration、連結は無次元、単体は正式なNonConsolidatedMemberだけです。

企業拡張の軸・不明次元・IFRS/USは採用しません。

sourceにはXML hash、本文/raw hash、タグ/namespace、contextの期間・提出者entity・次元出典、元セルとgridを保持します。顧客の名前は提出者entityとは別です。

`identity: unresolved`であり、名称/旧名注記を勝手に法人IDへ置換しません。本文contextの期間と、検索対象期間が異なれば混在エラーにします。

knownAtや訂正原本の選択は別工程です。

## 記載単位と金額

- 顧客名セルと売上高セルの結合範囲が一致するとき、複数のセグメント行を1記載に結び付けます。売上高は1回だけ保持し、セグメント数を掛けません。同じセル内の複数行は原文字列として保持します。
- 結合の範囲がずれる場合は`ambiguous-row-association`。金額を各顧客やセグメントに配賦したり、複数値を合算したりしません。合計/小計の行も顧客として採用せずdiagnosticsに残します。
- 同名/同値でも物理記載が別なら別記載です。法人が同じことも別なことも推定しません。検索件数は「顧客記載数」であり、異なる法人の数や全取引先数ではありません。
- 単位表示は百万円に限定し、非負の単独十進値を正確な円文字列に換算。raw/multiplierを残し、安全な場合だけsafeNumberを付けます。丸めを復元するものではありません。ダッシュ・空欄・括弧付き/複数値・負数・不正桁区切りは非数値のまま保持し、0を補いません。

主要顧客の開示表はすべての顧客を網羅する一覧ではありません。顧客別売上比率の分母、企業間のグループ合算、取引関係の時系列、法人同定、顧客別売上の永続索引は別の残工程です。

## 検索とCLI

顧客名/セグメント名の文字列部分一致、売上高の5演算と昇降順、offset/limitを扱います。文字列を正規表現や法人名の正規化として扱いません。

数値条件/順序で使う金額が非数値ならexcluded、条件外ならfiltered。名前だけの検索ではダッシュの記載も残します。

元本文/表の不採用はextractionsの状態/diagnosticsにあります。0件を「主要顧客なし」と断定しません。

```sh
edinet-ts search-main-customers --manifest files.json \
  --start 2025-04-01 --end 2026-03-31 --scope Consolidated \
  --customer-contains 顧客名 --revenue '{"operator":"gte","value":60000000000}' \
  --sort revenue-desc --pretty
```

manifestは`file/selection/accountingStandard/scope/proof`の配列で、fileはmanifest基準の相対パスです。CLIの失敗時は入力内容を表示しません。通信やDB更新はしません。

100原本・合計256MiB、本文表の既存上限、検索全体100,000物理セル/10,000記載、ページ最大1,000件。重複原本・同一提出者の複数原本・期間/連単混在を検索前に拒否します。訂正系列を先に選択してください。同値順はdocID/contextRef/原表順です。

## 実原本による限定確認

> 以下は各検証を実施した時点の記録です。件数・配布先・未確認範囲を含めて読み、現在の稼働状態とは分けてください。

保存済みのエクシオ/ミライト、2025/2026年提出の4原本・8本文（当期/前期）を通信なしで読み、顧客記載20件・関連セグメント64物理セルを確認しました。4PDFの計8ページ（エクシオ2025年120/121、2026年123/124、ミライト2025年127/128、2026年125/126）を画像で読み、20原金額と円換算が独立転記/Decimal処理と一致しました。

原XMLのcontext・本文hash・結合範囲、4検索の結果/金額順も独立処理で一致しています。

確認済みの表形式と原本に限る結果です。全業種/全年度の表記、外国基準、全市場の充足率・速度優位・法人名寄せは未検証/未実装です。元計画6aの主要顧客モデルの追加であり、セグメント全体・受注・関係会社までの完成とはしません。

最終検証: Node 26.12.1で全87ファイル・2,840テスト（1ワーカー）、公開API型検査、buildに成功。全20記載のsource/公開buildのJSONと、実2社の公開CLI/API検索JSONが一致。公開CJSの入口と版番号も確認しました。
