# 観測世代からの直接財務SQL検索

`FinancialSearchIndex` は、[観測財務アーカイブ](OBSERVED_FINANCIAL_ARCHIVE.md)が返す直接値を、検索用の別SQLiteへ保存します。形式は `FINANCIAL_SEARCH_INDEX_VERSION = "1"`。原本アーカイブ版1の形式・既存DB・既存検索APIは変更しません。ローカル実装で、利用先vendor/本番サービスへの反映は別工程です。

対象は日本基準/IFRSのBS3科目と、アーカイブで明示して取得したduration明細です。BS・期間明細、基準・scope・JPY・期間/期間分類を分け、検索時に異なる基準や累計期間を同一視しません。比率や内訳の合算は行いません。

## 原本・世代・検索の関係

1. アーカイブへ一覧観測・原本を保持し、観測cutoff・訂正系列・原本hash・DEIを照合する。
2. `materialize` で対象入力と抽出版を固定し、検索用の世代・財務行・選択値を一transactionで保存する。
3. `screen` で固定世代の同一比較集合をSQL検索する。原本XMLや原本アーカイブを開き直さない。

```ts
import {ObservedFinancialArchive, FinancialSearchIndex} from "edinet-ts";

const source = new ObservedFinancialArchive("data/observed.sqlite", {readOnly: true});
const index = new FinancialSearchIndex("data/financial-index.sqlite");
try {
  index.materialize("cutoff-20261028", source, {
    cutoff: "2026-10-28T00:00:00+09:00",
    extractorVersion: "fixed-extractor-1",
    sourceCommit
  });
  const result = index.screen({
    generation: "cutoff-20261028", group: "details",
    accountingStandard: "J-GAAP", scope: "Consolidated", currency: "JPY",
    period: {startDate: "2025-04-01", endDate: "2026-03-31"}, periodType: "annual"
  }, {
    metricIds: ["costOfSales", "sellingGeneralAndAdministrativeExpenses"],
    conditions: [{metric: "costOfSales", operator: "gte", value: 0}],
    sortBy: "costOfSales", order: "desc", limit: 20
  });
} finally {
  index.close(); source.close();
}
```

`materialize` の入力は実際の `ObservedFinancialArchive` インスタンスです。任意の保存JSONを無検証で索引へ昇格させません。アーカイブをreadOnlyで渡すと、元アーカイブは変更しません。write可能なインスタンスなら、通常のアーカイブ契約に従い解析cacheを追加する場合があります。索引の世代書込とは別のtransactionです。

保存する明細は `materialize` の `detailMetricIds` で指定します。既定の日本基準duration2項目/IFRS PL5を維持し、CF等は明示した項目だけです。`edinetCodes` はアーカイブの会社指定へ渡します。一回の観測集合や原本のbatch上限はアーカイブの契約に従い、全市場の取得/複数入力batchの世代集約を実装したことにはしません。

## 固定世代と失敗時の扱い

世代IDは1〜200文字の英数字/`_.:-`です。同じID・同じ入力は再実行できますが、観測・原本・cutoff・抽出版・項目等の内容が違えば上書きを拒否します。cache hit件数のような実行時統計は世代の同一性に含めません。別のIDで新世代を作り、旧世代を明示して再検索できます。途中の書込失敗は世代・行・選択値の全体を戻し、部分世代を正常として返しません。

`generation(id)` は、cutoff、観測・訂正選択、原本不在、未確定の原本、利用不能group、抽出/対応表版、行と選択値のmanifestを返します。IFRS単体や基準不明、原本なし、context不在等を0値へ変えません。`screen` の `excludedRows` は保存済み財務行における必要値の非採用数で、未取得会社や原本不在を含む母集団の除外数ではありません。

固定世代は「その入力で保存した結果」です。後からcutoff以前の観測が追加された場合も旧世代を更新せず、新しい世代で処理します。未観測の過去を復元したとせず、訂正差分と親原本の値も合成しません。公開サービスのactive世代を自動切替する機能ではありません。

## 比較・欠損・精度

cohortには世代、`group`、基準、scope、JPY、期間を必須にします。`balanceSheet` は `period.instant`、`details` は開始/終了日と `periodType`（annual/ytd/quarterly）を必要とします。期間型とgroupが食い違う指定は拒否します。IFRSは既存抽出器と同じ連結のみです。

`metricIds` は既知項目の明示subsetです。条件/並び項目はそのsubsetに含め、保存していない選択記録はエラーにします。不在と未抽出を混同しません。条件/並びに使う項目だけを必須とし、どちらも指定しない場合は明示subsetを全て必須とします。

欠損・非対応・曖昧・安全なnumberへ変換できない値を分け、不要な欠損は診断へ残し、必要な欠損は行を除外します。診断は明示subsetの各指標について返すため、診断数と除外行数は同じとは限りません。条件による絞込は `filteredRows`、ページ前の一致数は `total`、理由別件数は `reasonCounts` に返します。

