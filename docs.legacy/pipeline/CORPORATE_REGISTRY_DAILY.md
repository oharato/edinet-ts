# 法人番号差分の日次実行

`scripts/roadmap/run-corporate-registry-daily.mts` は、取得・署名検査・全国DBへの差分適用を1公表日ずつ進めます。[保存済み差分の適用](../companies/CORPORATE_REGISTRY.md#保存済み差分を全国dbへ適用する)を使い、実行ごとのjobと受理記録を残します。

2026-11-03現在、実SDK・GPGによる小さな署名済みfixtureで26テストが成功しています。本番DBの初期化・定期unitの登録・このwrapperによる実通信は未実施です。全国DB＋11月2日差分の適用検証は下位の適用CLIの結果であり、wrapperや連続2実公表日の受入とは分けます。

## 初期化に必要なもの

Linux、現行Node、GnuPG、固定SDKの検証器が必要です。wrapper・適用スクリプト・それぞれと同じ場所の `operational-files.mjs` も固定した専用ディレクトリへ保存します。作業treeや固定runtimeを実行中に編集しません。

出力rootは実体のある専用0700ディレクトリにします。入力や固定runtimeの内部には置きません。初期化は次の順に行います。

1. 全記録監査を完了した全国DBと差分chainのmanifestを選び、書込み停止・sidecar不存在・SHA-256を確認します。元DBと原本を保持します。
2. 追加DBと適用時の一時領域を確保し、上書きなしで `root/current.sqlite` へコピーします。コピー先のSHAが元DBと一致することを確認します。
3. その起点を識別する64桁のSHA-256をbootstrap IDとして、`root/jobs/<ID>/accepted.json` を保存します。必須項目は以下です。
4. `root/current.json` へ同じ項目を保存し、`dbShaAtAcceptance` の代わりに `dbSha256`、加えて受理JSONの**保存byte列**のSHAを `receiptSha256` に指定します。受理JSONとpointerは0600で保存します。

```json
{
  "format": "edinet-ts-corporate-registry-daily-v1",
  "jobId": "<bootstrap ID>",
  "previousReceiptSha": null,
  "dbShaAtAcceptance": "<コピー済みDBのSHA-256>",
  "lastActualDataDate": "<最後の実原本の日付>",
  "calendarCoverageThrough": "<カレンダーを含めて確認した最終日>",
  "manifests": ["<監査済みのscope/expectedParts/fileIdsオブジェクト>"]
}
```

これは項目の説明用です。`manifests` には文字列ではなく、[保存DBの再構成](../companies/CORPORATE_REGISTRY.md#保存した記録から状態を再構成する)と同じmanifestオブジェクトを指定します。`current.json` に `previousReceiptSha` は不要です。

実原本の最終日と確認範囲は別です。例えば11月2日差分を適用し、保存した公式方針と祝日CSVで11月3日を未作成日と確認した起点なら、前者は `2026-11-02`、後者は `2026-11-03` です。11月3日の空XMLや適用checkpointは作りません。

## 固定configと実行

各パスは実体のある絶対パスです。`sdkPath` は検証器と同じreleaseの `dist/index.js` を指定します。検証器と適用スクリプトのSHAは、内容を確認してから固定してください。

```json
{
  "format": "edinet-ts-corporate-registry-daily-v1",
  "root": "/absolute/private-daily-root",
  "calendarPath": "/absolute/calendar.json",
  "publicKeyPath": "/absolute/nta-public-key.asc",
  "fingerprint": "<信頼した完全なfingerprint>",
  "sdkPath": "/absolute/pinned-runtime/dist/index.js",
  "runtimeVerifierPath": "/absolute/pinned-runtime/run-financial-pinned.mjs",
  "runtimeVerifierSha256": "<検証器のSHA-256>",
  "applyScriptPath": "/absolute/fixed-operations/apply-corporate-registry-differences.mts",
  "applyScriptSha256": "<適用スクリプトのSHA-256>",
  "metadataDeploymentPath": "/absolute/duck-financial/deployment.json",
  "probeCorporateNumber": "<監査対象の13桁番号>",
  "networkEnabled": true
}
```

```sh
# 保存済み入力だけで検査・再開する
node /absolute/fixed-operations/run-corporate-registry-daily.mts --config /absolute/daily-config.json
# 有限予算内で取得も許可する
node /absolute/fixed-operations/run-corporate-registry-daily.mts --config /absolute/daily-config.json --acquire
```

既定の目標は前JST日です。`--through YYYY-MM-DD` で当日以前を指定できますが、1回に進むのは最初の1公表日、または公表日のない範囲だけです。pending jobがあれば先に同じ入力から再開します。取得queryは最終実原本の翌日から作り、休日確認範囲を基準に未取得の公表日を飛ばしません。

通信時の排他は、現在のdeployment→日次設定→metadata設定から共通lockを導きます。固定lockパスをconfigへ書きません。通信後はこのlockを解放して適用・全記録監査を行います。deploymentが変わった場合は検出して適用を止めます。ただし、別lockへの切替と送信中要求の完全な同時排他には、切替側も旧新lockを協調して扱う必要があります。

## 結果と停止後の扱い

`accepted` は今回の受理、`up-to-date` は現在の確認範囲での完了です。`pending-*` は有限処理後の未完了で、終了0でも合格扱いにしません。JSONの `reason` とjob内の記録を確認します。lock競合は終了75、入力・監査・容量等の失敗は終了1です。

1jobは最大3回の取得試行・6 HTTP予約です。要求前に予約を永続化し、プロセスを再起動しても予算を増やしません。`networkRequestsThisInvocation` は今回、`jobReservedRequestsTotal` は累計です。`jobRespondedRequestsTotal` は応答headersが返った数で、原本受領や署名検証の成功数ではありません。原本の完了はcollectionのreceiptで判断します。

未公表の応答は残予算内で再確認できます。予約だけ残った要求やtransport失敗は、未送信と断定できないため自動再要求を止めます。予算終了・`uncertain-request-requires-review` ではtimerを止め、`http.json`・pending・原本・receiptを保持します。完成済みの署名入力があればofflineで再検査・再開できます。予算の編集・予約の削除・同じ要求を別jobへ付け替える回避はしません。この版には未確定要求を自動解除する機能がありません。

DB適用・受理記録・pointer更新の途中停止は同じ固定configで再開します。過去の `accepted.json.dbShaAtAcceptance` は**その時点**のDBのhashです。現在の可変DBのhashは `current.json.dbSha256` にあります。後日のDBへ古い適用checkpointを再実行しません。SDKやconfigを更新するときも、pending jobの固定版を保持してください。

## 定期起動前の条件

実際のbootstrapを検査し、全国DBでのwrapper実行・再開と次の実公表日を確認してから定期起動へ進めます。未来の未公表日を空データで埋めません。

wrapperは20分、子プロセス群のRSS 1 GiB、MemAvailable 2 GiB、出力先/一時領域の34 GiB＋余裕を監視します。適用CLIはコピー・journalの追加容量も要求します。DB 640 MiB・合計100原本パートを上限とし、無期限のepoch自動更新は実装していません。

unitは `KillMode=control-group`、`TimeoutStartSec=21min`、`TimeoutStopSec=15s`、`Restart=no` を使います。cgroupのメモリ上限はpage cacheと子を含むため、実測して決めます。親のSIGKILL後も子が継承したflockは二重書込みを防ぎますが、親の資源監視は失われるため、外側のunit管理が必要です。

境界検証は [26テスト](../../test/corporate-registry-daily.test.ts)、このホストの未有効な初期化・unit案は `data/roadmap/corporate-registry-daily-preparation-20261103/` にあります。実連続2日の日次財務受入は別の[手動手順](DUCK_FINANCIAL_MANUAL_DAILY_ACCEPTANCE.md)で行います。
