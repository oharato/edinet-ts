# 日別一覧backfillと財務アーカイブへの転送

日別一覧を取得し、その原観測を財務アーカイブへ転送します。取得完了の確認と転送の再開位置を分けて保存し、途中からやり直せるようにします。

## 二つの完了を分ける

| 工程 | 完了の意味 | 再開位置 |
|---|---|---|
| 日別一覧の取得 | 指定範囲の全日について、日が閉じた後の取得証跡がある | `nextAfterDate`。前方に失敗日がある場合は、巡回後にcursorなしで再試行 |
| 原観測の転送 | 固定した最終sequenceまで転送した | `nextAfterSequence`。同じ転送元・転送先・上限を使う |

終了コード0だけで完了とは判断せず、返却された `complete` を確認してください。取得・転送が完了しても、原本の取得や財務値の検査は別に必要です。

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

一覧は書類種別で絞らず、日ごとに既存 `saveDocumentList` で原子的に保存します。書類0件の日にも取得証跡を残します。

当日中の取得は完了扱いにせず、日本時間で翌日以降に一度取り直します。取得完了済み過去日の再取得は下記refreshAfterで指定します。

修正通知の既知対象日への再観測は下記の日次補助で扱い、未観測の原提出日や全履歴の復元は別です。

`days` は `cached / fetched / failed` と `closed` を返します。通信・保存の失敗は `document-list-fetch-failed` とし、入力値や例外本文を返さず後続の日へ進みます。

signal中断時は受信後でも保存せず、すでにcommitした日を維持します。readOnly/close済みDBは通信前に拒否します。

取得上限や中断で未試行日が残れば、`nextAfterDate` を次回の `afterDate` に渡します。`remainingDates` はcursorより後の取得未完了日数で、前方の失敗が解消した意味ではありません。

巡回後はcursorなしで再実行し、失敗日を再試行します。`complete` は指定範囲の全日が閉じた後の取得証跡を持つことです。

当日を含む範囲では、当日分が取得済みでもfalseになります。

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

`sourceId` は取得元DBの履歴を識別する固定名で、英数字/`_.-` の1〜64文字。同じ取得元を再読込・コピーしても維持し、異なる取得元には別名を使います。

保存観測IDは `metadata:<sourceId>:<sequence>`。別DBが同じsequenceを持っても衝突しません。

同じsourceId/sequenceで金融選択に使う内容が違う場合は上書きせず停止します。

一覧日・実観測日時・親番号/状態・コード/期間等は保存値を引き継ぎ、過去の一覧日を実観測時刻へ転記しません。元DBの保存JSON全体は元DBに残し、財務アーカイブには既存の選択器が使う属性を保存します。

転送開始時の最終sequenceを `throughSequence` に固定し、その後に増えた観測は次の巡回へ回します。`pageSize` は既定/最大1,000、`maxPages` は既定20・最大1,000。

各batchのアーカイブcommit後だけcursorを進めます。後続batchで失敗しても先のcommitを保持し、最初から再投入して成功分を再利用できます。

`insertedObservations` と `readObservations` を分け、冪等再投入を新規取得と数えません。

`afterSequence > 0` では、転送元に該当sequenceがあり、転送先にもそのnamespaceの観測があり、同じ内容として再投入できることを確認します。別の取得元/転送先へcursorを流用しないでください。

取得元の履歴を削除・編集したり、アーカイブの過去batchを手動削除した状態の認証/修復を行うものではありません。転送開始時の固定末尾まで処理すると `complete` です。

元DBはreadOnlyで使えます。

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

一覧の補完→原観測の転送→アーカイブを停止→[全社取得job](FINANCIAL_SOURCE_JOB.md)の新規計画→原本取得→完了指紋を使う[財務索引構築](FINANCIAL_INDEX_BUILD.md)の順に接続します。既存取得jobの実行中に同じアーカイブへ新しい一覧を転送すると、一覧指紋の不一致で停止します。

新しい一覧は新しい取得計画で扱います。公開世代/利用先の切替・timer/service設定は別工程です。

## 実地確認

