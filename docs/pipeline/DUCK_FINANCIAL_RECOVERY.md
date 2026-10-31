# 作成経路の強制終了復旧

2026-10-31。P7の限定検証。停止した管理DBを、同じ固定入力・同じSDK・同じ候補/共有Storeの排他の下で再開する。

## 初期化とSQLite復旧

新しい解析Store・解析ジョブ・候補catalogは、最終パスへ直接schemaを書かず、予約名のstaging fileで初期化する。commit・close・fsync後にrenameする。初期化commit前後でkillされても最終パスへ空DBを残さず、次回の排他取得後に未確定stagingを回収する。既存の未知DBを空扱いして作り直す処理ではない。

解析Store/ジョブ/catalogのjournalが残った場合は次を行う。

1. 元DBとjournalを変更せず、指紋・通常ファイル/単一リンク・上限・rollback modeを確認する。SQLiteのWAL/SHM、super-journal、未知形式は対象外。
2. 同期済みhot journalは既存の `recoverDedicatedSqliteSnapshot` で私有コピーだけを復旧する。今回 `parsed-financial-store` と `parsed-financial-job` をkindへ追加した。
3. integrity/schemaに加え、解析結果は全ページの本文・SQL列・hash、ジョブは全計画、catalogは全候補と履歴/pointerを検査する。
4. 変更前のDB/journalを、候補の親に作った私有 `edinet-cycle-recovery-*` directoryへ退避し、両指紋・検査結果を `validated.json` に保存してfsyncする。
5. 成功した場合だけ元の管理DBをSQLite自身にrollbackさせる。結果が私有復旧像のhashと一致し、全レコードを再検査できたことを確認する。

未spillのcold journalや空journalは、mainの私有コピーだけでintegrity/schema/全レコードを検査する。元DBのBEGIN EXCLUSIVEを取得して指紋を再確認し、退避済みのinactive journalを外す。壊れたhot journalをcoldとして読み替えない。原本archiveをこの処理で書き換えない。

入力合計は既存復旧APIと同じ32 GiB以下。自動復旧は34 GiB＋DB4倍＋journal3倍＋64 MiBの余裕をbackup先/tmpで確認する。余裕不足では原本を変更せず停止し、guardを下げない。

退避には未確定書込も含まれる。SDKは退避を自動削除しない。`restored.json` は完了情報で、完了直後にkillされた場合は未作成のことがある。元SQLiteが復旧済みなら通常の再検査から続く。退避の参照・保持・整理はP8で扱う。

## 解析とDuckDBのcommit境界

解析の完了はStoreの原本単位transactionを唯一の根拠とする。実 `Store.put` のCOMMIT前にkillした場合は元の確定件数へ戻り、COMMIT後にackが届く前のkillでは保存済みキーを再利用する。

DuckDBは会社の行・指標値・receiptを同じtransactionへ保存する。実会社transactionのCOMMIT前/後でkillし、再open時のnative WAL復旧後に完了会社数を確認する。既存の完了会社を重複投入せず、同じparsed snapshotから残件を完成させる。完成manifest・全列・品質を再検査し、未確定値を公開しない。

SDK/入力の指紋が変われば同じ候補への再開を拒否する。復旧を理由にチェックを緩めず、固定された元SDKを保持して使う。別SDKの新しい候補への移行は別計画とする。

## 証跡と範囲

```sh
node node_modules/tsx/dist/cli.mjs scripts/verify-duck-financial-recovery.ts \
  /absolute/isolated-sdk/dist \
  data/benchmarks/duck-financial-index-build-20261031-v8 \
  data/benchmarks/parsed-financial-snapshots-20261031/input.sqlite \
  <新規出力先>
```

`data/benchmarks/duck-financial-recovery-20261031/summary.json` は実原本由来2社を使い、通常のflock付きCLIで次の7点を検証した。

| 強制終了点 | 再開確認 |
|---|---|
| Store schema COMMIT前/後 | stagingを回収し、新しい最終DBを正常初期化 |
| 実Store.put COMMIT前 | 未確定結果を戻し、残件から解析 |
| 実Store.put COMMIT後・ack前 | 確定済み結果を再利用 |
| 実DuckDB会社COMMIT前/後 | 確定会社を保持し、残件だけ構築 |
| catalog更新transaction中 | 元候補を復旧して完成記録と照合 |

全ケースで4行まで完成、同内容再実行、原本不変、正式切替不可を確認した。別fixtureでは3種類のschema初期化前後、cold/空journal、破損journalとWAL拒否、ジョブ・catalog履歴を確認する。検証ハーネスは終了を待った子processが作った私有コピーだけを回収する。

これは小標本のSIGKILL検証。全社・大容量復旧の時間/RSS、disk full、OS/ハードウェア電源断、取得側のmetadata/handoff・検証付き切替・利用先の運用受入を代替しない。package・vendorの本番更新も行っていない。
