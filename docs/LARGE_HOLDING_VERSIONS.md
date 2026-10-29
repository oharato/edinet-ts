# 一次大量保有の訂正版選択と原本観測

`selectLargeHoldingReportVersions(observations, cutoff)` は、一覧の観測日時・提出日時・利用状態・提出者/発行者・フォームを確認し、350（大量保有/変更）と360（訂正）の系列から利用可能な末端を選びます。値の合成や未観測の履歴復元は行いません。

観測は `{observationId, observedAt, listDate?, document}`。documentには一覧のdocID、docTypeCode、formCode、edinetCode、issuerEdinetCode、parentDocID、submitDateTimeとwithdrawalStatus/disclosureStatus/docInfoEditStatusを保存します。観測日時とcutoffにはtimezoneが必要で、一覧のtimezoneなし提出日時は日本時間です。観測は最大10,000件、系列参照は100,000ステップまでです。

同一書類はcutoff以前の最新観測を使います。同時刻の内容が競合すれば未確定です。数値/文字列の状態コードは正規化します。新しい観測が非対応種別になった場合も古い350/360へ戻りません。最新状態が不明、書類情報修正済み、親不明、循環、提出者/発行者不一致、提出日時逆行、訂正分岐なら理由を残します。競合した訂正の参照先候補も調べ、影響する旧版の採用を防ぎます。

350のparentDocIDは訂正辺として辿りません。変更報告と直前報告の参照を、訂正と混同しないためです。撤回/不開示/通知だけの訂正は除外理由を残します。有効な子訂正が利用不能な親を辿る場合は未確定です。

## 原本との接続

`searchObservedLargeHoldingReports(observations, sources, options)` は版選択と[一次原本の検索](LARGE_HOLDING_REPORT.md)を接続します。sourcesは最大100件の配列で、各要素は以下です。

```ts
{docID, availableAt, sourceSha256, coverContextRef, xml?}
```

availableAtは原本を利用可能と確認した観測時刻、sourceSha256は読み込むXMLのUTF-8 SHA-256です。XMLは合計256MiBまで。原本と系列判断に使った一覧観測のうち遅い時刻をknownAtにします。選択された訂正が欠落/未来/未読込/hash不一致/解析失敗ならunavailableSourcesへ理由を返し、旧版の数値へ戻りません。未選択原本は解析しません。数値0とnilは分けます。

CLIは既存コマンドに一覧観測を指定します。

```sh
edinet-ts screen-large-holdings \
  --observations observations.json --manifest sources.json \
  --cutoff 2026-10-28T12:00:00+09:00 \
  --duty-date 2025-06-16 --scope report --metric holdingPercent
```

sources.jsonは `{file, docID, availableAt, sourceSha256, coverContextRef}` の配列です。fileはmanifest基準の相対パスも使えます。選択済みでcutoff以前の原本だけを読みます。読込失敗は書類ごとにsource-not-loadedです。UTF-8 BOMを保持してhashを照合します。入力のエラー内容は表示しません。observationsを省略した既存のfile/metadata形式も使えます。

## 確認範囲と残工程

保存済みの一覧と一次原本6件から、訂正対象S100VYPVを外してS100W23Pを選ぶ5件を確認しました。親参照のある350のS100W06Mも独立して選択します。2025年6月16日義務発生の報告全体検索は2件で、明示0も保持します。訂正原本欠落時は結果へ親の数値を出しません。新規のAPI取得・有料サービスは利用していません。

添付訂正XBRLの直接値を読む機能であり、訂正箇所を適用した全文再構成ではありません。共同保有者の全形式、保有者の法人同定、証券別内訳/取引明細、永続索引、全市場の取得・本番運用は引き続き残工程です。

日次再観測で350/360の種別や親が消えた場合も、cutoff以前の対象観測があれば最新状態を無視しません。取下げ等はunavailable、それ以外の分類消失は `document-type-unavailable` のunresolvedです。旧360の親参照は旧系列へのfallbackを止める根拠に限って使い、旧観測IDを返します。350のparent参照を訂正辺として辿ることはありません。古い属性を新観測へ補う処理や、分類消失からの閲覧期間満了の断定は行いません。[財務版と同じ日次更新の注意](DOCUMENT_PIPELINE.md#再観測で書類種別親番号が消えた場合)を参照してください。
取下げられた訂正から有効な元書類を選ぶ場合も、その取下げの根拠IDをdecisionに残し、選択observedAtへ反映します。取下げ前のcutoffの結果を書き換えません。
