# 母集団全件の分割構築・再開・世代集約

`FinancialIndexBuild` は、母集団・原本アーカイブの指紋・cutoff・抽出版を固定し、会社ごとの[財務SQL索引](FINANCIAL_SEARCH_INDEX.md)をcheckpointして一つの検索世代へ集約します。状態形式は `FINANCIAL_INDEX_BUILD_VERSION = "1"`。原本アーカイブ版1・財務索引版1の形式を変更せず、構築状態だけを別の専用SQLiteへ保存します。

計画の全会社を処理したことと、財務値が全社分揃ったことは別です。原本不在・基準不明・IFRS単体・context不在等は理由付きで保持し、正常値や0値へ変えません。

## 固定する入力

| 項目 | 意味 |
|---|---|
| `id` / `generation` | 構築ID / 集約後の検索世代ID。各1〜200文字の英数字・`_.:-` |
| `archiveSha256` | 停止した原本アーカイブをreadOnlyで開いたコピー全体のSHA-256 |
| `population` | asOf、実観測時刻、出典名/URL、sourceSha256、重複しないEDINETコード集合 |
| `options` | cutoff、必須extractorVersion、任意sourceCommit/明示duration明細 |

母集団は1〜100,000件です。コード集合は並び順に依存しない形へ固定し、空・重複・不正コードを拒否します。母集団の実観測がcutoffより後の場合や、基準日がcutoffの日本日付より後の場合は使用しません。現在の上場母集団を過去に既知だった集合へ遡及させません。

`ObservedFinancialArchive.snapshotSha256()` はreadOnlyの物理ファイルだけで利用できます。元アーカイブを停止し、更新しない別名のコピーを計画用入力として保持してください。単なるcache追加でもDBのbyteが変われば、次の再開時に指紋不一致で停止します。同じbyte列の別パスへのコピーは利用できます。実行中はreadOnlyの私有コピーを読むため、入力の新旧を混在させません。新しい入力・cutoff・母集団・抽出版は別の構築ID/世代にします。

計画には索引形式版と抽出/対応表の版も保持します。途中で対応表版が変わった場合は会社処理を続けず、新しい計画を必要とします。source commitや出典hashは呼出元の宣言であり、署名認証や母集団そのものの真正性を保証するものではありません。

## API

```ts
import {ObservedFinancialArchive, FinancialSearchIndex, FinancialIndexBuild} from "edinet-ts";

const source = new ObservedFinancialArchive("data/frozen-observed.sqlite", {readOnly: true});
const index = new FinancialSearchIndex("data/financial-index.sqlite");
const build = new FinancialIndexBuild("data/financial-build.sqlite");
try {
  build.begin({
    id: "listed-20261028", generation: "listed-20261028",
    archiveSha256: source.snapshotSha256(),
    population, // asOf / observedAt / source / sourceSha256 / edinetCodes
    options: {cutoff, extractorVersion, sourceCommit}
  });
  const progress = build.runNext("listed-20261028", source, index, {limit: 20});
  if (progress.pending === 0 && progress.failed === 0) {
    build.finish("listed-20261028", index);
  }
} finally {
  build.close(); index.close(); source.close();
}
```

`population` は確認した母集団を明示します。既存の `CompanyMasterSnapshot` を使う場合は、`queryCompanyMaster` でasOf/knownAt/listingStatusを検査したrowsからコード集合を作り、snapshotの観測時刻・sourceUrl/sourceSha256も引き継ぎます。全コードの取得や「上場」の解釈をこの構築器が勝手に変更しません。

`begin` は同じ内容だけを再投入できます。構築IDが同じでも、指紋・母集団・世代名・cutoff・版・明示項目等が変われば上書きを拒否します。原本はメモリ/更新可能なアーカイブではなく、同じ指紋のreadOnlyファイルを使用します。計画optionsにedinetCodesを別途入れて母集団を狭めることはできません。

## checkpointと再試行

`runNext` の一回の処理数は1〜100社、既定20社です。未処理会社を先に選び、枠が残る場合に失敗会社を再試行します。各社では親子関係を含むアーカイブの会社指定を使い、一回の原観測10,000件という既存上限に全母集団が引っかからないようにします。その会社の関連集合自体が上限を超える場合は失敗として残し、観測を黙って切り捨てません。

会社別世代IDは計画hashと会社から固定します。索引への保存と状態DBへのcheckpointは別transactionですが、索引が先にcommitされてcheckpointが失敗した場合も、同じ会社世代を同内容で再投入できます。部分的な索引書込はSQL索引のtransactionで戻し、全件保存済みの会社世代だけをcheckpointします。

状態DBは会社処理のtransactionでwriterを直列化します。途中でprocessが停止すれば、その会社の状態更新はSQLiteのcommit境界で反映か未反映となります。未反映会社は次回に再実行します。試行回数は完了/失敗として記録した回数です。live workerのleaseや稼働中フラグではありません。停止済みDBを前提とするファイル保護と、同一内容の冪等再投入を使います。

