# 固定source配布物のローカル作成・保持

状態: 現行の保存方針。更新日: 2026-10-22。[ADR 0001](adr/0001-local-distribution.md) を参照。
GitHubの保存量を増やさず、固定sourceからローカルで配布物を再現する。既存の公開物は削除しない。手動workflowもtag・release・npm/GitHub Packages公開は行わない。

## 固定入力と実行

`python3 scripts/build-local.py` は、実行時の作業ブランチではなく、明示的に固定されたsource `6301b404a5d09fec0c5ad10b2796e95ac64bd4e9` とlockfileを一時checkoutしてbuildする。期待する配布物SHA-256は `1c1e35c0348d24e1dbfc65d7586f6a9e5d1496ca1cfba49c9221e87c4c32f048`。現在のheadの配布物を自動で作るスクリプトではない。

```sh
OUT=/absolute/private/path/edinet-ts-artifacts
python3 scripts/build-local.py --output "$OUT" --dry-run
python3 scripts/build-local.py --output "$OUT"
python3 scripts/test_artifact_store.py
```

公開対象外の保存先を指定する。スクリプトはoffline npm cacheのみを使い、cache不足時にネットワークへ黙ってfallbackしない。固定sourceの依存にはnative SQLiteがあり、ローカルcompileが必要になる場合がある。新しいNode/依存版の採用は、この固定配布物の検証を置き換える意味ではない。

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
