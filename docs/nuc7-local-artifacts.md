# 固定source配布物のローカル作成・保持

状態: 現行の保存方針。更新日: 2026-10-30。[ADR 0001](adr/0001-local-distribution.md) を参照。
GitHubの保存量を増やさず、固定sourceからローカルで配布物を再現する。既存の公開物は削除しない。手動workflowもtag・release・npm/GitHub Packages公開は行わない。

## 固定入力と実行

`python3 scripts/build-local.py` は、実行時の作業ブランチではなく、明示的に固定されたsource `3cc4618e5fa8d3e35604e15dc49c31f9f35ebdd7` とlockfileを一時checkoutしてbuildする。期待する配布物SHA-256は `69e50093645fdd38a31c46c5b676e7efe32b523033e37def135c3d5b657d7a94`。現在のheadの配布物を自動で作るスクリプトではない。

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

2026-10-30の現在版は3cc4618・202ファイル/2,512,120 bytesです。以下の53eb2ad/e673e8aの件数は前世代の履歴で、現在の検証は末尾に追記します。

## 利用先更新

stock-dataのlocal builderに `--edinet-generation "$OUT/current"` を渡す場合も、利用先の固定hash/provenanceとの一致確認が必要。未検証のregistry版を代用しない。

新sourceへ更新する際は、固定commit・期待配布物hash・利用先provenance/lockを明示的に更新し、完全なテストとinstalled-package回帰を行う。配布物をversion名だけで差し替えない。新しい定期実行や利用先の取得運用はこの手順に含めない。

当時の検証結果は [2026-10-10固定配布物の記録](history/2026-10-10-fixed-artifact-validation.md)、今後の統合計画は [改善計画](plans/EDINET_TS_ROADMAP.md) を参照。

2026-10-29更新: 公開財務snapshotの読取APIまでを固定sourceへ反映。配布物はdist・README・LICENSE・package.jsonの192ファイル（展開後2,449,985 bytes）で、原本・DB・.envを含みません。全体ロードマップの完了や本番サービスの切替を意味しません。

実行検証: クリーン固定sourceの全132ファイル/3,630テストが成功し、Node v26.12.1 / npm 12.2.1で期待SHA-256を再現しました。利用先の別worktree commit `6a4e760` で全10ファイル/63テスト・型検査・保存保護14件が成功。installed SDK全192ファイルは配布物とbyte単位で一致しました。保持済み旧世代e673e8aへの切替後、53eb2adへ戻すrollbackも実行して確認しました。

利用先の公開財務exportは、品質検査済みcatalogの固定snapshotをJSONへ保存し、static buildへ接続します。実4社の限定母集団から対象cohortの3行/9値をexportし、再実行のbyte一致と未承認catalogによる既存出力の非破壊を確認。全市場の充足率や既存価格データとの統合を示すものではありません。

旧source `e673e8a` の78ファイル/2,644テスト・利用先56テスト・配布物126ファイルの結果は前世代の記録です。保持世代は削除せず、元の作業ツリー/稼働サービスは切り替えていません。


利用先offline buildの検証（2026-10-29）: 別worktree `36e4ddf` のクリーンbuildで全63テスト・型・static buildが成功。元データ31,435ファイル/6,899,939,392 bytesを、WAL不在・前後metadata一致・全ファイルhash一致で私有snapshotへコピーし、そのコピーだけを入力にしました。元DBの他processによるlockや既存サービス状態は変更していません。検証用世代 `20261028T160348Z-dcea22de` は既存3,881銘柄と公開財務3行を保持し、manifest hash・exportとのbyte一致・localhost HTTPの3資源を確認。完了時にも元31,435ファイルのmetadata一致とWAL不在を確認しました。取得済みデータの時点を更新するbuildではありません。


2026-10-30更新: 現在の固定sourceは3cc4618e5fa8d3e35604e15dc49c31f9f35ebdd7、SHA-256は69e50093645fdd38a31c46c5b676e7efe32b523033e37def135c3d5b657d7a94です。202ファイル/2,512,120 bytesをクリーン作成し、正規builderの全141ファイル/3,786テストと同じhashを再現。旧53eb2ad世代への切替と新版復帰も確認しました。ROIC/評価API、企業マスター観測保存・法人番号原記録参照、XML/固定snapshot検査の改善を含みます。

利用先c473948のvendor/lock/provenanceを更新し、installed全202ファイルのbyte一致・全63テスト・型・保存保護14件が成功。初回は旧registry 7の固定期待値で1失敗し、registry 8とCP/短期社債の取得を確認する回帰へ更新後、全件を再実行しました。実公開財務3行/9値は旧SDK出力とbyte一致し、未承認catalog拒否と再投入も非破壊で成功。元の作業ツリー/サービスは変更していません。

利用先の新版世代は `20261029T150317Z-d25da03e`（UTC名）。私有snapshotの31,436入力・6,899,995,270 bytesを使い、全63テスト・型・static buildが成功しました。この入力には従来の31,435元データに加え、取得済みの公開財務JSON1ファイルが含まれます。全43,184出力ファイル/7,443,341,343 bytesのmanifest hashを独立検査し、3,881銘柄・公開財務3行/元exportとのbyte一致・localhost3資源を確認。公開出力への認証値混入も値非表示で検査しました。全入力metadataの前後一致とWAL不在、旧static世代36e4ddfへの切替と新版c473948への復帰を確認。既存の利用者変更6ファイルもhash不変です。

進行中の固定年次取得/構築待機は、検証済みSDKと依存関係を固定した[専用サービス](ROADMAP_RUNTIME.md)へ引き継ぎました。これは有限計画の実行分離と復旧確認であり、日次巡回/再boot後自動起動や元本番サービスの移行完了ではありません。

内部の長時間jobは、観測行の反復検査だけを改善した78c342c/bfbd01f2486c1bb6a7bd419636ee668f3733d98b2e4e8977a61461c9b9f8ba35へ別途固定しました。公開配布/consumerのPIN3cc4618は変更せず、同じ依存treeとAPIを保ち、差分2ファイル・クリーン全3,799テスト・旧task不変と追加取得を確認した内部更新です。


内部jobの現行固定版は1cf4c08384af64385e402a3e7d5244dcdf662013/SHA-256 a27ebb0c43de5350ff002ff5605ae0741e014542b2b94e6d7e3df0b428aca44e（204ファイル/2,526,512 bytes）です。全145ファイル/3,822テストと公開型/CJS、固定sourceのクリーンビルドとテスト済み出力の一致を確認。形式可否を保持した新計画へ移し、元の83,828観測・2,931原本/全履歴の保持と追加20件の取得を確認しました。詳細は[専用runtimeの引継ぎ記録](ROADMAP_RUNTIME.md)を参照してください。公開配布/consumerのPIN3cc4618は継続しています。

内部jobのSDK PIN1cf4c08/a27ebb0cと公開配布/consumerのPIN3cc4618を保ち、取得制御補助d696dcfを固定した永続unitへ実行を引き継ぎました。一回最大100件、20件単位の停止枠・3試行上限・本文前後の容量/中断確認・一件ずつcommitを維持し、旧4,007完了task/全履歴を保持して追加100件の保存を確認。user default.targetでenableし、既存Linger=yesと実PID/再起動0を確認しました。実機再bootと日次新規計画は検証していません。[現行サービス/引継ぎ記録](ROADMAP_RUNTIME.md)を参照してください。