既存の2025-06-23/24・2,402原観測DBをコピーし、2025-06-22の空の一覧と06-25の1,807観測だけをAPIで追加しました。4日分・計4,209観測を、転送cursor1,000→再読込→配布用CLIで2,000→4,209まで転送。

0からの再投入は新規0、過去に戻した取得日時はなく、元DBはbyte不変でした。提供元への一覧取得は2回で、有料サービスを追加していません。

source/builtの4,209件転送とキャッシュだけの一覧再巡回、CLI2入口の再投入、観測指紋/最終観測、CommonJS、配布物NodeNext型検査を確認しました。これらの観測を新たに実行中の原本取得jobへ混ぜたという結果ではありません。全市場/全年度の一覧backfill・充足率、本番定期運用は残工程です。

独立SQLite処理でも、4,209原観測・50,508保存fieldとrecord hash/索引、日別4件の完了証跡/観測日時、全sequence/cursorが一致しました。全126ファイル/3,596テスト、ビルド、公開型・配布物NodeNext型検査、認証値混入の非表示検査も成功しています。

## 1年窓への拡大（2026-10-29）

専用metadata DBで2025-10-29〜2026-10-28の365日を取得し、全日が閉じた後の完了証跡と83,828観測を保存しました。新しい専用財務アーカイブへ10,000件ごとにcursorを保存し、末尾83,828まで全件転送。

独立SQLite/JSON処理で全観測ID/hash、1,005,936項目、親/会社索引、一覧日/実観測日時、日別365件の完了証跡と件数が元metadata DBと一致しました。これらは取得時に実観測した履歴であり、過去日に既知だった履歴へ戻しません。

元の短い提出窓・1,268原本の取得/検索世代を変更せず、新しい一覧指紋とcutoffから別の原本取得計画へ進みます。1年分の一覧取得と、全原本/全指標の充足・公開可否は別の検証です。

## 実行開始時刻を固定して閉じた日を再観測する

`refreshAfter` を指定すると、その時刻以降に取得した閉じた日だけを再利用します。省略時は従来どおり取得済みの閉じた日を再利用します。

```ts
const refreshAfter = new Date().toISOString(); // この実行の状態として永続化
const page = await backfillFinancialDocumentLists(repository, fetchList, {
  startDate, endDate, refreshAfter, maxDays: 20, afterDate, signal,
});
// 次page/失敗再試行にも同じrefreshAfterを渡す
```

この時刻は現在以前でtimezone必須です。結果にもUTCへ正規化した `refreshAfter` を返します。再開時に時刻を作り直すと既に取り直した日まで再取得するため、同じ実行では固定します。取得commit後・cursor保存前に停止しても、保存済みの新しい完了証跡を再利用できます。新しい実行の開始時刻を指定した場合は、古い閉じた日も再取得します。

再取得に失敗した日を、以前の完了証跡だけで今回も成功したとは扱いません。`complete`/`remainingDates`/`closed` は指定時刻以降の取得証跡で判定します。

cursorより前の失敗があれば `remainingDates=0` でも `complete=false` となるため、従来どおりcursorなしで失敗を再試行します。空の一覧も新しい完了証跡を保存し、同じ実行の再投入では通信/観測追加を行いません。

原観測は追記し、過去のobservedAtやJSONを更新しません。取得元DBの `hasCompleteListForDate(date, notBefore)` でも、指定時刻以降の閉じた日かを確認できます。これは観測の最低時刻で、全日を同一瞬間に取得した証明や、未観測の訂正履歴の復元ではありません。

```sh
edinet-ts backfill-financial-document-lists --metadata data/daily.sqlite \
  --start-date 2026-06-01 --end-date 2026-06-30 \
  --refresh-after "$LIST_RUN_STARTED_AT" --max-days 20
```

公式仕様では過去日の情報も日次更新され、当日分ファイルが取得可能になれば前日までの更新完了を判断できます。日次運用ではこの確認と対象日/再観測範囲を別途固定し、`refreshAfter` だけで提供元の更新完了を宣言しません。

