# 直接記載された財務項目を読む・複数社で探す

状態: 既定5項目は#37でmainへ統合済み。明示して読むCF3項目も#39でmainへ統合済みです。借入金・社債・リースの直接7残高も#42でmainへ統合済みです。未リリース。2026-10-24更新。

固定資産・固定負債・現金及び預金・売上原価・販管費を、原本XBRLから出典付きで読みます。指定した会社集合で条件検索・並べ替えもできます。一般事業のJ-GAAP直接タグを対象にし、既存の主要18指標/21指標検索、BS3、SQLite保存形式は変更しません。

## 対象の5項目

| 定数 `FinancialDetailMetricId` | ID | 元の直接タグ `jppfs_cor:` | 対象 |
|---|---|---|---|
| `NoncurrentAssets` | `noncurrentAssets` | `NoncurrentAssets` | 指定日現在の固定資産 |
| `NoncurrentLiabilities` | `noncurrentLiabilities` | `NoncurrentLiabilities` | 指定日現在の固定負債 |
| `CashAndDeposits` | `cashAndDeposits` | `CashAndDeposits` | 指定日現在の現金及び預金 |
| `CostOfSales` | `costOfSales` | `CostOfSales` | 明示期間の売上原価 |
| `SellingGeneralAndAdministrativeExpenses` | `sellingGeneralAndAdministrativeExpenses` | `SellingGeneralAndAdministrativeExpenses` | 明示期間の販売費及び一般管理費（販管費） |

金額はJPY、元値のdecimal文字列を保持します。`FINANCIAL_DETAIL_REGISTRY_VERSION`は`"3"`です。候補・定義はfreezeしています。対応は既存生成型と公式taxonomy由来の定義、保存原本の存在確認を基に、共有の厳密選択器を使って独立実装しています。

現金及び預金と現金同等物は別です。総資産や繰延資産を固定資産へ足したり、工事原価・部門費用・営業費用を売上原価へ代用したりしません。内訳合算・差額補完・符号の反転は行いません。銀行・保険向け別mapping、IFRS/US-GAAPの候補はありません。対象タグがなければ欠損等の理由を返します。

## 1社から読むAPI

```ts
import { createFinancialDetailSnapshot, screenFinancialDetailDocuments, FinancialDetailMetricId, ComparisonOperator, SortOrder,
    ConsolidationScope, AccountingStandard, FinancialPeriodType } from "edinet-ts";

const current = createFinancialDetailSnapshot(xml, {
    secCode: "1001", docID: "SYNTHETIC1", scope: ConsolidationScope.Consolidated,
    accountingStandard: AccountingStandard.JGAAP, currency: "JPY",
    period: { instant: "2025-03-31" }
});
const cash = current.selections[FinancialDetailMetricId.CashAndDeposits];
if (cash?.status === "selected") console.log(cash.raw, cash.safeNumber, cash.source);

const expenses = createFinancialDetailSnapshot(xml, {
    secCode: "1001", docID: "SYNTHETIC1", scope: ConsolidationScope.Consolidated,
    accountingStandard: AccountingStandard.JGAAP, currency: "JPY",
    period: { startDate: "2024-04-01", endDate: "2025-03-31" },
    periodType: FinancialPeriodType.Annual
});
```

識別子は合成例です。時点指定ではinstantの3項目、開始/終了日指定ではdurationの2項目だけを`selections`へ返します。期間を持つ値は`annual`/`ytd`/`quarterly`も利用側が明示します。原本の書類種類や期間長からの自動分類ではなく、年次と宣言した期間が12か月あることまで証明する機能ではありません。時系列計算の連続性検査は別段階です。

既存の`EdinetXbrlObject`から1項目を読む場合は`object.selectFinancialDetail(id, { accountingStandard, scope, period })`です。選択器は[厳密な数値選択](METRIC_SELECTION.md)と同じで、元タグ・namespace/context・entity・期間・単位・decimals・候補と理由を返します。基準や会社コードと公式原本の対応は利用側の宣言で、自動証明はしません。

