# 固定年次計画と日次更新を実行する専用サービス

2026-10-30時点で、進行中の取得と構築待機はユーザーsystemdの専用永続unitで実行します。会話側の実行セッションから分離し、同じ固定計画をcheckpointから続けます。元の`stock-data.service`や元stock-data作業ツリーは変更しません。

## 固定した入力とコード

- 対象は基準日2026-10-27の上場3,813社、2025-10-29〜2026-10-28の365日/83,828観測から作成した7,337書類（XBRL未提供9件を別計上）の取得計画です。日付変更で現在のmasterへ差し替えません。
- 現行計画IDは `year-window-current-population-formats-v2`、SHA-256は `4d95e355096cdcce8f2ccd0aaceace01696d45b0377e41291386b741e54d963a`。元計画e0ae20b/source f073df8と履歴はpreviousJobへ保持し、SDK・実行補助のcommitとscript hashを別に記録します。
- 現在の内部年次実行SDKは1cf4c08384af64385e402a3e7d5244dcdf662013、配布物SHA-256は `a27ebb0c43de5350ff002ff5605ae0741e014542b2b94e6d7e3df0b428aca44e`。公開配布/利用先のPINは3cc4618を維持しています。固定sourceからのクリーンビルドとテスト済み出力が一致した204ファイルです。
- 私有実行環境は `/home/oharato/workspace/edinet-roadmap-runtime-1cf4c08-batch100`。クリーンな固定sourceのlockfile/依存treeをコピーし、検証済みSDKと2つの実行script・取得制御補助を固定しています。開発中のroot `dist`やSDKのcurrent pointerを参照しません。
- `runtime-manifest.json`で2,496ファイル/リンクとNode v26.12.1・作業ディレクトリ・取得configのhashを検査。余分なファイル・変更・外へ出る依存リンクはジョブ開始前に拒否します。検査は整合確認であり、OSの不変mountや外部署名ではありません。
- `.env`はコピーせず、既存の作業ディレクトリでdotenvが認証へ利用します。値は表示・manifest記録しません。自己検査ではDBも通信も開きません。

## 稼働するunit

| unit | 処理 | RestartSec |
|---|---|---:|
| `edinet-roadmap-year-acquisition-batch100.service` | 固定原本jobの残件取得・完了指紋検査 | 10秒 |
| `edinet-roadmap-year-build-batch100.service` | 取得完了を待ち、同じ計画指紋から全社索引/品質を構築 | 15秒 |
| `edinet-roadmap-daily-metadata.timer` | 年次完了後の別metadata再観測・通知対象日追加 | — |

年次の両serviceは`~/.config/systemd/user/`に置き、`WantedBy=default.target`でenableしています。`Restart=on-failure`、300秒内3回の起動上限、`TimeoutStopSec=600`、`UMask=0077`。絶対パスの固定Nodeで私有環境の`.mts`を実行し、Node標準の型除去だけを使います。ユーザーmanagerのLingerは既存でyesだったため変更していません。自動再起動は失敗時のみで、正常終了や安全条件による停止から無制限に取得し直しません。

```sh
systemctl --user status edinet-roadmap-year-acquisition-batch100.service
systemctl --user status edinet-roadmap-year-build-batch100.service
systemctl --user status edinet-roadmap-daily-metadata.timer
```

ログ/状態は元リポジトリの私有`data/roadmap`に保持します。

- `year-financial-source-service-batch100.log` / `year-financial-source-summary.json`
- `year-financial-build-service-batch100.log` / `year-financial-build-config.json`
- 既存のstate/archive/metadata SQLiteと全試行履歴

停止は該当unitへ`systemctl --user stop`でSIGTERMを送り、終了を確認します。停止のためにDBや副ファイルを削除しません。稼働判断にはunitのMainPID/実processを確認し、状態ファイルの時刻やtaskのrunning markerだけを使いません。過去の中断で残ったrunning taskは、pending優先の既存順序で後から中断履歴化・再試行します。

