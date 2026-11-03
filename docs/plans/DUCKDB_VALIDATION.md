# DuckDB 2.0 検証計画

対象は停止済みの日次財務索引の集約1世代。原本DB・サービス・公開先は変更しない。

1. 元SQLiteを読取専用で開き、集約世代のfinancial_rows / financial_valuesだけを検証用SQLiteへコピーする。元DBの前後SHA-256一致を確認する。
2. 同じデータ・列型をDuckDB 2.0へ取り込む。SQLiteの索引は元定義を再利用する。
3. ランキング、複数指標検索、品質集計、期間別集計、指標間集計を比較する。結果全件の一致を検査し、浮動小数の集計のみ相対誤差1e-12・絶対誤差1e-6を許容する。
4. 各クエリ1回ウォームアップ後7回、エンジン実行順を交互にして計測。結果の全取得を含める。接続開始・取り込み・DB容量は別に記録する。
5. DuckDBは1スレッドと最大4スレッドを比較する。単一ホスト・ウォームキャッシュの結果であり、本番APIの検証・hash監査・XML解析・取得時間を含めない。

判定: 結果一致が必須。分析集計の中央値がSQLiteの半分以下なら分析用途の追加候補とする。小規模検索だけの勝敗で全面移行しない。容量は同じ1世代同士を比較し、元DBの会社別世代との重複削減をDuckDBの効果に含めない。

実行スクリプト: `scripts/benchmark-duckdb.py`。依存: `uv run --with duckdb==2.0.0 python scripts/benchmark-duckdb.py`。検証生成物はGit管理外の `data/benchmarks/duckdb-2-production/` に保存する。

## 実施結果（2026-10-30）

DuckDB 2.0.0 / Python側SQLite 3.53.1、同一Linux x86_64ホストで実行。対象は `reconstructed-bac0f75d00fe72ee29a954d8` の14,436財務行・37,787指標レコード（利用不可を含む）。元DBの前後SHA-256は `2b66d2ac15bc57bbeb13fdfd15da8887f89a0aae3633e2c8638190178e77e889` で一致。

2表の全列・全行の取り込み一致、5クエリ×2スレッド設定の全結果一致を確認した。SQLiteは元の主キー・検索索引を再作成。DuckDBには追加索引を作らず、同じ列を型付きテーブルへ取り込んだ。

各1回ウォームアップ後7回の中央値（ms、結果の全取得を含む）。SQLite列はDuckDB 1スレッドとの交互実行時。4スレッド比較時のSQLite中央値もJSONに保持する。

| 処理 | SQLite | DuckDB 1スレッド | DuckDB 4スレッド | 判断 |
|---|---:|---:|---:|---|
| 負債上位100件 | 0.72 | 17.52 | 24.21 | SQLiteが約24倍速い |
| 流動資産・流動負債の複合条件 | 52.18 | 32.47 | 32.98 | DuckDBが約1.6倍速い |
| 基準・期間種別・指標・状態別の品質集計 | 355.51 | 32.40 | 34.74 | DuckDBが約11倍速い |
| 期間・指標別の件数・合計・平均 | 332.14 | 26.34 | 32.17 | DuckDBが約13倍速い |
| 基準別の流動資産−流動負債集計 | 99.65 | 27.35 | 26.19 | DuckDBが約3.6倍速い |

| コスト | 測定結果 |
|---|---|
| 同じ1世代のSQLite | 123,707,392 bytes（約118 MiB） |
| 同じ1世代のDuckDB | 8,138,752 bytes（約7.76 MiB、約93.4%削減） |
| 元の複数世代SQLite（参考） | 321,310,720 bytes。会社別世代も含むためDuckDBとの直接比較には使わない |
| SQLiteから検証用SQLiteへの転記・索引生成 | 約2.27秒 |
| DuckDB生成 | 約15.25秒。Pythonでの読み出し・CSV書出し・COPY・checkpointを含む |
| 接続開始 | SQLite約0.29 ms / DuckDB約46.91 ms。各1回の参考値 |

### 初回SQL比較での暫定判断

事前基準の「分析集計で2倍以上」は3種類すべてで達成した。分析用の選択肢として追加候補とする。一方、ランキングはSQLiteが大幅に速く、複合条件は2倍未満。既存API・原本保存・取得checkpointを全面移行する根拠にはならない。

初回SQL比較では任意のオフライン分析コマンドを次工程としていた。その後、検索DBを置換できるかを確認するため、以下のNode・既存APIの追加検証へ範囲を広げた。本番接続・公開世代・固定SDKは変更していない。

### 限界・再現

