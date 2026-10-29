# 固定年次計画を実行する専用サービス

2026-10-30時点で、進行中の取得と構築待機をユーザーsystemdの専用transient unitへ引き継ぎました。会話側の実行セッションから分離し、同じ固定計画をcheckpointから続けます。元の`stock-data.service`や元stock-data作業ツリーは変更しません。

## 固定した入力とコード

- 対象は基準日2026-10-27の上場3,813社、2025-10-29〜2026-10-28の365日/83,828観測から作成した7,337原本の計画です。日付変更で現在のmasterへ差し替えません。
- 計画SHA-256は `e0ae20b2ce8765110b4a0e6a710a3861a78ac65a63cd713d10a3509938ba459a`。元の計画source commit f073df8は保持し、実行SDKのcommitとscript hashを別に記録します。
- 実行SDKは3cc4618e5fa8d3e35604e15dc49c31f9f35ebdd7、配布物SHA-256は `69e50093645fdd38a31c46c5b676e7efe32b523033e37def135c3d5b657d7a94`。[固定配布手順](nuc7-local-artifacts.md)で再現した202ファイルです。
- 私有実行環境は `/home/oharato/workspace/edinet-roadmap-runtime-3cc4618`。クリーンな固定sourceのlockfile/依存treeをコピーし、検証済みSDKと2つの実行scriptを固定しています。開発中のroot `dist`やSDKのcurrent pointerを参照しません。
- `runtime-manifest.json`で2,493ファイル/リンクとNode v26.12.1・作業ディレクトリ・取得configのhashを検査。余分なファイル・変更・外へ出る依存リンクはジョブ開始前に拒否します。検査は整合確認であり、OSの不変mountや外部署名ではありません。
- `.env`はコピーせず、既存の作業ディレクトリでdotenvが認証へ利用します。値は表示・manifest記録しません。自己検査ではDBも通信も開きません。

## 稼働するunit

| unit | 処理 | RestartSec |
|---|---|---:|
| `edinet-roadmap-year-acquisition-3cc4618.service` | 固定原本jobの残件取得・完了指紋検査 | 10秒 |
| `edinet-roadmap-year-build-3cc4618.service` | 取得完了を待ち、同じ計画指紋から全社索引/品質を構築 | 15秒 |

両unitは`Restart=on-failure`、300秒内3回の起動上限、`TimeoutStopSec=600`、`UMask=0077`。絶対パスの固定Nodeで私有環境の`.mts`を実行し、Node標準の型除去だけを使います。ユーザーmanagerのLingerは既存でyesだったため変更していません。自動再起動は失敗時のみで、正常終了や安全条件による停止から無制限に取得し直しません。

```sh
systemctl --user status edinet-roadmap-year-acquisition-3cc4618.service
systemctl --user status edinet-roadmap-year-build-3cc4618.service
```

ログ/状態は元リポジトリの私有`data/roadmap`に保持します。

- `year-financial-source-service.log` / `year-financial-source-summary.json`
- `year-financial-build-service.log` / `year-financial-build-config.json`
- 既存のstate/archive/metadata SQLiteと全試行履歴

停止は該当unitへ`systemctl --user stop`でSIGTERMを送り、終了を確認します。停止のためにDBや副ファイルを削除しません。稼働判断にはunitのMainPID/実processを確認し、状態ファイルの時刻やtaskのrunning markerだけを使いません。過去の中断で残ったrunning taskは、pending優先の既存順序で後から中断履歴化・再試行します。

取得の1秒間隔・本文timeout/再試行・原本ごとのcommit・3試行上限・disk reserveは既存のままです。完了時の原本指紋と固定計画を検証した後だけ、3,813社の構築へ進みます。構築の再起動では同じSDK/入力を要求し、PIDだけを更新します。公開catalogの自動切替は行いません。

## 検証と残工程

旧worker両方のSIGTERM終了と副ファイル不在を確認し、完了1,761task・固定config・計画指紋を保存して引継ぎ。新サービスで追加51件まで取得し、元の全1,761完了taskの内容とconfigが不変でした。SDKのLICENSEを一時的に変更する自己検査では開始拒否を確認し、正確に復元した後は成功しました。

DBをまだ開いていない構築待機だけを意図的に終了し、systemdによる自動再起動を確認。SDK指紋とconfigはPID以外不変で、待機へ戻りました。実取得中の強制終了やhot journalの自動回復を試した結果ではありません。

transient unitは再起動後の自動起動を設定していません。再boot時のunit再作成、日次カレンダー巡回、実行scriptの汎用化/配布、hot journal回復、本番移行と全市場品質/公開条件の解消は残工程です。安全停止理由や繰返し失敗があれば、保存状態を検査してから再開します。
