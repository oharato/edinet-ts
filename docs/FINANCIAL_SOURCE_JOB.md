# 全社の原本取得計画と試行履歴

`FinancialSourceJob` は、母集団・書類選択cutoff・一覧観測を固定し、[不足原本の取得](FINANCIAL_SOURCE_ACQUISITION.md)を専用状態SQLiteで管理します。`FINANCIAL_SOURCE_JOB_VERSION = "2"`。失敗/中断履歴と試行回数を再open後も保持し、未処理を先に取得します。原本アーカイブ版1を変更しません。

## 固定する入力

`begin({id, cutoff, population}, readOnlyArchive)` は、停止したアーカイブのreadOnlyコピーから計画します。母集団は[索引構築と同じ出典付き形式](FINANCIAL_INDEX_BUILD.md)で1〜100,000社。開始時の原本ファイルSHA-256に加え、全一覧観測のSHA-256を固定します。一覧の指紋は観測ID順の保存JSONを索引/record hashと照合して走査し、原本や解析cacheの追加では変わりません。

会社ごとに既存選択器を使い、指定母集団の選択書類だけを固定manifestにします。母集団が100社・全保存観測が10,000件を超えていても、各社の関連観測が上限内なら計画できます。一社の関連集合が10,000観測を超える場合や一計画100,000書類超は停止します。未解決/利用不可の系列は取得対象へ変えず、検査した系列の状態件数を `selectionCounts` に残します。関連系列には母集団外の書類も含まれ得るため、この件数を全市場充足率とは扱いません。

manifestは選択書類/根書類/会社と開始時の原本状態を持ちます。既に最新原本の内容が検査できた書類は、試行0・`complete` から始まります。書類が選択されなかった会社も母集団に残しますが、取得taskは作りません。taskが0件で完了しても、その会社に財務値が揃ったという意味ではありません。

一覧観測に `xbrlFlag=0` が明示され、保存済みXMLがない書類は、試行0・`unavailable` になります。`formatAvailability` に選択書類自身の観測ID・観測時刻と形式宣言を残し、取得通信を行いません。進捗は `completed` と `unavailable` を分け、両者の合計が全task数なら `finished` です。`finish` は未提供の根拠も元アーカイブと再照合し、`documents` は保存済み原本件数だけ、`unavailableDocuments` は未提供書類の一覧を返します。取得処理の終了は財務品質の充足を意味しません。

版1の保存済み計画はそのまま読めます。版2を旧実装へ渡すと拒否されます。旧計画へ可否宣言を後付けすると固定観測指紋が変わるため、元計画・履歴を保持した新しい計画が必要です。

同じID・同じ初期アーカイブ・同じ入力の再投入は同じ計画を返します。異なるcutoff/母集団/初期ファイル指紋は同じIDへ上書きしません。取得後のアーカイブから新規に計画する場合は新しいIDを使います。

## APIと再開

```ts
import {FinancialSourceJob, ObservedFinancialArchive, EdinetXbrlDownloader} from "edinet-ts";

const state = new FinancialSourceJob("data/source-job.sqlite");
const frozen = new ObservedFinancialArchive("data/financial.sqlite", {readOnly: true});
try {
  state.begin({id: "listed-run-1", cutoff, population}, frozen);
} finally {
  frozen.close();
}
const archive = new ObservedFinancialArchive("data/financial.sqlite");
const downloader = new EdinetXbrlDownloader({rootDir: "downloads", requestTimeoutMs: 60_000});
try {
  const progress = await state.runNext("listed-run-1", archive,
    (id, request) => downloader.fetchXbrl(id, request), {limit: 20, signal});
  console.log(progress.pending, progress.failed, progress.history);
} finally {
  archive.close();
  state.close();
}
```

一回の `limit` は既定20・最大100です。未処理を先に、次に失敗/実行途中のtaskを試行数の少ない順・書類ID順に選びます。一回のbatch内で同じ失敗を無限に再試行しません。再開時に別の一覧へ接続しないよう、全一覧観測の指紋を照合します。完了済み原本も最新のhash・取得日時・実内容をcheckpointと照合し、不足/差し替わりを成功扱いにしません。

各試行は、通信前に `started` 履歴と `running` taskをcommitします。その後は当該一件の状態DB書込lockを保持して取得/原本commit/checkpointまで処理します。別接続のworkerによる状態更新・二重取得を防ぐためで、原本アーカイブのtransactionを通信中に保持するものではありません。標準downloaderには本文受信までのtimeoutを指定してください。

