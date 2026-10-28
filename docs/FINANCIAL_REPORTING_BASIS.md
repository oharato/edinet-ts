# DEIから財務基準・当期を確定する

`resolveFinancialReportingBasis(xml, docID)` は、DEIの宣言と実contextを照合して、会計基準・提出者・主たる財務範囲・当期の開始/終了日を返します。`createAutomaticFinancialSnapshots` はその結果を既存のBS/財務明細snapshotへ接続します。判定版は `FINANCIAL_REPORTING_BASIS_VERSION = "1"` です。

## 読む宣言と整合性

[2026年版の公式タクソノミ](https://www.fsa.go.jp/search/20251111.html)に含まれるjpdei/2013-08-31 XSDで、以下11要素が非abstractのinstant項目であることを確認しました。

| 項目 | DEIタグ |
|---|---|
| 提出者 | EDINETCodeDEI |
| 証券コード（任意） | SecurityCodeDEI |
| 様式 | DocumentTypeDEI |
| 基準 | AccountingStandardsDEI |
| 連結作成の宣言 | WhetherConsolidatedFinancialStatementsArePreparedDEI |
| 年度開始/年度末 | CurrentFiscalYearStartDateDEI / CurrentFiscalYearEndDateDEI |
| 当期末/当期の符号 | CurrentPeriodEndDateDEI / TypeOfCurrentPeriodDEI |
| 連結/単体の業種別財務諸表規則コード（任意） | IndustryCodeWhenConsolidatedFinancialStatementsArePreparedInAccordanceWithIndustrySpecificRegulationsDEI / IndustryCodeWhenFinancialStatementsArePreparedInAccordanceWithIndustrySpecificRegulationsDEI |

各fieldはselected/missing/unsupported/ambiguousと原値・全候補・namespace/context/entity/単位等の証跡を返します。DEIは正規namespace・次元のない有効instant・単位なしを確認し、複数候補は完全一致でも自動採用しません。nil/空欄/不在と不正値を分けます。単一の既知entityを必要とし、EDINETCodeDEIのEコードとentityのEDINET scheme・Eコード-000を照合します。

選択されたDEIのentity/instantが食い違う場合は確定しません。証券コードと業種コードのnil/不在は保持できますが、曖昧/非対応を無視して埋めません。業種コードは原文のまま主範囲の値を保持し、JPX業種や一般事業/金融の意味へ自動変換しません。株式コードと企業マスター、呼出元のdocIDと原本の対応は別の確認です。

## 基準・範囲・期間

Japan GAAPはJ-GAAP、IFRSはIFRSとして確定します。US GAAP/JMIS/未知値を他基準へ切り替えません。連結作成フラグtrue/1を主範囲Consolidated、false/0をNonConsolidatedとして扱い、財務contextも実際のscope・次元・entityで照合します。

| DEIの当期符号 | 期間分類 | durationの対象 |
|---|---|---|
| FY | annual | 年度開始から当期末。年度末と当期末の一致を確認 |
| HY / Q1 / Q2 / Q3 | ytd | 年度開始から当期末。年度末へ延長しない |

年度開始≦当期末≦年度末、当期末≦DEIのinstantを確認します。FY以外は当期末が年度末より前であることを確認します。annualはFYの宣言に基づく分類で、12か月の保証ではありません。変則期間の元日付を保持し、単四半期や12か月へ換算しません。

様式はFYの第三号、HYの第四号の三/第五号、Q1/Q2/Q3の第四号の三を対象とします。様式だけで期間を決めず、当期符号・各DEI日付・実contextと併せて検査します。第五号様式の半期報告書の表紙は[金融庁の様式資料](https://www.fsa.go.jp/news/r7/shouken/20251126/01.pdf)でも確認しています。Q1/Q3・第五号の経路は現時点では合成検証までです。

metadataのdeiContextInstantは「DEIが参照するinstant」です。これを提出日時・取得日時・knownAtへ読み替えません。metadata.periodは当期累計、fiscalYearは年度全体、instantは当期末です。contextのID名を見て年次/半期や期末を推測しません。複数の同義contextがあればID一覧を保持し、重複したIDはblockedDuplicateContextsへ期間型とともに記録します。

## APIとsnapshot接続

```ts
import {resolveFinancialReportingBasis, createAutomaticFinancialSnapshots} from "edinet-ts";

const basis = resolveFinancialReportingBasis(xml, "SAMPLE");
if (basis.status === "selected") {
  console.log(basis.metadata.accountingStandard, basis.metadata.period);
}
const result = createAutomaticFinancialSnapshots(xml, {
  docID: "SAMPLE", detailMetricIds: ["costOfSales"]
});
```

解析済みobjectでは `object.selectFinancialReportingBasis()` も使えます。Object入口では元XML hashを作らず、xmlを渡す入口だけUTF-8文字列のSHA-256を付けます。BOMを保持します。hashは真正性やdocIDとの対応の保証ではありません。

自動接続の結果は、基準に応じて以下の既存契約を返します。

| 判定 | balanceSheet | detailsの既定 |
|---|---|---|
| J-GAAP | 既存BS3 snapshot | 既存のduration2科目（原価/販管費） |
| IFRS連結 | IFRS BS3 snapshot | IFRS PL5 snapshot |

detailMetricIdsで、その基準のduration明細を明示できます。期間型/基準にない項目や未知/重複/疎配列は拒否します。IFRS単体は既存抽出器の対象外として停止し、日本基準へ切り替えません。

status:resolvedはDEIから接続条件を確定できたことを意味します。各groupのstatus:createdはsnapshotを作成できたことで、すべての値の採用を意味しません。値のnil/曖昧/非対応はsnapshot内で確認します。対象contextがなければgroupをunavailableとし、通常の不在と重複IDによる利用不能を区別します。

基準が未確定、証券コードなし、対象外のIFRS単体ではstatus:unresolvedと理由を返します。証券コードなしでもbasis自体の期間/提出者情報は保持できます。現在のsnapshot型が証券コードを必要とするため、架空のコードを作りません。

targetCurrency:JPYは抽出器の対象単位です。DEIから表示通貨を認定する項目ではなく、外貨factは既存の単位検査でunsupported-unitとなります。換算やJPYの推定補完は行いません。既存snapshotの検証契約を使うため、最大3回解析する実装です。大量取り込みでの解析済みobject共用は後続工程です。

## CLI

```sh
edinet-ts financial-reporting-basis --file saved.xbrl --doc-id SAMPLE --pretty
edinet-ts financial-reporting-basis --file saved.xbrl --doc-id SAMPLE \
  --with-snapshots --detail-metrics costOfSales,sellingGeneralAndAdministrativeExpenses
```

--detail-metricsは--with-snapshotsと組み合わせます。入力/読込/解析の不正は内容を表示せず終了1、正常に判定した未確定は理由付きJSON/終了0です。

## 実原本と残工程

取得済み10原本で、J-GAAP/IFRS、FY/HY/Q2の累計、連結/単体を確認しました。独立XML処理でDEI110件（105採用/5nil）、当期duration10・instant10のcontextと日付/範囲/提出者が一致しました。9原本は18snapshotを生成し、60財務選択すべての原値・単位・当期contextと160fact証跡を元XMLで確認しました。別処理でDEIを読んで作った既存APIの手動metadata/snapshotとも完全一致しています。IFRS単体1原本は対象外として停止しました。

元XMLはミライト2025年3月期、ユキグニ/アイティメディア/パーソル2026年3月期、ソフトバンク2024年3月期に加え、保存済みの年次/半期/Q2記載原本を使用しました。この追加確認はXMLと既存APIの照合であり、新規対象すべての財務値のPDF照合とは区別します。外部取得・費用はなく、元stock-dataキャッシュは読取専用で扱いました。

全DEI版/様式、複数entityの主提出者分離、別scopeへの自動切替、非上場のsnapshot型、US/JMIS・IFRS単体・外貨、単四半期化・比較期間/訂正全文の再構成は残工程です。観測cutoff/最新版選択は[文書パイプライン](DOCUMENT_PIPELINE.md)と別に接続し、DEIの時点から未観測の履歴を作りません。永続索引、利用先の固定配布物と本番反映も引き続き対象です。

観測cutoff・訂正選択からこのAPIへ接続する入口は、[文書パイプラインの自動財務snapshot](DOCUMENT_PIPELINE.md#選択原本からの自動財務snapshot)を参照してください。DEIだけでknownAtを作らず、選択原本の直接値を返します。