原値・単位・精度・全候補/採用理由は保持し、数値条件には既存選択器のguard済み `safeNumber` と同じnumberを使います。SQLiteのREALへの丸めでunsafeな原値を採用しません。0・負値・小数を変換/符号反転せず、`gte/lte/gt/lt/eq` の比較は既存のnumber検索と一致させます。日本基準の条件値は既存通り有限number、IFRSは既存通り安全整数範囲内の有限numberです。比率・BigInt分数の計算/索引はこのAPIの対象ではありません。

並びの同値順は証券コード、書類IDです。sortの既定方向はdesc、sortなしは証券コード/書類ID順。offset/limitは0以上の安全な整数で、limit 0でも件数・診断は返します。同じ証券コードまたはEDINETコードの複数候補は自動で一方を採用しません。必要な場合はcohortの `docIDs`（既知の重複しない1〜1,000件）で対象を明示します。指定書類がその世代/cohortにない場合はエラーです。選択済み訂正版を古い親へ差し替える機能ではありません。

戻り値の各行は、元書類/提出者、系列・観測ID、knownAt、原本SHA-256と、統一metadata形式のsnapshotを持ちます。BSの対象日も `snapshot.metadata.period.instant` に保持します。`snapshot.selections` は検索時の明示subsetで、元の候補と原値を返します。原本真正性の保証や為替換算は行いません。

## SQLと整合検査

| 保存対象 | 用途 |
|---|---|
| `financial_generations` | 固定入力の選択結果・保留・版・行/値のmanifest |
| `financial_rows` / `financial_cohort` | 世代・group・基準・scope・通貨・期間の集合、行本文と出典 |
| `financial_values` / `financial_metric_range` | available、guard済みnumber、原値、状態/理由、指標順。条件の範囲検索 |

SQLが同一集合、必要値の利用可能性、条件一致、件数、並べ替え、ページを処理します。世代・行metadata・全選択値の索引をmanifest/hashと照合し、条件外へ動かされた索引破損や余分/欠けた行も拒否します。証跡本文は返すページの行だけを読み、そのhashとmetadata対応を検査します。返却外の全証跡本文を毎回監査するAPIではありません。外部SQL書込と暗号的な改竄認証には対応しません。

DBを開く処理は原本アーカイブと同じ保護を共有し、別形式、追加table/index/trigger、空の既存ファイル、symlink/hardlink、既存の副ファイルを私有コピーで検査・拒否します。アーカイブ形式版1の互換を維持します。readOnlyは停止済みDBの私有コピーから読み、元のDB・副ファイルを変更しません。DB全体と同程度の一時ディスク領域を必要とし、open時のコピー時間はquery時間と別です。

## CLIと再現

```sh
edinet-ts index-financial-snapshots --archive data/observed.sqlite \
  --db data/financial-index.sqlite --generation cutoff-20261028 \
  --cutoff 2026-10-28T00:00:00+09:00 --extractor-version fixed-extractor-1

edinet-ts screen-financial-index --db data/financial-index.sqlite \
  --cohort cohort.json --metrics costOfSales,sellingGeneralAndAdministrativeExpenses \
  --conditions '[{"metric":"costOfSales","operator":"gte","value":0}]' \
  --sort-by costOfSales --order desc --limit 20
```

cohort.jsonはAPIのcohort objectです。buildのCLIは原本アーカイブをreadOnlyで開き、検索CLIも索引の私有コピーを読みます。条件・世代ID・宣言を先に検証します。正常な0件/欠損はJSON/終了0、不正条件・未保存項目・DB/破損等は入力内容を表示せず終了1です。原本やネットワークは検索時に不要です。

実5,911観測を保持した既存アーカイブから、既定4原本の8財務行/26選択、IFRS17項目指定2原本の4行/40選択を固定保存しました。合計12行/66選択と全来歴、89検索の値・診断・条件・順序・ページを独立したSQLite/JSON処理でも確認。範囲条件に `financial_metric_range` が使われることを実行計画で確認しました。source/built、CLIの世代再投入・4検索、CommonJS、配布物のNodeNext型検査も確認しています。新たなAPI取得/費用やPDF全数照合ではありません。

合成100/500/1,000社で、ウォームアップ1回後5回の中央値を測定しました。2groupを保存し、期間明細2項目・原価gte 10・desc・limit 10を検索する条件です。

| 社数 | DBサイズ | SQL | 既存メモリ検索 |
|---|---:|---:|---:|
| 100 | 約1.25MiB | 約13.6ms | 約21.1ms |
| 500 | 約6.10MiB | 約60.0ms | 約89.2ms |
| 1,000 | 約12.2MiB | 約127ms | 約183ms |

Node26.12.1、Core i5-7260U、一つのprocessでメモリ入力も保持し、原本/OSのcacheが温まった条件です。SQLは全世代のmetadata/選択値の整合検査と返却行の検証を含み、readOnlyのコピーopen時間を除いています。全市場の速度保証ではありません。再現は `node --import tsx scripts/benchmark-financial-search-index.ts`、結果はGit管理外の `data/benchmarks/financial-search-index.json` です。

比率/既存主要21指標や他領域の索引、全市場の世代集約・運用性能/充足率、再開可能な取得job、訂正差分の完全版再構成、公開世代/利用先の切替と旧DB移行は、全体ロードマップの残工程です。
