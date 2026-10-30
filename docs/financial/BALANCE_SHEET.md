# J-GAAPのBS3項目・検索・流動比率

貸借対照表の3項目を読む、複数社を条件で探す、流動比率を計算する、という順で説明します。日本基準・円の原本を用意し、対象日と連結・単体の範囲を揃えて使います。

- [流動資産・流動負債・負債合計を読み取る](#selection)
- [保存した会社データを3項目で検索する](#screening)
- [流動比率で会社を比べる](#ratio)

各節のAPI・入力条件は区別します。検証件数と配布物の記録は実施当時のもので、現在の全体検証や稼働状態を示しません。

<a id="selection"></a>

## 流動資産・流動負債・負債合計を読み取る

<a id="selection-できることと使う前の準備"></a>

### できることと使う前の準備

1社の提出書類から、流動資産・流動負債・負債合計の3つを読み取ります。日本の会計基準であるJ-GAAP、金額は円、指定した日付の数値が対象です。[財務用語の説明](../GLOSSARY.md)も参照してください。

手元のXBRLファイルを用意し、「連結（グループ全体）か単体（その会社だけ）」「どの日付の数値か」を指定します。読めないときは0を返さず、記載なし・未対応・候補が複数ある等の理由を返します。元の項目名・日付・単位も一緒に確認できます。

保存した2企業の書類にある数値とは照らし合わせました。その後、企業公式PDFとの[限定的な照合](../development/REAL_DATA_VALIDATION.md)では3社・各2時点の18項目が一致しました。

両社の2025年有報PDF同士の追加照合も一致しましたが、当時のXBRL別提出原本や全市場での確認は未完了です。PR #24で数値を読む機能がmainへ入りました。

その3項目を使う[横断検索](BALANCE_SHEET.md#screening)を利用できます。

<a id="selection-開発者向け-関数と戻り値"></a>

### 開発者向け: 関数と戻り値

`BALANCE_SHEET_REGISTRY` と `EdinetXbrlObject.selectBalanceSheetMetric()` は、主要18指標とは別の3科目を返します。既存の `KeyMetrics`、`METRIC_REGISTRY`、`selectMetric()`、21指標のscreening集合には追加しません。

[別のBS横断検索API/CLI](BALANCE_SHEET.md#screening)を利用できます。

| 安定ID | 直接fact | 単位/期間 |
|---|---|---|
| `currentAssets` | `jppfs_cor:CurrentAssets` | JPY / Instant |
| `currentLiabilities` | `jppfs_cor:CurrentLiabilities` | JPY / Instant |
| `totalLiabilities` | `jppfs_cor:Liabilities` | JPY / Instant |

指標の対応表（registry）のversionは `BALANCE_SHEET_REGISTRY_VERSION`（現在 `"2"`）。定義・候補配列・辞書はfreezeしています。負債純資産合計や内訳の加算、資産から純資産を引く差額補完は行いません。

<a id="selection-利用方法"></a>

### 利用方法

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
    console.log(result.source);    // 元の項目名/記載範囲/日付/連結か単体/単位等
}
console.log(result.reason, result.evidence);
console.log(BALANCE_SHEET_REGISTRY.currentAssets);
```

会計基準は**呼出元が対象factの元書類・表で確認して宣言**します。このAPI自体はDEIを自動照合しません。

DEIから条件を得る場合は[財務基準判定](FINANCIAL_REPORTING_BASIS.md)を使います。IFRS書類の単体J-GAAP factを、書類全体のIFRS宣言だけで連結IFRSに採用しないでください。

`accountingStandard: "IFRS"` / `"US-GAAP"` はタグがあっても `unsupported-standard` です。

単体は `scope: ConsolidationScope.NonConsolidated` を明示します。対象時点は日付の完全一致です。最新時点の推定、連結から単体、当期から前期、通貨・基準のfallbackはありません。Duration・不正日付は `unsupported / invalid-period` です。

<a id="selection-共通の選択契約"></a>

### 共通の選択契約

[厳密なfact選択](METRIC_SELECTION.md)と同じ選択器を使います。`MetricDefinition<Id>` と `FactSelectionResult<Id>` にIDの型引数を追加し（省略時は従来18項目）、`selectDefinedMetricFact()`へ辞書定義を渡す形を共通化しました。

旧 `selectMetricFact()` は同じ18項目辞書を渡すwrapperとして維持しています。選択基盤の複製はありません。

- `selected` はraw、任意のsafeNumber、採用source、探索時点までのevidenceを返します。巨大整数・高精度decimalは `selected-raw-only`。decimalsは倍率ではありません。
- `missing` はタグ不在・context不一致・nilを区別します。nil・空・欠損を0にせず、実値0・有効な負数は保持します。
- `unsupported` は基準・単位・namespace・context・entity・明細次元・不正decimal等の理由を持ちます。JPY以外や未定義unitを推測変換しません。
- `ambiguous` は重複contextまたは複数適合factです。有効な候補の原値・タグ/名前空間・精度・単位・期間・範囲・次元・entityが完全一致する場合だけ、全証跡と`selected-identical-duplicates`理由を残して1件として採用します。数値丸めによる同値化はしません。
- 文書内のcontextにentity identifier/schemeが不明なもの、または複数entityがあれば `unsupported-entity` として止めます。主提出者の推測は行いません。Instant/Durationの混在・不正contextも拒否します。
- 全社factは明細次元なし、単体は公式の連結/単体axis/memberの対のみを許容します。部門・調整項目・typed dimension・未知scenarioは全社へ混ぜません。
- 公式jppfs taxonomy URI形式を確認し、未知namespaceの同じlocal nameやprefixのURI偽装を代用しません。全taxonomy年度の意味確認を保証するものではありません。

<a id="selection-検証と残る範囲"></a>

### 検証と残る範囲

> 以下は各検証を実施した時点の記録です。件数・配布先・未確認範囲を含めて読み、現在の稼働状態とは分けてください。

[財務正規化計画](../plans/FINANCIAL_NORMALIZATION.md)の最初の3項目について、F01〜F05/F07〜F11/F14/F15の適用範囲を合成/保存テスト用データで検証済みです。InstantのみのAPIなのでF14は時点完全一致と期間型拒否が対象です。訂正書類選択やDurationの分類は未実装です。

保存済み2企業のXBRL（`CJ_2371_kakakucom.xbrl`、`S100TMMG/XBRL/PublicDoc/*.xbrl`）で、連結/単体それぞれ3項目のraw・元タグ・namespace URI・context・時点・単位・decimalsをraw取得APIと突合します。`3031_raccoon.xbrl`の連結負債は同じcontextのfactが重複しており、精度・期間・単位等も完全一致することを確認して`selected-identical-duplicates`で採用し、全factを証跡へ残します。

金額はこの資料へ掲載しません。IFRS書類の単体jppfsがIFRS宣言で拒否されることも確認します。

この突合は**保存XML内の原factと来歴の一致**です。表示された元財務諸表との独立照合は[実データ確認記録](../development/REAL_DATA_VALIDATION.md)の3社・各2時点に限ります。

エクシオとミライト・ワンの2025年有報PDFとの一致は追加確認済みです。当時のXBRL別提出原本、全市場充足率、銀行/保険、新リース基準は未検証です。

呼出元による誤ったJ-GAAP宣言の検出はしません。

現預金と現金同等物（F06）、借入/リース（F12）、設備投資/償却（F13）、既存21指標横断検索への登録、比率計算、IFRS mapping、永続索引は未実装です。F16は別のBS横断検索APIでraw/来歴を検証します。既存21指標のscreening集合や全市場索引へ自動登録する意味ではありません。

ローカル検証（2026-10-23）: mainのNode 26.12.1 / npm 12.2.1へ同期し、build、`tsc --noEmit`、型の使用例の検査、19ファイル426テスト（BS専用73件）、関連Python 5テストが成功しました。文書の相対リンク・差分も検査しています。

この財務機能による依存・lockの追加変更、新規取得、配布・利用先更新はありません。

補完用定数はmainへ統合済みの[入力候補を選ぶ方法](TYPED_OPTIONS.md)を参照。文字列union型とJSON値は維持し、APIのscope等には同じ定数値を渡せます。

<a id="screening"></a>

## 保存した会社データを3項目で検索する

`createBalanceSheetSnapshot()` と `screenBalanceSheetSnapshots()` / CLI `screen-bs` は、[J-GAAP BS3科目](BALANCE_SHEET.md#selection)の別検索APIです。既存 `KeyMetrics`・主要18指標registry・21指標の `screen` は変更しません。

ローカルXBRLと明示集合を使い、取得API・DB・全市場索引には接続しません。

<a id="screening-できることと使う前の準備"></a>

### できることと使う前の準備

保存した複数社の書類を、流動資産・流動負債・負債合計の条件で絞り込み、金額順に並べます。たとえば「流動資産が指定額以上の会社を、負債合計の多い順に見る」といった使い方です。金額の単位は円です。[用語集](../GLOSSARY.md)に財務用語と開発用語をまとめています。

使う人が各社のXBRLファイルと対象の日付・連結か単体かを用意します。比較する書類は同じ日付・範囲・会計基準・通貨に揃える必要があります。日付の違う書類から最新値を自動で選んだり、全市場の書類を集めたりする機能ではありません。

値が読めない会社を0として並べず、検索から外した理由と件数を返します。初回は対象日の違う2企業と合成データで確認しました。

その後、エクシオとミライト・ワンの実書類で2025年・2026年3月末を各年別に比較し、公式PDFに基づく条件検索・並び順・ページ指定の50件が成功しました。[確認範囲と残る課題](../development/REAL_DATA_VALIDATION.md)を参照してください。

以下では、1社分の数値と対象日などをまとめたデータを `snapshot`、使えなかった値の理由一覧を `diagnostics` と呼びます。

追加の[流動比率](BALANCE_SHEET.md#ratio)も利用できます。`currentRatio`を条件・並べ替えへ指定すると、同じ流動資産・流動負債から計算します。値の単位は小数（1=100%）で、入力の金額3項目は変えません。

<a id="screening-開発者向け-api"></a>

### 開発者向け: API

```ts
import { createBalanceSheetSnapshot, screenBalanceSheetSnapshots,
    AccountingStandard, BALANCE_SHEET_REGISTRY, ComparisonOperator, ConsolidationScope, SortOrder } from "edinet-ts";
const row = createBalanceSheetSnapshot(xml, {
    secCode: "1001", docID: "SYNTHETIC1", instant: "2025-03-31",
    scope: ConsolidationScope.Consolidated, accountingStandard: AccountingStandard.JGAAP, currency: "JPY"
});
const result = screenBalanceSheetSnapshots([row], {
    conditions: [{ metric: BALANCE_SHEET_REGISTRY.currentAssets.id, operator: ComparisonOperator.GreaterThanOrEqual, value: 100 }],
    sortBy: BALANCE_SHEET_REGISTRY.totalLiabilities.id, order: SortOrder.Descending, offset: 0, limit: 20
});
```

例の識別子・比較値は合成です。helperはXML文字列または `EdinetXbrlObject` を受け、`selectBalanceSheetMetric()` で3科目を厳密選択します。objectのdocIDが既知ならメタデータと一致を確認します。証券コードは4桁/英字混在4文字、または末尾0の5文字を受け、末尾0の5文字へ正規化します。

snapshotは `secCode / docID / instant / scope / accountingStandard / currency / selections` を持ちます。selectionsのkeyは `currentAssets / currentLiabilities / totalLiabilities` の3項目です。

APIはその選択結果snapshotを受けますが、`status: "selected"` の宣言だけでは比較に使いません。

- メタデータはJ-GAAP・JPY固定です。IFRS/US-GAAPやUSDのメタデータは入力エラーです。単一科目の `selectBalanceSheetMetric()` のIFRS→`unsupported-standard`契約は変わりません。
- 全snapshotのinstant・scope・基準・通貨の整合を、条件で絞る前に検査します。日付が異なる企業を最新値へ推測調整しません。
- 同一証券コードの複数snapshot、および別証券コードでも同一docIDの重複を拒否します。最新書類や訂正版を自動選択しません。
- 異なる企業のentity identifier/schemeは許容します。同一snapshot内の採用科目のentityが違う場合は拒否します。
- selectedはrawとsafeNumberの整合、科目ID/元タグ、namespace URI、JPY単位、context、instant/scope、entity、nil、decimals、元の明細次元とscopeを検査します。採用sourceと対応evidenceの全フィールドが一致し、対象時点/scopeの全社/単体に適合する証跡が一つであることを求めます。
- 残存する競合evidence、元の明細次元とdimensionsの矛盾、採用可能evidenceを残した偽missing等を拒否します。非selectedも理由に対応する証跡を要求します。正当な他期間・明細除外evidenceは保持します。

これは**入力内の整合検査**です。全source/evidenceを捏造したserialized snapshotの真正性や、厳密選択器を実行した事実を証明できません。

元QNameのnamespace prefix mapはsnapshotにないため、元axis/memberはlocal name・次元数・scopeを照合し、URIの再検証には限界があります。単体の正当なprefix aliasは許容します。

CLI/helperで原本を渡す場合は、先行する厳密選択器による元namespace URI検証が働きます。

証券コード/docIDを原本DEIや企業マスターと自動照合しません。呼出元は原本と識別子の対応・対象factの会計基準を確認してください。原fact・来歴の一致は、表示原表との独立照合や全市場充足率の証明ではありません。

<a id="screening-検索と返値"></a>

### 検索と返値

条件は `gte / lte / gt / lt / eq` のANDです。値と比較値には有限で絶対値が `Number.MAX_SAFE_INTEGER` 以下のnumberを用い、rawのみの巨大整数・高精度decimalは比較しません。`1e-7` のようなJSON numberの小数条件は許容します。XBRL rawの指数表記禁止とは別の規則です。

必要指標は条件とsortByの和集合です。両方未指定なら3項目すべてを必要とします。必要指標がmissing/unsupported/ambiguous、またはsafeNumberなしなら行を除外します。sort値の欠損も末尾へ残さず、理由付き除外です。不要指標の欠損は診断に残し、行を落としません。

原本factがUSDで、呼出元メタデータがJPYの場合、strict選択は `unsupported-unit` になります。この正当な非採用結果は検索の診断・除外です。一方、USDメタデータや、JPYメタデータと矛盾するselectedのUSD来歴は入力エラーです。

返値は以下です。

| フィールド | 意味 |
|---|---|
| `rows` | 条件一致・並べ替え・ページング後のsnapshot。入力から深いコピーを返す |
| `total` | 条件一致後・ページング前の件数 |
| `excludedRows` | 必要指標の非採用/unsafe-numberで除外した行数 |
| `filteredRows` | 比較可能だが条件に一致しない行数 |
| `diagnostics` | 証券コード/docID/科目、非採用statusまたはunsafe-number、元selectionReason、requiredフラグ |
| `reasonCounts` | missing/unsupported/ambiguous/unsafe-numberの**指標診断件数**。不要指標の診断も含むため行数とは異なる |

sortByの既定順はdesc、`order: "asc"` も指定可能です。同値またはsort未指定では正規化証券コードの辞書順、次にdocID順です。offset/limitは0以上の安全整数。limit=0はrowsを空にしtotalを保持します。入力順を変えても並びが決まり、入力snapshotを変更しません。

<a id="screening-端末から使う-入力ファイル一覧（manifest）"></a>

### 端末から使う: 入力ファイル一覧（manifest）

まず、各社のファイルと対象条件を次のJSON形式で一覧にし、`manifest.json`として保存します。`file`以外の値は説明用です。実際の書類に合う証券コード・書類ID・対象日・範囲・基準を指定してください。新しい書類の取得はこのコマンドでは行いません。

```json
[
  { "secCode": "1001", "docID": "SYNTHETIC1", "file": "./one.xbrl",
    "instant": "2025-03-31", "scope": "Consolidated", "accountingStandard": "J-GAAP" }
]
```

```sh
edinet-ts screen-bs --manifest ./inputs/manifest.json \
  --conditions '[{"metric":"currentAssets","operator":"gte","value":100}]' \
  --sort-by totalLiabilities --order desc --offset 0 --limit 20 --pretty
```

相対fileは実行cwdではなくmanifestのディレクトリ基準です。currencyはCLIがJPYに固定します。

CLIはmanifestのローカルXBRLを解析して厳密選択を行います。serialized選択結果や余分なmanifestフィールドを受け付けません。

manifest/file/条件/来歴の不正はstderr・非0終了、成功はstdoutへJSONです。`--conditions null`も入力エラーです。

<a id="screening-何を確認し、何が残っているか"></a>

### 何を確認し、何が残っているか

合成テスト用データで条件・順序・ページ境界・欠損診断・不正入力・来歴改変・entity/期間/scope混在を検証します。保存2企業を同じ日付へ書き換えず、各原本の時点でrawと検索返値を突合し、両原本の時点混在は拒否するテストを持ちます。CLIは一時ディレクトリの合成XBRL/manifestだけを使います。

新取得、外部認証、DB、依存追加、IFRS mapping、巨大decimal比較、書類版選択、DEI/企業マスター照合は対象外です。表示原表との独立照合、複数年度提出原本、全市場品質、release・利用先更新は未達です。

数値を選ぶ基盤（PR #23）はmainへ統合済みです。財務3項目を読む機能（PR #24）もmainへ統合済みです。

その機能を使う検索の差分はPR #26でmainへ入りました。計画文書はmainにあるものを共有し、コピーを増やしません。

経緯と現在の状態は[過去の取り込み記録](../history/PENDING_BRANCHES.md)を参照してください。

ローカル検証結果（2026-10-23）: PR #24取り込み後のmainを基準に、Node 26.12.1 / npm 12.2.1で、build・`tsc --noEmit`・型の使用例の検査・20ファイル489テスト（この検索機能専用63件、既存screen CLIの確認を含む）・関連Python 5テストが成功しました。文書リンク・差分も検査しています。

この検索機能による依存・lockの追加変更、新規取得はありません。

<a id="ratio"></a>

## 流動比率で会社を比べる

流動資産と流動負債を使い、流動比率を計算して会社を絞り込めます。式は**流動資産 ÷ 流動負債**です。流動資産120、流動負債40なら結果は`3`、百分率では300%です。

既存の率指標と同じく、API・JSON・CLIは**小数値で1＝100%、2＝200%**とします。「200%以上」は`value: 2`で指定します。`200`を指定すると20,000%になります。数値は報告された金額に基づく比率です。

既存の金額3項目、主要18指標、従来の21指標検索は変えていません。[用語集](../GLOSSARY.md)と[保存ファイルの準備](BALANCE_SHEET.md#screening)も参照してください。

検証の根拠は先行する[実データの確認記録](../development/REAL_DATA_VALIDATION.md)を参照してください。当時のPR取り込み順は[履歴](../history/PENDING_BRANCHES.md)へ分離しています。

<a id="ratio-1社の比率を確かめる"></a>

### 1社の比率を確かめる

```ts
import { calculateCurrentRatio, createBalanceSheetSnapshot,
    AccountingStandard, ConsolidationScope } from "edinet-ts";

const snapshot = createBalanceSheetSnapshot(xml, {
    secCode: "1001", docID: "SYNTHETIC1", instant: "2025-03-31",
    scope: ConsolidationScope.Consolidated,
    accountingStandard: AccountingStandard.JGAAP, currency: "JPY"
});
const ratio = calculateCurrentRatio(snapshot);
if (ratio.status === "calculated") {
    console.log(ratio.value); // 表示用の近似値。3なら300%
    console.log(ratio.exact); // 例: { numerator: "3", denominator: "1" }
} else {
    console.log(ratio.reason); // 計算しなかった理由
}
console.log(ratio.inputs); // 流動資産・流動負債の原値、採用元と理由
```

識別子と金額の例は合成データです。利用者が保存XBRLと、書類の会社・会計基準・対象日・範囲の対応を確認してください。企業マスターや提出者情報との自動照合はありません。

<a id="ratio-複数社を検索する"></a>

### 複数社を検索する

```ts
import { screenBalanceSheetSnapshots, BalanceSheetScreeningMetric,
    ComparisonOperator, SortOrder } from "edinet-ts";

const result = screenBalanceSheetSnapshots(snapshots, {
    conditions: [{ metric: BalanceSheetScreeningMetric.CurrentRatio,
        operator: ComparisonOperator.GreaterThanOrEqual, value: 2 }],
    sortBy: BalanceSheetScreeningMetric.CurrentRatio,
    order: SortOrder.Descending, offset: 0, limit: 20
});
console.log(result.rows.map(row => row.derivedMetrics?.currentRatio));
console.log(result.excludedRows, result.diagnostics);
```

`currentRatio`を条件・並べ替えに使うと、その場で再計算した結果を`rows[].derivedMetrics.currentRatio`へ返します。金額の`selections`は3項目のままです。比率を要求しない検索には`derivedMetrics`を付けません。以前の検索結果を再入力しても、入力に付いていた計算済み値は使いません。

流動比率に必要なのは流動資産と流動負債です。負債合計だけが欠けても比率での検索は続け、欠けた理由は`required: false`で記録します。従来どおり条件・並べ替えを省いた場合は、金額3項目がすべて必要です。

<a id="ratio-端末から使う"></a>

### 端末から使う

保存XBRLの一覧を[既存のmanifest形式](BALANCE_SHEET.md#screening)で用意します。ファイル形式や取得方法は変わりません。

```sh
edinet-ts screen-bs --manifest ./inputs/manifest.json \
  --conditions '[{"metric":"currentRatio","operator":"gte","value":2}]' \
  --sort-by currentRatio --order desc --offset 0 --limit 20 --pretty
```

各社を同じ対象日・連結か単体か・会計基準・通貨に揃えてください。この追加機能も日本基準・円の保存書類が対象で、全市場のデータを集める機能ではありません。入力の整合性は、条件で絞る前に検査します。

<a id="ratio-計算しない場合"></a>

### 計算しない場合

| 理由 | 扱い |
|---|---|
| `missing-input` | どちらかの金額が欠損。0で補いません |
| `ambiguous-input` | 候補を一つに決められません |
| `unsupported-input` | 単位・項目等が未対応。元の選択結果に詳しい理由を残します |
| `unsafe-input` | 元の数値を安全にnumberへ往復できません。巨大な入力同士でも計算しません |
| `zero-denominator` | 流動負債が0。無限大にしません |
| `negative-input` | 流動資産または流動負債が負値。比率を作りません。流動資産0・流動負債が正なら比率0は有効です |
| `unsafe-result` | 商が最大安全整数を超える、表示値が非有限、正の商が0へ小さくなりすぎる等 |

会社・対象日・範囲・単位や採用元が矛盾する入力は、未計算の返値ではなく入力エラーです。正当な欠損・重複候補などは理由付きの未計算結果になり、比率を必要とする検索から除外します。金額検索だけなら、従来どおり0や負値を保持します。

検索の`diagnostics`には金額の問題と計算値の問題をそれぞれ残します。`reasonCounts`は従来の4分類のままで、指標ごとの診断件数です。たとえば分子の欠損と比率の未計算は2件の診断になりますが、除外した会社は1社です。

<a id="ratio-精度と境界値"></a>

### 精度と境界値

`value`は表示用の近似numberです。一方、`exact`は**報告された十進金額の商**を約分した分数です。元の値は`safeNumber`との十進往復が一致することを検査し、短い十進表現から標準のBigIntで分数を作ります。外部の数値ライブラリは追加していません。

条件判定・並べ替えには分数の交差積を使います。表示値を先に四捨五入してから比べません。JSONの数値条件は、そのnumberの文字列表現が示す十進数として扱います。指数表記も使えます。

- `0.3 ÷ 0.1`は厳密には3なので、`eq 3`に一致します。
- `1 ÷ 3`の表示近似値`0.3333333333333333`は、厳密な1/3とは異なります。その近似値を`eq`条件へ戻しても一致しません。範囲条件を使う際も、この違いを考慮してください。
- numberで同じ表示になった2社でも、分数が異なれば本来の大小順で並べます。同じ分数なら従来の証券コード順です。

分数が正確でも、元の開示金額の精度を高めたわけではありません。百万円単位に丸めた金額から求めた比率には、その元の丸めが残ります。`decimals`は精度で、倍率ではありません。将来の別資料や訂正、物理的な原本の真正性まで、この計算で確認できるわけではありません。

<a id="ratio-確認範囲"></a>

### 確認範囲

合成データで、0・負値・分母0・欠損・曖昧候補・外貨・不安全な数値・極小値・安全整数上限・元情報の混在・閾値境界・同値順・ページ指定・CLI・従来検索の互換性を検証しました。

Node 26.12.1 / npm 12.2.1でbuild、型検査、型の使用例、全528テスト（新規39件）、保存保護のPython 5件が成功しました。独立レビューで、古い計算値を再入力した場合の扱いを修正し、回帰テストを追加しています。lintの設定はありません。

実データでは、エクシオグループとミライト・ワンの2025年・2026年3月末をそれぞれ同じ日付の2社集合にしました。既存XBRLのコピーから計算した4つの比率を、企業公式PDFの流動資産・流動負債の表示値からPython標準の`Fraction`で別に計算した期待値と照合し、約分後の分数が4件とも一致しました。

Pythonの`Decimal`（精度60桁）は表示用の参考値に使い、条件の期待値は分数で判定しています。

- [エクシオ2026年有報](https://www.exeo.co.jp/wp-content/uploads/2026/06/yuuhou202603.pdf): 流動資産はPDF85頁、流動負債は86頁（冊子82・83頁）。
- [ミライト・ワン2026年有報](https://contents.xj-storage.jp/xcontents/AS99169/28ca282f/b014/46b2/8e6d/1cd3c175b56d/S100YG40.pdf): 流動資産はPDF86頁、流動負債は87頁（冊子も同じ）。

PDFは百万円表示で、計算は両項目を同じ単位のまま比べています。両時点とも2026年有報の当期・前期比較列を使った、**表示金額から求めた流動比率の確認**です。PDFに掲載された流動比率という別の指標値との一致を主張するものではありません。2025年当時のXBRL原本・全市場・他の基準・元金額の丸め誤差は、この確認の対象外です。

この独立期待値に基づくAPIの条件・並び順64件、ビルド済みCLIの比率条件・並び順・ページ指定8件も成功しました。原本・金額・個別の計算結果と詳細の照合記録はGit管理外に保持しています。新規取得・認証・費用・既存DBの変更・依存追加はありません。

辞書版2では、保存済みsnapshotの新しい重複採用理由を検査するときも、2候補以上の有効な完全一致と採用元の一致を要求します。旧JSONの`ambiguous/multiple-facts`は読込だけで採用へ変えません。旧SDKは新しい採用理由を拒否するため、新しい索引世代と対応SDKを組にして配布・切戻ししてください。
