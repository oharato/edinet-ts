# 提供機能と制約

このページは「何ができるか」「何を用意するか」「どこまで結果を信用できるか」を確認するための資料です。実行例は[README](../README.md)、内部の処理は[技術仕様](SPECIFICATIONS.md)を参照してください。

対象はリポジトリの現行コードです。実装済み・検証済み・配布済みは別の状態なので、利用する版は[実装状況](plans/IMPLEMENTATION_STATUS.md)で確認してください。

## 誰の、何を解決するか

対象は、EDINET原本を自分で確認・解析する開発者と、収集範囲を固定して企業比較や定期更新を行う利用者です。原本ごとの独自タグや期間・連結区分を区別し、値だけでなく採用理由と出典を追えることを目指します。

主な利用目的は「保存済み1原本を通信なしで読む」「条件を揃えて値を選ぶ」「明示した複数社を検索する」「原本と解析結果を保持して更新・再開する」です。全市場データの同梱、未知の会計基準・形式への自動対応、訂正差分からの法的全文再構成、欠損の推測補完、投資判断の代行は現行の提供範囲に含めません。追加対象は[ロードマップ](plans/EDINET_TS_ROADMAP.md)で管理します。

以下の受入条件は現行APIの契約です。関連テストはその条件を確認する入口であり、実データ全件や全形式で検証済みという意味ではありません。

