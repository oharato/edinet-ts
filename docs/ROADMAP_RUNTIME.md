# 固定年次計画を実行する専用サービス

2026-10-30時点で、進行中の取得と構築待機をユーザーsystemdの専用transient unitへ引き継ぎました。会話側の実行セッションから分離し、同じ固定計画をcheckpointから続けます。元の`stock-data.service`や元stock-data作業ツリーは変更しません。

## 固定した入力とコード

- 対象は基準日2026-10-27の上場3,813社、2025-10-29〜2026-10-28の365日/83,828観測から作成した7,337原本の計画です。日付変更で現在のmasterへ差し替えません。
- 計画SHA-256は `e0ae20b2ce8765110b4a0e6a710a3861a78ac65a63cd713d10a3509938ba459a`。元の計画source commit f073df8は保持し、実行SDKのcommitとscript hashを別に記録します。
- 現在の内部実行SDKは1cf4c08384af64385e402a3e7d5244dcdf662013、配布物SHA-256は `a27ebb0c43de5350ff002ff5605ae0741e014542b2b94e6d7e3df0b428aca44e`。公開配布/利用先のPINは3cc4618を維持しています。固定sourceからのクリーンビルドとテスト済み出力が一致した204ファイルです。
- 私有実行環境は `/home/oharato/workspace/edinet-roadmap-runtime-1cf4c08`。クリーンな固定sourceのlockfile/依存treeをコピーし、検証済みSDKと2つの実行scriptを固定しています。開発中のroot `dist`やSDKのcurrent pointerを参照しません。
- `runtime-manifest.json`で2,495ファイル/リンクとNode v26.12.1・作業ディレクトリ・取得configのhashを検査。余分なファイル・変更・外へ出る依存リンクはジョブ開始前に拒否します。検査は整合確認であり、OSの不変mountや外部署名ではありません。
- `.env`はコピーせず、既存の作業ディレクトリでdotenvが認証へ利用します。値は表示・manifest記録しません。自己検査ではDBも通信も開きません。

## 稼働するunit

| unit | 処理 | RestartSec |
|---|---|---:|
| `edinet-roadmap-year-acquisition-1cf4c08.service` | 固定原本jobの残件取得・完了指紋検査 | 10秒 |
| `edinet-roadmap-year-build-1cf4c08.service` | 取得完了を待ち、同じ計画指紋から全社索引/品質を構築 | 15秒 |

両unitは`Restart=on-failure`、300秒内3回の起動上限、`TimeoutStopSec=600`、`UMask=0077`。絶対パスの固定Nodeで私有環境の`.mts`を実行し、Node標準の型除去だけを使います。ユーザーmanagerのLingerは既存でyesだったため変更していません。自動再起動は失敗時のみで、正常終了や安全条件による停止から無制限に取得し直しません。

```sh
systemctl --user status edinet-roadmap-year-acquisition-1cf4c08.service
systemctl --user status edinet-roadmap-year-build-1cf4c08.service
```

ログ/状態は元リポジトリの私有`data/roadmap`に保持します。

- `year-financial-source-service-1cf4c08.log` / `year-financial-source-summary.json`
- `year-financial-build-service-1cf4c08.log` / `year-financial-build-config.json`
- 既存のstate/archive/metadata SQLiteと全試行履歴

停止は該当unitへ`systemctl --user stop`でSIGTERMを送り、終了を確認します。停止のためにDBや副ファイルを削除しません。稼働判断にはunitのMainPID/実processを確認し、状態ファイルの時刻やtaskのrunning markerだけを使いません。過去の中断で残ったrunning taskは、pending優先の既存順序で後から中断履歴化・再試行します。

取得の1秒間隔・本文timeout/再試行・原本ごとのcommit・3試行上限・disk reserveは既存のままです。完了時の原本指紋と固定計画、および保存済み原本/未提供の件数合計を検証した後だけ、3,813社の構築へ進みます。未提供は財務品質の充足に数えません。構築の再起動では同じSDK/入力を要求し、PIDだけを更新します。公開catalogの自動切替は行いません。

## 検証と残工程

