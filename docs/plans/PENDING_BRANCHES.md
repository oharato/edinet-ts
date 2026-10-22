# 公開待ち変更と統合順

更新日: 2026-10-22。状態: ローカル検証・公開承認待ち。
この一覧は既存の公開PRと未公開の変更を区別する。未公開commitはGitHubに存在する保証がなく、以下の順序はレビュー・統合の提案であり、mergeや公開を実行する指示ではない。

## 変更の依存関係

| 変更 | branch / 検証基準commit | 状態・依存 |
|---|---|---|
| 21指標・比較資料・文書整理 | main / `ec49152` | PR #20統合済み。後続の共通基準 |
| Node26・依存更新・標準SQLite | `modernize/node-sqlite` / `bd6381e` | [Draft PR #21](https://github.com/oharato/edinet-ts/pull/21)。最低Node版の引き上げを伴う独立変更 |
| 財務明細の受入計画 | `docs/financial-normalization-plan` / `3072e2b` | [Draft PR #22](https://github.com/oharato/edinet-ts/pull/22)。計画作成は後続実装完了を意味しない |
| 18指標辞書・厳密選択 | `improve/metric-foundation` / `859f349` | ローカルのみ。基盤実装`61a0f04`と、別entity/不正period拒否の修正を含む |
| J-GAAP BS3科目 | `improve/jgaap-balance-sheet` / `d390751` | ローカルのみ。基盤`61a0f04`へ積み、基盤修正`859f349`と同じパッチを`e7aa996`として取り込み済み |
| BS3科目の横断検索API/CLI | `improve/balance-sheet-screening` / `0110fa7` | ローカルのみ。BS3科目`d390751`を基準。既存21指標screenと別API/command |

基盤修正は同等パッチが別commit IDで存在する。将来の差分整理では二重適用しない。BS実装branchにはPR #22の計画文書を含めているため、PR #22統合後は計画・索引の重複差分を整理する。

## 推奨するレビューとPRの順序

1. PR #22の計画は単独レビュー可能。定義・受入条件を確認する。
2. PR #21でruntime互換性の変更をレビューする。標準SQLite APIの安定度が現状Release candidateである点、既存固定配布物・利用先vendorへ自動反映されない点を確認する。
3. 公開が承認された場合に、厳密選択基盤を最新mainとの差分へ整理して別PRにする。legacy API回帰、raw精度、namespace・scope・entity・曖昧性を優先する。
4. 基盤の後にBS3科目を別PRでレビューする。既存18指標の集合を拡張せず、共通選択器へ定義を渡す小さな抽象化だけを確認する。
5. BS3科目の後に横断検索API/CLIを別PRでレビューする。検索対象・除外理由・比較条件・入力整合性を確認する。

公開前に各branchを、その時点のmainおよび承認済み先行変更と整合させ、差分・文書リンク・関連テスト・CIを確認する。現在の未公開branchはCI未実施であり、ローカルテストや一時treeの成功をCI成功と呼ばない。未承認のpush、merge、branch削除、release、定期運用の変更は行わない。

## ローカル検証の区切り

| 対象 | 環境 | 確認結果 |
|---|---|---|
| 厳密選択基盤`859f349` | Node24.22.1・既存mainの依存 | 336テスト、build、型検査、保存保護5テスト成功 |
| BS3科目`d390751` | Node24.22.1・既存mainの依存 | 409テスト、build、型検査、保存保護5テスト成功 |
| BS3科目＋Node更新の一時tree | Node26.12.1/npm12.2.1・PR #21依存 | 421テスト、build、型検査、保存保護5テスト成功 |
| BS横断検索`0110fa7` | Node24.22.1・既存mainの依存 | 472テスト（専用63件）、build、型検査、保存保護5テスト成功 |
| BS横断検索＋Node更新の一時tree | Node26.12.1/npm12.2.1・PR #21依存 | 484テスト、build、型検査、保存保護5テスト、build済みCLIの成功JSON/不正条件終了を確認 |

一時treeの検証はbranch/mainへのmergeではない。新規APIは保存2企業の原fact/来歴と合成fixtureを使い、新規取得・全市場の母集団・永続索引・実データ配布を追加していない。原factとの一致は、表示された財務諸表の独立照合や全市場充足率の証明ではない。

## 今回の完了範囲と残る課題

単一銘柄ではJ-GAAPの流動資産・流動負債・負債合計の直接factを厳密選択できる。横断検索では、明示した保存書類集合の同じ時点・JPY・scope・J-GAAPだけを比較する。通期損益の検索、最新書類の自動探索、全市場DB、IFRS、企業マスターとの照合は含まない。

会計基準・銘柄ラベルの原本照合、単一entityと主提出者の同一性確認、複数年度原本の検証、IFRSの意味対応、比率計算、企業属性、人的資本、差分更新、固定vendor統合は引き続き別段階である。価格・短信・IR/PDF/AIの取得も今回開始しない。

- [BS横断検索の仕様とCLI](../BALANCE_SHEET_SCREENING.md)
- [BS3科目の仕様](../BALANCE_SHEET_NORMALIZATION.md)
- [厳密選択基盤](../METRIC_SELECTION.md)
- [財務明細の受入計画](FINANCIAL_NORMALIZATION.md)
- [全体計画](EDINET_TS_ROADMAP.md)
