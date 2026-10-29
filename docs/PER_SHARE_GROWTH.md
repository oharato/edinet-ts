# 株式基準を確認したEPS・実績配当の成長率

`calculatePerShareGrowth(pair, metricId)` / `screenPerShareGrowth(pairs, metricId, options)`は、EPSと支払済み配当の前年比を扱います。IDは`PerShareGrowthMetricId.EarningsPerShare` / `.DividendPerShare`です。

`calculateCagr(documents, CagrMetricId.EarningsPerShare)` / `.DividendPerShare`と`screenCagr`は同じ根拠付き入力からCAGRを計算します。3年には連続する4原値が必要で、中間年の欠損や基準未確認も除外します。従来の売上/利益CAGRの入力と既定選択は維持します。

## 入力する株式基準

各`PerShareAnnualDocument`は`xml`、J-GAAP/JPYのannual `metadata`、`shareBasis`を持ちます。

```ts
shareBasis: {
  state: "confirmed",
  shareClass: "ordinary",
  basisDate: "2024-04-01",
  proof: {
    key: "jpcrp_cor:BusinessResultsOfGroupTextBlock",
    contextRef: "FilingDateInstant",
    rawSha256: "...64桁のSHA-256..."
  }
}
```

基準未確認は`{ state: "unknown" }`として計算不可を返します。確認済みと宣言する場合は、原注記で基準日・普通株式・遡及調整の対象年を確認します。proofは原本内の「連結経営指標等」または「提出会社の経営指標等」のTextBlockを参照します。hashはparserの`rawValue`（解析時の外側空白処理後）からUTF-8で作成します。

APIは参照factの一意性・公式namespace・nil・hash・context/entity・基準日と注記時点を検査し、`shareBasis.status: "reference-matched"`と`declaration: "source-reviewed-by-caller"`を返します。基準の意味・支払状態・会計方針の比較可能性は、呼出元が原注記で確認する宣言です。hash一致は参照一致の検査です。

系列内の全点に同じ`basisDate`/普通株式の基準が必要です。既に遡及調整されたEPSは、その共通基準の値を使います。異なる基準の値は計算不可で、調整後株価や株式数の比から分割を推測しません。分割イベントによる自動換算は別工程です。

配当にはさらに`dividendStatus: "paid" | "proposed" | "unknown"`を宣言します。`paid`だけを実績計算へ使い、一部に予定額を含む年額は`proposed`です。時間の経過だけで支払済みへ昇格させません。記念配当等の内訳は自動で取り除きません。

## 算術・検索

前年比は`(当期−前期)/前期`で、前期は正値が必要です。EPS前年比は当期損失も計算し、配当0への減配は-100%です。負の配当は扱いません。CAGRは全点非負・基数正に限定します。

前年比の`exact`は増減率の分数、CAGRの`exact`は`{ numerator, denominator, root }`による倍率の累乗根です。表示`value`は小数1=100%の近似です。条件と順序は厳密分数で比較し、EPS前年比の-100%未満も扱います。

系列内の会社/entity・scopeと期間の連続性、企業間での対象期・基準/通貨の一致を検査します。完全一致する有効な重複factだけはこの新規計算で明示採用し、全evidenceを保持します。異値・精度違い・nil混在・安全なnumberにできない入力は計算しません。既存主要指標の`selectMetric`や売上/利益CAGRの既定動作を変更しません。

## CLI

- `screen-eps-growth --manifest pairs.json`
- `screen-dividend-growth --manifest pairs.json`
- `screen-cagr --metric earningsPerShareCagr --manifest series.json`
- `screen-cagr --metric dividendPerShareCagr --manifest series.json`

前年比manifestは`[{previous:{file,metadata,shareBasis},current:{file,metadata,shareBasis}}]`、CAGRは`[[{file,metadata,shareBasis},...],...]`です。条件は`[{"operator":"gte","value":0.1}]`等です。読取り容量・件数制限、相対fileの解決、非表示の入力エラー、除外と条件不一致の区別を維持します。基準不明等は計算不可の診断として返します。

## 取得済み原本の限定照合

エクシオ`S100W0NZ`のPDF2/3ページを描画し、表と注記を確認しました。2024-04-01の1→2分割について、EPSの過年度値は遡及調整、過年度配当は当時の株式数の記載です。2025年3月期の配当63円には総会承認前の予定額が含まれます。

| 計算 | 対象年/原値 | exact |
|---|---|---|
| EPS前年比 | 2024年94.76→2025年128.97、分割後基準 | 3421/9476 |
| EPS 3年CAGR | 2022〜2025年、125.32/103.22/94.76/128.97 | (12897/12532)^(1/3)−1 |
| 実績配当前年比 | 2023年102→2024年120、分割前基準 | 3/17 |
| 実績配当3年CAGR | 2021〜2024年、82/96/102/120、分割前基準 | (60/41)^(1/3)−1 |
| 予定額を含む配当 | 2025年63 | proposed-dividendで除外 |

EPSは収益認識基準適用後の2022年からを選びました。配当には記念配当を含む年があり、記載された年額のままです。独立Pythonで9原値・14点参照・2前年比分数・2CAGR倍率/高精度小数・2注記hashが一致しました。全市場、他の株式種類、分割をまたぐ配当の自動換算や掲載成長率との一致を示すものではありません。

この追加はe673e8aの後に実装し、現在の固定配布物3cc4618へ反映済みです。

検証: 追加後の全81ファイル・2,700テスト（1ワーカー）、build、公開API型検査が成功しました。
