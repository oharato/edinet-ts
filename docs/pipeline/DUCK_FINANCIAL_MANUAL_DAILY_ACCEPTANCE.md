# DuckDB日次処理を連続2日、手動で検証する

2026-11-03。ユーザー指定により、実連続2日の日次運転は自動作業から外し、この手順で手動実施する。未実施を合格扱いにしない。正式切替は別工程であり、この手順では行わない。

## 事前に確認すること

同じ固定SDK・Node・解析版・共有解析Storeを2日間使う。SDKを途中でbuildし直したり、既存候補のinputやhandoffを書き換えたりしない。版を変える場合は別の検証rootからやり直す。NASは使わない。

必要なものはNode 26.13.0以上、通常build済みSDK、DuckDB optional driver、Linux `/usr/bin/flock`、GNU time（`/usr/bin/time`）、EDINETの有効な認証情報、日次metadata設定、母集団snapshot、検証用のローカル保存先。認証情報は既存metadata設定のenvPathから読み、ログへ出さない。

この手順の`DUCK_SDK`には、`scripts/roadmap`とbuild済み`dist`の両方を含む固定実行treeを指定する。npmのtgzだけを展開したpackageには日次スクリプトが含まれない。スクリプト・dist・package manifest・依存環境を揃え、日次実行に必要なモジュールを事前に配置する。

11月3日の検証候補は `data/benchmarks/duck-financial-final-20261103/sdk/` に通常ディレクトリとして保管した。ソース532ファイルと配布267ファイルのhashが元の固定SDK・tgzに一致し、SDK指紋 `45e1a3cf…` とCLI起動を確認済み。依存は同ホストの既存node_modulesを参照する。`sdk-retention.json`と`build2/source-binding.json`で保存先・依存参照・source commit・未commit差分を含む固定manifestを確認する。正式採用前の検証候補なので、全社の受入結果も実装計画で確認する。

以下の変数は実際に検証する絶対パス・固定commitへ置き換える。`DUCK_SDK` は全検証を通した最終採用SDKにする。`DUCK_SETTINGS` は既存の日次設定version 2を使い、そのoutputDirectoryを専用の検証rootにする。新しいrootでは新しい設定ファイルを作る。既存handoffを持つ設定は変更しない。

```bash
export PATH=/home/oharato/.local/share/mise/installs/node/26.12.1/bin:$PATH
export DUCK_SDK=/absolute/fixed-sdk
export DUCK_SETTINGS=/absolute/daily-settings.json
export DUCK_PARSED=/absolute/shared-parsed.sqlite
export DUCK_SOURCE_COMMIT=0123456789abcdef0123456789abcdef01234567
export DUCK_EVIDENCE=/absolute/manual-daily-evidence
mkdir -m 700 -p "$DUCK_EVIDENCE"
cd /home/oharato/workspace/edinet-ts
node --version
python3 --version
test -f "$DUCK_SDK/scripts/roadmap/run-daily-duck-financial-cycle.mjs"
test -f "$DUCK_SDK/scripts/roadmap/run-acquired-duck-financial-cycle.mjs"
test -f "$DUCK_SDK/dist/index.js"
test -x /usr/bin/time
node "$DUCK_SDK/dist/cli.js" --help > /dev/null
sha256sum "$DUCK_SETTINGS" "$DUCK_SDK/package.json"
df -h . /tmp
```

元workspaceをcwdにするのは、既存の移行監査証跡に相対archivePathがあるため。設定schemaと必要なパスは[日次構築仕様](DUCK_FINANCIAL_CYCLE.md)を参照する。共有Storeの親は既存の正規ディレクトリとし、候補の外へ置く。

出力先とTMPDIR双方に既存の34 GiB留保＋原本・解析snapshot・検証用投影の余裕が必要。空き容量不足なら領域を確保して再開し、guardを下げない。原本・正式世代・切戻し先を削除しない。

## 競合する既存処理

既存SQLite日次財務サービスと対応タイマーは2026-11-03にユーザー指示で停止した。勝手に再起動しない。日次metadataサービスは停止対象ではない。

```bash
systemctl --user show edinet-roadmap-daily-financial-preparation.service \
  edinet-roadmap-daily-financial-preparation.timer -p Id -p ActiveState -p MainPID
systemctl --user show edinet-roadmap-daily-metadata.service -p ActiveState -p MainPID
```

