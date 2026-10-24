# EDINET DB と edinet-ts の比較・改善

調査日: 2026-10-22。基準コード: `oharato/edinet-ts` の `b2adab5`（PR #19 merge後）。
本資料では単一銘柄の取得と、複数銘柄の検索を別々に評価する。

## 調査後に進んだこと（2026-10-24）

上の基準日と、以下の初期比較表は当時の記録です。現在の追加状況は次のとおりです。EDINET DBの認証APIとの実測照合は引き続き未実施です。保存JSONの`screen`の21指標は維持し、新APIを同じ21項目へ無理に混ぜていません。

| 分野 | 1社から読める情報 | 複数社の検索 | 状態・範囲 |
|---|---|---|---|
| BS3・流動比率 | 流動資産/流動負債/負債合計、分数で計算する流動比率 | 原本のメモリ検索と専用SQLite試作で条件・順序・ページ | main完了。日本基準/円/同一期末・範囲。保存/差分/再解析比較と有限品質runnerもmain |
| 追加財務5項目 | 固定資産/固定負債/現金及び預金、売上原価/販管費 | 時点項目と期間項目を分けた明示集合の検索 | #37でmain。原XML20項目突合、独立PDF照合は未実施 |
| 売上高前年比 | 連続12暦月の前年/当年から算出 | 正確な分数で条件・順序・ページ | #38でmain。実2社は候補重複で不可、別保存fixture1社の算術を確認。実複数社ランキングは未検証 |
| CF明細3項目 | 営業CF調整の減価償却費、有形固定資産取得支出、有形・無形合計取得支出 | 必要な項目を明示して検索 | #39でmain。実2社2期間で8原値一致、合計支出4対象は欠損。合算・代用なし |
| 借入/社債/リース7残高 | 各直接タグの残高。合計は作らない | 期末項目を明示して検索 | この版で追加。実56組中34採用、残りは欠損理由保持。PDF独立照合は未実施 |
| 会社情報6項目 | 会社名、EDINET/証券コード、会計基準名、当期開始/終了 | 専用の属性検索・企業履歴はまだない | #40でmain。出典・原文・項目間整合性。業種/市場のマスターや公式コード認証は未実装 |
| 平均年間給与 | 提出会社単体のJPY原値と出典 | 同一期末・範囲の明示集合で条件・順序・ページ | #41でmain。注記の対象社員/賞与等を自動推定せず、従業員数と混ぜない |

どの検索も、全市場のデータが自動で揃う機能ではありません。2025年別提出XBRLの追加取得は未完了で、2026年有報の前年列と区別します。会社情報や人的資本、追加財務明細のSQL保存は未実装です。詳しい仕様と残課題は[全体計画](plans/EDINET_TS_ROADMAP.md)、[直接財務項目](FINANCIAL_DETAILS.md)、[会社情報](COMPANY_PROFILE.md)、[人的資本](WORKFORCE.md)を参照してください。

## 調査方法と範囲

