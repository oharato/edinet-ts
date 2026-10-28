# 不足財務原本の取得と再開

`ObservedFinancialArchive.planSourceAcquisition` と `acquireSources` は、保存済み一覧の訂正選択から不足原本を調べ、既存cacheまたはEDINETから取得した原本を一件ずつ保存します。既存アーカイブ版1の形式を維持します。一覧日の新規取得、定期起動や公開世代切替は別工程です。

## 対象の固定と保存済みの判定

`cutoff` は書類系列を選択する観測時点です。必要なら `edinetCodes` に1〜100社を指定します。一回の関連集合は10,000観測までで、超過時はエラーです。既存の会社/親子索引と選択器を共有し、他社を名乗る訂正も検査します。未解決な系列・取下げ・非開示等を取得対象へ変換せず、`selection` に理由を残します。選択された訂正leafだけが対象で、親書類へのfallbackはしません。

計画の `items` は書類ID順で、各書類の最新原本観測を次の状態に分けます。

| status | 意味 |
|---|---|
| `missing` | 原本観測なし |
| `declaration-only` | 最新hashの観測はあるが内容なし |
| `stored` | 最新hashの内容があり、保存byteのhashも一致 |
| `conflicting` | 最新の同時刻観測に複数hashあり |

原本観測の索引/record hash、保存内容のhashが破損していれば計画を失敗させます。破損を不足扱いにして再取得・上書きしません。異なる書類が同じhashを持つ場合は既存の内容を共有します。

取得差分は、選択cutoff後に保存された内容も再利用します。`availableByCutoff` は**最新原本観測の内容がcutoffまでに利用可能か**を表し、過去版の存在を集計する値ではありません。`stored` は財務値の取得成功ではありません。財務利用には別途 `createSnapshots` のcutoff、DEI/提出者/対象期照合、group・値ごとの状態を確認します。

## 一件ずつ保存して再開する

```ts
import {ObservedFinancialArchive, EdinetXbrlDownloader} from "edinet-ts";

const archive = new ObservedFinancialArchive("data/observed-financial.sqlite");
const downloader = new EdinetXbrlDownloader({
  rootDir: "downloads", requestTimeoutMs: 60_000
});
try {
  const query = {cutoff: "2026-10-28T03:46:38.635Z", edinetCodes: ["E01139"]};
  const plan = archive.planSourceAcquisition(query);
  const batch = await archive.acquireSources(query,
    (docID, request) => downloader.fetchXbrl(docID, request),
    {limit: 20, signal});
  // batch.results の失敗と batch.remaining を確認して次の巡回を決めます。
} finally {
  archive.close();
}
```

`planSourceAcquisition` は解析・通信・書込を行わず、readOnlyでも使えます。`acquireSources` は書込可能なアーカイブと取得関数を必要とします。標準の取得関数は既存cacheを優先し、なければ既存の通信制御・ZIP検査を通して取得します。cacheを書き換えません。取得したXMLは既存の64MiB/DOCTYPE/整形式検査を通し、UTF-8本文のSHA-256と**受取時点の実時計**を付けて `append` します。内容の提出者や財務値の解釈はsnapshot生成時に検証します。

提出日時・選択cutoff・cacheのmtimeを取得日時へ転記しません。既存cacheを新たにアーカイブへ取り込んだ場合も、アーカイブが今回観測した日時を記録します。既存の最新原本観測より時計が進んでいなければ失敗とし、未来の既存観測を過去の取得で解消したことにはしません。

一回の `limit` は既定20、最大100件です。`stored` を除外し、対象の書類ID順に処理します。ネットワーク待ち中にDB transactionを保持せず、成功ごとに独立commitします。成功の直後にprocessが終了しても、再open後の巡回ではその原本を取得し直しません。受信/検査/保存の失敗は `source-acquisition-failed` とし、例外本文や認証情報を返さず後続を処理します。

`nextAfterDocID` を `afterDocID` に渡すと、失敗を含め処理済み位置より後の不足書類へ進みます。`remaining` はそのcursorより後の未試行件数で、失敗の解消を意味しません。巡回後はcursorなしで再度実行すると、成功分を除き失敗・残件だけを試します。永久再試行は行いません。固定母集団の取得manifest・失敗履歴/試行数を永続化する入口は、[全社の原本取得job](FINANCIAL_SOURCE_JOB.md)を参照してください。

`AbortSignal` は取得関数へ渡し、開始前/受取後の中断も確認します。未commitの受信内容は保存せず、既にcommitした成功分を維持します。取得中にアーカイブをcloseすると停止します。取得workerは一つにし、同じアーカイブへの並列取得や索引構築との同時書込は行わないでください。取得後に停止したアーカイブの指紋を固定し、[検索世代の分割構築](FINANCIAL_INDEX_BUILD.md)を始めます。

## CLI

```sh
edinet-ts plan-financial-source-acquisition --archive data/observed-financial.sqlite \
  --cutoff 2026-10-28T03:46:38.635Z --edinet-codes E01139 --pretty

edinet-ts acquire-financial-sources --archive data/observed-financial.sqlite \
  --cutoff 2026-10-28T03:46:38.635Z --edinet-codes E01139 \
  --cache downloads --limit 20 --timeout-ms 60000 --pretty
```

取得は環境の `EDINET_API_KEY` と既存downloaderを使います。`--after-doc-id` が巡回cursorです。SIGINTで中断を伝達します。JSONに失敗や中断があれば終了1、後続の未試行だけが残る場合は終了0です。入力/DB等の失敗は内容を表示しないstderrと終了1です。終了0だけで全件取得や財務充足を判断せず、`results`・`remaining`・snapshotの状態を確認します。

## 実原本の接続確認

既存の5,911観測/4原本アーカイブを別ファイルへコピーし、現在上場5社の選択書類6原本をEDINETから新規取得しました。APIから最初の5件を保存し、配布用CLIで残り1件を取得。再open/再投入では6件を取得し直さず、元アーカイブのbyteも不変でした。取得後の時点では6 records/12財務行、既定30選択のうち25採用・4欠損・1曖昧です。欠損や曖昧を0で補いません。

今回の取得より前の固定cutoffでは、この6原本のrecordsは0です。source/builtの計画・6 snapshot、配布用CLIの残件取得/再投入、CommonJS公開関数、NodeNext型検査と検索索引への保存を確認しました。全市場の取得・品質保証や新たなPDF照合の完了を示す結果ではありません。無償APIを使用し、有料サービスは追加していません。

独立したSQLite/XML処理でも、取得6原本のhash・原観測/取得時刻からのknownAt、DEI65項目、当期context/範囲による候補選択の25採用/4欠損/1曖昧、検索索引12行の30選択が一致しました。
