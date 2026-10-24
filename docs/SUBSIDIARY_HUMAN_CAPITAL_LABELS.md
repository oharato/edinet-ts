# 人的資本表に載る会社ラベルを探す

指定した有価証券報告書から「連結子会社の指標」表の「指標を公表した会社」を読み、文字列の完全一致・部分一致で探せます。**会社ラベル**とは、この欄に書かれた名前です。一般的な子会社一覧、法人の同一性、出資関係を判定する機能ではありません。人数や比率は今回読みません。

## 対応範囲

金融庁の[2026年版EDINETタクソノミ](https://www.fsa.go.jp/search/20251111.html)の定義を確認し、独立して実装しています。

- 対象名前空間は `http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2025-11-01/jpcrp_cor` のみ。
- 項目は `ConsolidatedSubsidiariesMetricsOfConsolidatedSubsidiaries`（文字列・期末時点・単位なし）。
- 行指定はscenarioの `SequentialNumbersAxis` と `Row1Member`〜`Row300Member` が一つだけのもの。他の軸、typed次元、旧年度・企業拡張の別定義は未対応です。
- 提出者・指定期末を確認します。連結軸が宣言されていない場合は `consolidationDeclaration: "not-declared"` とし、定義ファイルの既定値から連結を補いません。財務APIの連結範囲へ変換しません。
- 同じ行に候補が複数あれば、同じ文字列でも `ambiguous`（一つに決められない）です。別行の同じラベルは残します。項目が見つからなくても「子会社がない」とは言いません。

`parsedLabel` は既存パーサーが保持した文字列です。前後空白の除去などを経ており、元XMLの字面そのものではありません。`dtsValidation` / `originalLexicalValidation` は常に `not-performed`。表定義一式（DTS）や原文の字面の検証済みという意味ではありません。数値文字参照らしい未解決文字列も勝手に復元しません。

## API

```ts
import {
  extractSubsidiaryHumanCapitalLabels,
  searchSubsidiaryHumanCapitalLabels,
  SubsidiaryHumanCapitalLabelOperator,
  SortOrder,
} from 'edinet-ts';

const metadata = { docID: 'SYNTHETIC-A', instant: '2026-03-31', secCode: '1001' };
const extraction = extractSubsidiaryHumanCapitalLabels(xml, metadata);
const result = searchSubsidiaryHumanCapitalLabels([{ xml, metadata }], {
  conditions: [{ operator: SubsidiaryHumanCapitalLabelOperator.Contains, value: 'SYNTHETIC' }],
  order: SortOrder.Ascending,
  offset: 0,
  limit: 10,
});
```

`secCode` は任意の申告文字列です。このAPIではコードの正規化・原本との独立照合はしません。複数原本の検索では同一期末を要求し、同じ書類番号・判明した同一提出者の複数書類を拒否します。最新版を自動で選びません。比較前にmetadata・条件を固定し、解析するXMLとSHA-256の対象を揃えます。

採用した行だけを検索します。条件はAND、`eq`（完全一致）と`contains`（部分一致）。大文字小文字・全半角・法人名の揺れを統一しません。順序はJavaScriptの文字列順（UTF-16）、同値なら書類番号・行キー順です。読み仮名順ではありません。

- `total`: 条件に合う採用行数。ページ指定前。
- `filteredRows`: 採用できたが条件に合わなかった行数。
- `excludedRows`: 欠損・未対応・曖昧で採用しなかった行数。会社数ではありません。
- `summary.emptyDocuments`: 対象項目の候補が0件だった書類数。
- `reasonCounts`: `multiple-facts`、`nil`、`tag-absent` など理由別の診断件数。候補0件の書類診断も含むため、`excludedRows`との合計一致は保証しません。

抽出結果は `traces`、検索結果は書類ごとの `sources[].traces` に[次元の出典](CONTEXT_DIMENSION_TRACES.md)をまとめます。候補の `traceRef` は同じ書類のこの配列のindexです。`metadata.docID` と組み合わせて参照してください。同じcontextを候補ごとに全文複製しません。原本hash・fact/context・期末・提出者・不採用理由を辿れます。

解析済みObjectの `selectSubsidiaryHumanCapitalLabels(metadata)` も使えますが、Objectは元XMLを保持しないため、この入口の `inputXmlSha256` はundefinedです。Objectを手動編集しても元XMLの次元出典は再生成しません。原本との対応を確かめたい場合は、編集していないXML入口を使ってください。

## CLIと入力準備

取得済みXMLをGit管理外に置き、次のようなJSON一覧を作ります。相対パスは一覧ファイルの場所が基準です。ネット取得やフォルダ自動走査はしません。

```json
[
  { "file": "a.xbrl", "metadata": { "docID": "SYNTHETIC-A", "instant": "2026-03-31", "secCode": "1001" } },
  { "file": "b.xbrl", "metadata": { "docID": "SYNTHETIC-B", "instant": "2026-03-31" } }
]
```

```sh
node dist/cli.js search-subsidiary-labels --manifest /path/to/files.json --contains SYNTHETIC --order desc --offset 0 --limit 10 --pretty
node dist/cli.js search-subsidiary-labels --manifest /path/to/files.json --conditions '[{"operator":"eq","value":"SYNTHETIC ALPHA"}]'
```

`--equals` / `--contains` はJSON条件へANDで追加します。成功はJSON/stdout・終了コード0、入力エラーは一般的な説明/stderr・終了コード1です。候補の欠損や未対応は入力エラーではなく、結果の理由と件数で返します。

API上限は100書類・100条件・候補合計10,000件。CLIは一覧2MiB・原本1件64MiB・合計256MiB、正しいUTF-8の通常ファイルだけを読みます。リンク先が通常ファイルのsymlinkは解決して読むため、ディレクトリ隔離の機能ではありません。元ファイルやDBを書き換えません。

## 確認したことと未確認

合成XMLで候補の重複、欠損、未知の定義、別期末、追加次元、同一提出者の二重入力、文字列条件・順序・ページ、出典参照、CLIを確認します。保存済み2社の2026年提出原本は読み取りだけで使用し、会社ラベルをGitへ収録しません。37ラベル（31行/6行）の文字列・context・entity・行指定が独立したPython抽出と一致しました。64通りの条件/順序/ページとbuild済みCLIも独立期待値に一致し、2原本は不変です。全2,294テスト・型/build・保存保護5件・独立レビュー/公開ビルド確認が成功しています。

別年度原本・PDF表示・全市場充足率・全タクソノミ年度・法人同一性・性能優位は未確認です。DB保存、主要顧客・大量保有者の逆引き、一般的な子会社マスターは未実装です。
