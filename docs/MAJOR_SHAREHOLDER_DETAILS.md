# 大株主表と大量保有の引用を分ける

`extractMajorShareholderDetails`は確認済みの大株主本文の表から、名義・住所・記載保有数・割合と出典を返します。`searchMajorShareholderDetails`と`search-major-shareholders` CLIは、表の種類、日付の意味、明細/合計、指標を指定して逆引きします。`MAJOR_SHAREHOLDER_DETAILS_VERSION`は1です。

## 入力と出典

```ts
import { DisclosureTableKind, extractMajorShareholderDetails, searchMajorShareholderDetails } from "edinet-ts";
const document = {
  xml: savedXml,
  selection: { docID: "SAMPLE", kind: DisclosureTableKind.MajorShareholders, contextRef: "FilingDateInstant" },
  tables: [{ tableIndex: reviewedTableIndex, rawSha256: reviewedFragmentHash }]
};
const detail = extractMajorShareholderDetails(document);
const matches = searchMajorShareholderDetails([document], {
  kind: "major-shareholders-table", date: { basis: "holding-as-of", value: "2026-03-31" },
  role: "named", metric: "holdingPercent", condition: { operator: "gte", value: 5 }, sort: "value-desc"
});
```

`MajorShareholdersTextBlock`と、確認済み表位置/本文hashを指定します。元XML/本文hash、物理セル・context・entity・次元証跡を[本文表API](DISCLOSURE_TABLES.md)と同じ形で保持します。書類種別自体の自動認定ではないため、有報だけを使う場合はメタデータで先に選択します。大量保有の一次報告書をこのAPIで読んだとは扱いません。

本文contextは次元のないinstantで、表の日付がその提出日時点より後なら採用しません。会計基準から株主名義や対象時点を補完しません。元表の4列と見出しを照合し、未知の書式/単位/分母、結合された明細数値セルは理由を残します。`計/合計/総計`の名義・住所を横結合した原表合計は明細と区別して保持します。

## 2種類の表・数値・分母

| kind | 数の見出し | reportedCountの単位 | 割合の分母 |
|---|---|---|---|
| major-shareholders-table | 所有株式数（株/千株） | shares | issued-shares-excluding-treasury |
| large-holding-reference | 保有株券等/保有株式等の数（株/千株） | reported-holding-equivalents | large-holding-definition-unconfirmed |

大株主表の割合は「発行済株式（自己株式を除く。）の総数に対する所有株式数の割合」という見出しを照合します。実際の分母の数値を逆算したり、[所有者別状況](SHAREHOLDER_CATEGORIES.md)の単元合計へ置き換えたりしません。引用の「株券等保有割合」は別の定義として保持し、自己株式除外の割合へ変換しません。countDefinition/denominatorは元見出しセルの位置と表示を持ちます。

reportedCountは原表の株/千株を株単位へ正確に換算した記載値です。千株表示の端数切捨て等を元の厳密な保有数へ復元しません。千株の小数は換算後が整数株なら採用します。原文・倍率・十進文字列を保持し、安全な場合だけsafeNumberも付けます。holdingPercentは原表の百分率で、5は5％です。0〜100の単独数値以外、空欄、ダッシュ、注釈、途中で空白に分かれた数値は理由を残します。欠損を0で埋めません。

各rowは`identity: unresolved`、roleはnamedまたはreported-totalです。名義と住所の改行・注番号・常任代理人・信託口/別口を保持します。同じ名称が複数行/複数報告に現れても統合せず、共同保有者や合計と足し合わせません。住所の法人ID/国の補完や、登録名義から実質保有者の認定もしません。rowKeyは元XML/書類/context/物理表/行に対応します。

## 日付と引用の確認状態

大株主表のholdingAsOfは、見出しより前の日付セル、またはその表の直前の表外本文にある「N年N月N日現在」へ対応します。原表の日付と文書の提出日を同一視しません。

大量保有の引用では、次の情報を分けます。

- publicInspectionDates: 「N年N月N日付で公衆の縦覧に供されている」という引用日付。複数なら原順で全件保持します。取得システムが観測したknownAtや、一次報告書の提出メタデータとは別です。
- holdingAsOf: 「保有者がN年N月N日（付）現在で」と明記された共通の保有日だけを選択します。確認できない会社期末の記述や引用日付からは補完しません。
- ownershipConfirmation: 原注記の実質所有株式数が確認できない旨を照合し、`reference-only-not-confirmed-by-filer`とします。肯定文の「確認ができました/できる」を確認不能とは読み替えません。

