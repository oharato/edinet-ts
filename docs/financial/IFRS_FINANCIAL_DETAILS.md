# IFRS連結の直接PL・CF明細

IFRS連結の損益・キャッシュフロー明細を読み、同じ期間の企業を比較します。科目の対応表で必要な項目を選び、APIまたはCLIへ原本を渡します。

`selectIfrsFinancialDetail` は、IFRS・連結・JPY・明示した期間の直接タグを選びます。`createIfrsFinancialDetailSnapshot` と `screenIfrsFinancialDetailDocuments`、CLI `screen-ifrs-details` で原値・出典を保持して比較できます。

日本基準の辞書/既定5項目、主要18/21指標、[既存IFRS BS3](IFRS_BALANCE_SHEET_SELECTION.md)の契約は変更しません。

<a id="対応表"></a>

## 取得できる項目

専用辞書 `IFRS_FINANCIAL_DETAIL_REGISTRY` の版は1です。候補は各IDにつき1タグだけで、別範囲の科目から合算/差引で埋めません。すべて `jpigp_cor:` の金額・durationです。

| ID | タグ |
|---|---|
| costOfSales | CostOfSalesIFRS |
| grossProfit | GrossProfitIFRS |
| sellingGeneralAndAdministrativeExpenses | SellingGeneralAndAdministrativeExpensesIFRS |
| profitBeforeTax | ProfitLossBeforeTaxIFRS |
| incomeTaxExpense | IncomeTaxExpenseIFRS |
| depreciationAndAmortizationCashFlow | DepreciationAndAmortizationOpeCFIFRS |
| depreciationExpenseCashFlow | DepreciationExpenseOpeCFIFRS |
| propertyPlantEquipmentPurchaseCashFlow | PurchaseOfPropertyPlantAndEquipmentInvCFIFRS |
| propertyPlantEquipmentAndIntangiblesPurchaseCashFlow | PurchaseOfPropertyPlantAndEquipmentAndIntangibleAssetsInvCFIFRS |
| incomeTaxesPaidCashFlow | IncomeTaxesPaidOpeCFIFRS |
| incomeTaxesRefundCashFlow | IncomeTaxesRefundOpeCFIFRS |
| netIncomeTaxesRefundPaidCashFlow | IncomeTaxesRefundPaidOpeCFIFRS |
| dividendsPaidCashFlow | DividendsPaidFinCFIFRS |
| dividendsPaidToOwnersOfParentCashFlow | DividendsPaidToOwnersOfParentFinCFIFRS |
| longTermBorrowingsRepaymentCashFlow | RepaymentsOfLongTermBorrowingsFinCFIFRS |
| bondsAndLongTermBorrowingsRepaymentCashFlow | RedemptionOfBondsAndRepaymentsOfLongTermBorrowingsFinCFIFRS |
| leaseObligationsRepaymentCashFlow | RepaymentsOfLeaseObligationsFinCFIFRS |

