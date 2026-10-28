# 政策保有株式の直接記載と逆引き

`extractPolicyShareholdings` は `ShareholdingsTextBlock` の確認済み表から、純投資以外の集計、特定投資株式、みなし保有株式を分けて返します。`searchPolicyShareholdings` と `search-policy-shareholdings` CLIは、種類・期末・指標を指定して検索します。版は `POLICY_SHAREHOLDINGS_VERSION = "1"` です。

## 入力の確認

```ts
const document = {
  xml: savedXml,
  selection: { docID: "SAMPLE", kind: "policyShareholdings", contextRef: "FilingDateInstant" },
  periodEnds: { current: "2026-03-31", previous: "2025-03-31" },
  tables: [
    { tableIndex: 0, rawSha256: reviewedFragmentHash, kind: "non-pure-summary" },
    { tableIndex: 3, rawSha256: reviewedFragmentHash, kind: "specified", headingTableIndex: 3 },
    { tableIndex: 4, rawSha256: reviewedFragmentHash, kind: "specified", headingTableIndex: 3 },
    { tableIndex: 5, rawSha256: reviewedFragmentHash, kind: "deemed", headingTableIndex: 5 }
  ]
};
```

periodEndsは呼出元が原本を確認した宣言です。自動の会計年度認定ではなく、結果にも `periodBasis: "caller-reviewed"` と残します。前期より当期が後、当期末が本文の提出日context以前であることを検査します。本文contextは次元のないinstantに限ります。原本・本文hash、セル位置、元見出しと表外注記、context/entity/次元の証跡を保持します。

銘柄別表では、headingTableIndexが参照する表の直前本文の末尾が「特定投資株式」または「みなし保有株式」であることを確認します。継続表では、その間の表外本文が空である場合だけ同じ見出しを使えます。別の注記や純投資の節を越えて持ち越しません。集計は「純投資目的以外」の確認と、銘柄数/貸借対照表計上額の見出しを要します。

## 返す値と意味

| 種類 | 記載単位と指標 | 扱い |
|---|---|---|
| non-pure-summary | issueCount（銘柄）、reportedAmount（円） | 非上場株式と非上場株式以外を別記載として保持。当期のみ |
| specified | shares（株）、reportedAmount（円） | 特定投資株式の記載。簿価と株数を当期/前期に分ける |
| deemed | shares（株）、reportedAmount（円） | みなし保有の記載。貸借対照表そのものの簿価とは同一視しない |

円/千円/百万円、株/千株を十進文字列で換算し、元表示・倍率・見出し参照を残します。みなし保有では原見出しが「貸借対照表計上額」でも、注記が時価と議決権行使対象株数による金額と説明する実例があるため、指標名をreportedAmountとしています。amountDefinitionも `deemed-holding-reported-amount` とし、特定投資/集計の `balance-sheet-carrying-amount` と区別します。

ダッシュ/空欄/非対応数値と実際の0は別です。株数・銘柄数は換算後の整数だけ採用します。未知の見出し/単位や結合構造は理由を残します。保有目的と相互保有欄は原文で返し、「無だが子会社は有」等を単純な真偽値にしません。株式分割の説明から株数を修正したり売買量を計算したりしません。

銘柄ごとの上場区分は `not-established` です。集計区分の `other-than-non-listed` を「上場」と読み替えません。名義の法人同定は未実施、ownerScopeも未確定です。本文の提出者を全記載の実質保有者や連結範囲と自動認定しません。同名の特定投資/みなし保有や年度を合算しません。

## 検索

```ts
searchPolicyShareholdings([document], {
  kind: "specified", periodEnd: "2026-03-31", metric: "reportedAmount",
  nameContains: "原表の名前", condition: { operator: "gte", value: 100000000 },
  sort: "value-desc", offset: 0, limit: 100
});
```

listingClassで集計の非上場/その他を限定できます。条件は円・株・銘柄で、十進分数で比較します。結果はmatched、ページ対象rows、条件対象外filtered、未採用理由excludedと元抽出を返します。同じ提出者の複数原本は、訂正版・比較年度の重複を呼出元で選択してから入力してください。100原本/256MiB、100,000セル/10,000記載までです。永続索引ではありません。

```sh
edinet-ts search-policy-shareholdings --manifest reviewed.json \
  --kind deemed --period-end 2026-03-31 --metric shares \
  --condition '{"operator":"gte","value":1}' --sort value-desc
```

manifestは上記入力のxmlをfileに置き換えた配列です。fileはmanifest基準の相対パスも使用できます。UTF-8 BOMを保持し、入力エラーの内容は表示しません。

## 原本照合と残工程

保存済みのエクシオ/ミライト2年度、弘電社/ピーエス・コンストラクション/若築建設の2026年度、計7原本の302記載を確認しました。独立したXML処理で1,482原文参照・604見出し参照・14期末contextと、572数値/32ダッシュが一致しました。PDFでも記載順の2期数値対576値と集計28値を確認し、6検索を独立計算と照合しています。みなし保有の時価注記と、PDFで数値の行がずれる実例は画像でも確認しました。新規の外部取得や費用はありません。

索引化では、原本/本文hash、抽出版、提出者、種類、期末と宣言根拠、表/行/セル参照、名義、十進値/原単位/倍率/採用理由を保存する方針です。全形式、非上場銘柄別情報、保有主体・保有先の法人同定、目的変更/取得売却/時系列、株式分割の自動換算、永続保存は未完了です。役員/報酬と全体ロードマップの他段階も引き続き対象です。