- 本番の `screen()` / `quality()` 全体ではなくSQL処理の比較。入力検査・hash監査・私有DBコピー・出力組立は含まない。品質集計SQLも既存品質API全体の代替ではない。
- 単一ホストのウォームキャッシュ測定。4スレッドの効果はこの規模では小さく、一部は遅い。コールドキャッシュ・メモリピーク・並行アクセス・複数年への拡大は未測定。
- PythonのSQLite 3.53.1を使用し、本番NodeのSQLiteとの完全な比較ではない。SQLite統計の追加生成・クエリ別チューニングはしていない。
- DuckDBファイルは主キー制約・検索索引を付けない分析コピー。容量差には列圧縮と索引等の構成差を含む。元DBの会社別世代を除外した効果とは分けている。
- DuckDB 1.xとの比較はしておらず、結果を2.0固有の高速化率とは呼ばない。SQLite拡張の直接読取、Nodeバインディング、原本BLOBの保存は未検証。
- 予備実行では固定世代条件・検索形を本番と揃えていなかったため、中断して最終集計から除外した。最終実行は固定世代と本番同様の非相関IN条件を使用した。
- 再実行時は `--output-directory /tmp/edinet-duckdb-check-<識別子>` など新規出力先を指定する。既存の検証DBは上書きしない。

生データ・SQL・全サンプル: `data/benchmarks/duckdb-2-production/results.json`（Git管理外）。実行スクリプトは `scripts/benchmark-duckdb.py`。

## Node・既存APIの追加検証計画

PythonのSQL比較だけでは検索DBの置換を判断できないため、Node 26.12.1と公式Nodeパッケージ `@duckdb/node-api@2.0.0-r.1` で次を確認する。パッケージは `/tmp/edinet-duckdb-node-validation/` にだけ導入し、本体の依存・exports・公開世代は変更しない。

- 同じ集約世代の行・値に、世代manifestも加えて比較する。SQLiteは実際の `FinancialSearchIndex` を利用する。
- DuckDB側は現行ソースの `audit` / `generation` / `quality` / `screen` を検証用に機械抽出し、DB呼出しを非同期に変換する。SQLite固有の `INDEXED BY` を除き、件数制限なしの `LIMIT -1` を `LIMIT ALL` へ変換し、指標選択・hash監査・欠損診断・ページ処理は再利用する。
- 日本基準/IFRS×BS/明細の4種類に、ランキング・複合条件とページ・空結果の3種類を組み合わせる。各cohortは同一企業の重複を除いた明示書類（最大1,000社）で固定する。
- 全12検索の戻り値（値・出典・診断・件数等）、品質結果、世代結果の一致を確認する。入力エラーの拒否も確認する。
- エンジンごとの別Node processで接続・私有コピー・品質集計・検索を実行し、1回ウォームアップ後5回の時間とRSS/heap/OS記録の最大RSSを保存する。各エンジンを順番に実行するため、ホスト負荷の時間差は残る。
- 実際のcatalogがDuckDB readerを受け入れるかを確認する。別途、実会社別2世代を使う隔離したreaderで切替・失敗時の旧snapshot維持・切戻しを検証する。このreader実験は正式なcatalog・公開条件の移行完了を意味しない。

実行: Node 26.12.1で `node --import tsx scripts/validate-duckdb-node.ts`。再実行時は `DUCKDB_NODE_OUTPUT` に新規ディレクトリを指定する。Nodeパッケージの位置は `DUCKDB_NODE_MODULE` で指定できる。生成した検証用readerと結果は `data/benchmarks/duckdb-node/`（Git管理外）へ保存する。

## Node追加検証の結果（2026-10-30）

Node 26.12.1 / 内蔵SQLite 3.54.0 / DuckDBエンジンv2.0.0 / Nodeパッケージ2.0.0-r.1で確認した。原本のSQLiteは前後hash一致。検索処理の元ソースhashは `053b4c3ebc054756fef575eb410143ced02b83b796ca1d9ea1a038c415afdf0e`。

### 値・検索・世代管理

| 確認 | 結果 |
|---|---|
| 12検索の戻り値 | 全件一致。原値・出典・診断・欠損理由・件数・並び・ページを含む |
| 品質・世代情報 | 全結果のJSON hashが一致。全世代の行・値のhash監査と品質処理を含む |
| 検索対象 | 日本基準BS/明細は各1,000社、IFRS BSは188社、明細は176社 |
| 不正な項目指定 | 両方で拒否 |
| 隔離readerの世代切替 | 実会社別2世代で切替・切戻しに成功。読込失敗時は前のsnapshotを維持 |
| 破損検出 | 指標のavailableを改変した別DBをhash不一致で拒否。前のsnapshotを維持 |
| 既存catalogへの接続 | 不可。`FinancialIndexPublication` が `instanceof FinancialSearchIndex` を要求して拒否 |
| 同期APIの互換 | 不可。検証用DuckDB readerは非同期。現行の同期constructor・screen・reload等の単純な差替えではない |

