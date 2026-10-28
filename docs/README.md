# ドキュメント索引

更新日: 2026-10-28。使い方・現在の仕様はこの階層、計画はplans、過去の経緯はadr/historyに置きます。

まずは「何をしたいか」から選んでください。言葉に迷ったら[用語集](GLOSSARY.md)を参照できます。

| やりたいこと | 最初に読む資料 |
|---|---|
| 実際の決算書との一致・未確認範囲を知りたい | [実データの確認結果](REAL_DATA_VALIDATION.md) |
| 会社の数値を読み、元の記載も確認したい | [数値の取り出し方](METRIC_SELECTION.md) |
| 流動資産・流動負債・負債合計を読みたい | [今回の3項目](BALANCE_SHEET_NORMALIZATION.md) |
| IFRSの連結BS3項目を読み、明示した会社を比べたい | [IFRSの専用抽出・検索](IFRS_BALANCE_SHEET_SELECTION.md)（直接抽出/メモリ検索/CLIは#55/#56でmain、DBなし） |
| 保存した複数社の数値を条件で探したい | [21指標の検索](EDINET_DB_COMPARISON.md)。新しい3項目は[保存ファイルからの検索](BALANCE_SHEET_SCREENING.md)（#26でmainへ統合済み） |
| 提出会社単体の給与・年齢・勤続年数・従業員数を読み比べたい | [人的資本](WORKFORCE.md)（期末と範囲を揃えた検索。従業員数は#53、平均臨時雇用人員は#64、同一重複採用は#65でmainへ統合済み） |
| 原本の会社名・コード・基準を読み、会社名・決算月で探したい | [会社情報](COMPANY_PROFILE.md)（原記載・採用理由、明示集合の検索） |
| 固定資産/費用/CF明細・借入/社債/リース残高を読み比べたい | [直接財務項目](FINANCIAL_DETAILS.md)（既定5項目＋明示CF6/残高7/PL5項目、XML/保存JSON検索） |
| 流動比率で会社を比べたい | [計算方法・検索・CLI](CURRENT_RATIO.md)（#28でmainへ統合済み） |
| 入力候補を選び、タイプミスを減らしたい | [型・定数の使い方](TYPED_OPTIONS.md) |
| 財務3項目・流動比率を保存して検索したい | [SQLiteの小規模試作](FINANCIAL_SQLITE_STORE.md)（#31でmainへ統合済み） |
| 固定資産・固定負債・現金及び預金を保存したい | [直接財務3項目の専用Store](FINANCIAL_DETAIL_STORE.md)（#46でmain統合済みの試験API、CLIなし） |
| 財務DBへ必要な書類だけ取り込みたい | [差分取り込み](FINANCIAL_INCREMENTAL_IMPORT.md)（APIは#33、`import-bs --dry-run`は#34でmain統合済み） |
| 保存した旧版と新版の違いを知りたい | [数値・採用状態・出典の比較](BALANCE_SHEET_VERSION_DIFF.md)（#35でmain） |
| 保存原本で取り込みから比較まで通るか確認したい | [オフライン品質確認](OFFLINE_FINANCIAL_VERIFICATION.md)（#36でmain、明示入力・一時DB専用） |
| 売上高・営業利益の前年からの増減で会社を比べたい | [12暦月の前年比](ANNUAL_REVENUE_GROWTH.md)（売上は#38でmain、営業利益を別APIで追加。曖昧な入力は計算しない） |
| 次の実装範囲を確認したい | [確認待ちの具体案](plans/EDINET_TS_ROADMAP.md#確認待ちの具体案2026-10-28)（税引前重複→CF3項目は承認済み、ローカル実装・検証中） |
| 全工程の実装状況を追いたい | [残工程の実装追跡](plans/IMPLEMENTATION_STATUS.md)（全体ロードマップが継続対象） |
| 現在地と次の方針を知りたい | [全体計画](plans/EDINET_TS_ROADMAP.md)。main完了・PR確認待ち・未着手・未検証を区別 |
| 変更の経緯を知りたい | [#27 検証記録](https://github.com/oharato/edinet-ts/pull/27)・[#28 流動比率](https://github.com/oharato/edinet-ts/pull/28)は正式stack #29でmainへ統合済み |
| 通知書010・届出書030を正しく指定したい | [書類種別と旧名の互換性](DOCUMENT_LIST_VALIDATION.md#通知書010と有価証券届出書030の指定) |
| 大量保有の種別コード（350/360と340の扱い）を確認したい | [大量保有関係の書類種別コード](DOCUMENT_LIST_VALIDATION.md#大量保有関係の書類種別コード) |
| 書類一覧の親番号や状態の違いを確認したい | [書類の関係と観測](DOCUMENT_RELATIONS.md)（明示JSONのみ。最新版を自動選択しません） |
| 人的資本表に書かれた会社名を探したい | [会社ラベルの抽出・検索](SUBSIDIARY_HUMAN_CAPITAL_LABELS.md)（一般子会社マスターとは別） |
| 表の行や対象を区別する指定の出典を確認したい | [次元の名前の追跡](CONTEXT_DIMENSION_TRACES.md)（解析後の証跡。元の字面・DTSの検証ではありません） |

以下は、実装・確認する人向けの詳しい資料一覧です。

## 現行の入口

| 資料 | 内容 |
|---|---|
| [利用方法](../README.md) / [DBセットアップ](../SETUP_DB.md) | ライブラリ・CLI・書類メタデータDB |
| [要件・提供機能](REQUIREMENTS.md) | 現行機能と環境。未実装の範囲は計画と区別 |
| [型付き入力定数](TYPED_OPTIONS.md) | scope・比較・並び順・期間分類と、文字列指定の互換性 |
| [指標辞書・厳密選択](METRIC_SELECTION.md) | 18指標の追加API、raw/number・欠損理由・未対応境界 |
| [技術仕様](SPECIFICATIONS.md) | パーサー、主要指標、scope、DB、探索規則 |
| [書類一覧API境界](DOCUMENT_LIST_VALIDATION.md) | 区分の正規化、エラーと空結果の区別 |
| [EDINET DB比較・指標辞書](EDINET_DB_COMPARISON.md) | 単一銘柄/横断検索の二軸、21指標・入力・制約 |
| [他EDINETライブラリ調査](EDINET_LIBRARY_RESEARCH.md) | 設計候補、ライセンス、独立実装の境界 |
| [Node・標準SQLite](RUNTIME_AND_SQLITE.md) | 採用版、breaking change、DB互換と検証結果 |
| [依存選定方針](DEPENDENCY_DECISIONS.md) | Node/SQLite・XML/ZIP/Excel・開発依存の判断 |
| [ローカル配布物](nuc7-local-artifacts.md) | 固定sourceの再現、保持、rollback、利用先統合 |
| [タクソノミ更新](TAXONOMY_UPDATE.md) | 取得・型/資料生成の手順 |
| [jppfs_cor一覧](TAXONOMY_JPPFS_COR.md) / [jpcrp_cor一覧](TAXONOMY_JPCRP_COR.md) | 現行実装の生成済み型に対応する一覧。最新年度への対応を保証する意味ではない |

- [BS3項目の横断検索](BALANCE_SHEET_SCREENING.md): 保存ファイルの一覧を使う検索方法、使えなかった理由と件数。
- [J-GAAP BS3項目](BALANCE_SHEET_NORMALIZATION.md): 別registry/API、来歴・欠損・対応範囲。

## 計画と判断の履歴

- [進行中の改善計画](plans/EDINET_TS_ROADMAP.md): 現在地と、原本→TypeScript抽出→SQLite財務保存→SQL検索の方針案。専用DBの小規模試作はローカル検証済み。本番の保存構造・移行は未設計。
- [財務明細正規化計画](plans/FINANCIAL_NORMALIZATION.md): 追加する数値と確認項目。BS3・直接5・CF3・残高7・PL5項目はmainへ取り込み済み。対応範囲は現行仕様、残る受入条件は全体計画を参照。
- [ADR 0001: ローカル配布物保持](adr/0001-local-distribution.md): 採用した保存・配布方針。
- [履歴索引](history/README.md): 過去の依頼、失効した公開手順、過去比較と検証。現行の手順として実行しない。

## 生成元と参照の維持

- `TAXONOMY_JPPFS_COR.md`: `scripts/generate_doc_taxonomy.ts` が生成。
- `TAXONOMY_JPCRP_COR.md`: `scripts/generate_types_jpcrp.ts` が生成。
- CLI型ヘルプの `src/utils/type-doc-defs.ts`: `scripts/generate-type-docs.ts` が生成。手動編集しない。
- 生成先は変更していない。`.github/workflows/auto-release.yml` が案内する `docs/nuc7-local-artifacts.md` も維持する。

Markdownのファイルを移す際は、README・相対リンク・スクリプト・CI参照・大小文字を同時に確認する。過去資料の削除ではなく移動を基本とし、明らかな重複だけを根拠付きで統合する。

XML原本を読む際のサイズ・構文・DOCTYPEの制約とCLIの読み取り上限は[仕様書](SPECIFICATIONS.md#22-edinetxbrlparser)を参照してください。

ZIPの形式・容量・保存先の制約、既存キャッシュと失敗時の扱いは[ZIP取得と保存時の保護](DOWNLOAD_SAFETY.md)を参照してください。

取得の待ちを制限・中断したい場合は[本文受信までの期限とsignal](DOWNLOAD_SAFETY.md#本文受信までの時間制限と中断)、サーバーの待ち指定は[再試行待ち](DOWNLOAD_SAFETY.md#サーバーが指定する再試行待ちと追加待ち)を参照してください。

- [訂正書類・世代保存・充足率・ローカル価格](DOCUMENT_PIPELINE.md): 観測cutoff、専用世代保存、母集団別工程集計と未調整価格の選択。

- [監査・非監査報酬](AUDIT_FEES.md): 本体/ネットワーク・監査/非監査・提出会社/子会社/計を分ける12区分の直接取得と期間別検索。

- [平均自己資本による計算ROE](AVERAGE_EQUITY_RETURN.md): 掲載値と分けた算式・期首/期末構成・厳密分数検索・実原本照合。

- [根拠付きEPS・実績配当の前年比/CAGR](PER_SHARE_GROWTH.md): 株式基準・支払状態・注記参照を確認し、予定額や基準不一致を計算から除外。

- [子会社人的資本表の数値・検索](SUBSIDIARY_HUMAN_CAPITAL_METRICS.md): 行次元と7項目、算出方法/未記載理由の原注記参照、実37行の独立照合。

- [開示本文の表とセルの出典](DISCLOSURE_TABLES.md): 設備・関係先等の元本文/結合セル保持と文字列逆引き。意味/単位を確定した数値明細とは別。

- [設備表の直接明細と条件検索](FACILITY_DETAILS.md): 確認済み表の簿価/面積、十進換算と条件検索。個別物件や所有権の推定とは別。

- [主要顧客の記載明細と逆引き](MAIN_CUSTOMER_DETAILS.md): 結合された売上の二重計上を避け、同一期間の顧客名・セグメント・金額条件で検索。

- [セグメントの直接明細と期間・役割別検索](SEGMENT_DETAILS.md): 横分割表、報告セグメント/調整/合計、7項目の直接値と検索。

- [関係会社の記載明細と逆引き](AFFILIATED_COMPANY_DETAILS.md): 親子/持分法区分、通貨と所有方向、集計社数を分離した検索。