原本は実時計・SHA-256・XML検査付きで一件ずつ独立commitします。その後、状態DBの試行を `complete`、taskを `complete` にします。原本commit直後に状態書込が失敗した場合、`started` が残ります。再開では古い試行を `interrupted` にし、既に保存できた原本を再利用して次の試行を完了します。受信待ち中にprocessが強制終了した場合も同じ試行履歴から再開します。

通信/検査/原本保存の失敗は `failed` / `source-acquisition-failed`、signal中断は `interrupted` / `source-acquisition-interrupted` として保持し、例外本文を保存しません。成功には `downloaded` または `reused` の結果を残します。試行回数は通信回数と同じではなく、再利用での復旧も一試行です。状態DBの書込失敗・一覧変更・checkpoint破損は全体エラーとして停止し、正常な取得失敗と混同しません。

同じ接続を実行中に再度run/progress/begin/closeしないでください。同一状態DBの別接続からの書込はSQLiteで排他します。同じ原本に別の状態DBを使った並列取得は行わず、一つのworker/状態DBで運用します。既存専用DBと同じ副ファイル/未知形式/リンク保護を維持し、SQLite書込途中のhot journal等をこのAPIが無条件に削除・回復することはありません。

## 完了の確認と後続

`progress.finished` は固定manifestの全taskが完了したことを示し、外部ファイルの現在の状態を検査する値ではありません。取得を停止して原本をreadOnlyで開き、`finish(id, archive)` を呼ぶと、全完了taskと一覧/保存原本を再照合し、`planSha256 / archiveSha256 / selectionCutoff / population / documents` を返します。返す原本指紋は、開始時の指紋とは異なります。既に保存した入力の削除・自動公開切替は行いません。

取得後の索引構築では、[固定世代構築](FINANCIAL_INDEX_BUILD.md)の入力へ完了時の原本指紋を渡します。`selectionCutoff` は過去の書類選択時点です。今回取得した原本をその過去日時に利用可能だったことにはせず、財務利用cutoffは実取得後に指定します。cutoffを進めると別の観測が選択される場合があるため、新しいcutoffでも選択/取得対象を確認します。

全taskの完了は、元の一覧窓が全市場/全年度を覆ったこと、原本が正常な財務snapshotになること、全指標が採用されたことを保証しません。欠損・曖昧・基準非対応や未選択の系列、一覧窓/母集団不足は引き続き別に集計します。

## CLI

```sh
edinet-ts plan-financial-source-job --state data/source-job.sqlite \
  --archive data/financial.sqlite --population population.json \
  --id listed-run-1 --cutoff 2026-10-28T05:56:15.250Z

edinet-ts run-financial-source-job --state data/source-job.sqlite \
  --archive data/financial.sqlite --id listed-run-1 --cache downloads \
  --limit 20 --timeout-ms 60000

edinet-ts financial-source-job-progress --state data/source-job.sqlite --id listed-run-1
edinet-ts finish-financial-source-job --state data/source-job.sqlite \
  --archive data/financial.sqlite --id listed-run-1
```

母集団JSONは2MiB以下です。取得は環境の `EDINET_API_KEY` を値非表示で使い、既存cache/通信/ZIP保護を再利用します。SIGINTを取得関数へ伝えます。失敗/実行途中/中断があればcheckpoint JSON付き終了1、未処理だけが残る場合は終了0。入力/DB/固定一覧等のエラーは入力内容を表示しないstderrと終了1です。progress/finishはreadOnlyで元ファイルを変更しません。

## 実データと検証範囲

現在上場3,813社・保存5,911観測から1,268選択書類を計画しました。初期保存済み10原本を再利用し、実EDINETから2件取得→状態/原本を閉じる→再openして1件取得と進め、完了13・未処理1,255、成功試行履歴3件を保存しました。元アーカイブのコピーで処理し、元ファイルは不変です。別の5社6書類の完了済みsubsetでは、配布用CLIの計画/run再投入/progress/finishを確認しました。

