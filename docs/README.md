# ドキュメント案内

初めて使う方は[READMEの最初の1回](../README.md#このリポジトリを試す)で、APIキー不要のサンプル解析を試してください。このページでは、目的に合う詳しい資料を選べます。全ページを順番に読む必要はありません。

## 最初に読むページ

| 知りたいこと                     | 読むページ                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| 動かし方と最小のコード例         | [README](../README.md)                                                               |
| CLIのmanifest/cohort入力と診断   | [最小JSON例](development/CLI_INPUT_EXAMPLES.md)                                      |
| 使える機能と制約                 | [提供機能と制約](REQUIREMENTS.md)                                                    |
| 連結・期間・出典などの言葉の意味 | [用語集](GLOSSARY.md)                                                                |
| 内部の処理や値の選択規則         | [技術仕様](SPECIFICATIONS.md)                                                        |
| 今できていることと残作業         | [実装状況](plans/IMPLEMENTATION_STATUS.md)・[今後の計画](plans/EDINET_TS_ROADMAP.md) |

## 要求から設計・検証・運用へ読む

この表の「正本」は、その内容を更新する場所です。まず要求・要件を確認し、仕様 → 構成 → データ → API/CLI → 検証 → 運用の順に進むと、目的と実装のつながりを追えます。進捗や過去の測定結果は、現行の契約と分けて読みます。

| 資料の役割     | 正本・入口                                                                                                                                                                                                             | ここで確認すること                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 要求・要件     | [提供機能と制約](REQUIREMENTS.md)、将来の要求は[全体ロードマップ](plans/EDINET_TS_ROADMAP.md)                                                                                                                          | 対象利用者・目的・対象外、機能/非機能要件と受入条件。実装状況は[実装追跡](plans/IMPLEMENTATION_STATUS.md)で別に確認する             |
| 仕様           | [技術仕様](SPECIFICATIONS.md)と下の領域別資料                                                                                                                                                                          | 入出力、値の選択、未取得・曖昧な結果の扱い。個別APIの詳細契約は領域別資料に置く                                                     |
| アーキテクチャ | [3つの処理経路](SPECIFICATIONS.md#処理の全体像)、[ソースコードの読み方](development/SOURCE_LAYOUT.md)                                                                                                                  | 通信・メモリ内処理・保存の境界、機能ごとの責務、実関数の呼出し順                                                                    |
| データ設計     | [財務データ構造](pipeline/FINANCIAL_DATA_MODEL.md)、[DDL定義の場所](development/SOURCE_LAYOUT.md#テーブル定義を探す)                                                                                                   | XMLの値と出典、原本・解析済みStore・検索世代・catalogの関係、保存形式と再利用の境界                                                 |
| API/CLI        | [7つのAPIの責務比較](SPECIFICATIONS.md#条件を指定するapiと自動判定)、[CLI入力JSONと診断](development/CLI_INPUT_EXAMPLES.md)、[DuckDB CLI/API](pipeline/DUCK_FINANCIAL_CLI.md)                                          | 入口を選び、必要な入力・既定値・結果・エラーを調べる。初回の実行例は[README](../README.md)                                          |
| テスト・受入   | [要件と関連テスト](REQUIREMENTS.md)、[テストの実行手順](../scripts/README.md#全体テスト)、[手動日次受入](pipeline/DUCK_FINANCIAL_MANUAL_DAILY_ACCEPTANCE.md)                                                           | 要求を何で確認するか、実行条件と成功条件、未検証の範囲。テスト成功と実運用の受入を区別する                                          |
| 運用・復旧     | [DuckDB構築・再開](pipeline/DUCK_FINANCIAL_CYCLE.md)、[照合・正式切替](pipeline/DUCK_FINANCIAL_VERIFICATION.md)、[強制終了復旧](pipeline/DUCK_FINANCIAL_RECOVERY.md)、[保持条件](pipeline/DUCK_FINANCIAL_RETENTION.md) | 汎用の手順・排他・再開・切戻しと削除条件。特定ホストの設定・実施記録は[本番運用記録](pipeline/DUCK_FINANCIAL_PRODUCTION.md)へ分ける |
| 設計判断       | [ローカル配布ADR](adr/0001-local-distribution.md)、[SQLite/DuckDBの構成判断](plans/SQLITE_DUCKDB_IMPLEMENTATION_PLAN.md)、[外部データの採否](plans/EXTERNAL_DATA_DECISIONS.md)                                         | なぜその構成・出典・配布方式を選んだか。日付付き判断と後続の変更を区別し、現行の仕様・手順へ進む                                    |

### API/CLIの細かい条件を探す

入力と返値は[領域別API](#財務値の抽出計算)へ進みます。採用されなかった理由は、たとえば[指標選択の結果と理由](financial/METRIC_SELECTION.md#結果と理由)で確認できます。CLIの引数・省略時の値は使用する版の `edinet-ts <command> --help`、manifest/cohortの形と入力エラーの直し方は[CLI入力例](development/CLI_INPUT_EXAMPLES.md)、索引検索の件数・並び順の既定値や非0終了は[DuckDB CLI](pipeline/DUCK_FINANCIAL_CLI.md)で確認してください。個別APIが返す「値がない・曖昧」と、入力不正や処理失敗のエラーは同じ意味ではありません。

通信・書込みの有無は[処理経路とAPI責務表](SPECIFICATIONS.md)を入口に、取得の時間制限・中断・保存保護は[取得仕様](pipeline/DOWNLOAD_SAFETY.md)、DB書込みと再開は[アーカイブ](pipeline/OBSERVED_FINANCIAL_ARCHIVE.md)・[解析済みStore](pipeline/PARSED_FINANCIAL_STORE.md)・[構築手順](pipeline/DUCK_FINANCIAL_CYCLE.md)で確認します。解析やsnapshot作成だけでDB保存まで行うとは限りません。

### 汎用手順と特定環境の記録を分ける

環境共通の条件は[実行環境](development/RUNTIME_AND_SQLITE.md)、実際の固定SDK・絶対パス・service/timer・更新履歴は[本番運用記録](pipeline/DUCK_FINANCIAL_PRODUCTION.md)にあります。別環境へ導入するときは汎用手順の入力と前提から設定し、ホスト固有のパスや初回移行policyをそのまま流用しません。日付付きの検証件数は、その入力・版での結果です。

設計判断の現行の帰結は、配布ADRから[固定配布物の手順](development/nuc7-local-artifacts.md)、SQLite/DuckDB計画から[現行の構成](SPECIFICATIONS.md#current-storage)へ進みます。[外部データ採否](plans/EXTERNAL_DATA_DECISIONS.md)の古い候補・未取得という記載は当時の判断を保持しているため、後続の[残作業](plans/REMAINING_WORK.md)と[実装追跡](plans/IMPLEMENTATION_STATUS.md)、対象領域の現行仕様も確認してください。

## 目的別の読み順

| 目的                                 | 最初の一冊                                                           | その次                                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1社の財務値を出典付きで読む          | [指標の選択](financial/METRIC_SELECTION.md)                          | 基準も原本から判定するなら[DEIの自動判定](financial/FINANCIAL_REPORTING_BASIS.md)                          |
| 複数社の数値を比較する               | [財務明細の抽出・検索](financial/FINANCIAL_DETAILS.md)               | 流動比率なら[BSと比率](financial/BALANCE_SHEET.md)、前年比なら[成長率](financial/ANNUAL_REVENUE_GROWTH.md) |
| 会社・株主・役員などを調べる         | 下の[会社情報](#会社情報企業マスター)・[開示表](#開示表人的資本株主) | 対象領域の明細APIへ進む                                                                                    |
| 取得から検索データの公開まで運用する | [工程と観測時点](pipeline/DOCUMENT_PIPELINE.md)                      | 下図に沿ってアーカイブ・構築・品質・公開へ進む                                                             |
| 開発・検証する                       | [実行環境](development/RUNTIME_AND_SQLITE.md)                        | [テスト手順](../scripts/README.md#全体テスト)・[技術仕様](SPECIFICATIONS.md)                               |

### 保存・公開の流れ

```mermaid
flowchart LR
    List[一覧を観測] --> Source[不足する原本を取得]
    Source --> Archive[原観測と原本を保存]
    Archive --> Build[検索用の世代を構築]
    Build --> Quality[対象範囲と品質を確認]
    Quality --> Publish[公開する世代を切り替え]
```

現行の継続運転は、[日別一覧](pipeline/FINANCIAL_DOCUMENT_SYNC.md) → [原本取得](pipeline/FINANCIAL_SOURCE_JOB.md) → [アーカイブ](pipeline/OBSERVED_FINANCIAL_ARCHIVE.md) → [解析済みStoreとDuckDB構築](pipeline/DUCK_FINANCIAL_CYCLE.md) → [原本照合・正式切替](pipeline/DUCK_FINANCIAL_VERIFICATION.md) → [非同期reader](pipeline/DUCK_FINANCIAL_SEARCH_INDEX.md)へ進みます。[品質分類](pipeline/FINANCIAL_INDEX_QUALITY.md)と[同期SQLite索引](pipeline/FINANCIAL_SEARCH_INDEX.md)・[公開API](pipeline/FINANCIAL_INDEX_PUBLICATION.md)も継続提供しています。

## 資料の置き場所

| フォルダ          | 内容                               |
| ----------------- | ---------------------------------- |
| `financial/`      | 財務値の選択・比較・計算           |
| `companies/`      | 会社情報・企業マスター・法人番号   |
| `disclosures/`    | 開示表・株主・役員・人的資本       |
| `pipeline/`       | 取得・保存・検索データの構築と公開 |
| `development/`    | 実行環境・検証・更新・配布の手順   |
| `plans/` / `adr/` | 今後の計画・進捗・設計判断         |
| `history/`        | 過去の提案・調査・作業記録         |
| `generated/`      | 自動生成された項目一覧             |

以下は分野別の全資料です。検証件数や配布commitは記録時点の結果であり、現在の稼働状態や全市場の品質を示すものではありません。

## 財務値の抽出・計算

基本の選択方法、基準別の明細、計算指標の順に並べています。対応する会計基準・期間・単位は各ページで確認してください。

- [会社の数値と元の記載を確認する](financial/METRIC_SELECTION.md)
- [型付き入力定数と文字列指定](financial/TYPED_OPTIONS.md)
- [DEIから財務基準・当期を確定する](financial/FINANCIAL_REPORTING_BASIS.md)
- [原本根拠で添付金融版を選ぶ](financial/FINANCIAL_VERSION_SELECTION.md)
- [J-GAAPのBS3項目・検索・流動比率](financial/BALANCE_SHEET.md)
- [IFRSの貸借対照表を原記載から読む](financial/IFRS_BALANCE_SHEET_SELECTION.md)
- [直接記載された財務項目を読む・複数社で探す](financial/FINANCIAL_DETAILS.md)
- [IFRSの直接PL・CF明細](financial/IFRS_FINANCIAL_DETAILS.md)
- [連続する12か月決算の売上高・営業利益前年比を比べる](financial/ANNUAL_REVENUE_GROWTH.md)
- [株式基準を確認したEPS・実績配当の成長率](financial/PER_SHARE_GROWTH.md)
- [平均自己資本を使う計算ROE](financial/AVERAGE_EQUITY_RETURN.md)
- [確認した負債構成を使うROIC](financial/ROIC.md)
- [明示した実績一株値と終値による評価指標](financial/VALUATION.md)
- [監査・非監査報酬](financial/AUDIT_FEES.md)
- [EDINET DB と edinet-ts の比較・改善](financial/EDINET_DB_COMPARISON.md)

## 会社情報・企業マスター

原本に書かれた会社情報、ある時点のコードリスト、法人番号の公表記録を、それぞれ別の根拠として扱います。

- [企業マスターの観測保存と差分](companies/COMPANY_MASTER.md)
- [原本に書かれた会社情報を確認する](companies/COMPANY_PROFILE.md)
- [法人番号の原記録・保存・番号参照・状態再構成](companies/CORPORATE_REGISTRY.md)

## 開示表・人的資本・株主

元の表の行・値・出典を読むAPIです。同じ会社名・人名を自動で同一対象とみなす機能ではありません。

- [関係会社の記載明細と逆引き](disclosures/AFFILIATED_COMPANY_DETAILS.md)
- [表の行や対象を区別する指定を追跡する](disclosures/CONTEXT_DIMENSION_TRACES.md)
- [開示本文の表とセルの出典](disclosures/DISCLOSURE_TABLES.md)
- [設備表の明細・保存・条件検索](disclosures/FACILITY_DETAILS.md)
- [一次大量保有の明細・訂正版選択](disclosures/LARGE_HOLDING.md)
- [大量保有報告の原本限定取引表](disclosures/LARGE_HOLDING_TRANSACTIONS.md)
- [主要顧客の記載明細と逆引き](disclosures/MAIN_CUSTOMER_DETAILS.md)
- [大株主表と大量保有の引用を分ける](disclosures/MAJOR_SHAREHOLDER_DETAILS.md)
- [役員の現任・予定と原表の明細](disclosures/OFFICER_DETAILS.md)
- [役員報酬の区分集計・個人総額・会社別内訳](disclosures/OFFICER_REMUNERATION.md)
- [受注・工事・繰越の直接明細](disclosures/ORDER_DETAILS.md)
- [政策保有株式の直接記載と逆引き](disclosures/POLICY_SHAREHOLDINGS.md)
- [セグメントの直接明細と期間・役割別検索](disclosures/SEGMENT_DETAILS.md)
- [所有者別状況の分類・単元数・株数](disclosures/SHAREHOLDER_CATEGORIES.md)
- [子会社人的資本表のラベルと数値](disclosures/SUBSIDIARY_HUMAN_CAPITAL.md)
- [提出会社単体の給与・年齢・勤続年数・従業員数・平均臨時雇用人員を読み比べる](disclosures/WORKFORCE.md)

## 取得・保存・検索世代の公開

継続運用の手順と、小さなデータ集合を保存・比較するAPIがあります。まず工程全体を確認し、必要な処理へ進んでください。

- [保存した2つの解析結果の違いを見る](pipeline/BALANCE_SHEET_VERSION_DIFF.md)
- [書類一覧 API の応答境界](pipeline/DOCUMENT_LIST_VALIDATION.md)
- [訂正書類・世代保存・充足率](pipeline/DOCUMENT_PIPELINE.md)
- [書類の親子関係と、一覧情報の変化を確認する](pipeline/DOCUMENT_RELATIONS.md)
- [ZIP取得と保存時の保護](pipeline/DOWNLOAD_SAFETY.md)
- [財務取得計画の再開可能な準備](pipeline/FINANCIAL_CYCLE_PREPARATION.md)
- [固定資産・固定負債・現金及び預金をSQLiteへ保存する](pipeline/FINANCIAL_DETAIL_STORE.md)
- [日別一覧backfillと財務アーカイブへの転送](pipeline/FINANCIAL_DOCUMENT_SYNC.md)
- [必要な書類だけを財務DBへ取り込む](pipeline/FINANCIAL_INCREMENTAL_IMPORT.md)
- [母集団全件の分割構築・再開・世代集約](pipeline/FINANCIAL_INDEX_BUILD.md)
- [品質条件付きの財務世代切替と復帰](pipeline/FINANCIAL_INDEX_PUBLICATION.md)
- [DuckDB本番運用・正式catalog・切戻し](pipeline/DUCK_FINANCIAL_PRODUCTION.md)
- [DuckDB日次処理の連続2日手動検証](pipeline/DUCK_FINANCIAL_MANUAL_DAILY_ACCEPTANCE.md)
- [DuckDB移行後の保存物と整理条件](pipeline/DUCK_FINANCIAL_RETENTION.md)
- [固定財務索引の品質集計](pipeline/FINANCIAL_INDEX_QUALITY.md)
- [観測世代からの直接財務SQL検索](pipeline/FINANCIAL_SEARCH_INDEX.md)
- [不足財務原本の取得と再開](pipeline/FINANCIAL_SOURCE_ACQUISITION.md)
- [全社の原本取得計画と試行履歴](pipeline/FINANCIAL_SOURCE_JOB.md)
- [財務3項目と流動比率をSQLiteに保存して検索する](pipeline/FINANCIAL_SQLITE_STORE.md)
- [観測と原本を保持する財務アーカイブ](pipeline/OBSERVED_FINANCIAL_ARCHIVE.md)
- [公開snapshotによる財務検索と再ロード](pipeline/PUBLISHED_FINANCIAL_INDEX.md)
- [固定年次計画・日次サービスと、停止DBの完全バックアップ/復元](pipeline/ROADMAP_RUNTIME.md)
- [停止した専用DBのhot journal復旧](pipeline/SQLITE_RECOVERY.md)

## 開発・検証・配布

実行環境、原本照合、タクソノミ更新、固定配布物の手順です。

最初にデータの形を確認する場合は[財務データ構造の説明](pipeline/FINANCIAL_DATA_MODEL.md)、コードの配置を確認する場合は[ソースコードの読み方](development/SOURCE_LAYOUT.md)を参照してください。

- [手元の原本で取り込みから版比較まで確認する](development/OFFLINE_FINANCIAL_VERIFICATION.md)
- [実際の決算書と数値を照らし合わせた結果](development/REAL_DATA_VALIDATION.md)
- [Node・依存更新と標準SQLite](development/RUNTIME_AND_SQLITE.md)
- [タクソノミの更新手順](development/TAXONOMY_UPDATE.md)
- [固定source配布物のローカル作成・保持](development/nuc7-local-artifacts.md)

## 計画・設計判断・履歴

- [全体計画](plans/EDINET_TS_ROADMAP.md): 全段階の目標・受入条件と進め方。
- [実装追跡](plans/IMPLEMENTATION_STATUS.md): 実装・検証・配布・運用を分けた現在地。
- [財務明細の設計候補](plans/FINANCIAL_NORMALIZATION.md)・[外部データの採否](plans/EXTERNAL_DATA_DECISIONS.md)。
- [ローカル配布の設計判断](adr/0001-local-distribution.md)。
- [過去の計画・調査・依頼と検証経過](history/README.md)。

## 生成された項目一覧

- [財務諸表本表 jppfs_cor](generated/TAXONOMY_JPPFS_COR.md): `scripts/generate_doc_taxonomy.ts`で生成。
- [企業情報 jpcrp_cor](generated/TAXONOMY_JPCRP_COR.md): `scripts/generate_types_jpcrp.ts`で生成。

項目一覧は読み方の手引きではなく、タグを調べる辞書です。生成資料は手動編集せず、[更新手順](development/TAXONOMY_UPDATE.md)に従います。CLIの型ヘルプも`src/utils/type-doc-defs.ts`を直接編集せず、`scripts/generate-type-docs.ts`から生成します。

## 文書を更新するとき

文書を追加するときは、まず同じ目的の既存資料へ追記できるか確認します。使い方は領域別資料、現在の進捗は実装追跡、完了した作業の経緯は履歴に置き、同じ説明を複数箇所へコピーしません。

今後の作業順は[計画の残作業と優先順位](plans/REMAINING_WORK.md)を参照してください。実装済み・実データ検証待ち・正式反映待ち・利用者の手動実施を分けて管理しています。