[EDINET API仕様書3-1-3](https://disclosure2dl.edinet-fsa.go.jp/guide/static/disclosure/download/ESE140206.pdf)を参照してください。既存の年次取得計画へ新しい一覧を途中追加しない制約は変わりません。

## 専用日次収集の運用補助

`scripts/roadmap/run-daily-metadata.mjs <private-config.json>` は、固定年次取得が完了してunitも停止した後にだけ、別metadata DBを更新する運用scriptです。公開CLI/APIではありません。

SDKのbuild済みdistと併せて固定runtimeへ配置し、元metadataのコピー・専用checkpointを事前作成します。原本/状態DBや公開catalogへ自動追記しません。

- Linuxの`flock`でcheckpointごとに排他し、checkpointは一時fileのfsync・atomic rename・親directoryのfsyncで保存します。API要求前に通信枠を保存し、停止で枠を消費しても過剰再試行しません。SDKの自動再試行は0、上限256要求/JST日（当日probeも含む）、timeout60秒です。
- 当日一覧の取得成功を確認してから直近7日と前回の完了日以降の空白期間を再観測します。当日一覧自体を閉じた日のmetadataへ保存しません。probeの取得時刻・件数・解析済み一覧配列のSHA-256をcheckpointへ保存します。
- 対象日とrefreshAfterは実行を跨いで固定します。各日のDB commitが再開位置となるためcursor保存前の停止でも同じ日を重複取得しません。失敗時は次の定期起動で再開し、JST日が変われば予算を更新して当日probeを取り直します。同日の完了後は追加通信しません。
- 取得前に元seedの物理SHAと全観測prefixが残っていることを照合し、各要求前に34GiBの空き容量を要求します。`.env`は通信開始条件成立後にdotenvで読み、値・通信URL・例外本文を出力しません。

configはversion1で、絶対pathのmetadataPath/checkpointPath/envPath/guardSummaryPath/seedPath、guardUnit、guardPlanSha256、guardWorkerSha256、seedSha256、安定したsourceIdを指定します。checkpointのenvelopeはversion1・metadataPath・seedSha256・sourceId・checkpointを持ち、内部checkpointは `{version:1, throughDate, budget:{date, requests:0}}` から始めます。

throughDateはseedで取得済みの閉じた最終日です。コピー先・namespaceを別用途のforkと共有しないでください。

通常はoneshot user serviceをJST09〜23時台に5分間隔のtimerで起動します（boot時の確認を除く）。当日一覧がまだ更新されない早朝に予算を使い切らないための運用設定です。

取得待機は正常終了、排他中はexit75、一覧取得失敗はexit1です。プロセス終了後の新規財務取得計画/アーカイブ作成・解析・品質検査・公開は別工程です。

直近7日より古い既取得日の修正を全件検知した保証はなく、通知から辿れない対象日や取得範囲外の変更には、全期間再巡回等の別の補完が必要です。機械の実再起動試験もこの補助の単体試験には含みません。

### 変更通知から既知の過去一覧日を再観測する

checkpoint本体の現行版3には、原観測のafterSequence、通知identityのseen、日付/最低観測時刻のpending、参照元が不明な通知の原観測sequenceを保存します。旧版1/2の予算・実行範囲を保持して版3へ移行し、必要な日次取得で完了証跡を作ります。旧runtimeへ戻す場合は対応するcheckpointも保持し、版3を旧形式として読ませません。

取下書はparentDocIDを、書類情報修正/不開示開始/解除の通知はdocIDと親宣言を使い、保存済み観測から元の一覧日を探します。通知より前の一覧日に加え、同日の提出も確認できます。同日の場合は、提出日時が有効で、その日本時間の日付が一覧日と一致し、通知と元観測の両時刻以前であることを必須にします。一覧日が同じだけでは元の提出を確認したことにしません。

既知日と通知の実observedAtを同じcheckpointへ保存し、その時刻以降の完全取得markerがない日を直近7日とは別に取り直します。同日の完全取得が既にあれば再取得しません。参照先が複数ある場合は全ての日付が確認できるまでunresolvedに残し、分かっている日だけ先に再観測します。親が不明な取下書を、その書類自身の提出で解決しません。

通知の判定基準は `notices.rulesVersion = 2` で管理します。これはcheckpoint本体の `version = 3` とは別です。判定版のない旧noticesは、処理済みの通知も含めて原観測を最初から再評価します。元データと既存の再取得待ちは維持し、再評価のcursorをpageごとに保存するため、中断後はその位置から再開できます。

旧ルールの `completedDay` と `lastCompletedRun` は完了証跡として再利用せず、取得予算・処理中の範囲を引き継いで当日probeと日次取得の完了を確認し直します。予算切れでも古い完了証跡に戻しません。新しいnoticesを未対応の旧runtimeへ渡さず、対応コードとcheckpointを組にして保持してください。

通知を新しく保存した直後・cursor保存前に停止しても、原観測の再読込で対象日を復元します。通知の原本文/過去のobservedAtを書き換えません。

通知の一覧日/ID/親/状態/操作日時/提出日時からidentityを作り、同一通知を一覧再取得の度に再追加しません。新しい操作時刻など別identityは新たな再観測要求とします。

空日の完了markerも使い、原観測/参照元の検索は1000行ごとに読み切ります。原観測pageごとのcursor/通知/対象日を一緒に保存します。

seenは100,000件、pending/不明通知は各10,000件を上限とし、超過は黙って捨てず停止します。保存失敗時は未保存のメモリ状態を破棄し、最後の永続checkpointから再開します。

参照元が分からない通知はunresolvedに原観測番号を残し、後続の原観測が追加されたときに再照合します。結果のunresolvedNoticesを失敗なし/対象外へ置き換えません。

completeは指定範囲と既知対象日の再観測完了であり、全通知の解決・全履歴の捕捉・財務値の検査完了ではありません。当日probeは提供元の準備確認に限り、当日の通知は翌日以降に閉じた一覧として保存して処理します。

年間保存一覧で対象候補が143日に及んだため、初回も処理できるよう256要求/JST日へ上限を見直しました（probeを含む、既存毎秒1要求・自動retry0）。追加の認証や有料データ源は使いません。日次財務の新規計画/解析/品質/公開は引き続き別工程です。

## 日次財務計画へ渡す原観測の末尾を固定する

`archiveFinancialDocumentObservations` の `throughSequence` には、計画対象の日次runの完了を確認して採番した末尾を指定できます。後続の呼出しでも同じ値を使うと、途中で元DBへ新しい観測が増えても同じ入力集合を転送します。

0は空集合、未記録の末尾/負数/小数やafterSequenceより小さい値は書込前に拒否します。省略時は従来どおり各呼出し開始時の末尾を固定します。

```ts
// 日次writerと同じ排他内で完了状態を確認し、sourceId/throughSequenceを計画へ永続化する。
const throughSequence = repository.getLastObservationSequence();
let afterSequence = 0;
do {
  const page = archiveFinancialDocumentObservations(repository, candidateArchive, {
    sourceId, throughSequence, afterSequence, pageSize: 1000, maxPages: 20
  });
  afterSequence = page.nextAfterSequence; // 原本commit後に永続化
  if (page.complete) break;
} while (true);
```

```sh
edinet-ts archive-financial-document-observations --metadata data/daily.sqlite \
  --archive data/new-cycle.sqlite --source-id daily-metadata-20261030-v1 \
  --through-sequence "$CYCLE_THROUGH_SEQUENCE" --after-sequence "$SAVED_SEQUENCE"
```

この上限は追加する観測の範囲です。転送先にすでにある後続観測を消しません。財務の別計画には新しい候補アーカイブを用意し、既存の計画/公開世代へ後続観測を混ぜません。原本は [取得時刻を固定した転送](OBSERVED_FINANCIAL_ARCHIVE.md#原本の取得時刻を固定した転送)と組み合わせられます。

候補の再作成には、少なくともsourceId・throughSequence・原本availableBy・書類選択cutoff・母集団・SDK/Node/SQLiteの固定版・観測pageSize・期待する観測指紋/候補指紋を保持します。原観測転送、原本転送、FinancialSourceJob.beginを順に実行して入力を封じ、取得後の別cutoff/候補から構築へ進みます。

これらの境界を使う日次財務runnerは実装済みです。raw pool/候補の保存寿命管理と、品質を満たした公開までの反復運用は引き続き残ります。稼働版と検証範囲は[実装状況](../plans/IMPLEMENTATION_STATUS.md)で確認してください。
