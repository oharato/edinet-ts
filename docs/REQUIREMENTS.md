# 提供機能と制約

このページは「何ができるか」「何を用意するか」「どこまで結果を信用できるか」を確認するための資料です。実行例は[README](../README.md)、内部の処理は[技術仕様](SPECIFICATIONS.md)を参照してください。

対象はリポジトリの現行コードです。実装済み・検証済み・配布済みは別の状態なので、利用する版は[実装状況](plans/IMPLEMENTATION_STATUS.md)で確認してください。

## 利用に必要なもの

| 用途 | 必要なもの |
| --- | --- |
| 共通 | Node.js 26.12.1以上、npm 12.2.1以上。TypeScriptまたはJavaScriptから利用可能 |
| 保存済み原本の解析 | XBRLファイル。APIキー・ネットワークは不要 |
| EDINETからの取得 | APIキーと `api.edinet-fsa.go.jp` へのHTTPS接続 |
| 過去の書類の検索 | 取得対象期間の書類一覧DB |
| 複数社の財務検索 | APIの入力形式に沿った保存データ集合 |

環境・DB互換性の詳細は[実行環境](development/RUNTIME_AND_SQLITE.md)を参照してください。

## 機能を選ぶ

| やりたいこと | 主な入口 | 対応範囲・前提 |
| --- | --- | --- |
| 書類を取得する | `EdinetXbrlDownloader` | API v2の一覧・取得を利用。ZIPを検査してXBRLを取り出す |
| 売上・利益などをまとめて読む | `getKeyMetrics()` | 主要18指標。既定の候補から探索するが、項目間の期間・範囲の一致は保証しない |
| 条件と出典を確認して値を読む | `selectMetric()` | 会計基準・期間・連結区分を明示。採用値と未採用理由を返す |
| 原本から基準・当期を判定する | `resolveFinancialReportingBasis()` | DEIと実contextを検査。対応する基準・様式だけを確定する |
| BS・PL・CF明細や計算指標を扱う | 財務の専用API | 指標ごとに基準・期間・単位・計算条件が異なる |
| 会社情報・開示表を読む | 会社・株主・役員・人的資本などの明細API | 直接記載と出典を保持。名称だけで法人や人物を同一視しない |
| 複数社を条件で探す | `screenFinancialSnapshots()` など | 明示した保存データを検索。入力形式はAPIごとに異なる |
| 取得結果を保存・公開する | アーカイブ・索引構築・公開API | 原観測・原本・抽出版を保持し、検索用の世代を構築する |

専用APIは[ドキュメント案内](README.md)から選んでください。定数や型に会計基準名が存在することは、その基準の全項目に対応していることを意味しません。

## 主要18指標

`getKeyMetrics()` の返値です。書類に値がない場合や候補から取得できない場合は `undefined` になります。

| プロパティ名 | 日本語項目名 |
| :--- | :--- |
| `netSales` | 売上高 / 収益 |
| `operatingIncome` | 営業利益 |
| `ordinaryIncome` | 経常利益 |
| `netIncome` | 当期純利益 |
| `netAssets` | 純資産 |
| `totalAssets` | 総資産 |
| `operatingCashFlow` | 営業CF |
| `investingCashFlow` | 投資CF |
| `financingCashFlow` | 財務CF |
| `cashAndEquivalents` | 現金同等物残高 |
| `earningsPerShare` | EPS (1株益) |
| `bookValuePerShare` | BPS (1株資産) |
| `equityToTotalAssetsRatio` | 自己資本比率 |
| `rateOfReturnOnEquity` | ROE |
| `priceEarningsRatio` | PER (株価収益率) |
| `payoutRatio` | 配当性向 |
| `numberOfIssuedShares` | 発行済株式総数 |
| `dividendPaidPerShare` | 1株当たり配当 |

