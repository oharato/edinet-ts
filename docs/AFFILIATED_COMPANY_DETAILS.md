# 関係会社の記載明細と逆引き

`extractAffiliatedCompanies`は関係会社本文の確認済み表から、区分・会社表示・住所・事業・資本金/通貨・議決権表示・関係内容と出典を返します。`searchAffiliatedCompanies`と`search-affiliated-companies` CLIで、報告年度と記載区分を指定して逆引きします。`AFFILIATED_COMPANY_DETAILS_VERSION`は1です。

## 入力・報告年度・出典

```ts
import { DisclosureTableKind, extractAffiliatedCompanies, searchAffiliatedCompanies, AffiliatedRelationship } from "edinet-ts";
const document = {
  xml: savedXml,
  selection: { docID: "SAMPLE", kind: DisclosureTableKind.AffiliatedEntities, contextRef: "FilingDateInstant" },
  reportingPeriodEnd: "2026-03-31", accountingStandard: "J-GAAP" as const,
  proof: { rawSha256: reviewedFragmentHash, indirectIncluded: true },
  tables: [{ tableIndex: 0 }, { tableIndex: 1, continuationOf: 0 }]
};
const detail = extractAffiliatedCompanies(document);
const result = searchAffiliatedCompanies([document], {
  reportingPeriodEnd: "2026-03-31", relationship: AffiliatedRelationship.ConsolidatedSubsidiary, entryKind: "named",
  nameContains: "会社名", voting: { direction: "owned", component: "reportedTotal", operator: "gte", value: 50 }
});
```

原書類で表の関係と注記を確認し、[本文表API](DISCLOSURE_TABLES.md)の本文hashをproofに指定します。注記が間接保有を内数とすることを確認した場合だけindirectIncludedをtrueにします。hashと本文中の「間接所有」「内数」の参照を照合しますが、注記の意味の自動認証ではありません。

報告年度は原本のDEI会社情報（当期末とJapan GAAP）に照合し、根拠もprofileへ残します。本文contextの提出日時点と年度末を同一視しません。関係そのものの基準日は`relationAsOf: not-established`です。年度末の会社一覧や現在存続する会社一覧、関係成立/消滅の履歴が完成したとは扱いません。原本には期末後の社名変更・合併の注記を含む場合があります。

sourceにはXML/本文hash、タグ・context・提出者entity・元本文・全物理セル/次元出典を保持します。会社行は表/行番号とセル参照を持ちます。原本の真正性やDTSを認証する機能とは別です。

## 記載区分と継続表

親会社、連結/非連結子会社、持分法適用非連結子会社、持分法適用関連会社、持分法適用関連会社等、関連会社、その他の関係会社を、原表の区分見出しで区別します。`持分法適用関連会社等`を「すべて関連会社」と断定せず、比率だけで親子関係を変更しません。50％以下の連結子会社や、100％の持分法区分も原表示を維持します。

継続表は直前の物理表をcontinuationOfへ明示し、見出しの意味が同じ場合だけ区分を引き継ぎます。未知区分・不明な継続元を前の区分で補いません。同じ会社名の物理記載も統合しません。会社名の注番号・社名変更の注記を保持し、identityはunresolvedです。

「その他○社」はaggregateで社数を別に保持し、個別会社として数えません。検索のentryKindを必須にしてnamedと分離します。合計/小計行も個別会社として採用しません。matchedは記載件数であり、重複排除した法人の数ではありません。

確認したレイアウトは、会社/住所等を分ける7列表、所有・被所有の別列を持つ7列表、関係内容をまとめた6列表、会社名/住所を同じ欄に持つ5列表です。結合欄ではcompanyAndAddressCombinedをtrueとし、住所はnot-separatedです。そこから住所や法人名を推測して分離せず、住所条件の検索はaddress-unavailableとして除外します。nameContainsは会社欄の表示文字列（結合欄の住所・注記も含む）の部分一致です。

役員兼任/資金融通が別欄の場合だけofficerRelationship/fundingRelationshipを持ち、文章1欄の場合はrelationshipDescriptionを保持します。関係内容から人数や貸借方向・金額を推測しません。データ行自体が複数行/列に結合されている場合は重複配賦せず診断に残します。