`selected`でも安全なnumberが作れなければrawだけを保持します。nil/不在/単位不明/複数候補を0にしません。実際の0や負数は保持します。連結→単体、当期→前期、未知namespace→同名タグへのfallbackはありません。同値重複も曖昧として止めます。XML文字列を受けるsnapshot APIは構文を検査しますが、XBRLスキーマ検証ではありません。

## 複数社の検索とCLI

`screenFinancialDetailDocuments([{ xml, metadata }, ...], options)`に対象原本を明示します。対象日/開始終了日・期間分類・連結/単体・会計基準・通貨が異なる集合は先に拒否します。同じ会社または書類の複数候補も拒否し、最新/訂正後を自動選択しません。instant項目とduration項目を同じ検索へ混ぜる指定は設定エラーです。

```ts
const result = screenFinancialDetailDocuments(documents, {
    conditions: [{ metric: FinancialDetailMetricId.CashAndDeposits,
        operator: ComparisonOperator.GreaterThanOrEqual, value: 100 }],
    sortBy: FinancialDetailMetricId.CashAndDeposits,
    order: SortOrder.Descending, offset: 0, limit: 20
});
```

上例の`ComparisonOperator`と`SortOrder`もpackage rootからimportできます。条件はAND、演算子はgte/lte/gt/lt/eqです。条件/並べ替えで要求した項目だけを行の採用条件とし、未使用項目が欠けても行を落としません。何も指定しない場合は従来の既定5項目のうち、対象期間型の項目を要求します。明示した`metricIds`がある場合はその項目集合を使います。unsafe rawは検索用numberへ丸めず、その必要項目を持つ行を除外します。

`total`は条件一致後・ページ前の件数、`excludedRows`は必要値が使えない行、`filteredRows`は値が使えても条件不一致だった行です。`diagnostics`には非採用理由と`required`（検索に必要か）を残します。`reasonCounts`は**行数ではなく項目の診断件数**なので、1社で複数件になることがあります。結果は原値と出典を含み、数値だけの表ではありません。

CLI `screen-details`は、次のような一覧を指定します。相対fileは一覧JSONのフォルダが基準です。

```json
[
  { "file": "source.xbrl", "metadata": {
      "secCode": "1001", "docID": "SYNTHETIC1", "scope": "Consolidated",
      "accountingStandard": "J-GAAP", "currency": "JPY", "period": { "instant": "2025-03-31" }
  } }
]
```

```sh
npm run build
node dist/cli.js screen-details --manifest /tmp/local-details/files.json --sort-by cashAndDeposits --order desc --limit 20 --pretty
```

正常はJSONと終了0、入力や期間の不一致はstderrと終了1です。一覧100件/2MiB、原本1件64MiB/合計256MiBの手元作業用上限があり、通常ファイルだけを読みます。取得・保存・DB更新・フォルダ探索は行いません。元ファイルを変更しないでください。性能は未測定です。

## 確認した範囲

合成fixtureで5タグの選択、現金同等物や業種別費用の非代用、scope/期間/基準/JPY、0/負数/nil/巨大整数、未知namespace/次元/重複、5演算のAND検索・両順/ページ・未使用欠損、CLIを検証しています。

Git外の既存2社・当期/前年の2時点では、instant 12項目・duration 8項目の計20項目が採用され、元XMLの同じタグ/contextの原数値と一致しました。5項目×2期間の10検索も実行可能で、2原本は不変でした。これは**原本内のraw/factとの突合**で、追加5項目の公式PDF表示値との独立照合ではありません。新規取得や金額の公開はしていません。

元書類との独立照合、他企業/業種・他taxonomy年度の充足率、IFRS等、5項目のSQL保存や既存21指標への登録、前年比/合算・財務比率の追加は別段階です。合成fixtureで仕様を実装したことと、実市場での品質保証を分けています。

