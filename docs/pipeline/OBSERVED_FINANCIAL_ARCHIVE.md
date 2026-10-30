# 観測と原本を保持する財務アーカイブ

一覧の観測、取得した原本、解析結果を専用SQLiteへ保存します。原本と取得時刻を残し、指定した時点で使える情報から財務データを作ります。

`ObservedFinancialArchive` は、[観測付き財務snapshot](DOCUMENT_PIPELINE.md#選択原本からの自動財務snapshot)の入力と、版付きの解析結果を新規の専用SQLiteに保持します。プロセスを閉じた後も、cutoff・一覧観測・原本hashから同じ直接結果を再現します。

形式は `OBSERVED_FINANCIAL_ARCHIVE_VERSION = "1"` です。既存のメタデータDB、BS/明細Storeや世代DBは移行・変更しません。

## 保持するもの

| 保存対象 | 内容と識別 |
|---|---|
| 一覧観測 | 観測ID、実観測時刻、一覧日、書類/親ID、状態、提出者・証券コード・期間等、既存選択器が使う属性。元の文字列/null/未記録を保持 |
| 原本観測 | 書類ID・取得時刻・SHA-256。異なる時刻/hashの履歴を上書きしない |
| 原本内容 | UTF-8 XMLのBLOB。BOMを含む元byte列をhashで照合し、同じ内容は共有 |
| 解析結果 | 日本基準/IFRSのBS・明細・DEIと全候補/欠損/保留理由。原本ID/hash・指定項目・抽出版・source commit・対応表版ごとのキャッシュ |

一覧観測は選択器の既知属性を保存します。XBRL/PDF/CSV/添付/英文の可否宣言も保持し、数値コードは文字列に正規化します。

過去に可否宣言なしで保存した観測は未記録のままで、提供あり/なしを推測しません。任意の追加属性やgetterは読みません。

API応答全体の保存先を置き換えるものではなく、元の `EdinetRepository` の原観測/取得完了証跡は別に維持します。source commitは任意の40桁SHA、extractorVersionは呼出元が固定する必須の識別子です。

処理コードを更新したときは版/commitを変えて再解析します。会計基準判定・BS・明細の対応表版も自動でキャッシュキーに含めます。

原本と書類IDの対応・取得時刻は呼出元の宣言です。hashはbyte一致と偶発破損を検出するもので、原本の真正性や提出者の署名を保証しません。DEIのinstantを取得・提出・knownAtへ読み替えません。

<a id="api"></a>

## APIの使い方

```ts
import {ObservedFinancialArchive} from "edinet-ts";

const db = new ObservedFinancialArchive("data/observed-financial.sqlite");
try {
  db.append(observations, [{docID, availableAt, sourceSha256, xml}]);
  const result = db.createSnapshots({
    cutoff: "2026-10-28T00:00:00+09:00",
    extractorVersion: "fixed-extractor-1",
    sourceCommit,
    edinetCodes: ["E00007"]
  });
  console.log(result.records, result.unavailableSources, result.cache);
} finally {
  db.close();
}
```

`append` は一batchの観測10,000件・観測JSON16MiB、原本100件/合計256MiBまでを受け付けます。batchを分けて保存量を増やせます。同じ観測IDの同じ内容は再投入できますが、異なる内容は拒否し、batch全体を戻します。再観測は別の観測IDを付けます。日時のtimezone表記は同じ瞬間のUTCへ正規化します。

`xml` を省略して取得済み/未読込の宣言を保持し、後から同じhashの内容を追記できます。原本だけ先に保存し、一覧を後から追記することもできます。原本内容が変わった場合は、実際の取得時刻と新hashで別の原本観測を追加します。不正hash/不正UTF-8は未選択原本でも保存しません。未解決な系列や未知の基準を正常値へ変えません。

`createSnapshots` はcutoff付き訂正選択、当該時点で最新の原本観測、原本hash、DEIの提出者/コード/対象期/書類種別を照合します。必要な一覧観測と原本取得の遅い時刻を `knownAt` とします。

同時刻の異なるhashは `conflicting-source-observations` として保留し、古い原本へ戻しません。cutoff後の原本しかない場合も利用不可のままです。

訂正差分と親の値の合成は行いません。

戻り値の `records` は直接処理の結果であり、`result.status` や各group/各選択値の状態も確認します。IFRS単体・基準不明・証券コードなし等は未確定のまま保持します。金額の原符号・精度・元文字列、欠損/曖昧の理由を保存し、0値や他基準で補いません。

## 会社指定・batch・再解析

一回の選択は10,000観測までです。全アーカイブがこの件数を超える場合は、`edinetCodes` に1〜100社を指定して読み出します。

会社・書類・親番号のSQL索引を使い、関連する親子関係を再帰的に含めます。他社を名乗る訂正を単に落として古い元書類を選ぶことを防ぎます。

`selection` には検査に必要な関連書類も含まれ、返す `records` / `unavailableSources` は指定会社の対象に限ります。関連集合自体が10,000観測を超える場合はエラーとし、黙って一部を切り捨てません。

選択原本が100件を超える場合も、内部で100件/256MiB以下のbatchへ分けます。一原本は256MiBまでです。原本索引は書類IDと取得時刻を保持し、選択対象の宣言と内容だけを読みます。戻り値全体はメモリへ返すため、大量の結果は会社ごとに処理します。

`cache.hits` は原本を再解析せず保存結果を再利用した件数、`cache.extracted` は新規解析した件数です。版・source commit・明示項目・原本hashのいずれかが変われば別の解析結果として残します。

解析失敗と基準に合わない項目指定も版ごとに保持し、旧版の成功結果へ切り替えません。原本とキャッシュの整合検査は再利用時も行います。

戻り値はJSONで保持できる形で、元objectの値がundefinedだった任意属性は省略されます。

原本・観測と解析キャッシュの各書込はtransactionで行います。中断したbatchはSQLiteのcommit境界で全件反映か全件未反映となり、同じ入力で再開できます。

完了済みの原本や過去版を削除せず、古いcutoff/抽出版も明示して再現します。公開世代の切替・旧世代復帰は既存の世代Storeとは別の機能で、このアーカイブが本番サービスを自動切替することはありません。

## ファイル保護とCLI

既存DBは私有コピーで固定schemaを検査してから利用します。別形式・空の既存ファイル・symlink/hardlink・追加trigger/index・既存副ファイルを拒否します。DB本体がまだなくても `-journal/-wal/-shm` がある場合は作成しません。未知の元ファイルへSQLiteを直接接続しません。

`{readOnly:true}` は停止したDBの私有コピーから読み、元のDBや副ファイルを更新しません。cache missは計算して返しますが保存しません。

コピーは1MiBずつ行い、DB全体と同程度の一時ディスク領域が必要です。close時にコピーを除去します。

書込用途も同形式の停止済みDBを前提とし、既存のオンラインサービスDBをそのまま指定しません。

```sh
edinet-ts archive-financial-snapshots --db data/observed-financial.sqlite \
  --observations observations.json --manifest sources.json \
  --cutoff 2026-10-28T00:00:00+09:00 --extractor-version fixed-extractor-1

edinet-ts archive-financial-snapshots --db data/observed-financial.sqlite \
  --read-only --edinet-codes E00007 --detail-metrics costOfSales \
  --cutoff 2026-10-28T00:00:00+09:00 --extractor-version fixed-extractor-1
```

manifestは `docID / availableAt / sourceSha256 / file?` の配列で2MiB以下、観測JSONは16MiB以下です。fileはmanifest基準で読み、BOMを保持します。

fileの省略は未読込宣言で、明示したfileの読込失敗は終了1です。readOnlyと追記指定は同時に使えません。

CLIは条件・宣言・原本hashをDB作成前に検査し、繰返し投入の前検査ではXMLを再解析しません。

追記とsnapshot生成はそれぞれ別のtransactionです。追記後に抽出が失敗しても原観測/原本は残り、保存済み入力から再実行できます。正常な保留は理由付きJSON/終了0、入力・DB・破損等のエラーは内容を表示せず終了1です。原本の解析失敗と、DB/cacheの読書き失敗・破損を混同しません。外部SQL書込や暗号的な改竄認証には対応しません。

## 実データと残工程

既存2,402観測に、APIから今回取得した2026-06-24/25の3,509観測を加え、実5,911観測を保存しました。選択1,574系列のうち保存済み日本基準/IFRS4原本を接続し、残る1,570系列は原本なしです。

元キャッシュと元メタデータDBは読取専用で扱い、一覧2日分以外の新規取得・課金は行っていません。実観測は2026年の取得時刻を保持し、2025年のcutoffでは0件です。

独立SQLite/XML/JSON処理で、観測5,911件・原本4件・DEI44項目・既定財務値26件・既知時刻が一致しました。別projectionのIFRS17項目×2原本も保存・再利用し、34選択の22採用/12不在、完全一致重複3件を元XMLと独立照合しました。

DBの再読込後は既定4件を再解析せず再利用し、readOnlyの元ファイル不変、source/builtのobject・CLI JSON、会社指定も確認しました。今回の照合はXMLと保存・呼出し経路の検証で、新たなPDF全数照合ではありません。

実5,911観測/4原本・約21.6MiBの専用DBで、readOnlyの解析cache miss 1回は約6.67秒、hitは1回ウォームアップ後5回の中央値で約534msでした。私有コピーを含むopenは約9.5msで、query時間とは分けています。

Node26.12.1/SQLite3.54.0、Core i5-7260U、一つのprocess、原本/OSのcacheが温まった条件です。全市場や別の原本サイズでの速度保証ではありません。

合成試験では、原本101件の内部batch、10,001観測の保存後の会社指定、他社を名乗る訂正の系列停止、同時刻hash競合、訂正/取下げ、失敗batchのrollback、冪等投入、破損、未知DB/リンク/副ファイル保護を確認しています。

これは観測・原本・直接結果の永続化と再解析の削減です。[直接BS/明細の別DB索引](FINANCIAL_SEARCH_INDEX.md)を追加しました。

比率/他指標の索引、全市場での性能・充足率、訂正差分の完全版再構成、取得jobの運用と公開世代/利用先の切替、旧形式からの移行は全体ロードマップの残工程です。既存Store/世代DBを財務アーカイブへ自動移行しません。

不足原本を既存cache/EDINETから一件ずつ取り込み、再読込後に成功分を再利用する入口は、[原本の差分取得と再開](FINANCIAL_SOURCE_ACQUISITION.md)を参照してください。

母集団全件の取得manifest・試行履歴/回数・未処理優先の再試行は、[全社の原本取得job](FINANCIAL_SOURCE_JOB.md)で管理します。

## 一覧観測の反復検査

`observationsSha256()` は、毎回SQLiteから全観測をID順に読み、従来と同じ`edinet-observations-v1`の全体指紋を再計算します。同じinstanceで一度検証した行について、**id・本文・保存hash・doc_id・parent_doc_id・edinet_code・observed_msの全列**が完全一致するときだけ、行hash/JSON解析/本文と索引の突合の重複計算を省きます。

mtimeや「同じDB接続」だけでは再利用しません。

追加・削除・別接続の更新は毎回のSQL読取に反映され、全列のどれかが変われば行を再検証します。返す全体指紋そのものはキャッシュしません。原本BLOBや解析結果の検査もこの仕組みで省略しません。記録済み原本のhash/knownAt等を照合する取得jobの保護は維持します。

検証済み行の保持には200,000行・概算256MiBの上限があり、超過分は従来通り毎回検査します。概算は文字列のUTF-16長と行あたりの固定分から求め、実際のJS heap量と同一ではありません。closeで保持行を解放します。新規作成/再読込後の最初の検査は全行を解析し、キャッシュ構築分のコストが増えます。単発処理を一律に速くする変更ではありません。

固定した365日分の83,828観測では、旧版の5回が約1.73〜2.45秒、追加後の初回は約3.37秒、2回目以降は約0.93〜1.02秒でした。概算保持量は109,803,178 bytesで、全行が上限内に収まりました。

旧版/追加後の全指紋が一致し、独立Python/SQLite処理でも全行のhash・索引と同じ指紋を確認。これは観測検査単体の計測で、ネットワークや原本全体の検査を含む取得処理全体の倍率ではありません。

追加後の全142ファイル/3,799テスト・build・公開NodeNext型（型定義検査を省略しない）が成功。専用13テストで全7列の変更・別接続の正当更新/削除・rollback・容量/件数上限・readOnlyコピー・closeを確認。

配布物の書込/読取専用とCommonJSも同じ83,828観測の指紋を返し、DBの全byte hashは不変でした。公開配布PIN3cc4618より後の改善で、アーカイブ形式/指紋形式・既存の抽出/保存結果は変更しません。

## 全版の原本を別アーカイブへ引き継ぐ

可否宣言などを元metadataから再構成した新しいアーカイブへ、既に取得した原本を再ダウンロードせず引き継げます。元の観測・原本・計画・試行履歴は保持します。

```ts
const source = new ObservedFinancialArchive("stopped-old.sqlite", {readOnly: true});
const target = new ObservedFinancialArchive("new.sqlite");
try {
  const sourceArchiveSha256 = source.snapshotSha256();
  let afterId: string | undefined;
  for (;;) {
    const page = source.transferSourcesTo(target, {sourceArchiveSha256, afterId, limit: 20});
    // この結果と元指紋を永続化してから次のpageへ進めます。
    if (page.complete) break;
    afterId = page.nextAfterId;
  }
} finally {
  target.close(); source.close();
}
```

`sourceArchiveSha256` は停止した転送元全体の物理指紋で、cursorはこの指紋と組で保存します。各回は最大100原本観測・内容合計256MiB、原本内容は一件ずつ読みます。

同一書類の全版、取得時刻、内容なしの宣言、共有内容、BOMを保持し、record/索引/hash/UTF-8を検査します。破損を不足へ読み替えません。

一件ごとの追記なので、後続で失敗しても先に保存した分は残り、同じpageを再実行すると重複せず続行できます。

転送元はreadOnly、転送先は異なる書込可能アーカイブです。一覧観測・解析cache・取得jobの試行履歴を転送するAPIではありません。一覧は元metadataから同じnamespaceで再構成し、旧job/履歴は別の固定ファイルとして保存して引継ぎ記録に紐付けます。新しい一覧指紋を既存計画へ上書きせず、新規IDの計画を作ります。

```sh
edinet-ts transfer-financial-archive-sources \
  --source stopped-old.sqlite --archive new.sqlite \
  --source-sha256 <固定した転送元SHA-256> --limit 20 --pretty
# 続きは同じ指紋と --after-id <nextAfterId> を指定
```

CLIも指紋が一致する前に転送先を作成せず、入力内容をエラーへ表示しません。

停止中のhot journalから別候補へ戻す処理は[専用DBの復旧](SQLITE_RECOVERY.md)を参照してください。復旧後は構造一致だけで原本/財務データを利用可能にせず、一覧観測指紋と全原本宣言/内容を既存APIで検査します。通常のコンストラクタの副ファイル拒否は維持しています。

### 原本の取得時刻を固定した転送

`transferSourcesTo` の `availableBy` はtimezone付きの上限（inclusive）です。その時刻以前の全版/宣言/内容を転送し、結果のavailableByはUTCへ正規化します。省略時は従来どおり全版です。原本はdocIDごとの最新だけへ縮約せず、同時刻の異なるhashや宣言だけの原本も保持します。

```ts
const page = source.transferSourcesTo(candidate, {
  sourceArchiveSha256, availableBy: cycle.sourceAvailableBy, afterId, limit: 20
});
```

```sh
edinet-ts transfer-financial-archive-sources --source data/stopped-pool.sqlite \
  --archive data/new-cycle.sqlite --source-sha256 "$SOURCE_POOL_SHA256" \
  --available-by "$SOURCE_AVAILABLE_BY" --after-id "$SAVED_SOURCE_ID"
```

再開時は元snapshot指紋と同じavailableByを使います。取得時点の範囲外のcursorは拒否します。条件を変更する場合は新しい候補へcursorなしで始めてください。IDはhash順であり、時刻条件を広げて同じcursorを続けると前方の追加原本を読み落とすためです。転送先は追記先であり、すでにある未来原本を消す処理ではありません。

宣言は1000件ごとに読み、原本ID/本文/hash/索引を検査してから時刻で絞ります。未来へ偽装された索引で過去原本を隠し、空集合として完了することを防ぎます。

SQLから宣言の実長と先頭2049文字だけを読み、実長2048文字の上限を検査するため、巨大な宣言をJSへ全量読みしません。転送本文として対象外の未来XMLを読み出しません（固定snapshotのコピー/全体指紋検査は別です）。

対象原本の既存の256MiB上限・UTF-8/BOM・内容hash検査、原本ごとのcommitは維持します。

原観測の固定末尾と組み合わせ、同じSDK/SQLite版・入力/追加順・観測pageSizeで新しい空候補へ再作成すると、後から増えた観測/原本を除いた入力を再現できます。未来データ追加後のpoolの物理指紋は変わるため、新しいsource指紋で読み、以前の候補の期待指紋と照合した別の再生成証跡を残します。

過去のmanifestを書き換えません。上限以前の原本が後から追加された場合等は期待指紋が変わるため、同じ候補として黙って受け入れません。

異なるSDK/SQLite版や解析cache追加後のbyte一致を保証する機能ではありません。

2026-10-30の追加測定では、実139,758観測の保持見積りが198.78 MiBで旧上限を超えていたため、上限を200,000行・概算256 MiBへ変更しました。全行のSQLite再読込・指紋再計算は維持し、完全一致行の再解析だけを省きます。

同じ共有hostで旧/新版を交互に2processずつ実行し、各4回の指紋がすべて一致。反復3回分の中央値は旧2,559 ms/新1,629 ms、再解析は各49,784行から0行、実行後RSSは約264 MiBから約305 MiBでした。単一hostの限定測定で、通信や取得全体の速度・一般的なピークメモリ保証ではありません。私有の比較記録は `data/roadmap/fingerprint-cache-paired-comparison.json` です。稼働中の固定runtimeはこの変更で書き換えません。
