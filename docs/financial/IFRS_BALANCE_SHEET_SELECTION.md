# IFRSの貸借対照表を原記載から読む

IFRSの連結財務諸表から、直接記載された8項目を読みます。既定は従来の流動資産・流動負債・負債合計の3項目です。非流動資産と負債の内訳5項目は、snapshotや検索で明示して追加できます。

対象は連結・指定期末・JPYです。内訳の合算、差引による補完、外貨換算はしません。有利子負債にリース負債が含まれるかは会社の表示・定義によるため、両者を自動加算しません。

## 読む項目と根拠

定数は `IfrsBalanceSheetMetricId`、辞書は `IFRS_BALANCE_SHEET_REGISTRY`（版 `"2"`）です。正式タグの接頭辞はすべて `jpigp_cor:` です。

| 定数 | ID | 正式タグ | 既定 |
|---|---|---|---|
| `CurrentAssets` | `currentAssets` | `CurrentAssetsIFRS` | ○ |
| `CurrentLiabilities` | `currentLiabilities` | `TotalCurrentLiabilitiesIFRS` | ○ |
| `TotalLiabilities` | `totalLiabilities` | `LiabilitiesIFRS` | ○ |
| `NoncurrentAssets` | `noncurrentAssets` | `NonCurrentAssetsIFRS` | |
| `CurrentInterestBearingLiabilities` | `currentInterestBearingLiabilities` | `InterestBearingLiabilitiesCLIFRS` | |
| `NoncurrentInterestBearingLiabilities` | `noncurrentInterestBearingLiabilities` | `InterestBearingLiabilitiesNCLIFRS` | |
| `CurrentLeaseLiabilities` | `currentLeaseLiabilities` | `LeaseLiabilitiesCLIFRS` | |
| `NoncurrentLeaseLiabilities` | `noncurrentLeaseLiabilities` | `LeaseLiabilitiesNCLIFRS` | |

