# 型付き入力定数と文字列指定

更新日: 2026-10-23。既存の文字列union型を維持したまま、よく指定する入力へ補完用の値定数を追加した。
`as const`のreadonly値と同名の型をexportするため、TypeScript/JavaScriptのエディターでmemberを選択できる。TypeScriptでは誤字を型エラーにする。JSON・CLIの文字列値は変わらない。

```ts
import {
    AccountingStandard, ComparisonOperator, ConsolidationScope,
    FinancialPeriodType, MetricId, SortOrder,
    screenFinancialSnapshots
} from "edinet-ts";

const selection = object.selectMetric(MetricId.NetSales, {
    accountingStandard: AccountingStandard.JGAAP,
    scope: ConsolidationScope.Consolidated,
    period: { startDate: "2024-04-01", endDate: "2025-03-31" }
});
const options = {
    conditions: [{ metric: MetricId.NetSales,
        operator: ComparisonOperator.GreaterThanOrEqual, value: 100 }],
    sortBy: MetricId.NetSales,
    order: SortOrder.Descending
};
const result = screenFinancialSnapshots(snapshots, options);
// snapshot生成時の明示分類: periodType: FinancialPeriodType.Annual
```

上のobject/snapshotsは呼出元が準備する解析済みobjectと保存済みsnapshot集合。比較値は合成例。
定数はデータ取得、会計基準の自動判定、年次/YTD判定や連結fallbackを行うものではない。入力の意味は[厳密選択](METRIC_SELECTION.md)と[21指標検索](EDINET_DB_COMPARISON.md)の契約に従う。

## 採用した入力定数

| 定数/同名型 | member → 既存の値 | 適用先 |
|---|---|---|
| `MetricId` | `NetSales` → `netSales` 等18項目 | selectMetric、18指標のID |
| `AccountingStandard` | `JGAAP` → `J-GAAP`、`IFRS` → `IFRS`、`USGAAP` → `US-GAAP` | 明示する会計基準。定数の存在は全基準の抽出対応を意味しない |
| `ConsolidationScope` | `Consolidated`、`NonConsolidated`（値は同じ表記） | context、指標来歴、strict selection、既存context検索のscope |
| `ComparisonOperator` | `GreaterThanOrEqual` → `gte`、`LessThanOrEqual` → `lte`、`GreaterThan` → `gt`、`LessThan` → `lt`、`Equal` → `eq` | 財務検索条件 |
| `SortOrder` | `Ascending` → `asc`、`Descending` → `desc` | 財務検索の並び順 |
| `FinancialPeriodType` | `Annual` → `annual`、`YearToDate` → `ytd`、`Quarterly` → `quarterly` | 保存snapshotの明示分類 |

`scope: "Consolidated"`、`operator: "gte"`等も同じunion型の有効値であり、引き続き利用できる。定数利用を必須にしない。readonly定数はfreezeし、APIの選択結果・比較値・既定値を変更しない。

BS後続APIのscope/演算子/並び順も同じ文字列unionであるため、新定数を渡せる。BS3科目は別ID集合を維持し、`BALANCE_SHEET_REGISTRY.currentAssets.id`等の型付きregistry参照を利用できる。18指標へBS科目を混ぜない。

## 他の文字列直書きの調査と判断

| 対象 | 現在の型/扱い | 今回の判断 |
|---|---|---|
| 書類種別コード | 既存`EdinetDocumentType` enum | 重複した定数を追加せず、既存enumを利用する。未知/将来コードを扱う一覧APIのstring入力は維持 |
| 財務検索の指標名 | `FinancialScreeningMetric`とreadonly `FINANCIAL_SCREENING_METRICS` | 既存の21指標unionを維持。主要18項目には`MetricId`を使え、追加3計算指標も既存unionで誤字を検出する |
| strict選択のstatus/reason | discriminated unionと`SelectionReason` | 出力の分岐と内部生成は型で制約済み。入力定数と別に扱い、全reasonの値定数追加は保留 |
| registryのunit/instant-duration | `MetricUnit`と`MetricDefinition`のunion | 内部の指標定義を型で制約済み。annual/ytd/quarterlyとは異なる概念のため統合しない |
| 旧context検索のyear/Duration/Instant | 引数の限定union | scopeだけを共通型へ接続し、既存の大文字小文字・過年度値を維持。低頻度の旧引数への値定数追加は保留 |
| XBRL要素名・namespace・contextRef・unitRef・ISO通貨 | 原本のデータ値、生成済みtaxonomy型、厳密選択器の照合 | 原本をそのまま保持。未対応/将来taxonomyや未知単位を閉じたenumへ変換して失わない |
| 日付、docID、銘柄コード、ファイルパス | 可変のデータ値とruntime検査 | 固定候補の定数にしない。型付き定数はデータの真正性や原本との識別子一致を保証しない |
| API URL、XMLの固定属性名、既定の文字列 | 実装/プロトコル上の識別子 | 公開optionと分離。機械的な全置換や値の変更を行わない |

## 型・互換性の検証

`test/types/metric-selection.ts`で正常な定数指定・従来文字列指定をcompileし、scope/指標/会計基準/比較/並び順/期間の誤字を`@ts-expect-error`で固定する。誤字が通るような型の緩和でもCIが失敗する。

実行時テストでは定数のwire値・freeze、連結/単体選択、全比較演算子、並び順、期間混在拒否を確認する。APIの境界では既存のruntime検査も維持する。JavaScriptやJSONの入力までTypeScriptだけで検証できるとは扱わない。
