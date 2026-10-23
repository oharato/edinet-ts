# 保存した会社データを3項目で検索する

状態: 金額3項目の検索はPR #26でmainへ取り込み済み。流動比率はこのローカルブランチで追加（未公開・未release）。更新日: 2026-10-23。

`createBalanceSheetSnapshot()` と `screenBalanceSheetSnapshots()` / CLI `screen-bs` は、[J-GAAP BS3科目](BALANCE_SHEET_NORMALIZATION.md)の別検索APIです。既存 `KeyMetrics`・主要18指標registry・21指標の `screen` は変更しません。ローカルXBRLと明示集合を使い、取得API・DB・全市場索引には接続しません。

## できることと使う前の準備

保存した複数社の書類を、流動資産・流動負債・負債合計の条件で絞り込み、金額順に並べます。たとえば「流動資産が指定額以上の会社を、負債合計の多い順に見る」といった使い方です。金額の単位は円です。[用語集](GLOSSARY.md)に財務用語と開発用語をまとめています。

使う人が各社のXBRLファイルと対象の日付・連結か単体かを用意します。比較する書類は同じ日付・範囲・会計基準・通貨に揃える必要があります。日付の違う書類から最新値を自動で選んだり、全市場の書類を集めたりする機能ではありません。

値が読めない会社を0として並べず、検索から外した理由と件数を返します。保存した2企業の書類では個別の値と元の記載を確認していますが、2社は日付が異なるため、同じ日付の複数社検索は合成データで確認しています。

以下では、1社分の数値と対象日などをまとめたデータを `snapshot`、使えなかった値の理由一覧を `diagnostics` と呼びます。

追加の[流動比率](CURRENT_RATIO.md)は、このローカルブランチで実装しています。`currentRatio`を条件・並べ替えへ指定すると、同じ流動資産・流動負債から計算します。値の単位は小数（1=100%）で、入力の金額3項目は変えません。

## 開発者向け: API

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

snapshotは `secCode / docID / instant / scope / accountingStandard / currency / selections` を持ちます。selectionsのkeyは `currentAssets / currentLiabilities / totalLiabilities` の3項目です。APIはその選択結果snapshotを受けますが、`status: "selected"` の宣言だけでは比較に使いません。

- メタデータはJ-GAAP・JPY固定です。IFRS/US-GAAPやUSDのメタデータは入力エラーです。単一科目の `selectBalanceSheetMetric()` のIFRS→`unsupported-standard`契約は変わりません。
- 全snapshotのinstant・scope・基準・通貨の整合を、条件で絞る前に検査します。日付が異なる企業を最新値へ推測調整しません。
- 同一証券コードの複数snapshot、および別証券コードでも同一docIDの重複を拒否します。最新書類や訂正版を自動選択しません。
- 異なる企業のentity identifier/schemeは許容します。同一snapshot内の採用科目のentityが違う場合は拒否します。
- selectedはrawとsafeNumberの整合、科目ID/元タグ、namespace URI、JPY単位、context、instant/scope、entity、nil、decimals、元の明細次元とscopeを検査します。採用sourceと対応evidenceの全フィールドが一致し、対象時点/scopeの全社/単体に適合する証跡が一つであることを求めます。
- 残存する競合evidence、元の明細次元とdimensionsの矛盾、採用可能evidenceを残した偽missing等を拒否します。非selectedも理由に対応する証跡を要求します。正当な他期間・明細除外evidenceは保持します。

これは**入力内の整合検査**です。全source/evidenceを捏造したserialized snapshotの真正性や、厳密選択器を実行した事実を証明できません。元QNameのnamespace prefix mapはsnapshotにないため、元axis/memberはlocal name・次元数・scopeを照合し、URIの再検証には限界があります。単体の正当なprefix aliasは許容します。CLI/helperで原本を渡す場合は、先行する厳密選択器による元namespace URI検証が働きます。

証券コード/docIDを原本DEIや企業マスターと自動照合しません。呼出元は原本と識別子の対応・対象factの会計基準を確認してください。原fact・来歴の一致は、表示原表との独立照合や全市場充足率の証明ではありません。

## 検索と返値

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

## 端末から使う: 入力ファイル一覧（manifest）

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

相対fileは実行cwdではなくmanifestのディレクトリ基準です。currencyはCLIがJPYに固定します。CLIはmanifestのローカルXBRLを解析して厳密選択を行います。serialized選択結果や余分なmanifestフィールドを受け付けません。manifest/file/条件/来歴の不正はstderr・非0終了、成功はstdoutへJSONです。`--conditions null`も入力エラーです。

## 何を確認し、何が残っているか

合成fixtureで条件・順序・ページ境界・欠損診断・不正入力・来歴改変・entity/期間/scope混在を検証します。保存2企業を同じ日付へ書き換えず、各原本の時点でrawと検索返値を突合し、両原本の時点混在は拒否するテストを持ちます。CLIは一時ディレクトリの合成XBRL/manifestだけを使います。

新取得、外部認証、DB、依存追加、IFRS mapping、巨大decimal比較、書類版選択、DEI/企業マスター照合は対象外です。表示原表との独立照合、複数年度提出原本、全市場品質、release・利用先更新は未達です。数値を選ぶ基盤（PR #23）はmainへ統合済みです。財務3項目を読む機能（PR #24）もmainへ統合済みです。このPRは、その機能を使った検索の差分だけをmainへ提案します。計画文書はmainにあるものを共有し、コピーを増やしません。経緯と現在の状態は[確認中の変更](plans/PENDING_BRANCHES.md)を参照してください。

ローカル検証結果（2026-10-23）: PR #24取り込み後のmainを基準に、Node 26.12.1 / npm 12.2.1で、build・`tsc --noEmit`・型の使用例の検査・20ファイル489テスト（この検索機能専用63件、既存screen CLIの確認を含む）・関連Python 5テストが成功しました。文書リンク・差分も検査しています。この検索機能による依存・lockの追加変更、新規取得はありません。