初回3cc4618への引継ぎでは、旧worker両方のSIGTERM終了と副ファイル不在を確認し、完了1,761task・固定config・計画指紋を保存して引継ぎ。新サービスで追加51件まで取得し、元の全1,761完了taskの内容とconfigが不変でした。SDKのLICENSEを一時的に変更する自己検査では開始拒否を確認し、正確に復元した後は成功しました。

DBをまだ開いていない構築待機だけを意図的に終了し、systemdによる自動再起動を確認。SDK指紋とconfigはPID以外不変で、待機へ戻りました。実取得中の強制終了やhot journalの自動回復を試した結果ではありません。

transient unitは再起動後の自動起動を設定していません。再boot時のunit再作成、日次カレンダー巡回、実行scriptの汎用化/配布、hot journal復旧候補の運用への組込み、本番移行と全市場品質/公開条件の解消は残工程です。安全停止理由や繰返し失敗があれば、保存状態を検査してから再開します。

2026-10-30の観測行検査改善では、クリーンsource78c342cの全142ファイル/3,799テストと配布物hashを確認し、内部runtimeだけを更新しました。公開SDK3cc4618との差分はアーカイブのJS/型定義2ファイルだけです。全2,493ファイル/リンクの新manifestと両scriptの自己検査後、旧3cc unitをcheckpoint停止。完了2,244taskと元config/計画指紋を保持し、新unitで追加79件以上の完了と全2,244完了taskの不変を確認しました。旧runtime/停止unitと未開始の構築configも保持し、raw/schema/取得窓は初期化していません。

旧workerで生じた実取得失敗2件（S100X98U/S100XC1A）は、元の公式一覧のxbrlFlagがともに0でした。取得可否の宣言をアーカイブモデルで保持しておらず、未提供を通信障害と区別できなかったため、以下の継続計画で修正しました。現行計画のtaskや履歴を削除せず保持しています。


2026-10-30 可否宣言付き計画への引継ぎ: 全145ファイル/3,822テストとbuild/公開型/CJSを確認した1cf4c08を固定。元metadata全83,828観測・419,140形式宣言を別アーカイブへ構成し、形式以外の本文/索引・全record hash・観測指紋を独立照合しました。選択7,337書類・母集団3,813社・cutoff・系列の状態件数は不変です。

旧unitをSIGTERMで正常停止し、保存済み2,931件・旧状態DB/全試行履歴・旧configを保持。全2,931原本宣言と内容3,995,485,866 bytesを転送し、別のSQLite/Python検査でも全行/byte/hash一致と旧ファイルの不変を確認しました。新計画IDは `year-window-current-population-formats-v2`、計画SHA-256は `4d95e355096cdcce8f2ccd0aaceace01696d45b0377e41291386b741e54d963a`。開始時は原本2,931件・未取得4,397件・明示的XBRL未提供9件。新計画は保存済み原本を試行0で再利用し、旧履歴は `previousJob` の物理指紋/旧計画指紋とファイル参照で保持します。旧状態の実失敗3件はいずれも未提供9件に含まれ、履歴を成功へ書き換えていません。

新アーカイブ/状態は `data/roadmap/year-financial-{archive,source-state}-formats-1793291136311.sqlite`、引継ぎの照合記録は `data/roadmap/source-format-*.json`。旧78c342cのruntime/unit/アーカイブ/状態と公開SDK3cc4618は保持します。未提供を取得成功や数値0へ変換せず、PDF等での財務値対応・全市場品質は残工程です。


2026-10-30 [hot journalの復旧API/CLI](SQLITE_RECOVERY.md)を追加しました。停止した6種類の専用DB/journalの固定指紋から、新規の私有候補だけをrollbackし、構造/固定schema/元ページ数を検査します。復旧後のアプリケーションrecord監査は別で、稼働runtimeへの自動適用は未実装です。合成の取得checkpointでは履歴を保持した残件再開まで確認し、旧取得状態の私有コピーでも全7,337task/2,939履歴と全DB byteが元のコミット済み状態へ一致しました。実稼働の取得process/元状態を強制終了した検査ではありません。現行runtime1cf4c08と公開SDK3cc4618はそのままです。
