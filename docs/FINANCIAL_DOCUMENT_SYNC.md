# 日別一覧backfillと財務アーカイブへの転送

`backfillFinancialDocumentLists` は既存メタデータDBへ日別一覧を補い、`archiveFinancialDocumentObservations` は保存した原観測を財務アーカイブへ転送します。ネットワーク取得と転送を別の入口にし、元の取得日時・再観測・空の日の証跡を保ちます。既存アーカイブ版1の形式は変更しません。

## 日別の補完と再巡回

```ts
import {EdinetRepository, EdinetXbrlDownloader, backfillFinancialDocumentLists} from "edinet-ts";

const repository = new EdinetRepository("data/daily.sqlite");
const downloader = new EdinetXbrlDownloader({requestTimeoutMs: 60_000});
try {
  const lists = await backfillFinancialDocumentLists(repository,
    (date, request) => downloader.search(date, undefined, request), {
      startDate: "2026-06-01", endDate: "2026-06-30", maxDays: 20, signal
    });
  console.log(lists.complete, lists.days, lists.nextAfterDate);
} finally {
  repository.close();
}
```

開始/終了は有効な暦日で、終了は日本時間の当日まで、一回の指定範囲は日付差1,830日までです。この上限は本APIの処理上限であり、提供元の保存期間を宣言するものではありません。`maxDays` は新規取得日数で既定20・最大100。取得済みの閉じた日は再利用し、上限に数えません。

一覧は書類種別で絞らず、日ごとに既存 `saveDocumentList` で原子的に保存します。書類0件の日にも取得証跡を残します。当日中の取得は完了扱いにせず、日本時間で翌日以降に一度取り直します。取得完了済み過去日の強制再取得・修正通知の全形式解決は別の運用です。

`days` は `cached / fetched / failed` と `closed` を返します。通信・保存の失敗は `document-list-fetch-failed` とし、入力値や例外本文を返さず後続の日へ進みます。signal中断時は受信後でも保存せず、すでにcommitした日を維持します。readOnly/close済みDBは通信前に拒否します。

取得上限や中断で未試行日が残れば、`nextAfterDate` を次回の `afterDate` に渡します。`remainingDates` はcursorより後の取得未完了日数で、前方の失敗が解消した意味ではありません。巡回後はcursorなしで再実行し、失敗日を再試行します。`complete` は指定範囲の全日が閉じた後の取得証跡を持つことです。当日を含む範囲では、当日分が取得済みでもfalseになります。

## 原観測を安定IDで転送する

```ts
import {EdinetRepository, ObservedFinancialArchive, archiveFinancialDocumentObservations} from "edinet-ts";

const repository = new EdinetRepository("data/daily.sqlite", {readOnly: true});
const archive = new ObservedFinancialArchive("data/financial.sqlite");
try {
  const result = archiveFinancialDocumentObservations(repository, archive, {
    sourceId: "daily-production-1", afterSequence: 0, pageSize: 1000, maxPages: 20
  });
  // result.nextAfterSequence を、同じ取得元/転送先への次回cursorに使います。
} finally {
  archive.close();
  repository.close();
}
```

`sourceId` は取得元DBの履歴を識別する固定名で、英数字/`_.-` の1〜64文字。同じ取得元を再open・コピーしても維持し、異なる取得元には別名を使います。保存観測IDは `metadata:<sourceId>:<sequence>`。別DBが同じsequenceを持っても衝突しません。同じsourceId/sequenceで金融選択に使う内容が違う場合は上書きせず停止します。

一覧日・実観測日時・親番号/状態・コード/期間等は保存値を引き継ぎ、過去の一覧日を実観測時刻へ転記しません。元DBの保存JSON全体は元DBに残し、財務アーカイブには既存の選択器が使う属性を保存します。

転送開始時の最終sequenceを `throughSequence` に固定し、その後に増えた観測は次の巡回へ回します。`pageSize` は既定/最大1,000、`maxPages` は既定20・最大1,000。各batchのアーカイブcommit後だけcursorを進めます。後続batchで失敗しても先のcommitを保持し、最初から再投入して成功分を再利用できます。`insertedObservations` と `readObservations` を分け、冪等再投入を新規取得と数えません。

`afterSequence > 0` では、転送元に該当sequenceがあり、転送先にもそのnamespaceの観測があり、同じ内容として再投入できることを確認します。別の取得元/転送先へcursorを流用しないでください。取得元の履歴を削除・編集したり、アーカイブの過去batchを手動削除した状態の認証/修復を行うものではありません。転送開始時の固定末尾まで処理すると `complete` です。元DBはreadOnlyで使えます。

cursorは返却JSONに含みます。呼出元が同じ転送先へのcursorを保存するか、0から冪等再投入します。誤ったcursorで過去の入力が黙って消えることを避け、外部状態を無条件に進めません。CLIの転送は同期処理で、batchの途中をsignalで強制中断する機能はありません。

## CLIと取得jobへの接続

```sh
edinet-ts backfill-financial-document-lists --metadata data/daily.sqlite \
  --start-date 2026-06-01 --end-date 2026-06-30 --max-days 20 --timeout-ms 60000

edinet-ts archive-financial-document-observations --metadata data/daily.sqlite \
  --archive data/financial.sqlite --source-id daily-production-1 \
  --after-sequence 0 --page-size 1000 --max-pages 20
```

backfillは `--after-date` で巡回を続け、SIGINTを取得へ伝えます。失敗/中断は結果JSON付き終了1。後続の未試行があるだけなら終了0です。転送も `complete / nextAfterSequence` を必ず確認します。入力/DB/保存内容の不整合は入力を表示しないstderrと終了1です。

一覧の補完→原観測の転送→アーカイブを停止→[全社取得job](FINANCIAL_SOURCE_JOB.md)の新規計画→原本取得→完了指紋を使う[財務索引構築](FINANCIAL_INDEX_BUILD.md)の順に接続します。既存取得jobの実行中に同じアーカイブへ新しい一覧を転送すると、一覧指紋の不一致で停止します。新しい一覧は新しい取得計画で扱います。公開世代/利用先の切替・timer/service設定は別工程です。

## 実地確認

既存の2025-06-23/24・2,402原観測DBをコピーし、2025-06-22の空の一覧と06-25の1,807観測だけをAPIで追加しました。4日分・計4,209観測を、転送cursor1,000→再open→配布用CLIで2,000→4,209まで転送。0からの再投入は新規0、過去に戻した取得日時はなく、元DBはbyte不変でした。提供元への一覧取得は2回で、有料サービスを追加していません。

source/builtの4,209件転送とキャッシュだけの一覧再巡回、CLI2入口の再投入、観測指紋/最終観測、CommonJS、配布物NodeNext型検査を確認しました。これらの観測を新たに実行中の原本取得jobへ混ぜたという結果ではありません。全市場/全年度の一覧backfill・充足率、本番定期運用は残工程です。

独立SQLite処理でも、4,209原観測・50,508保存fieldとrecord hash/索引、日別4件の完了証跡/観測日時、全sequence/cursorが一致しました。全126ファイル/3,596テスト、ビルド、公開型・配布物NodeNext型検査、認証値混入の非表示検査も成功しています。