金融庁の[2026年版公式タクソノミ](https://www.fsa.go.jp/search/20251111.html)と[本体ZIP](https://www.fsa.go.jp/search/20251111/1c_Taxonomy.zip)の2025-11-01版XSDで、追加5項目が金額型・instant・非abstractであることを確認しています。既定3項目は[2018年公開資料](https://www.fsa.go.jp/search/20180316.html)の2018-03-31版でも確認済みです。全年度・全業種を検証したという意味ではありません。

`CurrentLiabilitiesIFRS` という別名は使いません。IFRSの非流動負債合計も、今回確認した辞書には追加していません。負債合計から流動負債を差し引く補完はしません。流動区分を単純に「1年以内」と再判定せず、会社の表示を保ちます。

<a id="api"></a>

## 1項目を読む

```ts
import { EdinetXbrlParser, IfrsBalanceSheetMetricId as M } from "edinet-ts";

const object = new EdinetXbrlParser().parse(xml, "SYNTHETIC-IFRS");
const result = object.selectIfrsBalanceSheetMetric(M.CurrentLeaseLiabilities, {
  accountingStandard: "IFRS",
  scope: "Consolidated",
  period: { instant: "2026-03-31" }
});
if (result.status === "selected") console.log(result.raw, result.source);
```

書類IDと期末は例です。会計基準は元書類で確認して指定します。タグがあるだけで、その書類をIFRSと推定しません。

`raw` に原文字列、`source` にタグ・名前空間・context・entity・期間・単位・decimalsを返します。安全に数値へ変換できる場合だけ `safeNumber` が付きます。0、nil、タグ不在、期間やscopeの不一致、曖昧な複数候補を区別します。有効な候補の原値・タグ/名前空間・精度・単位・期間・範囲・次元・entityが完全一致する重複だけ、`selected-identical-duplicates`で採用し、全候補を出典に残します。異値・精度差・nil混在・重複context定義は採用しません。

IFRS以外は `unsupported-standard`、単体は `unsupported-semantics` です。正規の `jpigp` 名前空間と日付を検査し、旧 `ifrs-full` や企業独自タグへ代替しません。J-GAAPの辞書・版は変更しません。

## snapshotと複数社検索

```ts
import { createIfrsBalanceSheetSnapshot, screenIfrsBalanceSheetDocuments,
  IfrsBalanceSheetMetricId as M } from "edinet-ts";

const metadata = {
  secCode: "1001", docID: "SYNTHETIC-IFRS", instant: "2026-03-31",
  scope: "Consolidated", accountingStandard: "IFRS", currency: "JPY"
} as const;
const metrics = [M.NoncurrentAssets, M.CurrentLeaseLiabilities];
const snapshot = createIfrsBalanceSheetSnapshot(xml, metadata, metrics);
const found = screenIfrsBalanceSheetDocuments([{ xml, metadata }], {
  metricIds: metrics,
  conditions: [{ metric: M.CurrentLeaseLiabilities, operator: "gte", value: 0 }],
  sortBy: M.CurrentLeaseLiabilities,
  order: "desc"
});
```

第3引数／`metricIds` は既定3項目に追加する指定です。返却値には既定3項目と指定項目を記録します。省略すれば従来の3項目だけを返し、追加項目の不在を診断にも加えません。空・未知・重複・疎配列は拒否します。

検索条件や並べ替えに追加項目を使う場合は `metricIds` にも指定してください。条件・並べ替えがあれば、その項目だけを必須とします。指定がなければ、返却する全項目を必須とします。必要項目が欠損・非対応・曖昧・不安全な数値なら行を除外し、不要な項目の欠損は診断に残します。

`total` はページ指定前の一致数、`excludedRows` は必要値を使えない行数、`filteredRows` は条件不一致の行数です。`reasonCounts` は項目ごとの診断件数です。

同一期末の明示集合を対象とし、原本・条件は各100件までです。混在する期末・scope・基準・通貨、重複する会社・書類、同じentityの別会社への割当は拒否します。最新書類を自動選択する入口ではありません。

`inputXmlSha256` は解析したXML文字列のUTF-8表現の印です。原本真正性や申告した会社・書類IDとの対応までは証明しません。

## CLI

一覧JSONには相対ファイル名と上例のmetadataを指定します。相対パスは一覧JSONの場所が基準です。

```json
[{ "file": "company-a.xbrl", "metadata": {
  "secCode": "1001", "docID": "SYNTHETIC-IFRS", "instant": "2026-03-31",
  "scope": "Consolidated", "accountingStandard": "IFRS", "currency": "JPY"
} }]
```

```sh
node dist/cli.js screen-ifrs-bs --manifest files.json \
  --metrics noncurrentAssets,currentLeaseLiabilities \
  --sort-by currentLeaseLiabilities --order desc --pretty
```

`--metrics` 省略時は3項目です。一覧100件/2MiB、原本1件64MiB/合計256MiBまで、厳密なUTF-8と通常ファイルへの解決を要求します。UTF-8 BOMも解析・hashへ渡します。成功はJSONと終了0、入力不正は内容を転載しない定型stderrと終了1です。終了0でも除外理由を確認してください。

## 自動抽出・保存・SQL検索

DEIで当期・基準・scopeを解決する `createAutomaticFinancialSnapshots()` は、IFRSのBS8項目を記録します。[観測アーカイブ](../pipeline/OBSERVED_FINANCIAL_ARCHIVE.md)もこの結果を保存・cacheします。辞書版3（8項目化は版2、完全一致重複の採用は版3）がcacheの指紋に含まれるため、旧3項目の抽出cacheを新結果として使いません。旧世代を上書きせず、新しい索引世代を作ってください。新SDKは旧3項目の索引世代も読めますが、旧SDKは8項目を記録した行を拒否します。配布・切戻しでは、対応するSDKと索引世代を組にしてください。

`FinancialSearchIndex.screen()` は、`group: "balanceSheet"`・`accountingStandard: "IFRS"`・明示期末のcohortで追加IDを受け付けます。`metricIds` に必要な項目を指定し、条件・並べ替えにも同じIDを使えます。SQL側は指定項目だけを返します。旧世代に記録のない項目はタグ不在と推定せず、選択記録不足として拒否します。

```ts
const rows = index.screen({
  generation: "verified-generation", group: "balanceSheet",
  accountingStandard: "IFRS", scope: "Consolidated", currency: "JPY",
  period: { instant: "2026-03-31" }
}, {
  metricIds: [M.NoncurrentAssets],
  sortBy: M.NoncurrentAssets
});
```

<a id="今回は含めないもの"></a>

## 対象外と確認範囲

流動比率の自動計算、負債とリースの合算、外貨・単体・企業独自タグの代替は含めません。既存のJ-GAAP専用BS3 StoreへIFRSを混在させないでください。IFRSのPL/CFは[専用17項目](IFRS_FINANCIAL_DETAILS.md)を参照してください。

実4社・2期の追加5項目40選択について、28採用・12不在を独立XML処理で確認しました。採用28値はPDF7ページの表示とも一致し、当期のSQL14値・不在6件も独立処理で確認しています。実3社のbuilt CLIはAPIと一致しました。Node 26で現行全158ファイル・4,218テスト、build・公開型・保存保護5件が成功しています。詳細は[実装状況](../plans/IMPLEMENTATION_STATUS.md)を参照してください。稼働中の固定SDKへ、この作業コードを自動反映することはありません。

## 既存3項目の検証履歴

### 検索の確認結果（当時の記録）

> 以下は各検証を実施した時点の記録です。件数・配布先・未確認範囲を含めて読み、現在の稼働状態とは分けてください。

Node26.12.1/npm12.2.1で全2,194テスト（既存2,116＋API71＋CLI7）、本体と利用例の型検査、build、保存保護Python5件が成功しました。独立source522確認と入力固定等8確認、公開ESM/CJS各533確認（計1,066）、built CLI8確認も成功しています。

UTF-8 BOMを含む解析用hashと入力不変を確認しました。これらは合成入力の結果で、実IFRS原本・PDFとの照合や性能測定の結果ではありません。

lint設定はありません。

IFRSのPL/CF追加明細は[専用17項目](IFRS_FINANCIAL_DETAILS.md)で扱います。BS3の既存辞書/型/検索契約は変更していません。