[金融庁の2026年版公表資料](https://www.fsa.go.jp/search/20251111.html)にある[公式タクソノミZIP](https://www.fsa.go.jp/search/20251111/1c_Taxonomy.zip)のjpigp/2025-11-01 XSDと日本語ラベルで、17タグの金額型・duration・非abstractを確認しました。借入と社債を含む返済、設備単独と無形資産を含む取得、減価償却単独と償却費を含む調整額、税支払/還付/純額、一般の配当/親会社所有者向け配当は別項目です。

タグ不在を他方の値で補いません。

原値の符号を保持します。例えば支払CFの負値を支出額の正値へ変えず、法人所得税の負値（利益方向）も失いません。PL費用を正の費用額として記載するXBRLと、費用を△表示するPDFがあるため、PDF表示の符号をAPIの原値へ上書きしません。自動で外貨換算、CFの表示区分移動、経済的に同じ範囲の再認定は行いません。

## 選択とsnapshot

```ts
import {
  EdinetXbrlParser, IfrsFinancialDetailMetricId,
  createIfrsFinancialDetailSnapshot, screenIfrsFinancialDetailDocuments
} from "edinet-ts";

const metadata = {
  secCode: "10010", docID: "SAMPLE",
  accountingStandard: "IFRS", scope: "Consolidated", currency: "JPY",
  periodType: "annual",
  period: { startDate: "2025-04-01", endDate: "2026-03-31" }
} as const;

const object = new EdinetXbrlParser().parse(xml, metadata.docID);
const paid = object.selectIfrsFinancialDetail(
  IfrsFinancialDetailMetricId.IncomeTaxesPaidCashFlow, metadata
);
const snapshot = createIfrsFinancialDetailSnapshot(xml, metadata, [
  "incomeTaxesPaidCashFlow", "incomeTaxesRefundCashFlow"
]);
```

基準・連結・通貨・期間・期間分類は、呼出元が原本を確認した宣言です。自動のIFRS/年次認定ではありません。periodTypeはannual/ytd/quarterlyで、検索では開始/終了日と分類が同じ原本だけ比較します。会計期間の長短や単四半期化を推測しません。

既定投影はPL5項目（対応表の先頭5件）です。CFはmetricIdsで明示し、条件/並びに使う項目も投影に含めます。

nil、不在、曖昧、単位/名前空間/期間/次元の非対応と実際の0を分け、全候補と採用理由、原文字列、context/entity、unit/decimalsを保持します。安全に表現できない巨大値はrawを保持し、safeNumberを付けません。

snapshotは解析に使った文字列のUTF-8 SHA-256も返します。hashは原本真正性や申告した銘柄との対応の証明ではありません。

IFRS直接PL/CF明細では、完全一致する有効重複だけを共通判定によりselected-identical-duplicatesとして採用します。原値・タグ/名前空間・解決済み単位・精度・期間・範囲・次元・entityの違いを消しません。

異値・精度差・nil混在・重複context定義など、完全一致と確認できない候補は採用しません。候補のcontextRef/単位refが異なっても、解決先の意味が完全一致するかを判定し、元refは各evidenceに残します。

対象外の基準はunsupported-standard、単体はunsupported-semanticsです。duration/instantの混在、旧IFRSや企業拡張タグの代用を認めません。共通選択器は正規jpigp URIの2018-03-31以降の日付を検査しますが、途中の全版・全タグを確認済みという意味ではありません。

## 検索とCLI

```ts
const result = screenIfrsFinancialDetailDocuments(documents, {
  metricIds: ["incomeTaxesPaidCashFlow", "incomeTaxesRefundCashFlow"],
  conditions: [{ metric: "incomeTaxesPaidCashFlow", operator: "lt", value: 0 }],
  sortBy: "incomeTaxesPaidCashFlow", order: "asc", offset: 0, limit: 100
});
```

条件/並びの必須項目が欠ける行だけ除外し、未使用項目の欠損は診断に残して行を保ちます。条件/並びがなければ投影項目すべてを必須とします。safeNumberのない値は数値検索からunsafe-numberとして除外します。原値を無理に丸めて比較しません。

rows、ページ前total、excludedRows/filteredRows、項目ごとのdiagnostics/reasonCountsを返します。分類/日付の混在、企業コード/書類の重複、同じentityの別銘柄への重複指定を拒否します。

入力metadataはXML取得前に固定し、独自iteratorや疎配列で検査を回避できません。100原本・100条件・合計256MiBまでの明示集合を読むメモリ検索です。

```sh
edinet-ts screen-ifrs-details --manifest reviewed.json \
  --metrics incomeTaxesPaidCashFlow,incomeTaxesRefundCashFlow \
  --conditions '[{"metric":"incomeTaxesPaidCashFlow","operator":"lt","value":0}]' \
  --sort-by incomeTaxesPaidCashFlow --order asc
```

manifestは `{file, metadata}` の配列で、fileはmanifest基準の相対パスも使えます。UTF-8 BOMを保持し、入力エラーの内容は表示しません。

既存の日本基準検索やIFRS BS3 CLIとは別の入口です。既存の財務snapshot/SQLiteへ強制キャストで混ぜないでください。

最新/訂正版選択、観測cutoff、SQL永続保存はこの入口では行いません。

## 実原本と残工程

> 以下は各検証を実施した時点の記録です。件数・配布先・未確認範囲を含めて読み、現在の稼働状態とは分けてください。

既存キャッシュを読取専用で調べ、ユキグニファクトリー・アイティメディア・パーソルの2026年3月期有報とソフトバンクグループの2024年3月期有報、各2期間を確認しました。4社8snapshot・136選択について、独立XML処理で87採用、タグ不在48、nil1、240fact証跡、完全一致重複の採用12件が一致しました。

PDFの44組・88項目（採用87値とnil表示1）、千円/百万円、会社別の費用表示符号を照合し、7検索の条件/順序/ページ/必要欠損/未使用診断も独立一致しました。費用の正/△表示と税還付nilのページは画像でも確認しました。

XBRL4件とソフトバンクのPDFは既存データを使用しました。残る3社のPDFだけEDINETから追加取得し、hash/観測時刻を私有検証記録へ保存しています。認証値は表示せず、有料取得元を使っていません。元のstock-data作業ツリー/キャッシュは変更せず、コピーした原本で検証しました。

今回の実原本にない減価償却単独CF・親会社所有者向け配当・社債と長期借入の合算返済の3タグは公式XSD/合成テスト用データの確認までです。すべての17項目を実原本で確認したとはしません。銀行・保険/流動性順、外貨、旧IFRS、企業拡張/全年度・全銘柄、追加BS/他PL/CF科目、標準化・比率/ROIC、SQL保存/索引・利用先反映は引き続き残工程です。

IFRS財務明細辞書版2では、販管費・税引前以外にも完全一致重複の検証を適用します。旧解析cacheと未完了計画は辞書版で分離し、既存の索引世代を上書きしません。BSも別の辞書版で完全一致重複に対応します。汎用の旧18指標の既定選択は維持します。