Node26.12.1で全821テスト（既存756＋新規65）、本体/公開API例の型検査、build、保存保護Python5件が成功。独立レビュー49件とビルド済みCLIのinstant/duration/期間型拒否3確認も成功しました。lint設定はありません。

## 追加のCF3項目を明示して読む

CF（キャッシュフロー）は現金の収入・支出を示す計算書です。次の3項目は一般事業J-GAAP/JPYのduration（開始日から終了日までの期間）だけを対象にします。金額の単位は円、符号は原本どおりです。設備取得の支出を正の額へ変換しません。

| 定数 `FinancialDetailMetricId` | ID | 元の `jppfs_cor:` タグ |
|---|---|---|
| `DepreciationOperatingCashFlow` | `depreciationOperatingCashFlow` | `DepreciationAndAmortizationOpeCF` |
| `PropertyPlantEquipmentPurchaseCashFlow` | `propertyPlantEquipmentPurchaseCashFlow` | `PurchaseOfPropertyPlantAndEquipmentInvCF` |
| `PropertyPlantEquipmentAndIntangiblesPurchaseCashFlow` | `propertyPlantEquipmentAndIntangiblesPurchaseCashFlow` | `PurchaseOfPropertyPlantAndEquipmentAndIntangibleAssetsInvCF` |

最初は営業CFの調整項目である減価償却費、次は有形固定資産の取得支出、最後は有形固定資産と無形資産を合わせた取得支出です。設備だけの支出と合計支出は別項目であり、互いに代用・合算しません。販管費の減価償却や減価償却累計額からCFの値を補うこともありません。EBITDAや設備投資総額を計算する機能ではありません。

既存利用を保つため、registryが拡張されても既定は`DEFAULT_FINANCIAL_DETAIL_METRICS`の従来5項目のままです。新項目を検索する場合は、返す項目の一覧`metricIds`へ明示します。単一snapshotでは第3引数です。

```ts
const metricIds = [FinancialDetailMetricId.DepreciationOperatingCashFlow,
    FinancialDetailMetricId.PropertyPlantEquipmentPurchaseCashFlow];
const cashFlow = createFinancialDetailSnapshot(xml, durationMetadata, metricIds);
const result = screenFinancialDetailDocuments(documents, {
    metricIds, sortBy: FinancialDetailMetricId.DepreciationOperatingCashFlow,
    order: SortOrder.Descending
});
```

`durationMetadata`は上のAPI例と同じ開始/終了日・期間分類付きの指定です。明示一覧は空・未知ID・重複・instant/duration混在を拒否します。条件や並べ替えの項目も一覧内に必要です。何も条件を付けなければ一覧全項目を要求し、条件等があれば必要項目だけを行の採用条件とします。診断も明示した項目だけを対象にします。3項目すべての同時開示は前提にしていません。合計支出がない企業も含めたい場合は、必要な支出項目だけを一覧へ指定してください。

同じduration形式の一覧JSONを使うCLI例:

```sh
node dist/cli.js screen-details --manifest /tmp/local-details/duration-files.json --metrics depreciationOperatingCashFlow,propertyPlantEquipmentPurchaseCashFlow --sort-by depreciationOperatingCashFlow --order desc --pretty
```

保存済み2社の2026有報にある当期/前年の2期間では、減価償却費と有形固定資産取得支出の計8項目が選ばれ、元XMLのタグ/context/rawと一致しました。合計支出のタグは4対象すべて欠損として返し、有形のみで補いませんでした。3項目×2期間の6検索を実行し、原本不変も確認しました。独立したPDF表示値の照合、2025年別提出XBRL、他業種/全市場の充足率は未検証です。合成fixtureでは合計支出を含む3項目の仕様と既定互換を確認しています。性能は未測定、SQLite保存への追加は対象外です。

このCF追加版では全898テスト（既存869＋新規29）、本体/使用例の型検査・build・保存保護Python5件、独立レビュー99検証が成功しました。CLIの明示選択・設定エラー・原本不変も確認しています。lint設定はありません。

