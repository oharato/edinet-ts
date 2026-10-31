# 解析済みSQLiteへの再開可能な解析ジョブ

2026-10-31。P2の内部モジュール `ParsedFinancialJob`。固定した原本アーカイブからXMLを読み、[解析済みStore](PARSED_FINANCIAL_STORE.md)へ直接抽出結果を保存する。ネットワーク取得・訂正差分合成・検索世代への採用・正式切替は行わない。

## 計画と再開の契約

| 項目 | 契約 |
|---|---|
| 固定入力 | 停止済みアーカイブの物理SHA-256、解析対象の書類ID・原本SHA-256・取得時刻・解析キー |
| 対象件数 | 1〜100,000件、計画JSONは64 MiB以下。同じ解析キーの重複を拒否 |
| 計画保存 | 専用SQLiteの `parsed_job_plans` へcanonical JSONとhashを保存。同じjob IDの入力変更を拒否 |
| 時刻 | 取得時刻はtimezone必須、UTCへ正規化。解析キーには含めず、原本観測との対応を計画に保持 |
| 完了の保存 | 別の可変checkpointを重複保存せず、解析済みStoreの原本単位transactionを完了の唯一の根拠とする |
| 再開 | 固定した解析キーでStoreを読む。保存済みなら再解析しない。原本保存後にjobが停止しても同じキーから再開 |
| 読取・保存の障害 | 原本の欠落・破損・指紋違い・DB保存失敗は例外。解析失敗としてキャッシュせず、未保存キーはpendingのまま |
| XML解析の失敗 | `parse-failed` / `projection-failed` をStoreへ保存。失敗も同じキーで再利用し、修正は新解析版の別jobで行う |
| 版の変更 | 実行時のbasis/対応表版が計画と異なれば拒否。解析版とsource commitは呼出側が固定runtimeの証跡に結合する |

`pending` はStoreに結果がないキー数、`completed` は結果を返した解析数、`failed` は解析失敗数。`unresolved` はcompletedの内数。`finished` はpending=0のみを表し、全値が利用可能・原本金額照合済み・正式切替可能を意味しない。

同じ原本内容が複数時刻に観測されていても解析は1キーで共有する。jobへ渡す対象は1キーにつき1つの正確な原本観測とし、全観測履歴は元アーカイブに残す。

## 原本アーカイブの内部読取API

`ObservedFinancialArchive.readSource({docID, availableAt, sourceSha256}, options?)` を追加する。固定readOnlyコピー専用で、最新版や別時刻の原本へ暗黙に置換しない。宣言JSON・SQL索引・hashの対応を検査し、本文を読む場合は既存のgzip展開・容量上限・内容hash・UTF-8検査を利用する。

`{includeXml:false}` は原本の宣言と本文の存在・保存長を検査し、XML本文を読まない。宣言または本文がない場合はundefined。通常の本文読取で宣言だけがある場合は、xmlなしの宣言を返す。

ジョブは開始時に固定指紋・全対象の宣言/本文存在を確認する。解析済みのキーでも時刻・原本が捏造された計画を受け付けない。本文の全件再hashはcache hitごとには行わず、入力アーカイブの固定証跡と正式世代の独立照合を別に維持する。

## 使用例

```ts
const plan = job.begin({
  id: 'parse-fixed-input',
  archiveSha256: archive.snapshotSha256(),
  tasks: [{identity, availableAt}],
});
await job.runNext(plan.id, archive, parsedStore, {limit: 100, signal});
job.progress(plan.id, parsedStore);
```

`runNext` は1〜100原本まで新規解析する非同期メソッド。原本間でevent loopへ制御を返し、signal中断後も保存済み結果は残す。同じjob instanceの二重実行を拒否する。固定コピーは呼出側が処理間で再利用し、毎原本のためにアーカイブ全体をコピーし直さない。

進捗は現時点で対象キーの保存結果を検査して計算する。全社規模の進捗計算・バッチ反復の性能は未検証で、P7で測定する。単体jobをホスト上の複数processで動かす排他・日次制御は後続の統合工程。

## 検証

`test/parsed-financial-job.test.ts` と既存Store/アーカイブの回帰で、plain/gzip、再open後の残件処理、保存直後の中断、signal、二重実行、cache再利用、原本時刻・指紋・版の不一致、Store/原本障害、解析失敗・未解決、原本破損、計画改変、readOnlyを確認する。

実原本は `scripts/verify-parsed-financial-job.ts <P1の実原本summary.json> <新規出力先>` で検証する。元の大型アーカイブを読取専用で参照し、hash・取得時刻を保持した小さな隔離アーカイブを作る。日本基準/IFRSの2件で1件ずつ処理・再open・残件処理・cache時のXML読取なし・直接解析結果との一致・原本DB不変を確認する。

全社、実際の日次制御、SIGKILL後の専用DB復旧、CLI・公開exports・検索builderとの接続は未実施。本モジュールの完成だけでP3〜P8の完了とはしない。

関連テストの実行時は `--exclude='data/**' --exclude='artifacts/**'` を付け、保存された過去source snapshotのテストを混ぜない。今回のroot実行ログは過去snapshotも含む568件成功だが、本工程の回帰根拠は現行rootの3ファイル・75件に限定して `implementation-summary.json` へ記録した。
