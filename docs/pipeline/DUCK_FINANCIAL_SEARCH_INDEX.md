# DuckDBの非同期財務reader

2026-10-31。独立移行計画のP4。公開exports・CLI・正式catalogへの接続は後続工程。

`DuckFinancialSearchIndex.open(file)` は、P3で完成した検索候補を私有snapshotとして開く。返すメソッドは `generation(id)`、`quality(id)`、`screen(cohort, options)`、`snapshotSha256()`、`close()`。すべてPromiseを返す。既存の同期 `FinancialSearchIndex` はそのまま使える。

## 同期readerと共有するもの

入力の正規化、世代/列/値のhash監査、品質分類、検索条件、欠損・曖昧・安全範囲外の診断、件数・順序、返却行の本文照合は `FinancialIndexReadQueries` に集約した。この内部処理はSQL要求を順に返し、SQLite側は同期、DuckDB側は非同期で実行する。監査・診断を別実装で複製しない。

SQL方言の差は、SQLiteの `INDEXED BY financial_metric_range`、無制限件数を表す `LIMIT -1`（DuckDBではNULL）、文字列のbyte長（SQLiteのBLOB長とDuckDBのencode/octet_length）で吸収する。BIGINTは安全範囲を検査してnumberへ戻し、DOUBLEの数値と原文・根拠を保持する。

世代の組立指紋には、DuckDB側が固定した解析済みStore指紋も含まれる。そのため、同じ財務値の旧SQLite構築とDuckDB構築では、assemblyの計画/会社別receiptのID・hashと、それを含む世代指紋は異なる。財務行・値・採用履歴・診断・母集団の一致を確認し、物理ファイルhashや異なる計画のhash一致を要求しない。

## ファイルと接続の寿命

私有コピー・完全schema比較・副ファイル拒否・外部アクセス禁止は `DuckFinancialSnapshot` が担当する。元候補が後から置換されても開いたsnapshotを維持し、明示的に別readerを開くまで世代を変えない。私有snapshot自体の変更はSQL前後で拒否する。

readerのcloseは開始済みの検索・品質処理全体を待つ。検索の途中のSQLだけが終わった時点で接続を破棄しない。close開始後の追加処理は拒否し、繰返しcloseできる。エラーになった検索の後も同じ接続を使える。

## 検証と残件

専用テストは日本基準、IFRS連結/単体、BS/期間指標、無制限・0件・offset・条件・ソート・明示書類、unsafe値の診断、世代/品質の一致、不正入力、存在しない世代、返却値の変更、実行中closeを対象にする。

実原本由来の固定候補は次で比較する。

```sh
node node_modules/tsx/dist/cli.mjs scripts/verify-duck-financial-reader.ts \
  data/benchmarks/duck-financial-index-build-20261031-v8 \
  <新規出力先>
```

初回の限定検証では24検索がSQLiteと一致し、品質も構築identityを除いて一致した。DuckDB・SQLiteの元ファイルは不変。証跡は `data/benchmarks/duck-financial-reader-20261031/summary.json`。時間は単回・小標本で、全社の速度保証には使わない。

P5で初回監査の分割・容量上限と検査結果再利用を追加した。詳細は以下。品質・独立原本照合gate、catalogでの正式切替、全社/日次/利用先の移行はP6〜P7。本モジュールの追加だけでは本番経路は切り替わらない。


## P5：固定snapshotの監査結果を再利用する

open中に世代manifest・全財務行・全指標値を監査し、全行本文を既存品質検査でSQL列・指標manifestへ突合する。失敗時はreaderを返さず、接続と私有コピーを破棄する。唯一の完成世代以外の孤立行・値も拒否する。

世代manifestは本文を取得する前に64 MiB上限を確認する。行・値の監査はDuckDB readerで最大4,096件・文字列payload合計64 MiB以内でkeyset分割する（初回性能改善の候補として検証中）。共有generatorと既存SQLite readerの標準は1,000件を維持する。byte長をDB内で計算し、容量上限へ先に達する場合は読取キーを減らすため、巨大な改変本文をJavaScriptへ展開する前に拒否できる。選んだ正確なキー集合をINで取得する。品質検査も同じ分割読取を使う。manifestや品質のメタデータは保持するので、全社のRSS上限を保証するものではない。

完成したreaderは検査済みmanifest・品質を私有メモリへ保持する。通常検索は全世代を再監査せず、cohort・要求項目のSQLと返却行のhash照合を行う。世代・品質の再読取はSQLなしでコピーを返し、呼出側の返却値変更が保持データへ影響しない。検索のたびに全manifestを複製することもしない。

