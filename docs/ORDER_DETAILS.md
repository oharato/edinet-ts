# 受注・工事・繰越の直接明細

`extractOrderDetails`は確認済みの経営分析本文の表から、原表区分別の受注高、完成工事高または売上高、期首/期末繰越高を返します。`searchOrderDetails`と`search-orders` CLIは、同一期間・連結/単体・行の役割・指標を指定して検索します。`ORDER_DETAILS_VERSION`は1です。

## 入力と出典

```ts
import { DisclosureTableKind, extractOrderDetails, searchOrderDetails, OrderMetric } from "edinet-ts";
const period = { startDate: "2025-04-01", endDate: "2026-03-31" };
const document = {
  xml: savedXml,
  selection: { docID: "SAMPLE", kind: DisclosureTableKind.ManagementAnalysis, contextRef: "FilingDateInstant" },
  accountingStandard: "J-GAAP" as const,
  declarations: [{ tableIndex: reviewedTableIndex, period, scope: "NonConsolidated" as const, rawSha256: reviewedFragmentHash }]
};
const detail = extractOrderDetails(document);
const matches = searchOrderDetails([document], {
  period, scope: "NonConsolidated", role: "detail", metric: OrderMetric.OrdersReceivedJPY,
  condition: { operator: "gte", value: 10_000_000_000 }, sort: "value-desc"
});
```

`ManagementAnalysis`は`ManagementAnalysisOfFinancialPositionOperatingResultsAndCashFlowsTextBlock`に限定します。原書類で表の位置・対象範囲・単位を確認した宣言を渡し、本文全体のhashを照合します。宣言の参照確認は、本文の意味を自動認証するものではありません。原XML/本文hash・全物理セル・context出典を[本文表API](DISCLOSURE_TABLES.md)と同じ形で保持します。

DEIの会計基準がJapan GAAP、当期開始/終了が採用可能で、会社情報の期間/entity等に矛盾がない原本を対象にします。本文contextは次元なしの提出日時点で、提出日が当期末より前なら採用しません。profileには照合した3項目の証跡、declarationsには採用宣言を残します。対応外の基準や形式は理由を返します。

## 期間・範囲と対応表

- 単体の7列表: 期別/区分/前期繰越工事高/当期受注工事高/計/当期完成工事高/次期繰越工事高。金額単位は各見出しの百万円を照合します。
- 単体の10列表: 種類別または工事別。次期繰越の「手持高」を期末残高として取り、別の「うち施工高」、割合、当期施工高は値へ混ぜません。完成工事高と売上高は原見出しどおり別の指標にします。
- 連結の3列表: セグメントの名称/受注高(百万円)/前年同期比(％)。受注だけを読み、前年同期比から前期額を逆算しません。
- 連結の横表: 報告セグメント名と金額/増減率の2段見出し、3区分の受注高行、本文の百万円単位を照合します。売上高・セグメント利益・増減率は受注へ読み替えません。

単体表は結合された期間セルの西暦開始/終了に宣言を照合します。「前事業年度」「当事業年度」「第N期」の実績期間に限定し、予想の表示、無効日付、当期末より後の期間は採用しません。前期と当期を同じ物理表から別々に指定できます。連結の受注表は当期DEIと宣言期間の一致が必要で、期間の根拠は`reviewed-declaration-and-profile`です。表の連結/単体の意味は確認済み宣言であり、全書式の自動分類は未完了です。

## 値と行の役割

| 指標 | 元の意味 | periodBasis |
|---|---|---|
| ordersReceivedJPY | 受注高/受注工事高 | duration |
| completedConstructionJPY | 完成工事高 | duration |
| salesJPY | 売上高 | duration |
| openingBacklogJPY | 前期繰越/期首の手持額 | period-start-opening |
| closingBacklogJPY | 次期繰越/期末の手持額 | period-end |

百万円を円へ正確な十進文字列で換算し、安全に表現できる場合だけsafeNumberも返します。単独の負数表示も符号付きで保持します。原セルの空白で分かれた数値、複数値や注釈を推測で結合しません。空欄・ダッシュ・非対応数値と、表にない指標`missing/not-in-table`は区別します。

各行は元の区分名とセル位置を持ち、`identity: source-label-only`です。同じ表記のセグメントを企業間/年度間で同一事業に名寄せしません。`計/合計/総計`は`reported-total`、`工事計/兼業計/小計`は`subtotal`、他は`detail`として分離します。合計の丸め差を直したり、明細と小計/合計を足したりしません。数値のない「建設事業」の見出し行は診断へ残します。

原注記には契約変更の増減を受注へ含む場合があります。`measurementDefinition: reported-not-normalized`として原注記を保持し、他社と同一定義の新規契約額とは認定しません。繰越は契約負債や将来の売上予想と同一視せず、差し引きで受注/売上を生成しません。

## 検索・CLI・上限

検索は期間、scope、role、metricが必須です。labelContainsは原文の部分一致、conditionのvalueは円単位です。比較と金額順序は正確な分数を使います。選択指標が数値でない行はexcludedに理由を残し、期間/役割/条件外はfilteredへ分けます。matchedはページ適用前、offsetは0以上、limitは既定100/最大1,000です。同額は書類ID順の入力/原表順を維持します。

```sh
node dist/cli.js search-orders --manifest manifest.json \
  --start 2025-04-01 --end 2026-03-31 --scope NonConsolidated \
  --role detail --metric ordersReceivedJPY \
  --condition '{"operator":"gte","value":10000000000}' --sort value-desc
```

manifestはfile/selection/accountingStandard/declarationsの配列です。fileはmanifestの所在から解決します。APIは100原本/256MiB/100,000物理セル/10,000採用行、各原本は100宣言まで。原本重複と同一提出者の混在は拒否し、訂正系列は先に選択します。同じ表/期間の二重宣言も拒否します。CLIは共通のローカル読取り上限を使い、失敗入力をログへ表示しません。通信/既存DBの変更はありません。

## 実データ確認と残工程

既存のエクシオ/ミライト各2025・2026年提出原本と、弘電社/ピーエス・コンストラクション/若築建設の2026年提出原本の計7原本を使用しました。単体の前期/当期を含む52行で、135数値・1ダッシュ・124表内指標不在を確認しました。原XMLのラベル/数値セル188項目と期間セル28行を独立処理で照合し、同じ提出のPDF7ページで全52行の対象135数値・1ダッシュも一致しました。PDFを画像で確認し、連結/単体、期間、列の意味と対象範囲も確認しています。2年度×2範囲×2指標の8検索は、独立した金額条件/順序/除外の期待値と一致しました。

原表のすべての書式、受注の定義/契約変更の自動比較、区分の法人/企業履歴との照合、全企業の取得、永続索引、訂正内容の自動再構成は未完了です。既存固定配布物e673e8aへはまだ含めません。全体計画6aの完了とはしません。

追加後の検証: 全93ファイル・2,982テスト（Node26.12.1/1ワーカー）、公開API型検査、buildが成功。source/buildの実7原本52行は同等で、公開CJSの関数/定数も確認しました。3社の期末繰越条件で公開CLI/APIの6件・数値不明による除外1件を含む全JSONが一致しました。
