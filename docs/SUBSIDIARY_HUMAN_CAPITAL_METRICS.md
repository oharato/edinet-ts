# 子会社の人的資本表を数値で調べる

`extractSubsidiaryHumanCapitalMetrics(xml, metadata, metricIds?, annotations?)`と`screenSubsidiaryHumanCapitalMetrics(documents, metric, options)`は、2025-11-01版jpcrpの子会社人的資本表を扱います。版は`SUBSIDIARY_HUMAN_CAPITAL_METRICS_VERSION = "1"`。既存の提出会社単体API/JSON形式とは別です。

対象は女性管理職比率、男性育休率（全/正規/非正規の報告値）、男女賃金比率（全/正規/非正規）の7項目です。`SubsidiaryHumanCapitalMetricId`の値を指定します。比率は小数1=100%、賃金比率は女性平均賃金/男性平均賃金です。100%を超える報告値も保持します。

## 行の扱いと比較の境界

検査済みの会社ラベルと、同じ書類・entity・時点・完全QNameの行次元を持つ専用タグだけを結び付けます。context IDが別でも同じ行のaspectsを確認できます。同名会社の別行をまとめず、同じRow番号を使う別表や提出会社の値で補完しません。

`row.label.parsedLabel`は原表の解析済み会社ラベルです。`label.entity`/`submitterEntity`は提出者entityで、子会社の法人IDではありません。一般子会社一覧や企業同一性の名寄せは行いません。Row軸を財務の連結/単体scopeへ変換せず、元次元・原値・精度・unit・trace参照・XML hashを残します。DTS/元の字面の検証はnot-performedです。

育休率タグには算出方法を特定できないものがあります。初期状態は`reported/definition-unconfirmed`として原値を保持し、比較から除外します。次の宣言を原注記で確認したときだけ付けます。

```ts
{
  kind: "childcare-method", rowKey, metric: "maleChildcareLeaveReportedAllRatio",
  method: "ordinance-item2", // ordinance-item1 / ordinance-item2 / womens-act
  proof: {
    key: "jpcrp_cor:InformationAboutEmployeesTextBlock",
    contextRef: "FilingDateInstant", rawSha256
  }
}
```

rowKeyはラベル抽出または数値抽出の返値を使います。proofは同じ原本の従業員欄TextBlockで、hashはparserの`rawValue`のUTF-8 SHA-256です。APIは参照・namespace・entity・時点・一意性・hashを検査します。算出方法と注記の意味は呼出元が確認する宣言で、参照一致を意味の自動判定とは扱いません。全/正規/非正規は個別に宣言します。

nilは0にしません。初期の`disclosure.state`は`unknown`です。原注記で分かる場合だけ、`{ kind:"unavailable", rowKey, metric, state:"not-applicable" または "not-disclosed", proof }`を付け、非該当と未開示を区別できます。nil以外への未記載宣言や、未知行・重複・不正hashは拒否します。

完全一致の有効な重複factは証跡付きで採用します。異値・精度違い・nil混在は曖昧とし、負値・%文字列・未知単位等は採用しません。安全なnumberにできない原値は保持して検索から除外します。ラベルのない数値も診断へ残します。

## 検索とCLI

検索は同じ期末の明示集合です。`conditions`はoperator/valueのAND、`labelContains`はラベル文字列、`order/offset/limit`で並びとページを指定します。育休率には比較する`childcareMethod`が必須で、異なる方法の行は除外理由を返します。会社の重複書類や期末混在は条件で隠さず拒否します。未比較と条件不一致は別件数です。名称の表記統一・FTE・給与体系・出向者などの範囲は補正しません。

```sh
node dist/cli.js screen-subsidiary-human-capital --manifest files.json \
  --metric femaleManagerRatio --conditions '[{"operator":"gte","value":0.1}]'
```

manifestは`[{file,metadata:{docID,instant,secCode?},annotations?:[...]}]`。育休の例は`--metric maleChildcareLeaveReportedAllRatio --childcare-method ordinance-item2`です。最大100書類、検索集合のXML合計256MiB、ラベルと数値の全候補10,000件が上限です。入力の内容はエラーへ表示しません。Object入口`selectSubsidiaryHumanCapitalMetrics(metadata, metricIds, annotations?)`では元XMLを保持しないためhashは付けません。

## 既存データによる独立照合

追加通信なしで既存キャッシュを私有作業先へコピーし、元ファイルの前後hash一致を確認しました。エクシオ`S100YI51`のPDF81/82ページ（冊子78/79）、ミライト・ワン`S100YG40`のPDF84ページを描画し、行名・単位・注記を確認しました。

| 検証対象 | 件数 |
|---|---:|
| 会社ラベル | 37 |
| PDF百分率とXBRL原値×100の一致 | 176 |
| PDFダッシュとXBRL nilの一致 | 71 |
| 注記で非該当と確認したnil | 9 |
| 理由を推測せず保持したnil | 62 |
| 元表に列がない投影セル（ミライトの育休正規/非正規） | 12 |

標準タグの247数値fact（176値+71nil）を独立Pythonで照合しました。ミライトの追加の別定義の育休列はこの標準タグの値へ代用していません。育休率の標準タグはエクシオで施行規則第2号、ミライトで女性活躍法の列を示すため、注記宣言と方法指定が必要です。

PDFから決めた4検索の件数も一致しました。女性管理職10%以上は5行、非正規賃金比率100%超は3行、施行規則第2号の男性育休率100%超は1行、女性活躍法の育休率80%超は5行です。数値や欠損の意味を他社・他年度・他表へ一般化せず、企業拡張列や自動的な注記解釈は残工程とします。

この追加は固定配布物e673e8aの後のローカル実装です。

回帰確認: 全83ファイル・2,727テスト（1ワーカー）、build、公開API型検査に成功。