取得の1秒間隔・本文timeout/再試行・原本ごとのcommitは維持し、一回の取得は最大100件です。3試行済みは候補から除き、進展なしの判定は従来と同じ20件単位5回の枠から残りの件数を決めます。本文の前後でも32GiB+2GiBの空き容量を確認します。完了時の原本指紋と固定計画、および保存済み原本/未提供の件数合計を検証した後だけ、3,813社の構築へ進みます。未提供は財務品質の充足に数えません。構築の再起動では同じSDK/入力を要求し、PIDだけを更新します。公開catalogの自動切替は行いません。

## 検証と残工程

初回3cc4618への引継ぎでは、旧worker両方のSIGTERM終了と副ファイル不在を確認し、完了1,761task・固定config・計画指紋を保存して引継ぎ。新サービスで追加51件まで取得し、元の全1,761完了taskの内容とconfigが不変でした。SDKのLICENSEを一時的に変更する自己検査では開始拒否を確認し、正確に復元した後は成功しました。

DBをまだ開いていない構築待機だけを意図的に終了し、systemdによる自動再起動を確認。SDK指紋とconfigはPID以外不変で、待機へ戻りました。実取得中の強制終了やhot journalの自動回復を試した結果ではありません。

旧transient unitは停止して保持し、現行の永続unitは既存のLinger=yesとdefault.targetから同じ有限計画を再開する設定です。実機の再bootは試験していません。日次カレンダー巡回、実行scriptの汎用化/配布、hot journal復旧候補の運用への組込み、本番移行と全市場品質/公開条件の解消は残工程です。安全停止理由や繰返し失敗があれば、保存状態を検査してから再開します。

2026-10-30の観測行検査改善では、クリーンsource78c342cの全142ファイル/3,799テストと配布物hashを確認し、内部runtimeだけを更新しました。公開SDK3cc4618との差分はアーカイブのJS/型定義2ファイルだけです。全2,493ファイル/リンクの新manifestと両scriptの自己検査後、旧3cc unitをcheckpoint停止。完了2,244taskと元config/計画指紋を保持し、新unitで追加79件以上の完了と全2,244完了taskの不変を確認しました。旧runtime/停止unitと未開始の構築configも保持し、raw/schema/取得窓は初期化していません。

旧workerで生じた実取得失敗2件（S100X98U/S100XC1A）は、元の公式一覧のxbrlFlagがともに0でした。取得可否の宣言をアーカイブモデルで保持しておらず、未提供を通信障害と区別できなかったため、以下の継続計画で修正しました。現行計画のtaskや履歴を削除せず保持しています。


2026-10-30 可否宣言付き計画への引継ぎ: 全145ファイル/3,822テストとbuild/公開型/CJSを確認した1cf4c08を固定。元metadata全83,828観測・419,140形式宣言を別アーカイブへ構成し、形式以外の本文/索引・全record hash・観測指紋を独立照合しました。選択7,337書類・母集団3,813社・cutoff・系列の状態件数は不変です。

旧unitをSIGTERMで正常停止し、保存済み2,931件・旧状態DB/全試行履歴・旧configを保持。全2,931原本宣言と内容3,995,485,866 bytesを転送し、別のSQLite/Python検査でも全行/byte/hash一致と旧ファイルの不変を確認しました。新計画IDは `year-window-current-population-formats-v2`、計画SHA-256は `4d95e355096cdcce8f2ccd0aaceace01696d45b0377e41291386b741e54d963a`。開始時は原本2,931件・未取得4,397件・明示的XBRL未提供9件。新計画は保存済み原本を試行0で再利用し、旧履歴は `previousJob` の物理指紋/旧計画指紋とファイル参照で保持します。旧状態の実失敗3件はいずれも未提供9件に含まれ、履歴を成功へ書き換えていません。