財務serviceのMainPIDが0、timerがinactiveであることを確認する。serviceのfailed表示だけでプロセス稼働と判断しない。metadataが稼働中なら完了後に日次コマンドを実行する。終了75は排他競合で、ロックファイルを削除して回避しない。

## 1日目：当日のmetadata完了後に実行する

最初にmetadata checkpointのcompletedDayがJST当日、throughDateが前日、activeが未設定であることを確認する。コマンドもこれらと完了証跡・通知ルールを検査する。`waiting-for-daily-metadata`ならmetadata完了を待つ。日時を手修正して通さない。

各呼出しのログを別ファイルに保存する。次の例の`DUCK_ATTEMPT`を実行ごとに変える。stdoutは結果JSON、stderrは診断、exit.txtは終了コード、time.txtは開始終了時刻。

```bash
DUCK_ATTEMPT=$(date +%Y%m%dT%H%M%S)
date --iso-8601=seconds > "$DUCK_EVIDENCE/$DUCK_ATTEMPT.time.txt"
/usr/bin/time -v -o "$DUCK_EVIDENCE/$DUCK_ATTEMPT.resource.txt" \
  node "$DUCK_SDK/scripts/roadmap/run-daily-duck-financial-cycle.mjs" \
  --config "$DUCK_SETTINGS" --parsed-store "$DUCK_PARSED" \
  --source-commit "$DUCK_SOURCE_COMMIT" \
  --max-acquisition-batches 1 --max-documents 20 --max-companies 20 --max-batches 1 \
  > "$DUCK_EVIDENCE/$DUCK_ATTEMPT.result.json" \
  2> "$DUCK_EVIDENCE/$DUCK_ATTEMPT.stderr.log"
DUCK_EXIT=$?
printf '%s\n' "$DUCK_EXIT" > "$DUCK_EVIDENCE/$DUCK_ATTEMPT.exit.txt"
date --iso-8601=seconds >> "$DUCK_EVIDENCE/$DUCK_ATTEMPT.time.txt"
cat "$DUCK_EVIDENCE/$DUCK_ATTEMPT.result.json"
cat "$DUCK_EVIDENCE/$DUCK_ATTEMPT.stderr.log"
```

`set -e`を設定したshellでは失敗直後に終了し、exit.txt以降が保存されないため、上のブロックは`set -e`を解除したshellで実行する。

最初の小さな呼出しが成功した後、全社の処理は `--max-documents 100 --max-companies 100 --max-batches 10` に増やすと、1回で最大1,000原本/1,000社まで進められる。これらは実行上限であり、固定入力・解析版を変更しない。原本取得の `--max-acquisition-batches 1` は既存の予算・再試行制御を維持して段階的に進める。各呼出しでログ名を変え、終了結果を確認してから次を実行する。

| 結果                                                           | 次の操作                                                               |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `partial`                                                      | 準備・再構築・解析・構築の保存済み進捗。同じ設定・SDKで再実行する      |
| `acquiring`                                                    | 原本取得の途中。同じコマンドを再実行する                               |
| `waiting-for-daily-metadata` / `waiting-for-fixed-acquisition` | 対応する先行処理の完了を確認してから再実行する                         |
| `acquisition-paused`                                           | reasonを確認。容量・予算・再試行回数を解決する。短いループで連打しない |
| `aborted` / 終了2                                              | 中断済み。SDK・入力不変を確認し、同じコマンドで再開する                |
| 終了75                                                         | 他processの排他。保持元を確認し、終了後に再実行する                    |
| 終了1                                                          | stderrと最後のcheckpointを保存し原因調査。入力やreceiptを上書きしない  |
| `built`                                                        | 候補完成。以下の独立原本照合へ進む。正式切替の完了ではない             |
| `cycle-complete`                                               | 当日の候補は構築済み。保存済みの当日候補・照合結果を確認する           |

version 2は古い未完了候補から先に処理する。返却JSONのdayが当日でない場合、その結果を当日分の検証へ数えない。過去日の取得を今行った場合、鮮度gateが不適格になる可能性がある。検証対象の連続2日は、各当日のmetadata完了後に着手する。

