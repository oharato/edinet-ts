# 監査・非監査報酬

`EdinetXbrlObject.selectAuditFeeMetric`、`createAuditFeeSnapshot`、`screenAuditFeeDocuments`は、明示したJ-GAAP/JPYの期間について、監査報酬12区分を直接タグから取得・検索します。辞書は`AUDIT_FEE_REGISTRY`、版は`AUDIT_FEE_REGISTRY_VERSION = "1"`です。主要18/21指標や財務明細23項目へは混ぜません。

| 区分 | 指標IDの先頭 |
|---|---|
| 監査証明業務／非監査業務 | `auditFees` / `nonAuditFees` |
| 提出会社／連結子会社／計 | `ReportingCompany` / `ConsolidatedSubsidiaries` / `Total` |
| 監査人本体／同一ネットワーク（本体を除く） | 接尾辞なし / `NetworkFirms` |

例えば`AuditFeeMetricId.AuditReportingCompany`は`auditFeesReportingCompany`、`AuditFeeMetricId.NonAuditTotalNetwork`は`nonAuditFeesTotalNetworkFirms`です。対応する`jpcrp_cor`の同名先頭大文字タグを使います。企業独自タグや別区分の値は代用しません。対象会社の区分はタグが示し、contextの連結/単体scopeとは別の情報です。

```ts
const result = createAuditFeeSnapshot({ xml, metadata: {
  secCode: "19510", docID, scope: "Consolidated", accountingStandard: "J-GAAP",
  currency: "JPY", periodType: "annual",
  period: { startDate: "2024-04-01", endDate: "2025-03-31" }
}}, AuditFeeMetricId.AuditTotal);
```

金額は円の原値で返し、元タグ・context・unit・精度・原XML hashを残します。重複は完全一致でも曖昧のままです。負値・未知次元・不一致単位等は採用せず、nil/ダッシュを0へ変えません。明記された0は保持します。安全なnumberにできない原値は保持しますが検索から除外します。合計タグを取得し、内訳を合算して補完しません。

`screenAuditFeeDocuments(documents, metric, { conditions, order, offset, limit })`は同じ項目・期間・期間分類・scope・基準・通貨の明示企業集合を検索します。条件は`{ operator: "gte", value: 100000000 }`等です。会社・書類の重複や比較範囲の混在は条件で隠さず拒否し、除外・条件不一致の件数と診断を返します。IFRS/US-GAAP、監査法人の名寄せ、報酬注記の意味分類、非ネットワークのその他監査報酬、役員報酬等は未対応です。12項目を同じ原本から読む場合は、原本を一度parseし、objectの選択APIを繰り返して使えます。

## 原本確認

取得済みAPI原本のエクシオ`S100W0NZ`（PDF73ページ）、ミライト・ワン`S100VZQA`（PDF80ページ）の当期/前期を対象にしました。PDFを描画して表の区分・百万円単位・注記を確認し、独立Python Decimal処理で48選択を照合しました。

- 数値31件: PDF百万円×1,000,000とXBRLの原値が一致。うち明記された0も保持。
- PDFダッシュ5件: XBRLのnilと一致し、値として採用しない。
- エクシオのネットワーク区分12件: 表自体が「該当事項なし」で、タグなしを保持。

例えばエクシオ当期の監査報酬は提出会社89百万円・子会社97百万円・計187百万円です。表示丸めにより89+97と187は一致しません。内訳を合算して合計タグを置き換えない理由です。その他監査法人への報酬148百万円の注記は、この合計に混ぜません。この限定2社の一致を、全社・他年度・IFRSでの充足としません。

追加後の全78ファイル・2,644テスト（1ワーカー）、build、公開API型検査が成功しました。原本照合はこの2社・2期間に限ります。