新アーカイブ/状態は `data/roadmap/year-financial-{archive,source-state}-formats-1793291136311.sqlite`、引継ぎの照合記録は `data/roadmap/source-format-*.json`。旧78c342cのruntime/unit/アーカイブ/状態と公開SDK3cc4618は保持します。未提供を取得成功や数値0へ変換せず、PDF等での財務値対応・全市場品質は残工程です。


2026-10-30 [hot journalの復旧API/CLI](SQLITE_RECOVERY.md)を追加しました。停止した6種類の専用DB/journalの固定指紋から、新規の私有候補だけをrollbackし、構造/固定schema/元ページ数を検査します。復旧後のアプリケーションrecord監査は別で、稼働runtimeへの自動適用は未実装です。合成の取得checkpointでは履歴を保持した残件再開まで確認し、旧取得状態の私有コピーでも全7,337task/2,939履歴と全DB byteが元のコミット済み状態へ一致しました。実稼働の取得process/元状態を強制終了した検査ではありません。現行runtime1cf4c08と公開SDK3cc4618はそのままです。

2026-10-30 復旧候補の再開前監査として、[`FinancialSourceJob.audit` / `audit-financial-source-job`](FINANCIAL_SOURCE_JOB.md)を追加しました。状態/原本をreadOnlyで開き、期待計画・停止原本指紋・全task/履歴と完了原本/未提供根拠を照合します。未完了でも監査可能で、元の復旧manifestは変更せず別の監査結果を保持します。実復旧候補の7,337 task/2,939履歴と保存2,931原本の照合が成功し、復旧候補・停止原本・旧状態の指紋不変を確認。財務値の検査や実行中のconfig書換え・公開切替を行うAPIではありません。現行runtime1cf4c08は維持し、固定configへの引継ぎ自動化と再boot/日次運用は残工程です。


100件処理ではsummary/progress JSONの更新はbatch完了時です。原本/状態のcommitは一件ごとで、途中には20要求ごとの `source-request-start` を記録します。この記録は取得開始の通知で、成功件数ではありません。稼働判断はunit PIDを使い、古いsummaryだけで停止や再起動を判断しません。

構築待機は、systemdの現在の取得PID・固定計画・期待する取得scriptのSHA-256と正確なargvで、新workerの初期summaryを確認します。起動直後の古いPID/summaryを誤認せず、取得完了ファイルを待ちます。単なる起動順や同じSDK commitだけを根拠に先へ進みません。

2026-10-30 100件単位/永続unitへの実行引継ぎ: 取得制御補助はd696dcf、全149ファイル/3,869テストと固定SDK1cf4c08の別実行試験を確認。SDK全204ファイル/依存関係・固定計画4d95e35・元configを保持したまま、全2,496ファイル/リンクの新manifestを固定し、両scriptの起動前検査とunit構文検査が成功しました。元のstock-dataサービスと変更6ファイルは維持しています。

旧unitを正常停止した時点で、保存4,007件・未処理3,320件・未提供9件と、制御停止による中断1件を保持。新unitは初期summaryで同じcheckpointを読み、最初の100件すべてを追加保存しました。保存4,107・未処理3,220・中断による失敗task1・未提供9、通信失敗試行0。全旧完了/未提供taskと既存1,077試行履歴の内容が不変で、次のbatchの全原本検査後に新要求へ進んだことも確認しました。中断taskは履歴を消さず、未処理優先の既存順序で後から再試行します。

最初の100件は405,034ms、そのうち初回の原本open/全検査を含む要求前69,053ms、要求区間335,981msでした。旧32 batchの中央値との条件を揃えた比較ではなく、速度保証とは扱いません。両永続unitはenable・実PID・再起動0、Lingerは既存yes、WantedBy/default.target symlink・FragmentPath・unit内容のhashを照合。構築は新SDKパスの指紋2607e855を固定し、取得完了を待っています。記録は私有 `data/roadmap/batch100-handoff-proof.json`。実機の再bootは未試験です。

