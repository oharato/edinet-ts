# 明示した実績一株値と終値による評価指標

保存済みの財務原本と終値から、実績PER・PBR・配当利回りを求めます。財務値と株価の株式基準、価格の対象日、情報を取得した時点を揃えることが前提です。

`calculateValuation(input, metricId)` と `screenValuation(inputs, metricId, options)` は、保存済みの財務原本と株価から次の値を計算します。

| metricId | 算式 | unit |
|---|---|---|
| `priceToAnnualEarnings` | 終値 ÷ 実績年次EPS | `multiple`（倍） |
| `priceToBookValue` | 終値 ÷ BPS | `multiple`（倍） |
| `annualPaidDividendYield` | 支払済み年次DPS ÷ 終値 | `ratio`（1=100%） |

定義はJPXの[PER](https://www.jpx.co.jp/glossary/ka/73.html)・[PBR](https://www.jpx.co.jp/glossary/ka/74.html)・[株価検索の指標説明](https://port.jpx.co.jp/jpxhp/portdocs/beginner_a_03.html)を参照。配当は[配当利回り](https://www.jpx.co.jp/glossary/ka/85.html)の考え方を使い、このAPIでは明示した実績・支払済み年額を固定します。

予想PER/予想利回りや、原本に掲載されたPER等の直接指標は変更しません。

## 入力と出典

```ts
const result = calculateValuation({
  financial: {
    xml, metadata, observedAt, // 財務原本を実際に観測したtimezone付き時刻
    shareBasis,               // 既存のShareBasis: 原注記を確認した宣言と参照hash
  },
  price: {
    rows,                    // 既存LocalPriceRow。OHLC等の追加列は読みません
    request: {secCode, asOf, knownAt, source: {name, sha256, observedAt}},
    shareBasis: {
      state: 'confirmed', shareClass: 'ordinary',
      basisDate: '2024-04-01', // 財務のShareBasisと同じ基準の識別日
      reviewedThrough: '2025-03-31', adjustment: 'unadjusted',
    },
    maxAgeDays: 3,            // 許容する終値の古さを必須指定
  },
}, 'priceToAnnualEarnings');
```

`metadata` は既存の財務明細形式です。EPS/DPSは連続12暦月のannual期間、BPSはinstantを指定します。J-GAAP/JPYだけを対象とし、四半期を年率へ換算しません。採用した元値・選択理由/全候補・原XML hash・両観測時刻・株価日/古さ/出来高/出典を返します。

`asOf` は価格の比較日、`knownAt` は利用できる情報の観測cutoffです。両者は別です。

後日取得した有報/株価キャッシュを古いcutoffへ戻して利用せず、財務期間が価格as-ofや財務の観測より未来でも計算しません。古いas-ofと現在のknownAtを指定すると、後日判明した実績による遡及的な計算です。

当時知り得た評価とは扱いません。最新決算の自動選択や財務の古さの判定は呼出元で行います。

## 株式基準の確認

[財務の一株基準](PER_SHARE_GROWTH.md)に加え、価格側でも選択した終値が未調整で、同じ普通株式の基準であることを宣言します。`reviewedThrough` は価格as-of以上かつknownAtの日本日付以下、`basisDate` は財務と同じでknownAt以下であることが必要です。

未知の場合は `{state:'unknown'}` とし、計算不可を返します。

基準の識別日は、取引日や分割効力日との大小だけで一致を判定するものではありません。権利落ち日は効力日より前になる場合があります。

利用者が原注記と価格の調整方法・企業行動を確認し、その価格as-ofまでに同じ基準で比較できると判断した宣言です。価格列名が`close`であることや、`adj_close`を使わないことだけでは未調整を証明できません。

過年度の配当を、分割後の価格へ無換算で組み合わせないでください。

結果の `declaration: 'source-reviewed-by-caller'` は、この意味上の確認が呼出元の責任であることを示します。APIは財務の注記参照・hash・entity・公式名前空間と観測時点を検査しますが、注記の意味、企業行動の完全性、価格そのものの真実性を認証しません。明示台帳による財務値の換算は後述の任意入力で対応します。企業行動台帳・価格基準の自動取得は残工程です。

## 計算不可と比較

- 元値の欠損/nil/曖昧/unsafe、未知基準、株価不在/競合/出来高0、観測cutoff違反、許容日数超過を補完しません。財務の完全一致重複だけは証跡付きで明示採用します。
- EPS/BPSが0以下ならPER/PBRを計算しません。配当0は利回り0を保持し、負配当は停止します。`dividendStatus:'paid'`だけを使い、予定/不明配当を時間経過で支払済みへ昇格させません。
- 財務のproof keyは連結/個別に合う経営指標表であることを要求します。金融業特例、IFRS/US-GAAPは未対応です。
- `value` は近似表示用、`exact` は開示原値と入力終値からの正確な分数です。比較・並び順は分数を使います。
- 検索は同じ財務期間・基準・scope・価格as-of・knownAt・許容日数の集合に限定。会社の重複/別会社の同じ書類IDを条件で隠さず拒否し、計算不可と条件不一致を分けます。企業ごとの採用取引日は結果に残します。
- 上限は100社・財務XML合計256MiB・価格合計100,000行、各XML64MiB・各社価格10,000行。SQL保存・CLI・市場/業種集計・公開利用先への接続は残工程です。

この追加は53eb2adより後に実装し、現在の固定配布物3cc4618へ反映済みです。

## 取得済み入力による検証

> 以下は各検証を実施した時点の記録です。件数・配布先・未確認範囲を含めて読み、現在の稼働状態とは分けてください。

2025-03-31の保存株価を明示し、後日の実観測時刻をknownAtにした遡及計算です。財務はエクシオS100W0NZ・ミライトS100VZQAの取得済み原本を使い、EPS/BPSはPDF2ページ、配当はPDF3/106/107ページの表・決議・支払日も確認しました。

| 入力 | 正確な分数 | 近似表示 |
|---|---|---:|
| エクシオ: 終値1,680円 / 2025年EPS128.97円 | 56,000/4,299 | 約13.0263倍 |
| エクシオ: 終値1,680円 / 2025年BPS1,551.71円 | 168,000/155,171 | 約1.08268倍 |
| ミライト: 支払済み2024年DPS65円 / 終値2,178円 | 65/2,178 | 約2.98439% |
| ミライト: 2025年DPS75円 | 計算不可 | 原本の予定額40円を含む |

4入力の選択値・context/entity・原XML/注記/価格ファイルhash、3算式と予定配当の除外を独立Python/XML・source/built/CommonJSで照合しました。株価は元キャッシュのコピーを使い、元ファイルは変更しません。

配布元Yahooの履歴APIを無認証の2リクエストで再取得し、2社×3日分の終値と円通貨を確認しました。計算API自体は通信しません。

取引所の独立した公式終値との照合とは区別します。

ミライトの掲載単体PER19.87倍に対し、同じ原本のEPS108.40円と保存/再取得終値2,178円からの単純計算は約20.0923倍です。差の原因・掲載指標の価格/算定基準は未確定で、どちらかを自動訂正せず別値として保持します。全銘柄の価格や企業行動の検証完了とは扱いません。

検証: ビルド後の全141ファイル/3,786テスト・公開NodeNext型（`--types node`、型定義検査を省略しない）・実入力4計算/4検索のsource/built/CJSと独立処理が成功。初回全回帰では前工程で生成された型の`import("..")`残存を検出し、共通後処理で`../index.js`等へ解決する修正と回帰試験を追加した後、ビルド→全件再実行を完了しました。

### 明示した価格の株式基準へ財務値を換算する

`ValuationInput.splitLedger` に [分割換算の確認済み台帳](PER_SHARE_GROWTH.md) を指定すると、財務の一株値を `price.shareBasis.basisDate` へ換算してPER・PBR・支払済み配当利回りを計算します。`calculateValuation` と `screenValuation` で同じ入力を使います。価格as-of・knownAt・財務の観測時刻は元の入力から使い、換算後の正確分数で計算・検索します。

```ts
const result = calculateValuation({
  ...input,
  splitLedger: reviewedLedger,
}, ValuationMetricId.PriceToAnnualEarnings);
```

価格の `shareBasis` は引き続き明示確認が必要です。株価そのものや取引日は変更せず、権利落ち日と効力日から価格の基準を自動推定しません。既に遡及調整された財務値は、その宣言された基準日以後だけを換算します。`shareAdjustment` に元値・換算分数・出典・適用イベントを残し、財務selectionと未調整終値を保持します。

省略時は従来どおり財務・価格の同一基準を要求します。未知の台帳、確認範囲不足、後日観測、銘柄違いを推測で補いません。複数社検索では各入力へ各社の台帳を渡し、非分割企業も確認済みの空台帳で統一できます。年額DPSに異なる株式基準が混在する場合は [明示台帳からの年額再構成](PER_SHARE_GROWTH.md#異なる株式基準が混在する年額配当の再構成) を使えます。この評価指標APIへの入力接続、台帳や権利落ち日の自動取得、価格調整は残工程です。
