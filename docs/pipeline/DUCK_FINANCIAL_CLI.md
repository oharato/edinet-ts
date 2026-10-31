# 検索DuckDBのCLIと公開API

2026-10-31。移行計画P7の配布・読取入口。既存コマンドに加え、以下の非同期コマンドを追加した。

| コマンド | 入力・結果 |
|---|---|
| `build-duck-financial-cycle` | `--config`。共有解析Storeを再利用し、固定原本から分割構築・再開する。Linux flockを使用 |
| `screen-duck-financial-index` | `--db --cohort --metrics`。条件・ソート・offset・limitを指定し、値・根拠・診断・件数を返す。企業マスター指定時はEDINETコードで結合する |
| `compare-duck-financial-industries` | `--db --cohort --metrics --company-master --company-query`。業種別の共通採用集合・分数統計を返す |
| `duck-financial-index-quality` | `--db --generation`。全件検査済み世代の母集団・書類・値の充足 |
| `duck-financial-index-generation` | `--db --generation`。固定世代manifest |
| `duck-financial-publication-status` | `--catalog --db`。SQLite catalogの候補・履歴とDuckDBの一致を検査 |

`--pretty` でJSONを整形する。完成した停止済みDuckDBを私有コピーとして読取専用で開く。未知/破損ファイル、不正な集合・数値・未収録世代は非0終了し、入力内容・ネイティブdriverのエラー詳細をログへ出さない。

## 検索例

cohort.json:

```json
{
  "generation": "listed-current",
  "group": "details",
  "accountingStandard": "J-GAAP",
  "scope": "Consolidated",
  "currency": "JPY",
  "period": {"startDate": "2025-04-01", "endDate": "2026-03-31"},
  "periodType": "annual"
}
```

```sh
edinet-ts screen-duck-financial-index --db data/search.duckdb \
  --cohort cohort.json --metrics costOfSales,sellingGeneralAndAdministrativeExpenses \
  --conditions '[{"metric":"costOfSales","operator":"gte","value":0}]' \
  --sort-by costOfSales --order desc --offset 0 --limit 100
```

省略limitは無制限、limit 0は行を返さず件数・診断を返す。保存済み項目の明示subsetを要求し、異なる基準・scope・期間を混ぜない。`--company-master` と `--company-query` を両方指定すると、企業マスターをEDINETコードで結合して企業属性で絞ってからページを切る。片方だけの指定は拒否する。`compare-duck-financial-industries` は同じDuckDB世代で業種別の共通採用集合・分数統計を返す。いずれもSQLite版と同じ入力・返却形を使う。

CLIは毎回snapshotをロードし直す。繰返し検索で監査を再利用する場合は、SDKの同じ `DuckFinancialSearchIndex` instanceを使い、終了時にawait closeする。

## 公開API

- `ParsedFinancialStore`、解析キー/版の関数・型：完全な解析結果と列・根拠の保存。
- `ParsedFinancialJob` と計画/進捗型：固定原本の版付き解析・再開。
- `DuckFinancialIndexBuild` / `DuckFinancialConnection`：呼出側所有の専用接続で候補構築。
- `DuckFinancialSearchIndex`：非同期の検索・品質・世代読取。
- `screenDuckCompanyFinancials` / `compareDuckCompanyFinancialsByIndustry`：検査済みDuckDB候補へ企業マスターを結合する非同期検索・業種比較。同期版と同じ入力・返却形。
- `DuckFinancialPublicationReader`：catalogへ一致するsnapshotのロード・明示reload。
- `FinancialIndexAsyncReader`：catalog用の最小非同期契約。

driverはoptional依存 `@duckdb/node-api@2.0.0-r.1`。通常import・SQLite API・公開型の利用ではdriverを読み込まない。DuckDB機能の実行時にだけ必要とする。公開型へdriver固有型を露出させない。

SDKの品質/pointer操作だけでは独立原本照合gateにならない。[検証済み切替入口](DUCK_FINANCIAL_VERIFICATION.md)を使う。[固定原本からの作成CLI](DUCK_FINANCIAL_CYCLE.md)は接続済み。原本照合/検証付き切替・取得側の日次handoff、照合器の配布同梱、全社/日次/利用先の受入はP7の残件。

## 配布物の限定検証

隔離作業ツリーで通常buildして `npm pack --ignore-scripts` のtgzを生成し、個別のconsumerへ展開した。root distや利用先vendorを更新していない。

```sh
node node_modules/tsx/dist/cli.mjs scripts/verify-duck-financial-package.ts \
  <npm-packのtgz> <固定DuckDB候補の証跡ディレクトリ> <新規出力先>
```

最終証跡は `data/benchmarks/duck-financial-package-20261031-v2/consumer-proof/summary.json`。driverなしでESM/CJS import・SQLite利用・公開型のstrict NodeNext検査が成功し、DuckDB CLIは内容を表示せず失敗した。driverありでは実原本由来4行の世代・品質・検索がSDKとCLIで一致した。Node 26.12.1・現ホストの検証で、他OS・全社・実利用先への導入確認を代替しない。tgzのSHA-256で検証対象を固定し、registryへpublishしていない。

本tgzの全source manifestと元作業ツリーを比べた際、隔離コピー後に並行作業の `financial-version-selection.ts` が更新されていた。差分は証跡に記録し、配布試験はmanifestの固定ソースで行った。正式な配布物は並行修正の固定後に再build・統合検証する。自身の変更対象4ファイルは元作業ツリーと一致している。

公開APIには `buildDuckFinancialCycle` と入力/結果型も追加した。直接呼ぶ側は候補と共有Storeの排他を保持する。作成CLIはその排他を取得し、metadata最新性/原本照合が未確認の結果を正式切替不可として返す。旧試験tgzは作成CLI追加前の固定版であり、この変更の正式配布は改めて統合検証する。

## 原本照合記録

`verify-duck-financial-values --db <停止したDuckDB> --catalog <候補catalog> --candidate <候補ID> --input-sha256 <固定入力hash> --archive <停止した原本SQLite> --record <記録JSON>` は同梱Pythonで採用値を独立照合し、検証記録を作成する。同じ記録の再実行では原本照合と内容一致を再確認する。`--check` は既存記録を再検証し、記録がなければ失敗する。実行環境に `python3` が必要。

catalogは読取専用で、正式参照を変更しない。原本の副ファイル・候補/入力/照合器の不一致を拒否する。記録は新規作成時に既存ファイルを原子的に上書きしない。中断は終了コード2、その他の照合失敗は1で、入力の内容はstderrへ出力しない。
