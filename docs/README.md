# ドキュメント案内

使い始める方は[ルートREADME](../README.md)へ進んでください。このページでは、目的に合う詳しい資料を選べます。全ページを順番に読む必要はありません。

## 最初に読むページ

| 知りたいこと | 読むページ |
|---|---|
| 動かし方と最小のコード例 | [README](../README.md) |
| 使える機能と制約 | [提供機能と制約](REQUIREMENTS.md) |
| 連結・期間・出典などの言葉の意味 | [用語集](GLOSSARY.md) |
| 内部の処理や値の選択規則 | [技術仕様](SPECIFICATIONS.md) |
| 今できていることと残作業 | [実装状況](plans/IMPLEMENTATION_STATUS.md)・[今後の計画](plans/EDINET_TS_ROADMAP.md) |

## 目的別の読み順

| 目的 | 最初の一冊 | その次 |
|---|---|---|
| 1社の財務値を出典付きで読む | [指標の選択](financial/METRIC_SELECTION.md) | 基準も原本から判定するなら[DEIの自動判定](financial/FINANCIAL_REPORTING_BASIS.md) |
| 複数社の数値を比較する | [財務明細の抽出・検索](financial/FINANCIAL_DETAILS.md) | 流動比率なら[BSと比率](financial/BALANCE_SHEET.md)、前年比なら[成長率](financial/ANNUAL_REVENUE_GROWTH.md) |
| 会社・株主・役員などを調べる | 下の[会社情報](#会社情報企業マスター)・[開示表](#開示表人的資本株主) | 対象領域の明細APIへ進む |
| 取得から検索データの公開まで運用する | [工程と観測時点](pipeline/DOCUMENT_PIPELINE.md) | 下図に沿ってアーカイブ・構築・品質・公開へ進む |
| 開発・検証する | [実行環境](development/RUNTIME_AND_SQLITE.md) | [テスト手順](../scripts/README.md#全体テスト)・[技術仕様](SPECIFICATIONS.md) |

### 保存・公開の流れ

```mermaid
flowchart LR
    List[一覧を観測] --> Source[不足する原本を取得]
    Source --> Archive[原観測と原本を保存]
    Archive --> Build[検索用の世代を構築]
    Build --> Quality[対象範囲と品質を確認]
    Quality --> Publish[公開する世代を切り替え]
```

対応する資料は、[日別一覧](pipeline/FINANCIAL_DOCUMENT_SYNC.md) → [原本取得](pipeline/FINANCIAL_SOURCE_JOB.md) → [アーカイブ](pipeline/OBSERVED_FINANCIAL_ARCHIVE.md) → [索引構築](pipeline/FINANCIAL_INDEX_BUILD.md) → [品質確認](pipeline/FINANCIAL_INDEX_QUALITY.md) → [公開](pipeline/FINANCIAL_INDEX_PUBLICATION.md)です。

## 資料の置き場所

| フォルダ | 内容 |
|---|---|
| `financial/` | 財務値の選択・比較・計算 |
| `companies/` | 会社情報・企業マスター・法人番号 |
| `disclosures/` | 開示表・株主・役員・人的資本 |
| `pipeline/` | 取得・保存・検索データの構築と公開 |
| `development/` | 実行環境・検証・更新・配布の手順 |
| `plans/` / `adr/` | 今後の計画・進捗・設計判断 |
| `history/` | 過去の提案・調査・作業記録 |
| `generated/` | 自動生成された項目一覧 |

以下は分野別の全資料です。検証件数や配布commitは記録時点の結果であり、現在の稼働状態や全市場の品質を示すものではありません。

## 財務値の抽出・計算

基本の選択方法、基準別の明細、計算指標の順に並べています。対応する会計基準・期間・単位は各ページで確認してください。

- [会社の数値と元の記載を確認する](financial/METRIC_SELECTION.md)
- [型付き入力定数と文字列指定](financial/TYPED_OPTIONS.md)
- [DEIから財務基準・当期を確定する](financial/FINANCIAL_REPORTING_BASIS.md)
- [J-GAAPのBS3項目・検索・流動比率](financial/BALANCE_SHEET.md)
- [IFRSの貸借対照表を原記載から読む](financial/IFRS_BALANCE_SHEET_SELECTION.md)
- [直接記載された財務項目を読む・複数社で探す](financial/FINANCIAL_DETAILS.md)
- [IFRS連結の直接PL・CF明細](financial/IFRS_FINANCIAL_DETAILS.md)
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
- [設備表の直接明細と条件検索](disclosures/FACILITY_DETAILS.md)
- [一次大量保有の明細・訂正版選択](disclosures/LARGE_HOLDING.md)
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
- [固定財務索引の品質集計](pipeline/FINANCIAL_INDEX_QUALITY.md)
- [観測世代からの直接財務SQL検索](pipeline/FINANCIAL_SEARCH_INDEX.md)
- [不足財務原本の取得と再開](pipeline/FINANCIAL_SOURCE_ACQUISITION.md)
- [全社の原本取得計画と試行履歴](pipeline/FINANCIAL_SOURCE_JOB.md)
- [財務3項目と流動比率をSQLiteに保存して検索する](pipeline/FINANCIAL_SQLITE_STORE.md)
- [観測と原本を保持する財務アーカイブ](pipeline/OBSERVED_FINANCIAL_ARCHIVE.md)
- [公開snapshotによる財務検索と再ロード](pipeline/PUBLISHED_FINANCIAL_INDEX.md)
- [固定年次計画と日次更新を実行する専用サービス](pipeline/ROADMAP_RUNTIME.md)
- [停止した専用DBのhot journal復旧](pipeline/SQLITE_RECOVERY.md)

## 開発・検証・配布

実行環境、原本照合、タクソノミ更新、固定配布物の手順です。

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