直前の物理表が終わった後から次の表までの表外本文を、`tables[].precedingText`として保持します。表内の住所/数値や前の表に対応する引用日付を、次の表へ持ち越しません。日付の注番号と年、分割された数字を空白除去で連結しません。

保有日がない14引用は`holding-date-not-established`です。実原本1引用では、共通保有日の記載が引用日付の一部より後にありました。原記載の候補日をreportedDateへ残し、`conflicting-reference-chronology`として確定した保有日検索から除外します。最古/最新の引用日や会社期末へ修正しません。元の記載誤りか、各保有者に別の報告が対応するかは一次報告書での確認が必要です。

このAPIの引用は有報本文の記載です。大量保有の一次報告書、変更/訂正系列、その後の売買・企業行動や現在の保有状況を確認した値ではありません。

## 検索・CLI・上限

kind/date.basis/date.value/role/metricが必須です。date.basisはholding-as-ofまたはpublic-inspection-dateで、大株主表はholding-as-ofだけを指定できます。未確定の保有日で検索するとexcludedへ理由を返します。種類/役割/日付/条件外はfiltered、数値不明もexcludedに分けます。数の比較は同じkind内の記載単位による比較で、他の証券構成や分母まで同一定義と認定するものではありません。

holderContains/addressContainsは原文の部分一致です。比較/並べ替えは正確な分数を使い、同額は書類ID順/原表順を維持します。matchedはページ適用前の記載行数であり、独立した保有者数ではありません。offsetは0以上、limitは既定100/最大1,000です。

```sh
node dist/cli.js search-major-shareholders --manifest manifest.json \
  --kind large-holding-reference --date-basis public-inspection-date --date 2026-05-12 \
  --role named --metric reportedCount --condition '{"operator":"gte","value":1000000}'
```

manifestはfile/selection/tablesの配列で、fileはmanifestの所在から解決します。APIは100原本/256MiB/100,000物理セル/10,000記載、各原本は200表指定まで。同じ表の重複宣言、原本/提出者の重複を拒否し、訂正系列は先に選びます。CLIは共通の有限読取りを使い、失敗入力をログへ表示しません。通信や既存DBの変更はありません。

## 旧APIの比率表示

既存`getMajorShareholders().ownershipRatio`は原タグの数値を返す互換動作を維持します。pure単位なら0.2037は20.37％です。旧APIは単位を検証しないため、READMEと型説明の誤った「そのまま％」という表示を修正しました。百分率・分母・期間と本文の引用区別が必要な場合は、新しい明細APIのholdingPercent等を使います。既存の大量保有一次報告書getterの挙動は今回変更していません。

## 独立確認と残工程

既存のエクシオ/ミライト各2025・2026年提出原本と、弘電社/ピーエス・コンストラクション/若築建設の2026年提出原本の計7原本で、大株主7表・引用16表、121行を確認しました。原XMLの484値/文字列セルと23直前本文、242数値、引用日の対応と日付未確定理由を独立処理で照合しました。同じ提出のPDFでは全121行242数値の列順と26日付が一致し、画像でも株/千株・分母・引用の区別と日付の記載を確認しました。2年度×4条件の8検索の結果/順序/除外も独立期待値と一致しています。今回の調査は保存済みデータだけを使用しています。

索引方針: source XML hash/書類/context/表/行を原本内キーとし、kind・role・日付の種類を混ぜず保存します。複数引用日は別の対応表に保持し、保有行を複製しません。数値は単位/倍率・正確な十進値・採用状態と理由を分離し、名義原文を法人IDへ置換しません。この永続索引の実装・移行・負荷検証は残工程です。

全書式/和暦、異なる分母や証券構成の正規化、名義/種類株式/実質保有者の同定、一次大量保有の明細/訂正系列、政策保有・役員/報酬等と他段階の残工程、固定配布物e673e8a/利用先の最終更新は未完了です。全体計画6bの完了とはしません。

追加後の検証: 全97ファイル・3,110テスト（Node26.12.1/1ワーカー）、公開API型検査、buildに成功。source/buildの実7原本121行の全JSONは同等。5社の公衆縦覧日付/保有数条件で公開CLI/APIの採用2件を含む全JSONが一致し、公開CJSの関数/定数も確認しました。