## 資本金と議決権

- 資本金は原表示と通貨を保持し、円/米ドル等の基本通貨単位へ十進換算します。通貨間の換算はありません。百万円見出しの単独値、明示された千/万/百万の通貨表示、金額先行/単位先行を認識します。数値の途中の改行を結合して別の金額にしません。換算は元表示の丸めを復元するものではありません。
- 対応通貨はJPY/SGD/USD/GBP/AUD/MYR/IDR/PHP/VND/HKD/CNY/TWD/THBの確認済み名称・表記。「ルピー」「ウォン」等の曖昧な表記を所在地から推定せず、unknownのまま保持します。ダッシュ/空欄と実際の0は別です。
- 議決権の単位はpercentで、条件の50は50％です。明示の所有/被所有列や「被所有」接頭辞を読み、共通見出しでは区分とともに方向を保持します。directionBasisから根拠を確認できます。双方の列がある場合はvotingとcounterVotingに別々に保持し、検索では指定方向の表示を選びます。
- reportedTotalは記載合計、indirectIncludedは確認済みの括弧内数です。内数がないことを0とせずnot-reportedにします。総割合から内数を引いて「直接保有」を作りません。括弧の意味が未確認、内数が合計を超える、100％超、負数・複数値・角括弧の別基準がある場合は、原表示を保持して数値比較から除外します。角括弧の外数を所有割合へ加算しません。

## 検索とCLI

同じ報告期末の明示原本を対象に、区分/個別・集計、会社欄・住所・事業の文字列部分一致、資本金/議決権の5演算、表示名順、offset/limitを扱います。資本金はcurrency、議決権はdirectionとcomponentを必須にし、単位/向き/合計と内数を混ぜません。欠損・不明通貨・異通貨・住所未分離は理由付きexcluded、条件外はfilteredです。元本文/会社情報/表自体の不採用はextractionsの状態/diagnosticsを確認し、0件を「関係会社なし」と断定しません。

```sh
edinet-ts search-affiliated-companies --manifest files.json \
  --period-end 2026-03-31 --relationship consolidated-subsidiary --entry-kind named \
  --capital '{"currency":"JPY","operator":"gte","value":100000000}' \
  --voting '{"direction":"owned","component":"reportedTotal","operator":"gte","value":50}' \
  --sort name-asc --pretty
```

manifestはfile/selection/reportingPeriodEnd/accountingStandard/proof/tablesの配列。fileはmanifest基準の相対パスです。CLIのエラーは入力内容を表示しません。検索自体は通信・DB更新をしません。

同じ原本/提出者の二重入力と報告期末の混在を拒否します。訂正系列は先に選択してください。最大100原本/合計256MiB、200物理表宣言、検索全体100,000物理セル/10,000記載、ページ1,000件です。同値順はdocID/contextRef/原表順を維持します。knownAtによる資料選択・法人番号照合・永続索引は別工程です。

## 検証

既存エクシオ/ミライト2社2年度の4原本と、既存キャッシュにある弘電社/ピーエス・コンストラクション/若築建設の2026年原本を確認。7原本385記載の出典・区分・全2,677原文セル参照が独立XML処理と一致しました。資本金は379数値/2ダッシュ/4不明通貨、所有/被所有表示は379数値/5ダッシュ/4未対応複合表示、確認済み間接内数は217数値です。合計と内数を別の記載数として数えず、所有・被所有の両列がある場合は表示数を別に集計しています。

親会社3原本のPDFを正規APIで取得し、各6ページを画像で確認しました。親会社・子会社・持分法適用関連会社の17行について、36の原数値と通貨単位換算が独立転記/Decimalと一致。含まれる外数付きの1行は数値不採用のまま確認しました。旧来4原本の全行PDF照合は未完了です。2年度×4種類の8検索の結果・除外理由・名前順・ページも独立期待値と一致しました。

未完了: 全表形式、住所/法人名の結合欄分離、法人同定、関係の成立/終了・会社履歴への自動結合、角括弧の外数の構造化、全市場品質、DB索引。実装済みモデルとこれらの残工程を区別して、全体ロードマップを継続します。