全体再実行では既存オフライン統合テストが並列実行時に5秒の制限を超えたため、公開前にCIと同じ`--maxWorkers=1`で全898件の成功を確認しました。期待値や検査条件、制限時間は変更していません。

## 借入金・社債・リースの直接7残高

次の7項目も`metricIds`/CLI `--metrics`で明示して読み、同じ期末・範囲の会社集合で検索できます。一般事業J-GAAP/JPYのinstantだけです。辞書は計15項目ですが、既定は従来5項目（時点3・期間2）を維持します。

| 定数 / ID | 元の `jppfs_cor:` タグ | 意味 |
|---|---|---|
| `ShortTermLoansPayable` / `shortTermLoansPayable` | `ShortTermLoansPayable` | 短期借入金 |
| `CurrentPortionOfLongTermLoansPayable` / `currentPortionOfLongTermLoansPayable` | `CurrentPortionOfLongTermLoansPayable` | 1年内返済予定の長期借入金 |
| `LongTermLoansPayable` / `longTermLoansPayable` | `LongTermLoansPayable` | 長期借入金 |
| `CurrentPortionOfBonds` / `currentPortionOfBonds` | `CurrentPortionOfBonds` | 1年内償還予定の社債 |
| `BondsPayable` / `bondsPayable` | `BondsPayable` | 社債 |
| `LeaseObligationsCL` / `leaseObligationsCL` | `LeaseObligationsCL` | 流動負債のリース債務 |
| `LeaseObligationsNCL` / `leaseObligationsNCL` | `LeaseObligationsNCL` | 固定負債のリース債務 |

CL/NCLは流動/固定の区分です。各原記載を独立に保持し、合算・排他的な内訳だとみなすこと・他科目での補完はしません。短期借入金に1年内返済分が含まれるかは自動判定しません。関連会社の借入内訳や負債合計を元タグの代わりにせず、欠損を0としません。原本の0や負数の記載は既存の直接財務APIと同じく保持します。

```ts
const loans = createFinancialDetailSnapshot(xml, instantMetadata, [
    FinancialDetailMetricId.ShortTermLoansPayable,
    FinancialDetailMetricId.LongTermLoansPayable
]);
```

`instantMetadata`は上記と同じ証券コード・書類ID・基準・範囲・JPY・期末の指定です。既存検索APIへ同じ`metricIds`と条件/並べ替えを渡せます。CLIも同じ時点形式の一覧JSONを使います。

```sh
node dist/cli.js screen-details --manifest /tmp/local-details/instant-files.json --metrics shortTermLoansPayable,longTermLoansPayable --sort-by longTermLoansPayable --order desc --pretty
```

7項目すべての開示は前提にしません。条件/並べ替えを省略すると明示一覧の全項目を要求するので、必要な項目だけを指定してください。CFの期間項目と同じ検索へ混ぜる指定は設定エラーです。

新リース基準・IFRSや銀行/保険の別mapping、借入金合計・リース総額・有利子負債総額の算出には対応していません。型定義のラベルと既存計画を照合しましたが、正式XSDのperiodTypeを今回新たに網羅照合した意味ではありません。実証できた原本factはinstantです。

保存済み2社・2期末・連結/単体の56組では、34項目が採用され元XMLの原値に一致しました。残りはnil4・タグなし12・指定範囲の候補なし6で、0補完しませんでした。Python標準XML処理とDecimalで別に作った28検索の期待値も一致し、原本は不変でした。2025年末値は2026年提出原本の前年列であり、2025年別提出XBRLの確認ではありません。

1年内返済予定の長期借入金は2原本ともタグがなく、採用時の実証は合成fixtureのみです。その他を含め、公式PDF表示値との独立照合や全市場の充足率は未検証です。

Node26.12.1で全1,055テスト（既存976＋追加79）、本体/使用例の型検査・build・保存保護Python5件が成功しました。独立source検証とビルド済みAPI/CLI検証は各110確認、CJS exportも成功。既存の検査条件や制限時間は変更していません。
