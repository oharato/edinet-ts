# 提出会社単体の平均年間給与を読み・比べる

状態: mainの会社情報取得（#40）の後に追加するAPI/CLI。2026-10-24更新。未リリース。

有価証券報告書に直接記載された、提出会社単体の平均年間給与を読み、同じ期末の複数社で条件検索・並べ替えできます。企業グループ全体の平均給与とは区別します。原値と出典を残し、欠けた給与を0で埋めません。

## 対応範囲

| 項目 | 仕様 |
|---|---|
| 定数 / ID | `WorkforceMetricId.AverageAnnualSalary` / `averageAnnualSalary` |
| 原本のタグ | `jpcrp_cor:AverageAnnualSalaryInformationAboutReportingCompanyInformationAboutEmployees` |
| 対象 | 一般事業J-GAAP、提出会社単体、JPY、明示した期末のinstant |
| 範囲の確認 | 正式な`NonConsolidatedMember`（単体を表す指定）が明示された候補だけ |
| 単位 | 円。`decimals=-3`でも原値へ1,000を掛けない |

J-GAAPなどの会計基準は、利用者が元書類で確認して指定します。給与タグの名前空間から基準を自動推定しません。次元なしを単体だと推測することや、連結から単体への自動切替はしません。この制限により、原本に給与があっても対象外になる場合があります。

期末の`instant`は値を対応付ける日です。給与の集計期間、対象従業員、賞与などの算入範囲までは分かりません。注記は自動解析していないため、会社間の待遇が完全に同じ定義で比べられると保証するものではありません。必要に応じて元書類の注記も確認してください。

## API

```ts
import { createWorkforceSnapshot, screenWorkforceDocuments, WorkforceMetricId,
    AccountingStandard, ConsolidationScope, ComparisonOperator, SortOrder } from "edinet-ts";

const metadata = {
    secCode: "1001", docID: "SYNTHETIC1",
    scope: ConsolidationScope.NonConsolidated,
    accountingStandard: AccountingStandard.JGAAP, currency: "JPY" as const,
    period: { instant: "2025-03-31" }
};
const snapshot = createWorkforceSnapshot(xml, metadata);
const salary = snapshot.selections[WorkforceMetricId.AverageAnnualSalary];
if (salary.status === "selected") console.log(salary.raw, salary.safeNumber, salary.source);

const result = screenWorkforceDocuments(documents, {
    conditions: [{ metric: WorkforceMetricId.AverageAnnualSalary,
        operator: ComparisonOperator.GreaterThanOrEqual, value: 1000000 }],
    sortBy: WorkforceMetricId.AverageAnnualSalary,
    order: SortOrder.Descending, offset: 0, limit: 20
});
```

コードと金額は合成例です。`documents`は`[{xml, metadata}, ...]`を明示します。期間集計のdurationは対象外です。返値の`selected`は採用できた原記載、`missing`は欠損、`unsupported`は扱えない条件、`ambiguous`は候補を決められない状態です。原文字列・タグ・namespace（項目の所属）・context（値の対象）・entity（対象会社識別）・期間・単位・decimals・採用できない理由を残します。

0は実値として保持します。負数は給与として検索に使わず、原値を候補の記録へ残します。nil、不在、同値を含む重複候補、未知namespace、単位違い、余分な次元、不安全な数値も0に置き換えません。安全なnumberが作れない原値は検索から除外します。給与を連結従業員数で割るような派生計算は行いません。

検索はAND条件とgte/lte/gt/lt/eqに対応します。期末・会計基準・連結/単体・通貨が違う集合や、同一会社/書類の複数候補は先に拒否します。異なる会社に同じentityを要求するものではありません。最新書類や訂正後の自動選択、コードと原本の対応の認証は行いません。

`total`は条件一致後・ページ前、`excludedRows`は必要な給与が使えない行、`filteredRows`は条件不一致の行です。`diagnostics`と`reasonCounts`に除外理由を残します。並べ替えを指定しない場合は会社コード/書類ID順で安定させます。

## CLIと入力

一覧JSONの例:

```json
[
  { "file": "source.xbrl", "metadata": {
      "secCode": "1001", "docID": "SYNTHETIC1", "scope": "NonConsolidated",
      "accountingStandard": "J-GAAP", "currency": "JPY", "period": { "instant": "2025-03-31" }
  } }
]
```

```sh
npm run build
node dist/cli.js screen-workforce --manifest /tmp/local-workforce/files.json --sort-by averageAnnualSalary --order desc --limit 20 --pretty
```

相対`file`は一覧JSONのフォルダを基準にします。一覧100件/2MiB、原本1件64MiB/合計256MiBの小規模な手元検索です。通常ファイルへ解決される入力だけを読みます。取得・フォルダ探索・DB更新はしません。正常解析はJSONと終了0、入力の不備はstderrと終了1です。終了0でも各値の採用状態を確認してください。

## 検証と未対応

合成fixtureで単体・JPY・期末、decimals、0/負数/nil/unsafe/重複、条件・順序・ページ、混在拒否、CLIと原本保護を検証します。保存済み2社の2026年期末で給与2項目が、Python標準XML処理で独立に選んだ元タグ/context/rawと一致しました。独立したDecimal算術で作成した12検索（5演算・両順・ページ）の期待値とも一致し、2原本は不変でした。これは原XML内の確認で、PDF表示値や給与の注記を独立照合した意味ではありません。

従業員数、臨時雇用人員、平均年齢・勤続年数、育休・男女賃金差などは、このAPIでは未対応です。従業員数に見つかった同値重複の扱いを、今回の給与追加のために変更しません。全市場充足率、PDF表示値との独立照合、給与注記の解釈、SQLへの永続保存、性能保証は別の課題です。[全体計画](plans/EDINET_TS_ROADMAP.md)の段階5を一部だけ進めます。

Node26.12.1/npm12.2.1で全976テスト（既存933＋追加43）、本体/使用例の型検査・build・保存保護Python5件が成功しました。全体テストはCIと同じ`--maxWorkers=1`で実行し、既存の制限時間や期待値は変更していません。lint設定はありません。

独立レビューのsource86確認・build済みESM/root/CLI87確認・CJS export1確認も成功し、修正必須の未解決問題はありませんでした。レビューは合成入力によるものです。