切替実験は機械抽出したread処理の実現性を確認するもの。既存 `PublishedFinancialIndex` / catalogをDuckDB対応させた試験ではなく、正式世代の公開条件や本番切替の完了を意味しない。

### 速度・容量・メモリ

API相当の時間には、毎回の世代全体監査・返却本文の再検証・診断生成を含む。1回ウォームアップ後5回の中央値。各エンジンは別processで順番に実行した。

| 検索 | SQLite | DuckDB |
|---|---:|---:|
| J-GAAP/balanceSheet/ranking | 3.61秒 | 5.58秒 |
| J-GAAP/details/multi-page | 4.53秒 | 4.46秒 |
| IFRS/balanceSheet/ranking | 4.05秒 | 3.30秒 |
| IFRS/details/ranking | 3.63秒 | 3.68秒 |

12ケース中DuckDBが速かったのは3件。ケースごとのDuckDB/SQLite時間比の中央値は約1.05倍で、API全体の一律高速化は確認できなかった。GC・時間帯のホスト負荷による揺れも大きく、この差をエンジン固有の性能差と断定しない。

| コスト | SQLite | DuckDB |
|---|---:|---:|
| 同じ集約世代・世代manifest込みの容量 | 151,343,104 bytes（144.33 MiB） | 12,595,200 bytes（12.01 MiB） |
| 接続開始・私有コピー（各1回） | 0.26秒 | 1.77秒 |
| 品質API相当（各1回） | 16.07秒 | 35.41秒 |
| 検索終了までの最大RSS | 1052 MiB | 1041 MiB |

容量は約91.7%削減。DuckDB側は世代manifestに主キーを付け、行・値の検索索引や主キー制約は付けていない。内容・hashは同一であるが、この構成差を含む。メモリにはNode・検証ハーネス・保持する世代結果・繰返し監査の割当を含み、DBエンジン単体の使用量ではない。DuckDBのopenには動的なNodeバインディングの初回読込と私有コピーのbyte検証も含むため、定常接続の遅延と区別する。

### 移行判断と残工程

検索DBの置換は容量削減の面では有望。同じ値・診断・来歴を非同期readerで返せることを確認した。一方、現在の監査をそのまま繰り返す処理では検索API全体の高速化・メモリ削減は示せていない。

移行する場合は次を実装する。

1. 正式世代向けDuckDBの形式・版・指紋・読取専用保護を定義し、全体の値・来歴照合付きで生成する。SQLiteとDuckDBを恒常的に二重保存する前提にはしない。
2. 非同期の検索readerと世代管理の接続を実装する。既存の同期APIとは戻り値の型が変わるため、移行対象のCLI・利用先を明示する。
3. 不変snapshotの検証結果を再利用できるかをSQLite/DuckDB双方で検証する。毎回の全世代監査を省く際も、初回全検査・ファイル変更検出・破損拒否は維持する。DB変更の効果と監査再利用の効果を混同しない。
4. 実際の公開catalog・readerで品質条件、切替、読込失敗、切戻しを回帰確認する。

本番・全社サービス・原本保存・取得checkpointは未変更。正式な型互換、実catalogのDuckDB対応、並行アクセス・停止復旧・長時間メモリは未検証。

証跡: `data/benchmarks/duckdb-node/results.json`、`sqlite.json`、`duckdb.json`、生成した `duck-read-path.ts`（Git管理外）。再現スクリプト: `scripts/validate-duckdb-node.ts`。

### 件数境界の追加確認

制限なし・offsetのみ・limit=0を追加確認した。初回はDuckDBがSQLiteの `LIMIT -1` を拒否したため、検証用readerのSQL境界で `LIMIT ALL` へ変換した。修正後は3条件とも戻り値の全体hashがSQLiteと一致（制限なし963件、offset=5で958件、limit=0で0件）。本体コードは変更していない。元の12ケースはいずれも明示limitを持ち、この変換分岐を通らない。

証跡は `sqlite-boundaries.json` / `duckdb-boundaries.json`。修正前の拒否結果も `duckdb-boundaries-before-limit-fix.json` に保持した。境界3検索では監査関数の実時間とSQL読出しの時間も計測した（両者は重複するため加算しない）。監査再利用の改善効果そのものは未測定。

取得用DBの検証結果は[取得用DBの容量・書込・強制終了復旧の追加検証](DUCKDB_ACQUISITION_VALIDATION.md)を参照。
