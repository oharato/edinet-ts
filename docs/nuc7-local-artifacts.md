# 固定source配布物のローカル作成・保持

状態: 現行の保存方針。更新日: 2026-10-28。[ADR 0001](adr/0001-local-distribution.md) を参照。
GitHubの保存量を増やさず、固定sourceからローカルで配布物を再現する。既存の公開物は削除しない。手動workflowもtag・release・npm/GitHub Packages公開は行わない。

## 固定入力と実行

`python3 scripts/build-local.py` は、実行時の作業ブランチではなく、明示的に固定されたsource `e673e8aa547be011056cfdb6bbe84d4d58e87e36` とlockfileを一時checkoutしてbuildする。期待する配布物SHA-256は `6df0b746e9047ac51a2eaee526015dc2d1d1a04ce292a295048f257951b35cc1`。現在のheadの配布物を自動で作るスクリプトではない。

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

2026-10-28更新: 固定sourceは財務/人的資本/訂正系列/世代保存/監査報酬のローカル拡充分です。全体ロードマップの完了や本番サービスの切替を意味しません。配布物にはdist・README・LICENSE・package.jsonのみ126ファイルを含み、原本・DB・.envは含みません。

実行検証: クリーン固定sourceの全78ファイル/2,644テストが成功し、期待SHA-256を再現しました。private世代を作成し、保持済み旧vendorへの切替後に新世代へ戻せることも確認しました。利用先の別worktreeでは全56テスト・型・保存保護14件とinstalled-package照合126ファイルが成功。元の稼働サービス/データは切り替えていません。