中断再開は原本・会社の処理境界で行う。実行中terminalでCtrl-Cを1回押し、終了を待つ。終了前に別processを起動しない。SIGKILLやDB副ファイルの削除を通常の停止手順にしない。

## 構築後：独立原本照合

`built`のconfigPath、または設定のoutputDirectory配下の`YYYY-MM-DD/preparation-config.json`を指定する。候補を取り違えないようdayとパスを照合する。

```bash
export DUCK_DAY_CONFIG=/absolute/daily-root/YYYY-MM-DD/preparation-config.json
DUCK_ATTEMPT=$(date +%Y%m%dT%H%M%S)-verify
date --iso-8601=seconds > "$DUCK_EVIDENCE/$DUCK_ATTEMPT.time.txt"
/usr/bin/time -v -o "$DUCK_EVIDENCE/$DUCK_ATTEMPT.resource.txt" \
  node "$DUCK_SDK/scripts/roadmap/run-acquired-duck-financial-cycle.mjs" \
  --config "$DUCK_DAY_CONFIG" --parsed-store "$DUCK_PARSED" \
  --source-commit "$DUCK_SOURCE_COMMIT" --verify \
  > "$DUCK_EVIDENCE/$DUCK_ATTEMPT.result.json" \
  2> "$DUCK_EVIDENCE/$DUCK_ATTEMPT.stderr.log"
DUCK_EXIT=$?
printf '%s\n' "$DUCK_EXIT" > "$DUCK_EVIDENCE/$DUCK_ATTEMPT.exit.txt"
date --iso-8601=seconds >> "$DUCK_EVIDENCE/$DUCK_ATTEMPT.time.txt"
cat "$DUCK_EVIDENCE/$DUCK_ATTEMPT.result.json"
```

終了0かつ`financialValuesValidated: true`とverificationを確認する。`verification-blocked`は品質不適格であり、照合成功ではない。`built`でもfinancialValuesValidatedがfalseなら未完了。品質policyを緩めたり欠損を0で埋めたりして通さない。`publicationEligible: false`はこの照合コマンドの正常な動作で、正式参照は変わらない。

## 2日目：翌日の実入力で繰り返す

JST翌日にmetadata完了を確認し、同じSDK・設定・共有Storeで1日目と同じ操作を行う。翌日の日付の別候補が作られ、同じ解析キーはcacheとして再利用されることを確認する。1日目の出力をコピーして2日目と数えない。システム時計やcutoffを変更しない。

## 保存する証拠と成功条件

### 解析結果と翌日のcache再利用件数を確認する

件数を比較する共有Storeは、新しい検証専用パスから開始し、2日間の間に他の解析処理から追加しない。空のファイルを手作業で作らず、初日のSDKに初期化させる。初日の再開と翌日も同じStoreを使い、途中で空にしたりパスを変更したりしない。この条件なら初日の計画対象数が初回解析数になる。両日の構築完了後、候補内の固定 `parsed-snapshot.sqlite` と `parse-job.sqlite` をreadOnly APIで調べる。以下のパスは各日の`candidate/duckdb`を指定する。共有Storeの現在値ではなく、各日が実際に使ったsnapshotを比較する。

