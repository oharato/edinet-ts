# 開示本文の表とセルの出典

`extractDisclosureTables`は、設備・関係会社・主要顧客・連結セグメント・役員・役員報酬・経営分析・所有者別状況・大株主の指定TextBlockを、本文とセルの位置付きで返します。元のHTMLを実行/描画せず、結合セルを同じ物理セルへの参照として展開します。数値や会社名の意味を確定する領域別APIとは別の前提機能です。

```ts
import { extractDisclosureTables, searchDisclosureTableCells, DisclosureTableKind } from "edinet-ts";
const selection = { docID: "SAMPLE", kind: DisclosureTableKind.Facilities, contextRef: "FilingDateInstant" };
const result = extractDisclosureTables(savedXml, selection);
const matches = searchDisclosureTableCells([{ xml: savedXml, selection }], { contains: "東京都", limit: 20 });
```

表外の解析済み本文は`outsideTableText`でも返します。表内の数値/注釈を、表外の基準日の証拠へ使わないための情報で、元HTMLを実行しません。

各物理表の`precedingText`は、直前の表が終わった後からその表までの表外本文です。日付/引用の対応を確認するための情報で、前の表の中身や注記を別表の数値へ混ぜません。

## 返却と検索

- 書類ID・領域・contextRefを明示します。最新/当期・連結/単体を推測して選びません。factoryは入力XML hashを、sourceは解析済み元本文・本文hash・fact名/namespace・contextの期間/entity/次元出典と全候補のhashを保持します。DTSや原文の字面の検証済みとはしません。
- `tables[].cells`は物理セルです。row/columnは0始まり、rowSpan/columnSpanと解析済み文字列を保持します。`grid`の番号はその表のcells添字です。欠けた枠はnull、結合セルは同じ番号を参照し、空セル・ダッシュ・0を同一視しません。
- `parsedText`には表外の文章・注記も含みます。画像、CSSの表示/非表示、脚注の意味は解釈せず、PDF上の見た目を再現するものではありません。役員本文以外の入れ子の表・不明な名前空間・DTD・不正XML/未定義実体参照・不正な結合/行群越えは元本文を保持して非対応にします。
- 同じ領域/contextの複数factは同値でも曖昧です。欠損、nil、raw取得不可、構造非対応を分けます。空のXML要素は既存parserがrawを保持しないためraw-unavailableです。
- `searchDisclosureTableCells`は明示した最大100原本から、物理セルの文字列を完全な部分文字列として逆引きします。docID/kind/contextRef/表/セルの順、offset/limit付き。結合セルは1件です。非対応原本をexcludedに残し、出典はsourcesへ1回だけ置きます。見出し・合計行も候補なので全一致は`semanticRole: unclassified`です。法人同定、会社数、金額や面積の検索として解釈しません。

## 範囲と上限

本文2MiB、解析用ラッパーを含む深度64、200表、合計5,000行/50,000物理セル、100列、結合展開/矩形化200,000枠。検索は原本合計256MiB、物理セル合計100,000件、検索文字列1,000文字、ページ最大1,000件。超過で黙って一部を採用しません。公式jpcrpの2018-03-31/2024-11-01/2025-11-01 namespaceの指定6タグだけが対象です。独自タグ・US/金融業/各年度全表の対応は保証しません。

設備の本文contextは提出日を示す場合があります。表の期末日と同一とはせず、注記にある賃借/共有、面積や金額の単位を確認するまで数値へ昇格させません。1行が複数の事業所をまとめる場合もあり、個々の不動産や地番の一覧とは呼びません。関係会社・主要顧客のセル文字列も法人IDに置き換えません。

## 既存原本による限定確認

通信なしで既存2社×2025/2026年の4原本を読みました。6領域/主要顧客2期の計28本文中24本文が採用、104表/5,764物理セルの文字列・位置・結合範囲・展開gridと元XML/本文hashが独立したPython処理と一致しました。初回確認時点では4役員本文は入れ子表のため非対応でした。現在は[役員明細](OFFICER_DETAILS.md)のため、役員本文だけ外側の表と入れ子のセル本文/nestedTableCountを保持します。入れ子の表は独立した数値明細へ展開しません。この照合は原XMLの保持確認であり、5,764セルのPDF独立照合ではありません。

本文表追加時点からの進展: [設備](FACILITY_DETAILS.md)・[顧客](MAIN_CUSTOMER_DETAILS.md)・[関係会社](AFFILIATED_COMPANY_DETAILS.md)・[セグメント](SEGMENT_DETAILS.md)・[受注](ORDER_DETAILS.md)・[株主分類](SHAREHOLDER_CATEGORIES.md)・[大株主/引用](MAJOR_SHAREHOLDER_DETAILS.md)の個別モデル/検証を追加しました。各領域の対応形式と確認範囲に限定し、全形式の意味/期間確定、DB索引は未完了です。本文を構造化金融値と同等には扱いません。全体計画6a/6b/6cの完了ではありません。

2026年設備表の限定PDF照合: エクシオPDF46ページ/ミライトPDF34ページを画像で確認し、7行45値セル（ダッシュを含む）がPDFからの独立転記と一致しました。全表/別年度のPDF照合は未完了です。

本文表追加後の検証: Node 26.12.1で全84ファイル・2,766テスト（1ワーカー）、build、公開API型検査、Python保存保護5件が成功。

役員報酬の追加確認では、任天堂/ソフトバンクグループの2024本文にあるjpcrp/2023-12-01も許可taxonomyへ追加しました。直接値の定義と複数会社の扱いは[役員報酬明細](OFFICER_REMUNERATION.md)を参照してください。