- 公式資料: [API概要](https://edinetdb.jp/developers)、[API reference](https://edinetdb.com/docs/api-reference)、[OpenAPI](https://edinetdb.com/v1/openapi.json)、[スクリーナー](https://edinetdb.jp/screener)。認証APIは実行していない。
- `src/edinet-xbrl-object.ts`、`src/types/*`、`src/edinet.ts`、`src/db/*`、`src/cli.ts`、`test/*` を調査。
- 既存保存DBを読み取り専用で調査し、書類メタデータのみで財務値の永続テーブルがないことを確認。

EDINET DB は正規化済みの財務データサービス、edinet-ts はローカルXBRLのパーサーとEDINET取得ライブラリであり、同じデータを全社分保持しているわけではない。型定義に項目があることは、その銘柄の値を取得済み・欠損なく抽出可能という意味ではない。

## 軸1: 一銘柄から取得できる情報

分類: **既存可能**=公開APIで抽出できる、**生データあり/未正規化**=保存XBRLにあれば低レベルAPIで読めるが専用の正規化出力がない、**未取得**=当ライブラリに取得基盤がない、**追加計算**=元データに加え定義・計算が必要。複数分類は併存する。

| 情報群 | EDINET DB の主なAPI/内容 | edinet-ts 調査時の状態 | 今回/次段階 |
|---|---|---|---|
| 会社情報 | companies/detail/profile: コード、名称、業種、会計基準、所在地等 | **既存可能**: `getCommonMetadata()` の書類ID・名称・EDINETコード・タイトル・提出日。DBは証券コード・提出者名等。**生データあり/未正規化**: DEI、表紙。外部企業マスター/現行市場区分等は**未取得** | 業種/市場を財務指標だけから推測しない |
| PL/BS/CF | financials: 売上・利益、流動/固定資産、負債、借入、費用、CF等 | **既存可能**: `getKeyMetrics()` 18項目。`getJppfsCor()`（1849型プロパティ）/`getJpcrpCor()`（2416）と raw APIで追加タグ取得。負債・流動資産等は**生データあり/未正規化** | IFRS独自タグの欠損あり。型プロパティ数を正常取得できる指標数として数えない |
| 年次時系列 | financials `years`、ratios | **既存可能**: `getFinancialHistory(ticker, years, docType)`。DB書類を期間末降順に選び、各XBRLを取得/解析。低レベル `getData` のCurrent/Prior1Year/Prior2Yearもあり | historyの`years`は実装上書類件数で、完全な年数/訂正統合の保証なし。キャッシュ欠損時はネットワーク取得し得る |
| 四半期/半期 | quarterly=YTD、quarterly_standalone=差分計算、earnings=短信/予想 | **既存可能**: 140/160の書類解析・定性テキスト。**追加計算**: YTD差分による単四半期。**未取得**: 短信/IR PDF・予想データ | 年次、半期累計、単四半期を混在させない。前期欠損を0としない |
| 指標 | ratios/analysis: 利益率、ROA/ROIC、成長率/CAGR、評価スコア等 | **既存可能**: XBRL掲載のROE・自己資本比率・PER・配当性向・EPS/BPS等。多くは**追加計算** | 今回: 営業利益率・純利益率・FCF。平均資産/自己資本を要するROA/ROE、CAGRは次段階 |
| 株価/分割調整 | ratios: PBR/時価総額/EV等、調整後EPS/BPS/配当 | 掲載PERを除き、株価・分割履歴は**未取得**。**追加計算**も必要 | 別データ源の設計が先。EDINET DBの株価由来値も有報期末基準でリアルタイムではない |
| 定性情報 | text-blocks/text-analysis | **既存可能**: `getQualitativeInfo()` の11種類（方針、リスク、経営分析、事業、沿革、R&D、ガバナンス、業績概要、資金流動性、重要契約、従業員）。HTML除去あり | 全文検索インデックス・テーマ分析/分類はなし |
| 大株主/大量保有 | major-shareholders=有報トップ10、shareholders=大量保有、shareholder-categories | **既存可能**: `getMajorShareholders()` の名称/株数/比率。`getLargeShareholdingInfo()` の提出者/発行者/保有割合/前回割合。分類別株主や共同保有人数は未正規化 | 大株主の個別取得と、保有者からの逆引きを分ける |
| 人的資本 | workforce、年収、年齢、女性管理職、男女賃金差、育休 | 従業員数/年齢/年収/女性役員/管理職/賃金差等の標準タグ定義あり。**生データあり/未正規化**。従業員テキストは既存可能 | 平均年収等は提出会社単体と連結従業員を区別。単位と欠損理由を付けて抽出する段階が必要 |
| ガバナンス | governance-summary/directors/director-compensation/audit-fees | 定性テキストと標準タグは取得可能、役員明細/報酬/監査報酬の統一構造は**生データあり/未正規化** | 取締役だけ/監査役含む、就任予定/当期を区別 |
| ESG | GHG scope1/2/3 | jpcrpにGHGタグ定義あり。保存XBRLに存在する場合はraw取得可、専用出力は**未正規化** | 境界・期間・排出単位を揃える。本文由来の推測を構造化値に代用しない |
| セグメント/受注/費用/顧客/関係会社 | segments/expenses/order-backlog/main-customers/subsidiaries/parents/related-party-transactions | raw/contextで値・TextBlock取得は可能。専用明細・会社名照合・グラフは**未正規化**。外部法人/LEI補完は**未取得** | context次元・注記表の正規化が必要 |
| 政策保有株 | cross-shareholdings | 注記タグ/表があればraw取得可能、銘柄別正規化・履歴は**未正規化** | issuer名の品質管理、非上場との区別が必要 |
| 不動産/設備 | real-estate/facilities、土地・建物・含み益・公示地価 | BSの土地/建物等はtyped/raw取得可能、物件表は未正規化。地価・住所照合は**未取得** | 地価評価や物件結合には追加データ源が必要 |
| 履歴/開示差分/IR | history/changes/disclosures、IR sections/KPI | 書類メタデータの一覧と沿革テキストは既存可能。項目差分・イベント分類・PDF IRは**追加計算/未取得** | EDINET DBのIR機能もpreview。`ir/kpis`は公式に現在全404との記載があり、提供を保証しない |

## 軸2: 複数銘柄の検索・条件・並べ替え

| 検索項目 | EDINET DB | edinet-ts 調査時 | 今回の改善後 |
|---|---|---|---|
| 企業名/証券コード/書類種別/提出日 | search/companies、events等 | `EdinetRepository.findDocuments`: 証券コード完全一致、提出者部分一致、書類種別、提出日の上下限、limit。`period_end DESC`固定。filerNameはSQL LIKEで `%`/`_` がワイルドカード | 既存仕様を保持 |
| 売上/利益/資産/CF/EPS/配当等 | screener + rankings | 財務条件は未対応。DBに財務列なし | 保存済みsnapshotの主要18項目すべてにAND条件・昇降順・ページング |
| 営業利益率/純利益率/FCF | screener + rankings | 追加計算が必要 | 3指標を計算し、同じ条件/並べ替えに利用 |
| 成長率/CAGR/ROA/ROIC/効率/負債 | screener + rankings（対応集合は別） | タグ抽出または複数期間から追加計算が必要 | 未実装。平均残高や期の連続性が必要 |
| 業種/市場/会計基準/決算月 | screener/companies | 専用の企業マスター/検索APIなし | 未実装。財務snapshotはこの情報を補完しない |
| 人的資本/GHG/ガバナンス/不動産/関係先件数 | screener、専用詳細API | 生データの有無と正規化が必要。財務DB検索はない | 未実装。全項目横断検索できるとは扱わない |
| 顧客名/子会社名/大量保有者逆引き | main-customers/search、subsidiaries/search、shareholders/search/history等 | 提出者名検索はあるが、顧客/子会社/保有先逆引きとは異なる | 明細インデックスが必要 |
| 業種比較/開示差分/イベント | industry-benchmarks/disclosures/search/events | 書類種別イベント検索のみ、比較・差分は未対応 | 別段階 |

今回の検索対象は**呼び出し側が渡した集合**のみ。全市場のデータ充足率・更新頻度・抽出品質は保証しない。DB全件を勝手に再取得・再解析する機能は追加していない。

### 公式仕様で区別すべき点

- 宣伝上のスクリーナー146指標と、調査時UIの150選択肢、ランキング49指標は異なる集合。認証APIで150指標の動作確認をしたという意味ではない。
- OpenAPIのCompany 33 / Financial 187 / Ratio 97プロパティには来歴・品質情報・算出値が含まれる。生数値の種類数やedinet-tsの型プロパティ数と直接比較しない。
- screenerはAND、`gte/lte/gt/lt/eq`。通常は条件1件以上が必要で、sort/orderだけは400。sort既定は最初の条件、orderはdesc。limitは既定100/最大500、offsetは0。`preset=ma_targets` は独自条件を使う特殊系。
- `industry`は日本語名の完全一致。会計基準はOpenAPI/UIで`JP/IFRS/US`、概要ページで`jp_gaap/ifrs/us_gaap`と表記不一致。市場もOpenAPI/UIのprime/standard/growthに対し概要にはtpmあり。実API未検証につき同一と断定しない。
- `business_tags`は2026-08-17撤去、引数は受理されても無視。新機能の対象にしない。
- 2026-10-21更新では本文解析由来の女性管理職/育休指標に配信停止の注意がある。構造化XBRLとの出所を混ぜない。
- Freeでも全endpoint/fieldが使えるが100req/日。本作業はキー利用・認証API呼び出し・有料利用をしていない。

## 今回追加した独立機能

`src/financial-screening.ts` の `calculateFinancialMetrics`、`screenFinancialSnapshots`、`FINANCIAL_SCREENING_METRICS` をトップレベルからexport。CLI `screen` は同じ関数を使用する。`FinancialHistory.metrics` は実際の返値に合わせ `KeyMetrics` 型にした。既存KeyMetricsの値の選択規則・DBスキーマ・ダウンロード動作は維持する。追加API `getKeyMetricsWithSources()` は実際に選んだfactのタグ/context・期間・scope・単位を返す。パーサーはISO 4217名前空間URIから単純通貨単位を解決し、unitRefの名前からは推測しない。

### 指標辞書

全21項目はnumber（欠損はundefined、JSON入力のnullも欠損扱い）。全てfilter/sort可。D=対象期間のフロー、I=期末、S=有報掲載サマリー。数値は自動的に単位変換しない。標準的な円建てXBRLでは金額=円、EPS/BPS/配当=円/株。率は小数（0.1=10%）。財務金額を百万円、年収を万円、率を百分率で扱うEDINET DB UIとは区別する。

| edinet-ts項目 | 意味/単位 | 期間 | ソース・式 |
|---|---|---|---|
| netSales | 売上高/収益・円 | D | KeyMetrics、J-GAAP/IFRSサマリー |
| operatingIncome | 営業利益・円 | D | KeyMetrics、標準/IFRSタグ。IFRS独自タグは欠損し得る |
| ordinaryIncome | 経常利益・円 | D | KeyMetrics、J-GAAP。IFRSでは通常未定義 |
| netIncome | 親会社帰属利益・円 | D | KeyMetrics、J-GAAP/IFRS |
| netAssets | 純資産/IFRS親会社持分・円 | I | KeyMetrics、会計基準で意味差あり |
| totalAssets | 総資産・円 | I | KeyMetrics、J-GAAP/IFRS |
| operatingCashFlow | 営業CF・円 | D | KeyMetrics、J-GAAP/IFRS |
| investingCashFlow | 投資CF・円 | D | 同上 |
| financingCashFlow | 財務CF・円 | D | 同上 |
| cashAndEquivalents | 現金同等物・円 | I | KeyMetrics。現預金BS勘定とは別 |
| earningsPerShare | EPS・円/株 | D/S | KeyMetrics、分割調整の統一なし |
| bookValuePerShare | BPS・円/株 | I/S | 同上 |
| equityToTotalAssetsRatio | 自己資本比率・小数 | I/S | 掲載値、純資産から再計算しない |
| rateOfReturnOnEquity | ROE・小数 | D/S | 掲載値。平均自己資本からの計算ROEとは別 |
| priceEarningsRatio | PER・倍 | S | 掲載値のみ。現在株価から計算しない |
| payoutRatio | 配当性向・小数 | D/S | 掲載値 |
| numberOfIssuedShares | 発行済株式数・株 | I/S | 掲載値。自己株控除/分割調整を行わない |
| dividendPaidPerShare | 一株配当・円/株 | D/S | 掲載値 |
| operatingMargin | 営業利益率・小数 | D | operatingIncome / netSales |
| netMargin | 純利益率・小数 | D | netIncome / netSales |
| freeCashFlow | FCF・円 | D | operatingCashFlow + investingCashFlow（投資CFを符号のまま加算） |

欠損理由: 既存18項目はタグ欠損、会計基準差、対象context不在などをundefinedで返し、理由コードはまだない。追加比率は分子/分母欠損、非有限値、売上0以下でundefined。FCFは片側欠損/非有限値/計算overflowでundefined。加えて両値の来歴（contextRef・期間開始/終了・scope・ISO 4217通貨）が揃い、完全一致する場合だけ計算する。来歴不明/不一致やsnapshotの期末不一致、periodType不明は計算せず、`unavailableDerivedMetrics`に項目名を返す。欠損を0で代用しない。

連結範囲: `getKeyMetrics` の金額/CFは連結scopeを選んだ後、タグ欠落を理由に単体へ降りない。一株/比率等は既存の互換探索で単体も使う。さらにDuration/Instantで選択scopeが異なり得る。このため新規計算は同一context・期間・scope・通貨を検証できるPL同士/CF同士のみに限定する。`getKeyMetrics()`だけの値では計算しない。新APIでも会計基準・年次/YTD分類・分割調整の統一や欠損理由コードは未整備。単位が複合形式の場合や単純通貨単位の名前空間を解決できない場合は通貨未確定となる。

### 入力と選択規則

`FinancialSnapshot[]` は `secCode, docID, docTypeCode, periodEnd, submitDate, metrics` が必要。
派生値を利用するには `metricSources`（新APIから取得）と `periodType`（annual/ytd/quarterly）も指定する。選択された銘柄間で、既知のperiodTypeが異なる場合、または条件・並べ替えで利用する指標（派生値ならその元指標）の既知のscope/通貨が異なる場合はエラーとする。来歴不明のraw18値の検索は互換入力として許すが、数値比較に限られ、意味的に比較可能とは検証できない。来歴で期間長を把握できる場合、比較対象の長さが7日を超えて異なると拒否する（閏年・52/53週の小さな差は許容）。会計基準、変則決算の経済的比較可能性、分割調整、raw値の不明なscope/単位は自動補完できない。書類種別だけで年次/YTDを推測せず、periodTypeは元書類に従って指定する。入力は各書類につき1件とする。同一docIDの矛盾する複数snapshotは渡さない。

1. 証券コード4桁は末尾0を補う（英字を含む銘柄にも対応）。既定書類種別は120、`docTypeCode`で切替可能。
2. `asOf`があれば提出日と決算日の両方を上限で制限。日付指定は当日全体、時刻指定は同じローカル時刻表現で比較。タイムゾーン付き日時は受け付けない。時刻指定cutoffの当日に提出日しか保存されていない行は、未来情報混入を避けるため除外する。日付指定なら当日行を含む。過去時点の訂正反映前データが保存されている保証はなく、厳密なpoint-in-timeデータベースではない。
3. 銘柄ごとにperiodEnd→submitDate→docIDの降順で最新1件を選ぶ。日付のみのsubmitDateは同日の00:00:00相当で順位付け。訂正有報130を120へ自動統合しない。
4. その最新1件に条件をAND適用。欠損値は条件不一致。条件なしの一覧/順位取得も可能（EDINET DB APIとの差）。
5. `sortBy`指定時は既定desc、欠損は昇降順とも末尾。同値とsort未指定は証券コード昇順。offset→limit。limit=0は空配列、未指定は全件（同APIと異なる）。

JSONの数値文字列・非有限値、不正な日付/指標/演算子/負のlimit等はエラー。raw JSONの値を暗黙に単位変換しない。

### ローカルファイルからの使用例

保存XBRLを解析してsnapshotを構築する。以下のメタデータは説明用であり実在銘柄のデータではない。`getFinancialHistory`はキャッシュ欠損時の取得があるため、完全オフラインではparserを直接使用する。

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { EdinetXbrlParser, screenFinancialSnapshots, type FinancialSnapshot } from "edinet-ts";

const parsed = new EdinetXbrlParser().parse(readFileSync("./saved-report.xbrl", "utf8"));
const extracted = parsed.getKeyMetricsWithSources();
const snapshots: FinancialSnapshot[] = [{
  secCode: "11110", docID: "EXAMPLE", docTypeCode: "120",
  periodEnd: "2024-03-31", submitDate: "2024-06-25",
  periodType: "annual", // 元書類が通期であることを確認
  ...extracted // metrics と metricSources を一緒に保存
}];
writeFileSync("./snapshots.json", JSON.stringify(snapshots));
const result = screenFinancialSnapshots(snapshots, {
  conditions: [{ metric: "operatingMargin", operator: "gte", value: 0.1 }],
  sortBy: "freeCashFlow", order: "desc", limit: 20
});
```

```sh
edinet-ts screen --file ./snapshots.json \
  --conditions '[{"metric":"operatingMargin","operator":"gte","value":0.1}]' \
  --sort-by freeCashFlow --order desc --as-of 2024-12-31 --limit 20 --pretty
```

入力JSONや出力は利用者のローカルデータとして保持し、Gitへ追加しない。新しい`screen`の処理はネットワーク・SQLite・認証キーを使用しない。

## 段階的な拡張方針

1. **今回**: 18既存指標+3計算指標、明示snapshotを横断検索、オフラインCLI、選択factの来歴API・単純通貨単位解決・派生値の整合性検証、型修正とテスト。新スキーマ・依存・費用・認証変更なし。
2. **次の小規模段階**: 今回のタグ/context/scope/期間/単純通貨単位の来歴を、会計基準・複合単位・年次/YTD分類・欠損理由まで拡張する。BS負債・流動項目・人的資本の専用抽出、複数期間の連続性検査と成長率/CAGR。既存KeyMetrics互換は維持。
3. **事前設計・報告が必要**: 永続財務インデックス（保存容量、訂正/削除、再解析移行）、全社更新、業種マスター・価格/分割履歴・法人/地価の外部データ結合、PDF/注記表正規化。大きなスキーマ・外部依存・認証/費用変更は別途判断。本作業で行っていない。

stock-dataは固定vendorを利用するため、この変更が自動反映されるわけではない。別途パッケージ更新・統合検証が必要。残作業の依存・受入条件は [改善計画](plans/EDINET_TS_ROADMAP.md) を参照。配布・release・定期運用の変更はこの第1段階に含めない。

## 検証

既存207テストを維持し、追加テストでAND/全比較演算子/最新選択/同日提出時刻/欠損/0/負数/並べ替え/ページング/asOf/英字コード/書類分離/入力検証/CLI正常・異常系を確認。同梱の任天堂・ソフトバンク2024 XBRLを用い、連結営業利益の欠損時に単体値を混入せず、利益率条件から除外することを確認する。

2026-10-22の最終確認: `npm run build`成功、`tsc --noEmit`成功、`npm test -- --reporter=dot`は14ファイル/255テスト成功（既存207+新規48）、`git diff --check`成功。ビルド済みCLIについても、合成XBRL→来歴付きJSON準備→利益率条件での検索を確認した。最終レビューで未知来歴の派生値抑制、混在拒否、通貨単位解決、時刻cutoffの保守的扱いを追加した。lint設定・lint scriptは存在しないため、lintは未実施。EDINET DB認証APIとの値の一致、全市場・最新データ、stock-data vendor統合、実保存DB全件の財務充足率検証は未実施。
