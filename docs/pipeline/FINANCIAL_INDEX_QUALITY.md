# 固定財務索引の品質集計

保存した検索世代を検査し、会社数・書類数・財務行数・利用できる値を別々に集計します。公開前に不足や保留の内容を確認するための入口です。

`FinancialSearchIndex.quality(generation)` は、[財務SQL索引](FINANCIAL_SEARCH_INDEX.md)の指定世代について、全保存本文と値索引を検査し、母集団・選択書類・財務行・利用可能な値を分けて集計します。XMLの再解析や新規取得は行わず、既存索引形式版1を維持します。

## APIと検査対象

```ts
import {FinancialSearchIndex} from "edinet-ts";

const index = new FinancialSearchIndex("data/financial-index.sqlite", {readOnly: true});
try {
  const quality = index.quality("listed-current");
  console.log(quality.populationCompanies, quality.companiesWithRows);
  console.log(quality.values, quality.cohorts);
} finally {
  index.close();
}
```

先に世代manifest・全行metadata・全値索引のhashを照合し、その後100行ずつ全本文を読み、本文hash/metadata・本文から得た値projectionと保存manifestを再照合します。通常検索で返さない行の本文破損も品質検査を失敗させます。

破損を欠損や0へ読み替えません。外部SQLでhashまで作り直す行為の認証や元原本の電子署名検証を行うものではありません。

`generationSha256` は検査した固定世代の内容指紋、`cutoff` は世代の観測時点です。readOnlyでは元ファイルを変更せず、原本アーカイブがなくても検査できます。全行を対象とするため、通常の絞り込み検索とは分けてオフラインの品質確認に使います。

## 会社・書類・行を分ける

| field | 意味 |
|---|---|
| `population` / `populationCompanies` | 全社分割構築で宣言・固定した母集団と会社数 |
| `companiesWithSelectedDocuments` | 固定母集団内で書類選択が成功した会社数 |
| `companiesWithoutSelectedDocument` | 固定母集団内で選択成功書類がない会社数 |
| `companiesWithRows` | 財務行が一つ以上ある会社数 |
| `companiesWithUsableValues` | 保存した指標のうち数値比較に使える値が一つ以上ある会社数 |
| `selectedCompaniesWithoutRows` | 選択成功書類があっても財務行がない会社数 |
| `selectedDocuments` / `documentsWithRows` / `selectedDocumentsWithoutRows` | 同じ違いを書類単位で数えたもの |
| `rows` | 保存したgroup別の財務行数 |

一社に複数期/書類があり、一書類にはBS・明細の別行があるため、会社数・書類数・行数を同じ充足率へ混ぜません。「利用可能な値がある」は全指標の充足や会社間比較可能性を意味しません。

母集団は[全社分割構築](FINANCIAL_INDEX_BUILD.md)のassemblyがある場合だけ返します。母集団を宣言しない直接構築世代では、母集団数と選択なし会社数を省略します。未宣言を0社や100%と見なしません。固定母集団を持つ場合、対象外の会社行があれば停止します。

選択書類がない会社を未開示と判断しません。この集計だけでは、一覧窓の完了・必要年度/書類種別の網羅・過去の上場母集団を証明できません。世代の選択結果はその入力観測/cutoffに限定されます。

## 原本/処理の保留と値の品質

`selectionDecisions` は保存世代に含まれる書類系列の `selected / unresolved / unavailable` 件数です。会社数ではなく、検査に必要な関連系列も含みます。選択自体が未解決/利用不可の場合を解析結果の保留と分けます。

`unavailableSources` は原本不在・cutoff後・hash/parse/照合失敗等を理由別の書類数で返します。`unresolvedRecords` は基準/証券コード/IFRS単体等により結果全体が未解決の書類、`unavailableGroups` は当期context不在/重複等でgroupを作れなかった書類です。

group別書類数と全体の書類数は単純に足しません。これらを値の欠損へ数え直しません。

保存した選択値の `values` は次の5分類です。

| state | 意味 |
|---|---|
| `available` | 保存選択が採用され、既存の数値範囲検査を通る |
| `missing` | 項目/対象factの不在等 |
| `unsupported` | 通貨/単位・nil等の非対応 |
| `ambiguous` | 複数fact等で採用を決められない |
| `unsafe-number` | 元記載は採用できても数値比較の範囲外 |

元の符号や精度を変更せず、nil/欠損/非対応/曖昧を0で補いません。詳細な採用理由と候補/evidenceは元の保存行・検索診断に残します。集計対象は世代に保存したprojectionだけであり、指定しなかった全辞書項目や主要21指標を抽出済みとする結果ではありません。

`cohorts` はgroup・会計基準・連結/単体・JPY・対象日/期間・periodTypeごとに分けます。各cohortは会社/書類/行数、値の5分類、`byMetric` と利用可能値を持つ会社数を返します。異なる基準や期間の財務値を合算しません。全体の `values` は状態件数の合計です。

同一cohortで同じEDINETコード/証券コードが複数行ある場合は、`duplicateCompanies / duplicateSecurityCodes` に残します。原本や値を合成して重複を消しません。通常検索が同一企業の複数書類を拒否する場合も、品質集計はその重複を確認するために使えます。

<a id="cli"></a>

## CLIで実行する

```sh
edinet-ts financial-index-quality --db data/financial-index.sqlite \
  --generation listed-current --pretty
```

CLIはreadOnlyで全品質をJSONへ返します。品質上の不在/保留/重複があっても検査が正常に終われば終了0。入力/世代/本文/索引の不整合は入力内容を表示しないstderrと終了1です。終了0を全指標の充足や本番公開の承認として扱わず、返した集計を確認します。公開世代の切替やサービス更新を自動実行しません。

## 実世代の確認

| 対象 | 財務行/会社 | 値の状態 | 備考 |
|---|---|---|---|
| 当初4原本の固定母集団世代 | 8行/4社、4 cohort | 26採用 | 母集団3,813社、選択成功1,177社/1,268書類、選択なし2,636社、原本不足1,264書類 |
| 後から取得した6原本の世代 | 12行/5社、6 cohort | 25採用/4欠損/1曖昧 | 利用可能値を持つ会社は4社 |
| IFRS17明細の世代 | 4行/2社、2 cohort | 28採用/12欠損 | BS3と明示duration17の別projection |

source/built・配布用CLIで3世代の全品質が一致し、readOnlyの元ファイル不変、CommonJS公開関数・NodeNext型検査も確認しました。この結果は固定した既存世代のもので、進行中の原本一括取得後の全市場品質を示すものではありません。全市場の必要期間/原本・指標充足、公開条件・本番/利用先反映は残工程です。

独立SQLite/JSON処理でも、3世代の全行/値とcohort・指標別状態、会社/書類の集合、固定母集団と原本不足の集計が一致しました。全128ファイル/3,604テスト、ビルド、公開型・配布物NodeNext型検査、認証値混入の非表示検査も成功しています。

品質条件を固定して候補の明示切替・旧候補への復帰を行う入口は、[財務世代の公開catalog](FINANCIAL_INDEX_PUBLICATION.md)を参照してください。
