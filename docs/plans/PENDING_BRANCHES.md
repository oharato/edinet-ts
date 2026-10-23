# レビュー中の変更と統合順

更新日: 2026-10-23。状態: Draft PRレビュー対象（未merge・未release）。
この一覧は先行PRと積み上げた変更の依存を記録する。以下の順序はレビュー・統合の提案であり、mergeを実行する指示ではない。

## 変更の依存関係

| 変更 | branch / 検証基準commit | 状態・依存 |
|---|---|---|
| 21指標・比較資料・文書整理 | main / `a501ec1` | PR #20・#21・#22統合済み。実装の共通基準は`ec49152` |
| Node26・依存更新・標準SQLite | `modernize/node-sqlite` / `bd6381e` | [PR #21](https://github.com/oharato/edinet-ts/pull/21)はmainへ統合済み。最低Node版の引き上げを伴う |
| 財務明細の受入計画 | `docs/financial-normalization-plan` / `3072e2b` | [PR #22](https://github.com/oharato/edinet-ts/pull/22)はmainへ統合済み。計画作成は後続実装完了を意味しない |
| 18指標辞書・厳密選択 | `improve/metric-foundation` / `fe08f1e` | [Draft PR #23](https://github.com/oharato/edinet-ts/pull/23)。baseはmain。別entity/不正period拒否と、MetricId/AccountingStandardの補完用定数を含む |
| J-GAAP BS3科目 | `improve/jgaap-balance-sheet` / `8214c7a` | [Draft PR #24](https://github.com/oharato/edinet-ts/pull/24)。baseはimprove/metric-foundation（#23） |
| BS3科目の横断検索API/CLI | `improve/balance-sheet-screening` / `8c69593`（API/CLI） | [Draft PR #25](https://github.com/oharato/edinet-ts/pull/25)。baseはimprove/jgaap-balance-sheet（#24）。既存21指標screenと別API/command |

初回公開前に未公開履歴を整理し、基盤修正を#23の`859f349`へ統一した。BSの旧`d390751`と横断検索の旧`551b745`からコード・テスト・依存の内容は変わらない。PR #22計画書のコピーも除き、先行branchへの参照へ統一した。force pushやmainへのmergeは行っていない。

## 推奨するレビューとPRの順序

1. PR #22の計画はmainへ統合済み。定義・受入条件を基準とする。
2. PR #21のruntime変更はmainへ統合済み。標準SQLite APIの安定度が現状Release candidateである点、既存固定配布物・利用先vendorへ自動反映されない点を確認する。
3. PR #23の厳密選択基盤をレビューする。legacy API回帰、raw精度、namespace・scope・entity・曖昧性を優先する。
4. 基盤の後にBS3科目を別PRでレビューする。既存18指標の集合を拡張せず、共通選択器へ定義を渡す小さな抽象化だけを確認する。
5. BS3科目の後に横断検索API/CLIを別PRでレビューする。検索対象・除外理由・比較条件・入力整合性を確認する。

先行PRがmainへ統合された後は、後続PRのbaseをmainへ変更し、差分・競合・文書リンク・関連テスト・CIを再確認する。積み上げbaseのまま先行branchへmergeしない。mainとの一時tree比較では、`docs/README.md`と`docs/plans/EDINET_TS_ROADMAP.md`の文書競合を確認した。mainへの付け替え時に両方の記述を保持して解消する必要がある。コード・テストには競合を検出していない。実行済みCIの最新headと結果は各PRのChecksを参照する。ローカルテストや一時treeの成功はCI成功と区別する。merge、branch削除、release、定期運用の変更は今回行わない。

## ローカル検証の区切り

| 対象 | 環境 | 確認結果 |
|---|---|---|
| 厳密選択基盤`fe08f1e` | Node24.22.1・既存mainの依存 | 337テスト、build、型fixture、型検査、保存保護5テスト成功 |
| BS3科目（公開head `8214c7a`） | Node24.22.1・既存mainの依存 | 409テスト、build、型検査、保存保護5テスト成功 |
| BS3科目＋Node更新の一時tree | Node26.12.1/npm12.2.1・PR #21依存 | 421テスト、build、型検査、保存保護5テスト成功 |
| BS横断検索（API/CLI `8c69593`） | Node24.22.1・既存mainの依存 | 472テスト（専用63件）、build、型検査、保存保護5テスト成功 |
| BS横断検索＋Node更新の一時tree | Node26.12.1/npm12.2.1・PR #21依存 | 484テスト、build、型検査、保存保護5テスト、build済みCLIの成功JSON/不正条件終了を確認 |
| 型付き定数`fe08f1e`＋後続2API＋最新main runtimeの一時tree | Node26.12.1/npm12.2.1 | 485テスト、build、型fixture、型検査、保存保護5テスト成功。BS科目・検索条件の誤字拒否と新定数の組合せも型検査 |

一時treeの検証はbranch/mainへのmergeではない。新規APIは保存2企業の原fact/来歴と合成fixtureを使い、新規取得・全市場の母集団・永続索引・実データ配布を追加していない。原factとの一致は、表示された財務諸表の独立照合や全市場充足率の証明ではない。

## 今回の完了範囲と残る課題

単一銘柄ではJ-GAAPの流動資産・流動負債・負債合計の直接factを厳密選択できる。横断検索では、明示した保存書類集合の同じ時点・JPY・scope・J-GAAPだけを比較する。通期損益の検索、最新書類の自動探索、全市場DB、IFRS、企業マスターとの照合は含まない。

会計基準・銘柄ラベルの原本照合、単一entityと主提出者の同一性確認、複数年度原本の検証、IFRSの意味対応、比率計算、企業属性、人的資本、差分更新、固定vendor統合は引き続き別段階である。価格・短信・IR/PDF/AIの取得も今回開始しない。

- [BS横断検索の仕様とCLI](../BALANCE_SHEET_SCREENING.md)
- [BS3科目の仕様](../BALANCE_SHEET_NORMALIZATION.md)
- [厳密選択基盤](../METRIC_SELECTION.md)
- [財務明細の受入計画](https://github.com/oharato/edinet-ts/blob/main/docs/plans/FINANCIAL_NORMALIZATION.md)
- [全体計画](EDINET_TS_ROADMAP.md)