処理失敗は `status:failed / lastErrorCode:company-materialization-failed` として保持し、元の例外文や入力内容は保存しません。他社の処理は継続できます。原本不在や未確定等、アーカイブが正常に返す保留は「機械的な処理失敗」ではなく、会社別世代の診断です。

`progress(id)` は計画と全会社の状態、pending/failed/completed、会社別世代ID/hash、行数、選択書類数、原本不在/未確定等の件数を返します。`companiesWithRows` は索引行を一つ以上作れた会社数で、必要指標が全て採用された会社数ではありません。原本・状態・索引を別パスへ移動しても、同じ入力と会社別世代を保つ場合は利用できます。欠落した別の索引DBを完了済みとすることはできません。

## 全件集約と旧世代

`finish` は全会社のcheckpointがcompleteであることを必要とします。会社別世代のhash、所有会社、cutoff、抽出/対応表版を計画と照合してから、全母集団を一つのSQL検索世代へ集約します。親子検査のため複数会社で読んだ同一観測は同一内容だけを重複除去し、矛盾する観測/財務行は拒否します。訂正差分と親の財務値は合成しません。

集約先の `FinancialIndexGeneration.assembly` に、計画hash、原本指紋、母集団、全会社別世代のID/hashを保持します。一回の会社数に関係なく、完成後は一つのgenerationで通常のSQL検索ができます。会社別世代も削除しません。

集約先の書込は一transactionです。状態DBの完了markerは集約索引のcommit後に保存します。途中停止でmarkerだけ未反映となった場合も、同じ集約内容を再確認してfinishを再実行できます。`finished:true` は状態DBに完了証跡があることです。progress単独で外部の索引ファイルの現在状態まで監査する意味ではなく、finishは提供された索引の実データを再検証します。

新しい原本/訂正・取下げ観測は、新しい入力指紋・計画・世代で処理します。古い世代を上書きせず、旧generationを明示した検索へ戻せます。稼働サービスのactive世代やcronをこのAPIが自動切替することはありません。

## CLI

```sh
edinet-ts plan-financial-index-build --state data/build.sqlite \
  --archive data/frozen-observed.sqlite --population population.json \
  --id listed-20261028 --generation listed-20261028 \
  --cutoff 2026-10-28T23:59:59+09:00 --extractor-version pinned-extractor-1

edinet-ts run-financial-index-build --state data/build.sqlite \
  --archive data/frozen-observed.sqlite --db data/index.sqlite \
  --id listed-20261028 --limit 100

edinet-ts financial-index-build-progress --state data/build.sqlite --id listed-20261028

edinet-ts finish-financial-index-build --state data/build.sqlite \
  --db data/index.sqlite --id listed-20261028
```

`population.json` は上記population object、2MiB以下です。planでは入力宣言を検証してから固定原本の指紋を取得します。runはcheckpointと原本指紋を検証し、会社ごとの状態をJSONで返します。pendingが残っていても失敗がなければ終了0、会社失敗があればJSONを保持して終了1です。finishはpending/failedが一つでもあれば拒否します。条件/DB/指紋の不正等は入力内容を表示せず終了1です。進捗CLIは状態DBの私有コピーをreadOnlyで読みます。

## 実母集団での確認と残工程

既存の公式コードリストsnapshot（asOf 2026-10-27）の上場3,813社と、原観測5,911件/保存原本4件を持つ固定アーカイブで確認しました。13社で状態/索引を閉じた後に再開し、100社ずつで全3,813社を完了、会社別3,813世代から一世代へ集約しました。失敗0、行を持つ会社4、財務行8、原本不在等の選択1,264件です。全市場の財務取得完了という結果ではありません。母集団は現在の上場集合であり、2025年当時の市場集合ではありません。

独立SQLite/JSON処理で母集団コード・全3,813 checkpoint・計画/会社別世代/集約markerのhashと来歴を検査し、80検索が直接構築した参照世代と一致しました。原本アーカイブのbyte不変、source/built・CLIでの計画/完了後run/finish再投入、CommonJS、配布物のNodeNext型検査も確認しています。新規API取得/課金はありません。

合成試験では、原観測10,002件からの会社別構築、失敗後再試行、checkpoint/完了markerの書込中断、指紋差替え拒否、訂正後の別世代と旧値保持、他社を名乗る訂正の重複診断、全母集団が揃わない集約の拒否を確認しました。

取得対象の差分計画と再開可能なネットワーク取得、全市場/全年度の実際の原本取得・充足率、比率/他指標・他領域の索引、本番の公開切替/運用・旧DB移行・利用先反映は、全体ロードマップの残工程です。
