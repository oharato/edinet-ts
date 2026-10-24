# ドキュメント索引

更新日: 2026-10-24。使い方・現在の仕様はこの階層、計画はplans、過去の経緯はadr/historyに置きます。

まずは「何をしたいか」から選んでください。言葉に迷ったら[用語集](GLOSSARY.md)を参照できます。

| やりたいこと | 最初に読む資料 |
|---|---|
| 実際の決算書との一致・未確認範囲を知りたい | [実データの確認結果](REAL_DATA_VALIDATION.md) |
| 会社の数値を読み、元の記載も確認したい | [数値の取り出し方](METRIC_SELECTION.md) |
| 流動資産・流動負債・負債合計を読みたい | [今回の3項目](BALANCE_SHEET_NORMALIZATION.md) |
| 保存した複数社の数値を条件で探したい | [21指標の検索](EDINET_DB_COMPARISON.md)。新しい3項目は[保存ファイルからの検索](BALANCE_SHEET_SCREENING.md)（#26でmainへ統合済み） |
| 提出会社単体の給与・年齢・勤続年数を読み比べたい | [人的資本](WORKFORCE.md)（期末と範囲を揃えた検索） |
| 原本の会社名・コード・基準を読み、会社名・決算月で探したい | [会社情報](COMPANY_PROFILE.md)（原記載・採用理由、明示集合の検索） |
| 固定資産/費用/CF明細・借入/社債/リース残高を読み比べたい | [直接財務項目](FINANCIAL_DETAILS.md)（既定5項目＋明示CF3/残高7項目、メモリ検索） |
| 流動比率で会社を比べたい | [計算方法・検索・CLI](CURRENT_RATIO.md)（#28でmainへ統合済み） |
| 入力候補を選び、タイプミスを減らしたい | [型・定数の使い方](TYPED_OPTIONS.md) |
| 財務3項目・流動比率を保存して検索したい | [SQLiteの小規模試作](FINANCIAL_SQLITE_STORE.md)（#31でmainへ統合済み） |
| 財務DBへ必要な書類だけ取り込みたい | [差分取り込み](FINANCIAL_INCREMENTAL_IMPORT.md)（APIは#33、`import-bs --dry-run`は#34でmain統合済み） |
| 保存した旧版と新版の違いを知りたい | [数値・採用状態・出典の比較](BALANCE_SHEET_VERSION_DIFF.md)（この版で追加） |
| 保存原本で取り込みから比較まで通るか確認したい | [オフライン品質確認](OFFLINE_FINANCIAL_VERIFICATION.md)（この版で追加、明示入力・一時DB専用） |
| 売上高の前年からの増減で会社を比べたい | [12暦月の売上高前年比](ANNUAL_REVENUE_GROWTH.md)（この版で追加、曖昧な入力は計算しない） |
| 現在地と次の方針を知りたい | [全体計画](plans/EDINET_TS_ROADMAP.md)。main完了・PR確認待ち・未着手・未検証を区別 |
| 変更の経緯を知りたい | [#27 検証記録](https://github.com/oharato/edinet-ts/pull/27)・[#28 流動比率](https://github.com/oharato/edinet-ts/pull/28)は正式stack #29でmainへ統合済み |

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
- [財務明細正規化計画](plans/FINANCIAL_NORMALIZATION.md): 追加する数値と確認項目。最初の3項目はPR #24でmainへ取り込み済み、残りは計画。
- [ADR 0001: ローカル配布物保持](adr/0001-local-distribution.md): 採用した保存・配布方針。
- [履歴索引](history/README.md): 過去の依頼、失効した公開手順、過去比較と検証。現行の手順として実行しない。

## 生成元と参照の維持

- `TAXONOMY_JPPFS_COR.md`: `scripts/generate_doc_taxonomy.ts` が生成。
- `TAXONOMY_JPCRP_COR.md`: `scripts/generate_types_jpcrp.ts` が生成。
- CLI型ヘルプの `src/utils/type-doc-defs.ts`: `scripts/generate-type-docs.ts` が生成。手動編集しない。
- 生成先は変更していない。`.github/workflows/auto-release.yml` が案内する `docs/nuc7-local-artifacts.md` も維持する。

Markdownのファイルを移す際は、README・相対リンク・スクリプト・CI参照・大小文字を同時に確認する。過去資料の削除ではなく移動を基本とし、明らかな重複だけを根拠付きで統合する。
