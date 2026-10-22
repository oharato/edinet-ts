# ドキュメント索引

更新日: 2026-10-22。直下には現行の仕様・利用方法・比較を置く。計画はplans、設計判断はadr、失効した手順・過去の提案はhistoryへ分離する。

## 現行の入口

| 資料 | 内容 |
|---|---|
| [利用方法](../README.md) / [DBセットアップ](../SETUP_DB.md) | ライブラリ・CLI・書類メタデータDB |
| [要件・提供機能](REQUIREMENTS.md) | 現行機能と環境。未実装の範囲は計画と区別 |
| [指標辞書・厳密選択](METRIC_SELECTION.md) | 18指標の追加API、raw/number・欠損理由・未対応境界 |
| [技術仕様](SPECIFICATIONS.md) | パーサー、主要指標、scope、DB、探索規則 |
| [書類一覧API境界](DOCUMENT_LIST_VALIDATION.md) | 区分の正規化、エラーと空結果の区別 |
| [EDINET DB比較・指標辞書](EDINET_DB_COMPARISON.md) | 単一銘柄/横断検索の二軸、21指標・入力・制約 |
| [他EDINETライブラリ調査](EDINET_LIBRARY_RESEARCH.md) | 設計候補、ライセンス、独立実装の境界 |
| [依存選定方針](DEPENDENCY_DECISIONS.md) | Node/SQLite・XML/ZIP/Excel・開発依存の判断 |
| [ローカル配布物](nuc7-local-artifacts.md) | 固定sourceの再現、保持、rollback、利用先統合 |
| [タクソノミ更新](TAXONOMY_UPDATE.md) | 取得・型/資料生成の手順 |
| [jppfs_cor一覧](TAXONOMY_JPPFS_COR.md) / [jpcrp_cor一覧](TAXONOMY_JPCRP_COR.md) | 現行実装の生成済み型に対応する一覧。最新年度への対応を保証する意味ではない |

- [J-GAAP BS3項目](BALANCE_SHEET_NORMALIZATION.md): 別registry/API、来歴・欠損・対応範囲。

## 計画と判断の履歴

- [進行中の改善計画](plans/EDINET_TS_ROADMAP.md): 完了/ローカル検証/未実装/実データ未検証を分離。
- [財務明細正規化計画](plans/FINANCIAL_NORMALIZATION.md): 最初の3項目と後続候補・受入条件。
- [ADR 0001: ローカル配布物保持](adr/0001-local-distribution.md): 採用した保存・配布方針。
- [履歴索引](history/README.md): 過去の依頼、失効した公開手順、過去比較と検証。現行の手順として実行しない。

## 生成元と参照の維持

- `TAXONOMY_JPPFS_COR.md`: `scripts/generate_doc_taxonomy.ts` が生成。
- `TAXONOMY_JPCRP_COR.md`: `scripts/generate_types_jpcrp.ts` が生成。
- CLI型ヘルプの `src/utils/type-doc-defs.ts`: `scripts/generate-type-docs.ts` が生成。手動編集しない。
- 生成先は変更していない。`.github/workflows/auto-release.yml` が案内する `docs/nuc7-local-artifacts.md` も維持する。

Markdownのファイルを移す際は、README・相対リンク・スクリプト・CI参照・大小文字を同時に確認する。過去資料の削除ではなく移動を基本とし、明らかな重複だけを根拠付きで統合する。
