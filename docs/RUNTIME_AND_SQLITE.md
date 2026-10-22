# Node・依存更新と標準SQLite

更新日: 2026-10-22。この変更は21指標の第1段階PRとは別のruntime更新。公開release・既存データの移行・利用先vendor更新は行わない。

## Runtimeと互換性

[公式リリース](https://nodejs.org/en/about/previous-releases) と公式配布一覧を確認し、最新stable Current **Node 26.12.1**を採用する。最新LTSは24.22.1だが、「すべて最新化」の対象としてCurrentを選ぶ。npmは公式registry latestの**12.2.1**。

- `.node-version`、`engines.node >=26.12.1`、`engines.npm >=12.2.1`、`packageManager`、CIを揃える。
- 従来のNode版を対象外にするbreaking change。次の配布時には互換性変更として扱う。既存の固定配布物や他プロジェクトのruntimeは更新しない。
- 開発用runtimeはこのリポジトリ用の限定環境で実行する。host全体のNode設定を変更する必要はない。
- npmと`package-lock.json`を単一の基準にし、使われていない古い`pnpm-lock.yaml`は削除した。
- TypeScript 7向けにrootDirを明示し、廃止されたbaseUrl/node10 moduleResolutionを除く。buildはdistをcleanしてから生成し、前のbranchの生成物を残さない。
- CIは宣言したNode/npmで実行し、default mainと保持したmasterの既存checkを扱う。公開workflowと既存scheduleの頻度は変更しない。

## 依存の採用版

公式npm registryのstable latestを直接依存に固定する。互換範囲を無視して推移依存を別majorへ強制上書きしない。

| 用途 | 採用版・変更 |
|---|---|
| SQLite | better-sqlite3と専用型を削除、Node標準node:sqlite |
| CLI | commander 15.0.0 |
| 日付 | dayjs 1.11.23 |
| .env | dotenv 18.0.8（標準API置換は別判断） |
| XML | fast-xml-parser 5.11.2 |
| ZIP | jszip 3.10.2、本体型を使いdeprecated @types/jszipを削除 |
| 型 | @types/node 26.6.5、@types/cli-progress 3.11.6 |
| 型資料生成 | ts-morph 28.0.0 |
| TS実行・型検査・テスト | tsx 4.23.15、TypeScript 7.0.2、Vitest 5.0.5 |
| 進捗 | cli-progress 3.12.0。scriptsだけの用途なのでdevへ移動 |
| Excel | 公式SheetJS CE 0.20.3 tarball、dev用途のみ |

[SheetJS公式導入資料](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/) はnpmの0.18.5を古い配布としているため、公式CDNの0.20.3へ固定し、lockfileのintegrityを記録する。ESMのfilesystemを明示設定する `scripts/utils/spreadsheet.ts` を生成スクリプトで共有する。合成workbookでsheet名・空行・列位置・文字列の保持を検証する。外部taxonomy全体の再取得・再生成は行わない。

npm 12はregistry外URLと未許可install scriptを既定で制限する。`.npmrc`は直接宣言した公式URLだけを扱う`allow-remote=root`、package.jsonの`allowScripts`は開発ツールに必要なesbuildだけを許可する。全URL/全scriptを一括許可する設定にはしない。

## SQLite APIとDBの互換性

[Node 26.12.1公式SQLite API](https://nodejs.org/api/sqlite.html) の正式名`Database`を使用する。`DatabaseSync`の実行時利用はしない。experimental-sqliteフラグは不要だが、モジュールの安定度は**1.2 Release candidate**であり、安定度2ではない。全APIは同期的で、従来の同期repositoryを維持する。

@types/node 26.6.5は正式名とStatement.closeの宣言が遅れているため、`src/db/node-sqlite.ts`で既存の構造型に必要な型だけを補う。旧名は型としてのみ使用し、実行時は26.12.1のDatabase/Statement.closeを使用する。この小さなadapterは型定義の追従時に削除できる。公開repository APIにnative DB型を露出しない。

- `documents`のschema、既存のTEXTコード、INSERT OR IGNORE、検索条件と並び順を維持する。スキーマ移行は不要。
- batchはBEGIN/COMMIT、例外時はROLLBACK。失敗後の接続再利用を確認する。
- metadataは文字列/null。省略可能値はSQL NULLへ正規化し、SQLはprepared statementでbindする。
- Node標準のnull-prototype行は通常のobjectへ変換して従来の返値形状を維持する。
- statementを各処理のfinallyでcloseする。
- `new EdinetRepository(path, {readOnly:true})`は既存DBを読み取り専用で開き、親directory作成やschema初期化をしない。
- timeout既定は従来と同じ5000ms。`{timeout:0}`も指定可能で、lock中はエラーを返す。非同期APIへ変えたわけではなく、待機中は同期的にblockする。
- SQLite INTEGERをsafe numberの範囲外で読む場合はNodeがエラーにする。任意SQLのBigInt読取はsetReadBigIntsを明示する。repositoryはmetadata TEXTを数値へ変換せず、金融値の精度保証を追加したわけではない。

## 検証と制約

対象は全テスト、型検査、clean build、CLI version/help/parse/不正引数、Excel生成API、DB互換、依存audit、既存の保存保護テスト。既存保存DBは読み取り専用でbackupしたコピーだけをnative API/repositoryで検証し、原本を変更しない。

外部APIとの値の照合、全市場充足率、実taxonomy Excel全体の再生成、利用先vendor統合、複数OSの実機検証は別作業。XML/iXBRLの意味的な選択・decimal精度やZIP資源上限の全面再設計は、依存最新版の採用だけで完了したことにしない。

検証結果: Node 26.12.1 / npm 12.2.1でoffline clean install、clean build、型検査、16ファイル/267テスト（最新mainの255+追加12）、保存保護5テスト、built CLI JSONが成功。既存保存DBのbackupコピーでintegrity・件数・read-only hash不変・repository書込み/検索を確認。npm auditは本体のみ/開発込みとも検出0件（確認時点のregistry情報）。lint設定はないためlintは未実施。
