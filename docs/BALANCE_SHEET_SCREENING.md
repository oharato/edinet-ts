# BS3科目のオフライン横断検索

状態: ローカル実装・検証済み。更新日: 2026-10-22。公開・配布は未実施。

`createBalanceSheetSnapshot()` と `screenBalanceSheetSnapshots()` / CLI `screen-bs` は、[J-GAAP BS3科目](BALANCE_SHEET_NORMALIZATION.md)の別検索APIです。既存 `KeyMetrics`・主要18指標registry・21指標の `screen` は変更しません。ローカルXBRLと明示集合を使い、取得API・DB・全市場索引には接続しません。

## API

```ts
import { createBalanceSheetSnapshot, screenBalanceSheetSnapshots } from "edinet-ts";
const row = createBalanceSheetSnapshot(xml, {
    secCode: "1001", docID: "SYNTHETIC1", instant: "2025-03-31",
    scope: "Consolidated", accountingStandard: "J-GAAP", currency: "JPY"
});
const result = screenBalanceSheetSnapshots([row], {
    conditions: [{ metric: "currentAssets", operator: "gte", value: 100 }],
    sortBy: "totalLiabilities", order: "desc", offset: 0, limit: 20
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

## CLIのローカルmanifest

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

## 検証と残る範囲

合成fixtureで条件・順序・ページ境界・欠損診断・不正入力・来歴改変・entity/期間/scope混在を検証します。保存2企業を同じ日付へ書き換えず、各原本の時点でrawと検索返値を突合し、両原本の時点混在は拒否するテストを持ちます。CLIは一時ディレクトリの合成XBRL/manifestだけを使います。

新取得、外部認証、DB、依存追加、IFRS mapping、巨大decimal比較、書類版選択、DEI/企業マスター照合は対象外です。表示原表との独立照合、複数年度提出原本、全市場品質、公開・利用先更新は未達です。ローカルbranchは厳密選択基盤とBS正規化branchを先行依存とし、PR22の計画文書を含みます。PR22統合後の文書・索引の差分整理と[未公開branchの依存関係](plans/PENDING_BRANCHES.md)の確認が、公開前に必要です。

ローカル検証結果: Node 24.22.1 / npm 11でbuild・`tsc --noEmit`・17ファイル472テスト（BS横断検索専用63件、既存screen CLI回帰を含む）・関連Python 5テスト・相対リンク・差分検査が成功。依存/lock変更、新規取得、remote操作はありません。