```bash
export DUCK_FIRST_CANDIDATE=/absolute/daily-root/YYYY-MM-DD/candidate/duckdb
export DUCK_SECOND_CANDIDATE=/absolute/daily-root/YYYY-MM-DD/candidate/duckdb
DUCK_ATTEMPT=$(date +%Y%m%dT%H%M%S)-cache
node --input-type=module > "$DUCK_EVIDENCE/$DUCK_ATTEMPT.json" <<'JS'
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const sdk=process.env.DUCK_SDK;
const {ParsedFinancialJob,ParsedFinancialStore}=await import(pathToFileURL(join(sdk,'dist/index.js')).href);
const {duckFinancialSdkSha256}=await import(pathToFileURL(join(sdk,'dist/duck-financial-cycle.js')).href);
const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const handles=[];
function load(directory){
  const marker=JSON.parse(readFileSync(join(directory,'input.json'),'utf8'));
  assert.equal(createHash('sha256').update(canonical(marker.input)).digest('hex'),marker.inputSha256);
  assert.equal(marker.input.sdkSha256,duckFinancialSdkSha256());
  const job=new ParsedFinancialJob(join(directory,'parse-job.sqlite'),{readOnly:true});handles.push(job);
  const store=new ParsedFinancialStore(join(directory,'parsed-snapshot.sqlite'),{readOnly:true});handles.push(store);
  const progress=job.progress(marker.input.build.id,store);assert.equal(progress.finished,true);
  return {marker,store,progress,plan:job.plan(marker.input.build.id)};
}
try{
  const first=load(process.env.DUCK_FIRST_CANDIDATE),second=load(process.env.DUCK_SECOND_CANDIDATE);
  assert.notEqual(first.plan.id,second.plan.id);
  assert.equal(first.marker.input.requestedExtractorVersion,second.marker.input.requestedExtractorVersion);
  assert.equal(first.marker.input.build.options.sourceCommit,second.marker.input.build.options.sourceCommit);
  assert.deepEqual(first.marker.input.build.options.detailMetricIds,second.marker.input.build.options.detailMetricIds);
  let reusedKeys=0,newKeys=0,reusedFailedKeys=0;
  for(const task of second.plan.tasks){
    const current=second.store.get(task.extractionId);assert(current);
    const prior=first.store.get(task.extractionId);
    if(prior){assert.deepEqual(current,prior);reusedKeys++;if(prior.outcome.status==='failed')reusedFailedKeys++;}
    else newKeys++;
  }
  assert.equal(reusedKeys+newKeys,second.progress.total);
  console.log(JSON.stringify({first:first.progress,second:second.progress,reusedKeys,newKeys,reusedFailedKeys,firstInputSha256:first.marker.inputSha256,secondInputSha256:second.marker.inputSha256,firstParsedSha256:first.store.snapshotSha256(),secondParsedSha256:second.store.snapshotSha256()},null,2));
}finally{for(const handle of handles.reverse())handle.close();}
JS
DUCK_EXIT=$?
printf '%s\n' "$DUCK_EXIT" > "$DUCK_EVIDENCE/$DUCK_ATTEMPT.exit.txt"
cat "$DUCK_EVIDENCE/$DUCK_ATTEMPT.json"
```

`reusedKeys`は前日のsnapshotにも保存済みで、parsedAt・原値・根拠を含む全保存結果が変わっていないキー数。`newKeys`は翌日の計画に必要になった新しいキー数で、上記の専用Store条件を満たす場合の追加解析分になる。`reusedFailedKeys`やprogressのfailed/unresolvedがあれば、再利用自体ができても品質合格ではない。上限を分けた呼出しの`progress.reused`は既存キーを再び数えるため、ログ間で合算しない。

2日分それぞれについて、以下を同じ証跡ディレクトリへ記録する。

- 実日付、固定SDKのsource manifest・配布hash、Node版、設定hash。
- 原本取得完了時刻と照合完了時刻、その差が24時間以内であること。`candidate/acquisition.json`のbody.receipt.completedAtが取得完了の記録。ログのwall timeだけで代替しない。
- day、候補ID、generation、input/hash、品質結果、原本照合結果、全ログと終了コード。
- 初日の解析件数、翌日の新規解析件数とcache再利用件数。上のreadOnly APIによる比較結果を保存し、推測で件数を補わない。
- 中断前後のcheckpointと再開結果、空き容量、旧日候補の不変を示すhash。DBが閉じ、副ファイルがない状態でhashを保存する。

`resource.txt`には呼出し全体の経過時間・CPU・OS最大RSSが残る。1回の呼出しが取得・解析・構築の境界を跨いだ場合、その呼出しのRSSは合算の観測値であり、各工程だけのRSSとして扱わない。返却status/phaseと実行時刻も合わせて保存する。

2日とも当日の候補・品質gate・独立照合を完了し、取得完了から解析・構築・照合まで24時間以内で、翌日分を同じSDKで処理できた場合に日次条件を満たす。足りない証跡は未確認として残す。

本手順の完了後も正式vendor/catalogの切替・切戻し確認とP8の参照・保持一覧は別途必要。削除対象を自動決定しない。実施結果を[実装計画](../plans/SQLITE_DUCKDB_IMPLEMENTATION_PLAN.md)へ追記する。
