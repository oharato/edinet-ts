# stock-dataのDuckDB財務snapshot利用

## 移行候補

既存の財務snapshot exportは `/home/oharato/workspace/stock-data-edinet-roadmap` にあり、稼働stock-data本体にはまだ統合されていない。移行候補は別worktree `/tmp/stock-data-duck-migration-20261031` で作成した。差分と試験用SDKは `data/benchmarks/stock-data-duck-migration-20261031/` に保持する。元の利用先vendor・価格DB・稼働サービスは変更しない。

`export-published-financials.ts` に `--engine duckdb` を追加。既定のSQLite経路を保持し、明示時に非同期の `DuckFinancialPublicationReader` を使う。正式catalogの参照先だけを読み、同じ `stock-data-published-financials-v1` JSONを生成する。0・出典・snapshot指紋を保持し、既存の所有権/サイズ/内容hash/原子的保存の検査を再利用する。静的builderは従来どおり生成済みJSONをコピーできる。

同一DuckDB世代をSQLiteへ投影した比較DBとのexport一致、原本照合後の一時catalog切替、CLI出力、0の保持、SQLite経路へ戻した出力一致、失敗時の旧asset保持、元DB/catalog不変を試験する。試験用SDKは固定した配布tgzから読み、リポジトリのsrcへ戻らない。

## native driverの分離

利用先の価格DB用driverは1.5.3-r.3、SDKのoptional driverは2.0.0-r.1。試験用lockfileでは後者をSDK配下へ分離した。ただし同じprocessで両native driverを読み、1.5を先に初期化すると、2.0側のSQL `version()` もv1.5.3となることを確認した。依存を二重に配置するだけでは、実エンジンを分離した証明にならない。

財務exportは専用CLI processで実行し、価格DBの処理へ同居させない。SDKだけのprocessではv2.0.0を確認した。SDK側の実エンジン版拒否検査を追加し、実際の1.5/2.0混在processで構築・再開・読取の拒否を確認した。検査入りconsumer試験tgzで全64テストと型検査が成功し、旧driverを先行loadしたCLIの拒否と旧asset保持も確認した。混在processの利用を成功扱いにはしない。価格DBのdriverを一括更新する変更は行っていない。

## 正式統合の条件

試験用vendorの正式置換は、SDK source/配布物の固定、全社比較・独立原本照合・性能/容量基準、consumer全回帰、切戻しの確認後に行う。今回のartifactは試験用で、既存の正式provenanceを更新したものではない。vendor filename/provenanceは正式固定時に内容hashとsource manifestを対応させる。

検査入り試験配布物・consumer差分・全回帰logは `data/benchmarks/stock-data-duck-guard-20261031/`。旧consumerの正式vendorは変更していない。


## 同一SDK配布候補での追加回帰

取得から構築まで同じ配布物を使う候補 `014e7801…` を `/tmp/stock-data-duck-unified-20261031` に接続した。artifact SHA-256は `7b259963ed55a365291f8c4da22e3a71f2c0f0da310e3cd820bc1155c051daa7`。型検査・全10ファイル64テストが成功した。初回の結合テストtimeout（60秒）はlogを保持し、複数CLIを含む機能試験の上限を120秒にして再実行。性能受入の閾値は変更していない。

追加証跡は `data/benchmarks/stock-data-duck-unified-20261031/`。旧試験SDK・旧trial・正式vendorは保持している。これは新配布候補のconsumer回帰であり、同じ新SDKの実取得・日次・全社受入と正式vendor統合は引き続き必要。