SQLを使わないcache返却でも、私有ファイルのdevice/inode/size/mtime/ctime・通常ファイル・単一リンク・副ファイルを前後で確認する。mtimeだけを根拠に別ファイルへ検査結果を流用しない。元候補の置換後も既存snapshotを保持し、新候補は別readerとして初回から検査する。

性能比較:

```sh
node node_modules/tsx/dist/cli.mjs scripts/benchmark-duck-financial-reader.ts   data/benchmarks/duck-financial-index-build-20261031-v8   <新規出力先>
```

SQLite、現行DuckDBで毎回共有監査を実行するモード、監査再利用モードを別processで測定する。uncachedは現在の分割監査であり、過去のP4コードそのものではない。すべて同じ検索結果を確認し、初回open・5反復・RSSを保存する。

限定2社・12検索/反復では、反復中央値はSQLite約51.7ms、DuckDB監査毎回約2,194ms、再利用約763ms。再利用はDuckDB自身との比較で約2.9倍速いが、この小標本ではSQLiteの方が速い。最大RSSは約79/197/195 MiBで、再利用によるメモリ削減はほぼない。初回openはSQLite約3ms、DuckDB約691〜828msで、DuckDB側には初回監査も含む。証跡は `data/benchmarks/duck-financial-reader-cache-20261031/summary.json`。小標本・単回process群の測定を全社へ外挿せず、P7で代表入力と日次更新を測る。

P5専用の追加検査は、定常時の監査SQLなし、cacheの返却値分離、候補本文/指標/manifestの改変拒否、孤立値、cache返却時の私有ファイル改変、64 MiB超の本文、100件超のreaderページ監査を含む。

## 固定SDK・同一世代での性能比較

`node scripts/benchmark-duck-financial-cycle.mjs <固定SDKディレクトリ> <完成したcycleディレクトリ> <新規出力ディレクトリ>` は完成候補のSDK/入力指紋を確認し、同じデータ・manifestから比較用SQLiteを生成する。各workerはSQLite/DuckDBの物理snapshot hashも確認し、計測対象の入替を拒否する。

日本基準/IFRS×BS/明細で会社数の多い連結cohortを固定し、各最大1,000社・1社/証券コード1書類に絞る。利用可能件数の多い最大5指標を使い、ランキング・複合条件・件数無制限の3検索を比較する。別processのSQLite、毎回全体監査するDuckDB、snapshot監査を再利用するDuckDBで、各1回warmup・5回計測。初回openとquality、各検索時間、RSS/最大RSS、DB容量、全結果hashを保存する。

全mode・全反復の結果一致が必須。Node/driverとSDKは同一にする。workerを逐次実行するためホスト負荷の時間差は残り、同時負荷やcold cacheの受入試験は別途必要。全社構築中に測った小標本の時間を正式な性能受入の根拠にしない。

## 実エンジン版の確認

固定したoptional packageの版に加え、SQL `version()` が `v2.0.0` であることを検査する。別版native driverを同じprocessで先に読み込むと、packageが2.0でも実エンジンが1.5になる場合があるため、読取ではメモリDBの検査を候補DB接続より前に行い、候補接続後も確認する。不一致では私有コピーを破棄し、正式readerを置換しない。

構築は新規beginと再開経路の形式検査でも確認し、候補schema/値への書込前に拒否する。異なるnative DuckDBを使う価格DB等とは専用CLI processで分離する。将来のengine更新は依存pinとこの確認条件を一緒に変更・検証する。

実機検証: `node scripts/verify-duck-financial-engine.mjs <隔離SDK> <旧driverのentry.js> <完成候補DuckDB> <新規証跡directory>`。2.0専用processの読取成功と、実1.5/2.0混在processでの拒否、元候補のhash不変を確認する。


初回のDuckDB readerは`auditSnapshot`で世代manifestに行のmetadata/本文/hashを照合し、同じ行読取で品質集計も行う。SQL指標値は全件のhashを別途照合してから検査済み状態を返す。数値列のNaN/InfinityはJSONのnullへ正規化される前に拒否する。本文・保存hashの同時改変や、行だけ欠落して指標値が残る場合も拒否する。

JSON正規化は、単純な値だけの配列と二段の配列ではnative stringifyを利用し、objectを含む値はキー順の正規化を維持する。toJSON付き配列は高速経路へ入れず、配列のevery上書きも信用しない。既存保存物のhash互換性を維持し、SQL数値の有限性と本文・manifest・値の照合を引き続き行う。

初回品質検査は正規化後の本文と保存本文の完全一致を確認し、prepareが計算するmetadata＋本文digestを保存hash/manifestに照合する。同じ本文のhashを二度計算せず、metadata・全SQL指標・金融版根拠・母集団/count検査は維持する。JSON parse/投影に失敗した本文も拒否する。