| 機能要件               | 受入条件                                                                                                  | 仕様・関連テスト                                                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 保存済み原本の解析     | APIキーや通信なしでXMLを読み、値がない項目を0で作らない                                                   | [主要指標の規則](SPECIFICATIONS.md#32-主要指標抽出ロジック-getkeymetrics)、[XML解析テスト](../test/edinet-xbrl-parser.test.ts)・[範囲テスト](../test/key-metrics-scope.test.ts) |
| 条件付き数値の選択     | 期間・基準・scope・単位を確認し、原値・根拠と不採用理由を返す                                             | [選択API](financial/METRIC_SELECTION.md)、[数値選択テスト](../test/metric-selection.test.ts)                                                                                    |
| 原本の取得             | 対象書類のZIPを検査し、破損・危険な展開先・容量超過を成功扱いにしない                                     | [取得の保護](pipeline/DOWNLOAD_SAFETY.md)、[ZIP境界テスト](../test/zip-downloader-boundaries.test.ts)                                                                           |
| 保存JSONの検索         | 明示されたsnapshot集合から銘柄ごとの最新書類を選んで条件・順序・件数を適用し、原本取得やXML再解析をしない | [JSON検索](financial/EDINET_DB_COMPARISON.md)、[検索テスト](../test/financial-screening.test.ts)                                                                                |
| 解析結果の保存と再利用 | 原本hash・解析版・条件が同じ結果を再利用し、同一キーの異なる結果を拒否する                                | [解析済みStore](pipeline/PARSED_FINANCIAL_STORE.md)、[保存テスト](../test/parsed-financial-store.test.ts)                                                                       |
| 世代構築と正式公開     | DuckDBの正式公開経路で候補指紋・原本照合記録を検査し、期待する直前候補と違う切替を拒否する                | [公開・照合](pipeline/DUCK_FINANCIAL_VERIFICATION.md)、[照合gateテスト](../test/duck-financial-verification.test.ts)                                                            |
| 開示表・履歴の読取り   | APIごとの期間・単位・来歴と訂正選択を保ち、名称だけで法人や人物を結合しない                               | [領域別API](README.md)、例：[大量保有取引テスト](../test/large-holding-transactions-store.test.ts)                                                                              |

## 利用に必要なもの

| 用途               | 必要なもの                                                                  |
| ------------------ | --------------------------------------------------------------------------- |
| 共通               | Node.js 26.13.0以上、npm 12.2.1以上。TypeScriptまたはJavaScriptから利用可能 |
| 保存済み原本の解析 | XBRLファイル。APIキー・ネットワークは不要                                   |
| EDINETからの取得   | APIキーと `api.edinet-fsa.go.jp` へのHTTPS接続                              |
| 過去の書類の検索   | 取得対象期間の書類一覧DB                                                    |
| 複数社の財務検索   | APIの入力形式に沿った保存データ集合                                         |

共通条件の正本は [`package.json`](../package.json) の `engines` / `packageManager` と [`.node-version`](../.node-version) です。環境・DB互換性の詳細は[実行環境](development/RUNTIME_AND_SQLITE.md)を参照してください。旧配布物の再現に使う版や年月日付き履歴は、その時点の条件を保持します。

## 機能を選ぶ

| やりたいこと                   | 主な入口                                | 対応範囲・前提                                                             |
| ------------------------------ | --------------------------------------- | -------------------------------------------------------------------------- |
| 書類を取得する                 | `EdinetXbrlDownloader`                  | API v2の一覧・取得を利用。ZIPを検査してXBRLを取り出す                      |
| 売上・利益などをまとめて読む   | `getKeyMetrics()`                       | 主要18指標。既定の候補から探索するが、項目間の期間・範囲の一致は保証しない |
| 条件と出典を確認して値を読む   | `selectMetric()`                        | 会計基準・期間・連結区分を明示。採用値と未採用理由を返す                   |
| 原本から基準・当期を判定する   | `resolveFinancialReportingBasis()`      | DEIと実contextを検査。対応する基準・様式だけを確定する                     |
| BS・PL・CF明細や計算指標を扱う | 財務の専用API                           | 指標ごとに基準・期間・単位・計算条件が異なる                               |
| 会社情報・開示表を読む         | 会社・株主・役員・人的資本などの明細API | 直接記載と出典を保持。名称だけで法人や人物を同一視しない                   |
| 複数社を条件で探す             | `screenFinancialSnapshots()` など       | 明示した保存データを検索。入力形式はAPIごとに異なる                        |
| 取得結果を保存・公開する       | アーカイブ・索引構築・公開API           | 原観測・原本・抽出版を保持し、検索用の世代を構築する                       |

専用APIは[ドキュメント案内](README.md)から選んでください。定数や型に会計基準名が存在することは、その基準の全項目に対応していることを意味しません。

## 非機能要件と検証範囲

| 項目               | 適用先・要求する条件                                                                                                                                            | 検証先・限界                                                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 有限の入力         | XML解析入口はUTF-8換算64 MiBまで。ローカルBS取込のmanifestは2 MiB・100件以下、原本1件64 MiB・合計256 MiBまで                                                    | [入力実装](../src/xbrl/validate-xml-input.ts)、[取込上限](../src/pipeline/import-local-balance-sheets.ts)、[CLI境界](../test/xml-input-cli.test.ts)。全CLI共通の上限ではない              |
| 数値精度           | 厳密選択・保存では原数値文字列と単位・精度を保持し、安全に数値化できない値を検索用の浮動小数へ無理に変換しない                                                  | [選択API](financial/METRIC_SELECTION.md)、[数値境界](../test/metric-selection.test.ts)。従来の主要指標のnumber返値に同じ精度保証を広げない                                                |
| 再投入・再開       | 対応するStore/jobで入力・版を固定し、同一内容の再投入と停止後の再開を行う。異なる入力を同じ候補へ上書きしない                                                   | [解析job](../test/parsed-financial-job.test.ts)、[DuckDB復旧](../test/duck-financial-cycle-recovery.test.ts)。電源断・ディスク故障全般の保証ではない                                      |
| 互換性             | 同期SQLite APIを維持し、DuckDBは別の非同期readerとして提供する。保存形式・hashを検査し、非互換なDBを黙って読むことはしない                                      | [実行環境](development/RUNTIME_AND_SQLITE.md)、[検索reader](pipeline/DUCK_FINANCIAL_SEARCH_INDEX.md)、[readerテスト](../test/duck-financial-search-index.test.ts)                         |
| 通信と中断         | SDKのmaxRetriesは0以上の安全整数で指定。1取得は最大maxRetries+1通信（既定3なら初回を含め4通信）。指定したtimeoutとAbortSignalを処理し、caller中断で再試行しない | [通信テスト](../test/http-request-lifecycle.test.ts)。日次metadataのJST日次予算やflockは運用job固有で、全SDK共通の割当ではない                                                            |
| 公開整合性         | 正式readerは検証済み世代を保持し、新候補の読込み失敗で既存snapshotを失わない。reloadと公開切替は明示操作                                                        | [reader契約](pipeline/DUCK_FINANCIAL_SEARCH_INDEX.md)、[公開readerテスト](../test/duck-financial-publication-reader.test.ts)                                                              |
| 性能・メモリ・容量 | 有限件数・jobごとの容量/メモリ条件で測定し、原本と切戻し先を保持して進める                                                                                      | [受入記録](plans/SQLITE_DUCKDB_IMPLEMENTATION_PLAN.md)、[保持条件](pipeline/DUCK_FINANCIAL_RETENTION.md)。固定hostの検索比率・実測RSSや34 GiB留保を、任意query・全環境のSLAへ読み替えない |

## 主要18指標

`getKeyMetrics()` の返値です。書類に値がない場合や候補から取得できない場合は `undefined` になります。

| プロパティ名               | 日本語項目名     |
| :------------------------- | :--------------- |
| `netSales`                 | 売上高 / 収益    |
| `operatingIncome`          | 営業利益         |
| `ordinaryIncome`           | 経常利益         |
| `netIncome`                | 当期純利益       |
| `netAssets`                | 純資産           |
| `totalAssets`              | 総資産           |
| `operatingCashFlow`        | 営業CF           |
| `investingCashFlow`        | 投資CF           |
| `financingCashFlow`        | 財務CF           |
| `cashAndEquivalents`       | 現金同等物残高   |
| `earningsPerShare`         | EPS (1株益)      |
| `bookValuePerShare`        | BPS (1株資産)    |
| `equityToTotalAssetsRatio` | 自己資本比率     |
| `rateOfReturnOnEquity`     | ROE              |
| `priceEarningsRatio`       | PER (株価収益率) |
| `payoutRatio`              | 配当性向         |
| `numberOfIssuedShares`     | 発行済株式総数   |
| `dividendPaidPerShare`     | 1株当たり配当    |

J-GAAPとIFRSの候補タグを持ちますが、企業独自のタグや特殊業種を含む全書類への対応ではありません。候補と単位は[指標辞書](financial/METRIC_SELECTION.md)、既定の探索順は[主要指標の選択規則](SPECIFICATIONS.md#32-主要指標抽出ロジック-getkeymetrics)を参照してください。

`getKeyMetricsWithSources()` は同じ選択規則で値と出典を返します。`screenFinancialSnapshots()` は主要18指標に営業利益率・純利益率・FCFを加えて検索します。派生値は期間・範囲・通貨などを確認できる場合だけ計算します。[入力形式と21指標](financial/EDINET_DB_COMPARISON.md)に詳細があります。

## 本文のテキスト項目

`getQualitativeInfo()` は次のテキストブロックを読み、HTMLタグ・実体参照を処理した文字列を返します。有価証券報告書・四半期報告書・半期報告書などが対象ですが、項目の有無は書類によって異なります。

| プロパティ名               | 日本語項目名     | 主な内容                                             |
| :------------------------- | :--------------- | :--------------------------------------------------- |
| `businessPolicy`           | 経営方針等       | 経営方針、経営環境及び対処すべき課題                 |
| `businessRisks`            | 事業等のリスク   | 事業展開上のリスク要因                               |
| `financialAnalysis`        | 経営者による分析 | 財政状態、経営成績及びキャッシュ・フローの状況の分析 |
| `businessDescription`      | 事業の内容       | 事業の系統図や内容の説明                             |
| `companyHistory`           | 沿革             | 会社の沿革                                           |
| `researchAndDevelopment`   | 研究開発活動     | 研究開発の状況                                       |
| `corporateGovernance`      | ガバナンス       | 統治の状況                                           |
| `operationsOverview`       | 業績概要         | 業績等の概要                                         |
| `capitalResourcesAnalysis` | 資金流動性       | 資本の財源・資金流動性                               |
| `criticalContracts`        | 重要契約         | 経営上の重要契約                                     |
| `employeesInformation`     | 従業員           | 従業員の状況                                         |

本文の構造化された表が必要な場合は[開示表のAPI](disclosures/DISCLOSURE_TABLES.md)を使います。テキスト化した結果から、表の行・列や注記との関係がすべて復元できるとは限りません。

## 基本情報・株主・元タグへのアクセス

| 入口                         | 返すもの                               | 注意点                                                                                                          |
| ---------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `getCommonMetadata()`        | 提出者名・書類名・提出日など           | `docID` は `parse(xml, docID)` で渡せる。省略時は空文字                                                         |
| `getMajorShareholders()`     | 大株主の名前・株数・比率の原値         | 比率の単位・基準日を確認するには[大株主明細](disclosures/MAJOR_SHAREHOLDER_DETAILS.md)を使う                    |
| `getLargeShareholdingInfo()` | 提出者・発行者・保有割合などの先頭候補 | 報告全体の合計とは限らない。[大量保有明細](disclosures/LARGE_HOLDING.md#report)で単位・分母・連名合計を確認する |
| `getJppfsCor()`              | 財務諸表本表の型付き項目               | 型定義があっても、その原本に値があるとは限らない                                                                |
| `dataMap`                    | タグごとの候補値一覧                   | `ReadonlyMap`。`.get()` / `.keys()` を使い、`Object.keys()` で列挙しない                                        |
| `getDataListByTagName()`     | 名前空間をまたぐ同名タグの候補         | 会社独自タグも含む。項目名が同じだけで会計上の意味を同一視しない                                                |

生成された項目一覧は [jppfs_cor](generated/TAXONOMY_JPPFS_COR.md) / [jpcrp_cor](generated/TAXONOMY_JPCRP_COR.md) を参照してください。

## CLIでできること

| コマンド   | 入力・処理                                    |
| ---------- | --------------------------------------------- |
| `get`      | 書類を検索・取得・解析してJSONを返す          |
| `download` | 指定日や証券コードで書類を取得する            |
| `parse`    | 保存済みXBRLを解析する                        |
| `screen`   | 保存済み `FinancialSnapshot[]` を条件検索する |

専用コマンドは `--help`、基本コマンドの出力項目は `get --help-types` で確認できます。実行例は[README](../README.md)を参照してください。

## 結果の扱いと限界

1. **値がないときは理由を残す。** 欠損を0で埋めたり、連結値がないため単体値へ切り替えたりするかはAPIの規則に従います。厳密選択は期間・範囲をまたいで補いません。
2. **原値と計算値を分ける。** 十進数文字列を保持し、安全に変換できる場合だけ `safeNumber` を返すAPIがあります。比率の百分率表示や通貨換算を一律に行う機能ではありません。
3. **訂正版の採用と値の合成を分ける。** 観測時点に応じた書類選択は行えますが、訂正差分と親原本を合成した完全版を自動作成するものではありません。
4. **検索対象と検証範囲を明示する。** テスト成功や一部原本との照合は、全市場の網羅性・正確性を保証しません。利用者が収集した範囲で検索します。

入力の検査・容量制限・保存の保護は[技術仕様](SPECIFICATIONS.md)、今後の対応は[計画](plans/EDINET_TS_ROADMAP.md)を参照してください。