J-GAAPとIFRSの候補タグを持ちますが、企業独自のタグや特殊業種を含む全書類への対応ではありません。候補と単位は[指標辞書](financial/METRIC_SELECTION.md)、既定の探索順は[主要指標の選択規則](SPECIFICATIONS.md#32-主要指標抽出ロジック-getkeymetrics)を参照してください。

`getKeyMetricsWithSources()` は同じ選択規則で値と出典を返します。`screenFinancialSnapshots()` は主要18指標に営業利益率・純利益率・FCFを加えて検索します。派生値は期間・範囲・通貨などを確認できる場合だけ計算します。[入力形式と21指標](financial/EDINET_DB_COMPARISON.md)に詳細があります。

## 本文のテキスト項目

`getQualitativeInfo()` は次のテキストブロックを読み、HTMLタグ・実体参照を処理した文字列を返します。有価証券報告書・四半期報告書・半期報告書などが対象ですが、項目の有無は書類によって異なります。

| プロパティ名 | 日本語項目名 | 主な内容 |
| :--- | :--- | :--- |
| `businessPolicy` | 経営方針等 | 経営方針、経営環境及び対処すべき課題 |
| `businessRisks` | 事業等のリスク | 事業展開上のリスク要因 |
| `financialAnalysis` | 経営者による分析 | 財政状態、経営成績及びキャッシュ・フローの状況の分析 |
| `businessDescription` | 事業の内容 | 事業の系統図や内容の説明 |
| `companyHistory` | 沿革 | 会社の沿革 |
| `researchAndDevelopment` | 研究開発活動 | 研究開発の状況 |
| `corporateGovernance` | ガバナンス | 統治の状況 |
| `operationsOverview` | 業績概要 | 業績等の概要 |
| `capitalResourcesAnalysis` | 資金流動性 | 資本の財源・資金流動性 |
| `criticalContracts` | 重要契約 | 経営上の重要契約 |
| `employeesInformation` | 従業員 | 従業員の状況 |

本文の構造化された表が必要な場合は[開示表のAPI](disclosures/DISCLOSURE_TABLES.md)を使います。テキスト化した結果から、表の行・列や注記との関係がすべて復元できるとは限りません。

## 基本情報・株主・元タグへのアクセス

| 入口 | 返すもの | 注意点 |
| --- | --- | --- |
| `getCommonMetadata()` | 提出者名・書類名・提出日など | `docID` は `parse(xml, docID)` で渡せる。省略時は空文字 |
| `getMajorShareholders()` | 大株主の名前・株数・比率の原値 | 比率の単位・基準日を確認するには[大株主明細](disclosures/MAJOR_SHAREHOLDER_DETAILS.md)を使う |
| `getLargeShareholdingInfo()` | 提出者・発行者・保有割合などの先頭候補 | 報告全体の合計とは限らない。[大量保有明細](disclosures/LARGE_HOLDING.md#report)で単位・分母・連名合計を確認する |
| `getJppfsCor()` | 財務諸表本表の型付き項目 | 型定義があっても、その原本に値があるとは限らない |
| `dataMap` | タグごとの候補値一覧 | `ReadonlyMap`。`.get()` / `.keys()` を使い、`Object.keys()` で列挙しない |
| `getDataListByTagName()` | 名前空間をまたぐ同名タグの候補 | 会社独自タグも含む。項目名が同じだけで会計上の意味を同一視しない |

生成された項目一覧は [jppfs_cor](generated/TAXONOMY_JPPFS_COR.md) / [jpcrp_cor](generated/TAXONOMY_JPCRP_COR.md) を参照してください。

## CLIでできること

| コマンド | 入力・処理 |
| --- | --- |
| `get` | 書類を検索・取得・解析してJSONを返す |
| `download` | 指定日や証券コードで書類を取得する |
| `parse` | 保存済みXBRLを解析する |
| `screen` | 保存済み `FinancialSnapshot[]` を条件検索する |

専用コマンドは `--help`、基本コマンドの出力項目は `get --help-types` で確認できます。実行例は[README](../README.md)を参照してください。

## 結果の扱いと限界

1. **値がないときは理由を残す。** 欠損を0で埋めたり、連結値がないため単体値へ切り替えたりするかはAPIの規則に従います。厳密選択は期間・範囲をまたいで補いません。
2. **原値と計算値を分ける。** 十進数文字列を保持し、安全に変換できる場合だけ `safeNumber` を返すAPIがあります。比率の百分率表示や通貨換算を一律に行う機能ではありません。
3. **訂正版の採用と値の合成を分ける。** 観測時点に応じた書類選択は行えますが、訂正差分と親原本を合成した完全版を自動作成するものではありません。
4. **検索対象と検証範囲を明示する。** テスト成功や一部原本との照合は、全市場の網羅性・正確性を保証しません。利用者が収集した範囲で検索します。

入力の検査・容量制限・保存の保護は[技術仕様](SPECIFICATIONS.md)、今後の対応は[計画](plans/EDINET_TS_ROADMAP.md)を参照してください。
