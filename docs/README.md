# ドキュメント索引

更新日: 2026-10-23。使い方・現在の仕様はこの階層、計画はplans、過去の経緯はadr/historyに置きます。

まずは「何をしたいか」から選んでください。言葉に迷ったら[用語集](GLOSSARY.md)を参照できます。

| やりたいこと | 最初に読む資料 |
|---|---|
| 会社の数値を読み、元の記載も確認したい | [数値の取り出し方](METRIC_SELECTION.md) |
| 流動資産・流動負債・負債合計を読みたい | [今回の3項目](BALANCE_SHEET_NORMALIZATION.md) |
| 保存した複数社の数値を条件で探したい | [21指標の検索](EDINET_DB_COMPARISON.md)。新しい3項目は[保存ファイルからの検索](BALANCE_SHEET_SCREENING.md)（このPRで確認中） |
| 流動比率で会社を比べたい | [計算方法・検索・CLI](CURRENT_RATIO.md)（このローカルブランチで追加、未公開） |
| 入力候補を選び、タイプミスを減らしたい | [型・定数の使い方](TYPED_OPTIONS.md) |
| 次に何を作るか知りたい | [全体計画](plans/EDINET_TS_ROADMAP.md) |

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

- [進行中の改善計画](plans/EDINET_TS_ROADMAP.md): 完了/ローカル検証/未実装/実データ未検証を分離。
- [財務明細正規化計画](plans/FINANCIAL_NORMALIZATION.md): 追加する数値と確認項目。最初の3項目はPR #24でmainへ取り込み済み、残りは計画。
- [ADR 0001: ローカル配布物保持](adr/0001-local-distribution.md): 採用した保存・配布方針。
- [履歴索引](history/README.md): 過去の依頼、失効した公開手順、過去比較と検証。現行の手順として実行しない。

## 生成元と参照の維持

- `TAXONOMY_JPPFS_COR.md`: `scripts/generate_doc_taxonomy.ts` が生成。
- `TAXONOMY_JPCRP_COR.md`: `scripts/generate_types_jpcrp.ts` が生成。
- CLI型ヘルプの `src/utils/type-doc-defs.ts`: `scripts/generate-type-docs.ts` が生成。手動編集しない。
- 生成先は変更していない。`.github/workflows/auto-release.yml` が案内する `docs/nuc7-local-artifacts.md` も維持する。

Markdownのファイルを移す際は、README・相対リンク・スクリプト・CI参照・大小文字を同時に確認する。過去資料の削除ではなく移動を基本とし、明らかな重複だけを根拠付きで統合する。
