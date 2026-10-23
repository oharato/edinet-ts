# J-GAAPのBS直接fact正規化

状態: ローカル実装・検証済み。更新日: 2026-10-22。

`BALANCE_SHEET_REGISTRY` と `EdinetXbrlObject.selectBalanceSheetMetric()` は、主要18指標とは別の3科目を返します。既存の `KeyMetrics`、`METRIC_REGISTRY`、`selectMetric()`、21指標のscreening集合には追加しません。[別のBS横断検索API/CLI](BALANCE_SHEET_SCREENING.md)を利用できます。

| 安定ID | 直接fact | 単位/期間 |
|---|---|---|
| `currentAssets` | `jppfs_cor:CurrentAssets` | JPY / Instant |
| `currentLiabilities` | `jppfs_cor:CurrentLiabilities` | JPY / Instant |
| `totalLiabilities` | `jppfs_cor:Liabilities` | JPY / Instant |

辞書versionは `BALANCE_SHEET_REGISTRY_VERSION`（現在 `"1"`）。定義・候補配列・辞書はfreezeしています。負債純資産合計や内訳の加算、資産から純資産を引く差額補完は行いません。

## 利用方法

```ts
import { EdinetXbrlParser, BALANCE_SHEET_REGISTRY, AccountingStandard, ConsolidationScope } from "edinet-ts";
const object = new EdinetXbrlParser().parse(xml);
const result = object.selectBalanceSheetMetric(BALANCE_SHEET_REGISTRY.currentAssets.id, {
    accountingStandard: AccountingStandard.JGAAP,
    scope: ConsolidationScope.Consolidated,
    period: { instant: "2025-03-31" }
});
if (result.status === "selected") {
    console.log(result.raw);        // decimal文字列
    console.log(result.safeNumber); // 安全に往復できる場合だけnumber
    console.log(result.source);    // 元タグ/context/期間/scope/単位等
}
console.log(result.reason, result.evidence);
console.log(BALANCE_SHEET_REGISTRY.currentAssets);
```

会計基準は**呼出元が対象factの元書類・表で確認して宣言**します。DEIの自動判定/照合は未実装です。IFRS書類の単体J-GAAP factを、書類全体のIFRS宣言だけで連結IFRSに採用しないでください。`accountingStandard: "IFRS"` / `"US-GAAP"` はタグがあっても `unsupported-standard` です。

単体は `scope: ConsolidationScope.NonConsolidated` を明示します。対象時点は日付の完全一致です。最新時点の推定、連結から単体、当期から前期、通貨・基準のfallbackはありません。Duration・不正日付は `unsupported / invalid-period` です。

## 共通の選択契約

[厳密なfact選択](METRIC_SELECTION.md)と同じ選択器を使います。`MetricDefinition<Id>` と `FactSelectionResult<Id>` にIDの型引数を追加し（省略時は従来18項目）、`selectDefinedMetricFact()`へ辞書定義を渡す形を共通化しました。旧 `selectMetricFact()` は同じ18項目辞書を渡すwrapperとして維持しています。選択基盤の複製はありません。

- `selected` はraw、任意のsafeNumber、採用source、探索時点までのevidenceを返します。巨大整数・高精度decimalは `selected-raw-only`。decimalsは倍率ではありません。
- `missing` はタグ不在・context不一致・nilを区別します。nil・空・欠損を0にせず、実値0・有効な負数は保持します。
- `unsupported` は基準・単位・namespace・context・entity・明細次元・不正decimal等の理由を持ちます。JPY以外や未定義unitを推測変換しません。
- `ambiguous` は重複contextまたは複数適合factです。同値重複も先頭採用しません。
- 文書内のcontextにentity identifier/schemeが不明なもの、または複数entityがあれば `unsupported-entity` として止めます。主提出者の推測は行いません。Instant/Durationの混在・不正contextも拒否します。
- 全社factは明細次元なし、単体は公式の連結/単体axis/memberの対のみを許容します。部門・調整項目・typed dimension・未知scenarioは全社へ混ぜません。
- 公式jppfs taxonomy URI形式を確認し、未知namespaceの同じlocal nameやprefixのURI偽装を代用しません。全taxonomy年度の意味確認を保証するものではありません。

## 検証と残る範囲

[財務正規化計画](https://github.com/oharato/edinet-ts/blob/docs/financial-normalization-plan/docs/plans/FINANCIAL_NORMALIZATION.md)の最初の3項目について、F01〜F05/F07〜F11/F14/F15の適用範囲を合成/保存fixtureで検証済みです。InstantのみのAPIなのでF14は時点完全一致と期間型拒否が対象です。訂正書類選択やDurationの分類は未実装です。

保存済み2企業のXBRL（`CJ_2371_kakakucom.xbrl`、`S100TMMG/XBRL/PublicDoc/*.xbrl`）で、連結/単体それぞれ3項目のraw・元タグ・namespace URI・context・時点・単位・decimalsをraw取得APIと突合します。`3031_raccoon.xbrl`の連結負債は同じcontextのfactが重複しており、原値の一致を確認しつつ`ambiguous / multiple-facts`を維持します。金額はこの資料へ掲載しません。IFRS書類の単体jppfsがIFRS宣言で拒否されることも確認します。

この突合は**保存XML内の原factと来歴の一致**です。表示された元財務諸表との独立照合、複数年度の提出原本、全市場充足率、銀行/保険、新リース基準は未検証です。呼出元による誤ったJ-GAAP宣言の検出はしません。

現預金と現金同等物（F06）、借入/リース（F12）、設備投資/償却（F13）、既存21指標横断検索への登録、比率計算、IFRS mapping、永続索引は未実装です。F16は別のBS横断検索APIでraw/来歴を検証します。既存21指標のscreening集合や全市場索引へ自動登録する意味ではありません。

ローカル検証: Node 24.22.1 / npm 11でbuild、`tsc --noEmit`、16ファイル409テスト（BS専用73件）、関連Python 5テスト、相対リンク・差分検査が成功。依存・lockの変更、新規取得、remote反映・配布・利用先更新はありません。

補完用定数は先行PR #23の[型付き入力定数](https://github.com/oharato/edinet-ts/blob/improve/metric-foundation/docs/TYPED_OPTIONS.md)を参照。文字列union型とJSON値は維持し、APIのscope等には同じ定数値を渡せます。
