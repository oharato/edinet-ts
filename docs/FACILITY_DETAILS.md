# 設備表の直接明細と条件検索

`extractFacilityDetails`は[本文表の抽出](DISCLOSURE_TABLES.md)を使い、確認した9/11/12列・3段見出しの設備表から、合計簿価・土地簿価・建物及び構築物簿価・土地面積を読みます。versionは`FACILITY_DETAILS_VERSION = "1"`。認識できない列配置/見出し/単位を推測で補いません。

## 明示入力

原本XMLとdocID/contextRef、確認済みの会計基準J-GAAP、表ごとの`FacilityTableDeclaration`を渡します。

```ts
import { DisclosureTableKind, extractFacilityDetails, screenFacilityDetails, FacilityField } from "edinet-ts";
const document = {
  xml: savedXml,
  accountingStandard: "J-GAAP" as const,
  selection: { docID: "SAMPLE", kind: DisclosureTableKind.Facilities, contextRef: "FilingDateInstant" },
  declarations: [{ tableIndex: 1, asOfDate: "2026-03-31", organization: "reporting-company" as const, rawSha256: reviewedFragmentHash }]
};
const details = extractFacilityDetails(document);
const result = screenFacilityDetails([document], {
  asOfDate: "2026-03-31",
  conditions: [{ field: FacilityField.TotalBookValueJPY, operator: "gte", value: 10_000_000_000 }],
  sort: { field: FacilityField.TotalBookValueJPY, order: "desc" }
});
```

`tableIndex`は本文表APIが返す0始まりの添字です。原書類を読み、どの表がどの期末・提出会社/国内子会社/海外子会社を指すか確認して宣言します。本文hash・表位置・本文中の日付記載とcontext時点の前後を検査しますが、宣言の意味を自動認定はしません。別の表にも同じ日付があるだけでは正しい宣言の保証になりません。`organizationVerification`は`declared-source-reference-matched`です。宣言のない表は`not-reviewed`として残します。

会計基準も呼出元の確認済み宣言です。`declaredAccountingStandard`へ残し、IFRS/US-GAAPや未確認基準を混ぜません。原本の会計方針の意味を自動検証したことにはしません。

## 値と出典

- 金額は元の百万円表示を十進文字列で正確に円へ換算し、面積はm²。`raw`/cellIndex/元単位の倍率を保存します。`decimal`は正確な文字列、`safeNumber`は安全に往復可能な場合だけです。浮動小数の乗算や内訳の足し算で合計を作りません。円への換算は、百万円表示の丸めを復元するものではありません。
- ダッシュ・空欄・実際の0を区別。括弧付き/複数値/負数/指数表記/不正桁区切り/未対応の数字は原文のまま非数値にします。括弧内の賃借面積等を勝手に加算/控除しません。数値セルが複数行/列に結合されていれば、同じ金額を各行へ重複計上せず利用不可にします。
- `siteAndLocation`は元の事業所名と所在地の結合表示、companyLabel/segmentも記載文字列です。表/行/セル参照と出典を残し、会社IDや地番には変換しません。出典entityは提出者であり、子会社表の個別会社とは別です。
- `rights: unconfirmed`、`propertyIdentity: not-established`。所有/共有/賃借は別途原注記を確認する必要があります。複数拠点の集合行を分割せず、同名行を同一物件として除去せず、BS全体や時価の合計にも使いません。事業所名自体が結合された行は除外理由を残します。

## 検索

同一期末の明示原本集合を対象に、4値の5演算・数値順・組織・所在地/会社ラベル/セグメントの文字列部分一致・offset/limitを扱います。円とm²で条件を指定し、十進分数で比較します。数値条件/順序に使う値だけを要求し、欠損はexcluded、条件外はfilteredに分けます。未対応本文/表はextractionsの状態/diagnosticsを確認してください。0件を「設備なし」とは解釈しません。

同値時はdocID/contextRef/元の表・行の順です。重複原本・同じ提出者の複数原本・期末混在は拒否します。訂正原本の選択は先に行ってください。asOfDateは設備の基準日であり、knownAtや当時の開示範囲を自動判定する機能とは別です。最大100原本・合計256MiB・100,000物理セル/10,000設備行、条件100件/ページ1,000行。小規模なメモリ検索で、SQL索引と全市場運用の機能ではありません。

## 検証と残り

既存のエクシオ/ミライト、2025/2026年の4原本を通信なしで確認。5+43+5+43の計96記載行、4項目384選択のうち330値/54非数値を独立Python Decimalと照合しました。合成fixtureでも3表形式・年度違い・注記/非数値・換算・検索を確認しています。

4PDFの設備表（エクシオ44/46ページ、ミライト45/34ページ）を画像で確認し、14行52原数値と円/m²換算、4ダッシュがPDFの独立転記と一致しました。全96行のPDF独立照合は未完了です。

未対応: 表形式の網羅、借地/共有持分/所有会社の意味の自動判定、住所分離/地番照合、全社の保有不動産一覧、地価結合、DB索引。確認済みの記載行を扱うAPIとして提供し、計画6c全体の完成とは区別します。

最終確認: Node 26.12.1で全85ファイル・2,802テスト（1ワーカー）、公開API型検査、buildが成功。最新のsource/buildで全96行のJSONが一致し、2年度の100億円以上検索は各7行/順序が独立Decimal期待値と一致しました。公開ESM/CJSからのAPIも確認済みです。
