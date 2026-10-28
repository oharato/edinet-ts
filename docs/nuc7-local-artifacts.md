# 固定source配布物のローカル作成・保持

状態: 現行の保存方針。更新日: 2026-10-29。[ADR 0001](adr/0001-local-distribution.md) を参照。
GitHubの保存量を増やさず、固定sourceからローカルで配布物を再現する。既存の公開物は削除しない。手動workflowもtag・release・npm/GitHub Packages公開は行わない。

## 固定入力と実行

`python3 scripts/build-local.py` は、実行時の作業ブランチではなく、明示的に固定されたsource `53eb2ad24228539969ebe3b46d97b864a5e020a2` とlockfileを一時checkoutしてbuildする。期待する配布物SHA-256は `98de4e0698c9f56b7465984e10b473a9c064713fd133e7815e7f02688ec8d366`。現在のheadの配布物を自動で作るスクリプトではない。

```sh
OUT=/absolute/private/path/edinet-ts-artifacts
python3 scripts/build-local.py --output "$OUT" --dry-run
python3 scripts/build-local.py --output "$OUT"
python3 scripts/test_artifact_store.py
```

公開対象外の保存先を指定する。スクリプトはoffline npm cacheのみを使い、cache不足時にネットワークへ黙ってfallbackしない。実行系はNode v26.12.1 / npm 12.2.1へ固定し、実build前に検査する。このsourceはNode標準SQLiteを使用し、旧配布物のnative SQLite依存とは異なる。旧世代は保持し、rollbackにはNode/npmを要求しない。

## 検証と世代保持

完全なbuild・全テスト（ESM統合を含む）・`npm pack --ignore-scripts`を実行する。配布物hashの不一致は失敗とし、既存物を上書きしない。version番号だけでsourceの同一性を判断しない。

出力先はprivate（0700）、nonblocking lockで二重実行を防ぐ。各成功世代にtgz・build/test log・source/lockfile/builder hash・toolchain・checksumを記録し、検証後にcurrentをatomicに切り替える。失敗時はstaging logと既存currentを残す。

最低2 GiBの空き容量が必要。自動削除はなく、別途判断する整理までは少なくとも成功3世代を保持する。ローカル保存であり、別hostへのbackupや突然の電源断への保証ではない。

rollbackはhashを確認してpointerを切り替える。

```sh
python3 scripts/build-local.py --output "$OUT" --rollback GENERATION_BASENAME
```

## 利用先更新

stock-dataのlocal builderに `--edinet-generation "$OUT/current"` を渡す場合も、利用先の固定hash/provenanceとの一致確認が必要。未検証のregistry版を代用しない。

新sourceへ更新する際は、固定commit・期待配布物hash・利用先provenance/lockを明示的に更新し、完全なテストとinstalled-package回帰を行う。配布物をversion名だけで差し替えない。新しい定期実行や利用先の取得運用はこの手順に含めない。

当時の検証結果は [2026-10-10固定配布物の記録](history/2026-10-10-fixed-artifact-validation.md)、今後の統合計画は [改善計画](plans/EDINET_TS_ROADMAP.md) を参照。

2026-10-29更新: 公開財務snapshotの読取APIまでを固定sourceへ反映。配布物はdist・README・LICENSE・package.jsonの192ファイル（展開後2,449,985 bytes）で、原本・DB・.envを含みません。全体ロードマップの完了や本番サービスの切替を意味しません。

実行検証: クリーン固定sourceの全132ファイル/3,630テストが成功し、Node v26.12.1 / npm 12.2.1で期待SHA-256を再現しました。利用先の別worktree commit `6a4e760` で全10ファイル/63テスト・型検査・保存保護14件が成功。installed SDK全192ファイルは配布物とbyte単位で一致しました。保持済み旧世代e673e8aへの切替後、53eb2adへ戻すrollbackも実行して確認しました。

利用先の公開財務exportは、品質検査済みcatalogの固定snapshotをJSONへ保存し、static buildへ接続します。実4社の限定母集団から対象cohortの3行/9値をexportし、再実行のbyte一致と未承認catalogによる既存出力の非破壊を確認。全市場の充足率や既存価格データとの統合を示すものではありません。

旧source `e673e8a` の78ファイル/2,644テスト・利用先56テスト・配布物126ファイルの結果は前世代の記録です。保持世代は削除せず、元の作業ツリー/稼働サービスは切り替えていません。


利用先offline buildの検証（2026-10-29）: 別worktree `36e4ddf` のクリーンbuildで全63テスト・型・static buildが成功。元データ31,435ファイル/6,899,939,392 bytesを、WAL不在・前後metadata一致・全ファイルhash一致で私有snapshotへコピーし、そのコピーだけを入力にしました。元DBの他processによるlockや既存サービス状態は変更していません。検証用世代 `20261028T160348Z-dcea22de` は既存3,881銘柄と公開財務3行を保持し、manifest hash・exportとのbyte一致・localhost HTTPの3資源を確認。完了時にも元31,435ファイルのmetadata一致とWAL不在を確認しました。取得済みデータの時点を更新するbuildではありません。