## 日次metadataの別fork（2026-10-30）

SDK source4a47cd9・運用補助84dc837を別runtime `edinet-roadmap-runtime-daily-4a47cd9` に固定し、2,492ファイル/リンクとconfigを起動前に検査します。manifest SHA-256はe9b8582899dbfb0fccf791521dc93442896af5d0ece1c8c8cf818c549c8b0c3b。年次取得runtime1cf4c08と公開SDK3cc4618は変更しません。

`edinet-roadmap-daily-metadata.timer` をenableして稼働確認しました。boot後2分と5分ごとのoneshot `edinet-roadmap-daily-metadata.service` で、取得計画4d95e35の全件完了・取得unit停止まで正常待機します。元seedの365閉日/83,828観測を複製した専用 `data/roadmap/daily-metadata-20261030.sqlite` と専用checkpoint/configを使います。namespaceはdaily-metadata-20261030-v1です。`daily-metadata-service.log` が実行結果、`daily-deployment-proof.json` が配置/指紋/待機/予算0件の証跡です。

元seed・日次DBの初期物理SHA一致、checkpoint不変・排他exit75、期待cwd以外の起動拒否、timer symlink/FragmentPath/内容hash、元stock-dataの6ユーザー変更ファイル不変を確認しました。Lingerは既存yesのままです。当日probeや実日次API収集は年次完了待ちのため未実行で、新規財務計画/解析/品質/公開は後続工程です。実機再bootは未試験です。停止する場合はtimerと実行中のoneshotの両方を停止し、再開はtimerを起動します。

通常の定期確認はJST 09〜23時台の5分ごと（`*-*-* 09..23:00/5:00`）へ調整しました。boot後2分とPersistentの取り逃し確認は残します。当日一覧がまだ更新されない早朝の失敗probeだけで32要求を使い切ることを避ける運用時刻であり、提供元の更新完了時刻を保証するものではありません。変更後のtimer構文・実NextElapse・unit hashと予算0件を `data/roadmap/daily-provider-window-proof.json` に保存しました。SDK/運用補助/runtime/configの指紋は変更していません。


## 通知対応の日次runtimeへ引継ぎ（2026-10-30）

日次側はSDK source fa61ab5（206配布ファイル）・運用補助e8f5d4dを `/home/oharato/workspace/edinet-roadmap-runtime-daily-fa61ab5-notices` へ固定しました。2,493ファイル/リンク・configを起動前検査し、manifest SHA-256は45b8d49445d032bc9a3b1396adc50f52bd8e04592f8b0c3b1d5974ce0e8b4f62です。通知モジュールに試験変更を加えた候補の起動拒否と、復元後の全指紋一致も確認しました。元の年次runtime1cf4c08と公開SDK3cc4618は変更しません。

同じ専用metadata/sourceId/configを保持し、日次serviceのExecStartだけを切り替えました。新環境で待機→旧環境で待機→新環境で待機の順に正常終了し、年次取得PIDの不変・元seed/日次DB/checkpointの物理SHA不変、日次通信0件を確認。timerはenable/activeで次の通常確認は09:00JST、09〜23時台の5分間隔です。元stock-dataの6ユーザー変更ファイルも不変です。設定/manifestと引継ぎの証跡は私有data/roadmap/daily-notice-{runtime,before,deployment}-proof.jsonに保持します。

日次通信が始まるとcheckpoint内部を版2へ移行し、通知cursor/identity・既知対象日と最低観測時刻・未解決通知を保持します。初回143日も処理するため上限は256要求/JST日、毎秒1要求・retry0・34GiB余裕です。版2移行後の旧環境への無条件復帰を検証したものではありません。旧版へ戻す場合は適合するcheckpoint/候補を別途用意し、版2を旧補助へ渡しません。現在は年次完了待ちのため実APIによる日次再観測/移行は未実行です。実機再boot・日次財務の反復取得/解析/品質/公開は後続工程です。