合成試験は、失敗優先順位・履歴/試行数、原本commit後のcheckpoint失敗と再利用、受信中中断、実processの受信待ちでのSIGKILL/復旧、別接続の二重取得排他、101社/10,003観測、一覧変更・原本差し替わり・状態破損を含みます。全市場実取得、日別一覧backfill/定期起動、原本/状態書込中の全クラッシュ地点、全市場の財務品質・本番/利用先切替は残工程です。

独立SQLite処理でも、全5,911観測の指紋・3,813社の母集団・1,268 taskのmanifest、初期/現在の原本hash・13完了/1,255未処理と3試行のhash/時刻順を照合しました。全124ファイル/3,585テスト、ビルド、公開型・配布物NodeNext型検査、source/built・CommonJS確認が成功しています。

一覧の原観測をアーカイブへ渡す前工程は、[日別一覧backfill・観測転送](FINANCIAL_DOCUMENT_SYNC.md)を参照してください。既存取得jobに新しい一覧を途中追加せず、新規計画へ切り替えます。


停止後にhot journalが残った場合は、[専用DB復旧候補](SQLITE_RECOVERY.md)で元DB/journalを保持して別ファイルへ復旧できます。復旧の構造検査だけで既存計画へ戻さず、`progress` で全計画/task/履歴と期待する計画指紋を検査し、原本との照合も行います。実行config/runtimeが固定する状態DBパス・指紋の引継ぎは別の管理操作です。通常のコンストラクタや `runNext` が元journalを消して再開することはありません。

## 復旧候補・未完了checkpointの再開前監査

`audit` / `audit-financial-source-job` は、指定jobの計画・全task/試行履歴と、完了原本/未提供根拠をreadOnlyで照合します。途中までしか取得できていないcheckpointも対象です。

```ts
import {FinancialSourceJob, ObservedFinancialArchive} from "edinet-ts";

const state = new FinancialSourceJob(recovery.output.path, {readOnly: true});
const archive = new ObservedFinancialArchive(stoppedArchivePath, {readOnly: true});
try {
  const audit = state.audit(jobId, archive, {
    planSha256: expectedPlanSha256,
    archiveSha256: stoppedArchiveSha256,
  });
  if (audit.stateSha256 !== recovery.output.sha256) throw new Error("復旧候補が異なります");
  // この状態/原本/計画の指紋を新しい固定実行configへ渡します。
} finally { archive.close(); state.close(); }
```

両接続は停止したファイルから開くreadOnly接続が必要です。`planSha256` は保存済みの期待計画指紋です。`archiveSha256` は**今回停止した原本アーカイブの物理指紋**で、取得開始時の初期アーカイブ指紋とは異なります。原本の追加で物理指紋が変わっても、一覧観測は計画時の指紋と一致する必要があります。

監査結果は版1で、状態/原本/一覧観測/計画の指紋と、完了・未処理・失敗・保存された実行中task・未提供・試行履歴の件数を返します。完了taskのhash/取得時刻と実内容、未提供taskの選択観測/形式宣言を再検査します。原本欠損/破損・一覧追加・期待指紋違いを受け入れません。`running` は保存されたtaskの状態であり、processが稼働している証拠ではありません。

`finished` は取得処理の状態で、未完了でも監査は成功し得ます。未提供を完了原本件数へ足しません。`financialValuesValidated` はfalseで、DEI/会計基準・財務値・検索品質・公開条件の検査は後続のsnapshot/索引工程で行います。別jobや未参照の解析cacheを監査した結果ではありません。

```sh
edinet-ts audit-financial-source-job \
  --state recovery-attempt-1/recovered.sqlite \
  --archive stopped-archive.sqlite --id "$SOURCE_JOB_ID" \
  --plan-sha256 "$SOURCE_JOB_PLAN_SHA256" \
  --archive-sha256 "$STOPPED_ARCHIVE_SHA256" --pretty
```

CLIは入力ファイルを書き換えず、成功時だけ監査結果をJSONで返します。失敗は終了1と内容非表示のエラーです。復旧候補への切替では、旧config/runtime/状態と原本を保持し、監査済みの指紋と状態パスを新しく固定してから再開します。現在のruntime/configを実行中に書換える操作や、監査結果だけでの公開切替は行いません。

計画開始時から保存済みの原本は、試行0・完了の状態と計画に記録したhash/取得時刻を保持します。taskのrecord hashが一致していても、これらの初期保存済みtaskを未処理へ戻したり別の原本へ付け替えたりした状態は拒否します。
