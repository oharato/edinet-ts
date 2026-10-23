# 確認中の変更と取り込み先

更新日: 2026-10-23。この資料は、複数社の保存書類を3項目で検索する変更の経緯を説明します。[用語集](../GLOSSARY.md)も参照してください。

## mainに入ったものと、まだ確認中のもの

- PR #20〜#23: 21指標検索、Node/SQLite更新、財務明細の計画、数値の元記載を確認する仕組みはmainへ取り込み済みです。
- [PR #24](https://github.com/oharato/edinet-ts/pull/24): 1社の流動資産・流動負債・負債合計を読む機能と用語集はmainの`3349809`へ入りました。
- [PR #25](https://github.com/oharato/edinet-ts/pull/25): 検索機能はマージ済みですが、取り込み先は`improve/jgaap-balance-sheet`でした。#24がmainへ入った後の操作だったため、#25の検索機能はmainへ届いていません。
- **このPR**: mainの`3349809`を基準に、まだ入っていない検索機能だけを新しいブランチ`improve/balance-sheet-screening-main`から提案します。取り込み先はmainです。既存の3項目取得機能や用語集を重複して追加しません。

次はこのPRの検索条件、読めない値の扱い、使い方を確認してください。mainへのマージは利用者が判断します。この作業ではマージ、force push、ブランチ削除、リリースは行っていません。

## GitHubのStacked PRについて

Stacked PRは、依存する複数のPRをGitHub上で正式にひとまとまりにする機能です。単に取り込み先を別の作業ブランチへ変えただけでは、正式なstackを作成した意味にはなりません。

[GitHub公式説明](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs)では2件以上のPRが対象です。リポジトリの正式なstack読取APIは利用可能で、確認時点のstackは0件でした。先行#24は取り込み済みで、今回残っている提案は1件のため、正式なstackを作る組合せはありません。将来、依存する複数PRを同時に提案する際は[正式な作成手順](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/creating-stacked-pull-requests)で関連付けとstack表示を確認します。

## 同期後のローカル検証

| 対象 | 環境 | 確認結果 |
|---|---|---|
| mainへ統合した#24の検証記録 | Node 26.12.1 / npm 12.2.1 | build、型検査、型の使用例、426テスト（3項目専用73件）、保存保護のPython 5テスト成功 |
| この検索PR | Node 26.12.1 / npm 12.2.1 | build、型検査、型の使用例、489テスト（検索専用63件）、保存保護のPython 5テスト成功 |

検索PRはmainの`3349809`から作成しています。過去の一時的な組合せ検証の件数とは区別します。lintの設定はありません。

## 使う前に知っておきたい制約

1社から読む対象はJ-GAAP（日本の会計基準）の3項目、金額は円です。複数社を比べる場合は、同じ日付・連結か単体か・基準・通貨に揃えた保存書類を渡します。値が読めない場合は0で埋めません。

保存2企業の元の数値と採用元は確認しています。2企業は日付が異なるため、同一日の複数社検索は合成データで確認し、実書類の日付混在は拒否しています。表示された財務諸表との別途照合、複数年度・全市場での品質確認は未完了です。

会計基準・証券コード・書類IDと原本との対応は利用者が確認します。IFRSの追加対応、比率計算、企業属性、人的資本、差分更新、固定vendorの利用先への反映は別の段階です。株価・短信・IR/PDF/AIの取得も今回開始していません。

- [3項目を読む方法](../BALANCE_SHEET_NORMALIZATION.md)
- [保存ファイルから検索する方法とCLI](../BALANCE_SHEET_SCREENING.md)
- [元の記載と数値の選び方](../METRIC_SELECTION.md)
- [財務明細の受入計画](FINANCIAL_NORMALIZATION.md)
- [全体計画](EDINET_TS_ROADMAP.md)
