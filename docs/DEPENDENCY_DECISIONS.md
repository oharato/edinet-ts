# 依存ライブラリの選定方針

更新日: 2026-10-22。状態: 調査済み、Node・依存更新と標準SQLite移行は第1段階とは別変更で検証する。
最新化は全ライブラリの全面置換を意味しない。既知問題の修正、不要依存の削除、実測が必要な大容量処理の順に判断する。

## 現行用途と候補

最新版は公式npm registryの`latest`を確認したstable版。package.jsonでの採用済み状態とは別で、pre-releaseは対象にしない。

| 現行依存 | 用途 | 確認した候補・方針 |
|---|---|---|
| better-sqlite3 | 書類メタデータDB | 外部依存を削除しNode標準node:sqliteへ。既存DB・transaction・bind・lockingの互換検証が必須 |
| cli-progress | seedスクリプトの進捗 | 3.12.0を維持。別UIフレームワークに替えない |
| commander | CLI | 15.0.0へ更新候補。ESM-only、Node>=22.12。肯定/否定オプションのdefaultとJSON/終了コードを回帰検証 |
| dayjs | seed・期間の日付操作 | 1.11.23へ更新維持。日付のみとtimestampを分け、UTC/JST/米国TZ境界を検証 |
| dotenv | CLI・開発スクリプトの.env | 最新18.0.8を確認。Node loadEnvFile/--env-file-if-existsも候補。ENOENT・環境変数の上書き・ESM import前の読み込み互換を確認して判断 |
| fast-xml-parser | XBRL/XML | 5.11.2へ更新優先。namespace/属性、raw数値、mixed content/継続/scaleの回帰が必要。preserveOrderの機械的変更はしない |
| jszip | ZIP読込/展開 | 3.10.2へ更新維持。大容量は下記候補を評価し、実測なしで高速化を主張しない |
| @types/better-sqlite3 | 外部SQLite型 | 標準SQLite移行と同時に削除 |
| @types/cli-progress | 進捗型 | 3.11.6を維持 |
| @types/jszip | ZIP型 | deprecated stub。JSZip本体に型があるため削除 |
| @types/node | Node型 | 26.6.5を確認。採用runtimeのDatabase/Statementと型APIを実機確認 |
| ts-morph | 型ドキュメント生成 | 28.0.0へ更新候補。生成結果が不必要に変わらないことを確認 |
| tsx | TypeScriptスクリプト実行 | 4.23.15を維持。Node組込TSはtsconfig/型検査の代替ではなく、無条件に削除しない |
| typescript | 型検査・宣言/JS生成 | 7.0.2へ更新候補。tsconfig廃止/非推奨設定と型宣言・ESM生成を検証 |
| vitest | テスト | 5.0.5へ更新候補。Node標準testへの置換は移行効果がある場合だけ別判断 |
| xlsx | タクソノミExcel読込・生成/調査スクリプト | npm latest 0.18.5は既知問題が残る。公式SheetJS CE 0.20.3配布と代替を比較して決定。runtimeのパーサー依存ではない |

## Nodeと標準SQLite

[公式リリース](https://nodejs.org/en/about/previous-releases) と公式配布一覧で、最新Current 26.12.1、最新LTS 24.22.1を確認。最新化の基本対象はCurrent 26.12.1とし、npm stable 12.2.1も確認する。リポジトリのruntime指定・CI・限定開発環境だけを更新し、他プロジェクトのNodeは切り替えない。

[node:sqlite公式API](https://nodejs.org/api/sqlite.html) はStability 1.2 Release candidateであり、安定度2のAPIとは説明しない。experimental-sqliteフラグは不要。26.12.1の正式名はDatabase/Statementで、DatabaseSyncはdeprecated alias（DEP0210）。APIは同期的で、close/disposeはStatementで26.8.0追加。

受入条件は、既存SQLiteファイルのコピー/合成DBでのread/write、prepared statement/NULL/bind、BEGIN/COMMIT/ROLLBACK、duplicate/失敗時の原子性、read-only、busy timeout/locking、safe integer/BigInt、CLI・公開exportの検証。既存保存DB本体は変更しない。最低Node版の引き上げはbreaking changeとして明記する。

## セキュリティと代替の判断

- XMLは [GHSA-jmr7-xgp7-cmfj](https://github.com/advisories/GHSA-jmr7-xgp7-cmfj) / [GHSA-8r6m-32jq-jx6q](https://github.com/advisories/GHSA-8r6m-32jq-jx6q) 等のentity/DoS修正を優先する。外部entity/network・資源上限の検証は、最新版という理由だけで省略しない。
- ZIPは小規模ならJSZip維持。大容量では [yauzl](https://github.com/thejoshwolfe/yauzl) の逐次entry/サイズ検証（random accessが必要）、ブラウザ/ZIP生成兼用ならfflateを候補にする。unzipSyncで全展開するだけでは資源改善にならない。全方式で入力/展開byte、entry数、時間、traversal/symlink/重複nameを制限する。
- SheetJSのnpm 0.18.5は [GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) 等を考慮する。[公式導入資料](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/) のCE 0.20.3 tarballはAPI差が小さい候補だが、新たな供給元とlockfile integrityを確認する。許可されない場合は導入せず未解決として報告する。
- ExcelJS 4.4.0を名前だけでよりモダンと判断しない。旧xls、セル型、空行、sheet選択と生成差分の移行コストを比較する。用途が不要になった場合は削除も候補。
- saxesはarchivedであり、新規採用候補に安易にしない。Node標準fetch/test/環境変数処理も、互換性と効果を確認して選ぶ。新興forkや外部コードコピーは不要。

ライセンスはFXP/Day.js/cli-progress/ts-morph/fflate/yauzl/ExcelJSがMIT、JSZipはMITまたはGPLv3の選択、SheetJS CEはApache-2.0、dotenvはBSD-2-Clause。導入時には実際に固定する配布物のLICENSE・依存・整合性を再確認する。

機能拡張の段階と受入条件は [改善計画](plans/EDINET_TS_ROADMAP.md)、EDINET固有の設計候補は [ライブラリ設計調査](EDINET_LIBRARY_RESEARCH.md) を参照。
