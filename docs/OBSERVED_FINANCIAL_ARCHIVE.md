# 観測と原本を保持する財務アーカイブ

`ObservedFinancialArchive` は、[観測付き財務snapshot](DOCUMENT_PIPELINE.md#選択原本からの自動財務snapshot)の入力と、版付きの解析結果を新規の専用SQLiteに保持します。プロセスを閉じた後も、cutoff・一覧観測・原本hashから同じ直接結果を再現します。形式は `OBSERVED_FINANCIAL_ARCHIVE_VERSION = "1"` です。既存のメタデータDB、BS/明細Storeや世代DBは移行・変更しません。

## 保持するもの

| 保存対象 | 内容と識別 |
|---|---|
| 一覧観測 | 観測ID、実観測時刻、一覧日、書類/親ID、状態、提出者・証券コード・期間等、既存選択器が使う属性。元の文字列/null/未記録を保持 |
| 原本観測 | 書類ID・取得時刻・SHA-256。異なる時刻/hashの履歴を上書きしない |
| 原本内容 | UTF-8 XMLのBLOB。BOMを含む元byte列をhashで照合し、同じ内容は共有 |
| 解析結果 | 日本基準/IFRSのBS・明細・DEIと全候補/欠損/保留理由。原本ID/hash・指定項目・抽出版・source commit・対応表版ごとのキャッシュ |

一覧観測は選択器の既知属性を保存します。任意の追加属性やgetterは読みません。API応答全体の保存先を置き換えるものではなく、元の `EdinetRepository` の原観測/取得完了証跡は別に維持します。source commitは任意の40桁SHA、extractorVersionは呼出元が固定する必須の識別子です。処理コードを更新したときは版/commitを変えて再解析します。会計基準判定・BS・明細の対応表版も自動でキャッシュキーに含めます。

原本と書類IDの対応・取得時刻は呼出元の宣言です。hashはbyte一致と偶発破損を検出するもので、原本の真正性や提出者の署名を保証しません。DEIのinstantを取得・提出・knownAtへ読み替えません。

## API

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

`createSnapshots` はcutoff付き訂正選択、当該時点で最新の原本観測、原本hash、DEIの提出者/コード/対象期/書類種別を照合します。必要な一覧観測と原本取得の遅い時刻を `knownAt` とします。同時刻の異なるhashは `conflicting-source-observations` として保留し、古い原本へ戻しません。cutoff後の原本しかない場合も利用不可のままです。訂正差分と親の値の合成は行いません。

戻り値の `records` は直接処理の結果であり、`result.status` や各group/各選択値の状態も確認します。IFRS単体・基準不明・証券コードなし等は未確定のまま保持します。金額の原符号・精度・元文字列、欠損/曖昧の理由を保存し、0値や他基準で補いません。

## 会社指定・batch・再解析

一回の選択は10,000観測までです。全アーカイブがこの件数を超える場合は、`edinetCodes` に1〜100社を指定して読み出します。会社・書類・親番号のSQL索引を使い、関連する親子関係を再帰的に含めます。他社を名乗る訂正を単に落として古い元書類を選ぶことを防ぎます。`selection` には検査に必要な関連書類も含まれ、返す `records` / `unavailableSources` は指定会社の対象に限ります。関連集合自体が10,000観測を超える場合はエラーとし、黙って一部を切り捨てません。

選択原本が100件を超える場合も、内部で100件/256MiB以下のbatchへ分けます。一原本は256MiBまでです。原本索引は書類IDと取得時刻を保持し、選択対象の宣言と内容だけを読みます。戻り値全体はメモリへ返すため、大量の結果は会社ごとに処理します。

`cache.hits` は原本を再解析せず保存結果を再利用した件数、`cache.extracted` は新規解析した件数です。版・source commit・明示項目・原本hashのいずれかが変われば別の解析結果として残します。解析失敗と基準に合わない項目指定も版ごとに保持し、旧版の成功結果へ切り替えません。原本とキャッシュの整合検査は再利用時も行います。戻り値はJSONで保持できる形で、元objectの値がundefinedだった任意属性は省略されます。

原本・観測と解析キャッシュの各書込はtransactionで行います。中断したbatchはSQLiteのcommit境界で全件反映か全件未反映となり、同じ入力で再開できます。完了済みの原本や過去版を削除せず、古いcutoff/抽出版も明示して再現します。公開世代の切替・旧世代復帰は既存の世代Storeとは別の機能で、このアーカイブが本番サービスを自動切替することはありません。

## ファイル保護とCLI

既存DBは私有コピーで固定schemaを検査してから利用します。別形式・空の既存ファイル・symlink/hardlink・追加trigger/index・既存副ファイルを拒否します。DB本体がまだなくても `-journal/-wal/-shm` がある場合は作成しません。未知の元ファイルへSQLiteを直接接続しません。

`{readOnly:true}` は停止したDBの私有コピーから読み、元のDBや副ファイルを更新しません。cache missは計算して返しますが保存しません。コピーは1MiBずつ行い、DB全体と同程度の一時ディスク領域が必要です。close時にコピーを除去します。書込用途も同形式の停止済みDBを前提とし、既存のオンラインサービスDBをそのまま指定しません。

```sh
edinet-ts archive-financial-snapshots --db data/observed-financial.sqlite \
  --observations observations.json --manifest sources.json \
  --cutoff 2026-10-28T00:00:00+09:00 --extractor-version fixed-extractor-1

edinet-ts archive-financial-snapshots --db data/observed-financial.sqlite \
  --read-only --edinet-codes E00007 --detail-metrics costOfSales \
  --cutoff 2026-10-28T00:00:00+09:00 --extractor-version fixed-extractor-1
```

manifestは `docID / availableAt / sourceSha256 / file?` の配列で2MiB以下、観測JSONは16MiB以下です。fileはmanifest基準で読み、BOMを保持します。fileの省略は未読込宣言で、明示したfileの読込失敗は終了1です。readOnlyと追記指定は同時に使えません。CLIは条件・宣言・原本hashをDB作成前に検査し、繰返し投入の前検査ではXMLを再解析しません。

追記とsnapshot生成はそれぞれ別のtransactionです。追記後に抽出が失敗しても原観測/原本は残り、保存済み入力から再実行できます。正常な保留は理由付きJSON/終了0、入力・DB・破損等のエラーは内容を表示せず終了1です。原本の解析失敗と、DB/cacheの読書き失敗・破損を混同しません。外部SQL書込や暗号的な改竄認証には対応しません。

## 実データと残工程

既存2,402観測に、APIから今回取得した2026-06-24/25の3,509観測を加え、実5,911観測を保存しました。選択1,574系列のうち保存済み日本基準/IFRS4原本を接続し、残る1,570系列は原本なしです。元キャッシュと元メタデータDBは読取専用で扱い、一覧2日分以外の新規取得・課金は行っていません。実観測は2026年の取得時刻を保持し、2025年のcutoffでは0件です。

独立SQLite/XML/JSON処理で、観測5,911件・原本4件・DEI44項目・既定財務値26件・既知時刻が一致しました。別projectionのIFRS17項目×2原本も保存・再利用し、34選択の22採用/12不在、完全一致重複3件を元XMLと独立照合しました。DBの再open後は既定4件を再解析せず再利用し、readOnlyの元ファイル不変、source/builtのobject・CLI JSON、会社指定も確認しました。今回の照合はXMLと保存・呼出し経路の検証で、新たなPDF全数照合ではありません。

実5,911観測/4原本・約21.6MiBの専用DBで、readOnlyの解析cache miss 1回は約6.67秒、hitは1回ウォームアップ後5回の中央値で約534msでした。私有コピーを含むopenは約9.5msで、query時間とは分けています。Node26.12.1/SQLite3.54.0、Core i5-7260U、一つのprocess、原本/OSのcacheが温まった条件です。全市場や別の原本サイズでの速度保証ではありません。

合成試験では、原本101件の内部batch、10,001観測の保存後の会社指定、他社を名乗る訂正の系列停止、同時刻hash競合、訂正/取下げ、失敗batchのrollback、冪等投入、破損、未知DB/リンク/副ファイル保護を確認しています。

これは観測・原本・直接結果の永続化と再解析の削減です。[直接BS/明細の別DB索引](FINANCIAL_SEARCH_INDEX.md)を追加しました。比率/他指標の索引、全市場での性能・充足率、訂正差分の完全版再構成、取得jobの運用と公開世代/利用先の切替、旧形式からの移行は全体ロードマップの残工程です。既存Store/世代DBを財務アーカイブへ自動移行しません。
