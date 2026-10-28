# 役員の現任・予定と原表の明細

`extractOfficerDetails` は `InformationAboutOfficersTextBlock` の確認済み役員一覧から、役職・氏名・生年月日原文・略歴・任期参照・所有株式数を保持します。`searchOfficerDetails` と `search-officers` CLIで逆引きできます。版は `OFFICER_DETAILS_VERSION = "1"` です。

## 表と状態の根拠

```ts
const document = {
  xml: savedXml,
  selection: { docID: "SAMPLE", kind: "officers", contextRef: "FilingDateInstant" },
  tables: [
    { tableIndex: 0, rawSha256: reviewedFragmentHash, status: "as-filed", evidenceTableIndex: 0 },
    { tableIndex: 1, rawSha256: reviewedFragmentHash, status: "as-filed", evidenceTableIndex: 0 },
    { tableIndex: 5, rawSha256: reviewedFragmentHash, status: "proposed", evidenceTableIndex: 5 }
  ]
};
```

位置と本文hashを指定し、evidenceTableIndexで表直前の状態説明を参照します。現任は「年月日（有価証券報告書提出日）現在の当社の役員の状況」の日付が本文contextのinstantと一致することを検査します。予定は「年月日開催予定」と議案が承認可決される場合の説明を確認し、開催予定日をrosterDateにします。予定日は就任の確認日ではなく、dateBasisも `scheduled-meeting-date-in-prefix` と区別します。

継続表では間の表外本文が空の場合だけ同じ根拠を使えます。別の注記、補欠役員、執行役員一覧などを越えて状態を持ち越しません。異なる/不正な日付、提出日より前の予定、複数予定日や状態の競合は理由を残して採用しません。本文contextは次元のないinstantです。自動の人物同定・役員履歴や、観測時点cutoff付き検索ではありません。

## 原文・株数・略歴

namedの個人行とreported-totalの原表合計を分けます。合計を個人行の加算で作り直しません。同じ人が現任表と予定表にいても別記載とし、rowKeyは原本/本文hash・表/行・状態/日付から生成します。

株/百株/千株を十進文字列で株単位に換算し、元表示、倍率、見出し・セル参照を返します。換算後に半株が残る値は採用しません。ダッシュ、空欄、不正数値と実際の0を分けます。役職や氏名の空白、戸籍名/旧姓、生年月日/任期の注番号は原文を保持し、名寄せ・年齢・任期末を推測しません。社外役員かどうかを略歴だけから認定しません。

役員本文に限り、略歴欄内の入れ子表をテキストとして保持できます。本文表APIのtablesは外側の表だけで、セルのnestedTableCountに内側の表数を記録します。元の入れ子構造はrawFragmentで参照できます。内部の年表を別の役員行として数えず、構造化された経歴イベントとも呼びません。役職/氏名/株数等の欄に入れ子がある行は採用しません。他の本文領域は入れ子表を引き続き非対応とします。

入れ子も表数200・行数5,000・セル数50,000・深さ/ノード/本文量の検査に含みます。内側の結合セルを展開して数値表へ昇格させません。HTMLは実行・描画しません。

## 検索とCLI

```ts
// 株数がダッシュの人も氏名・役職・略歴で検索できる
searchOfficerDetails([document], {
  metric: "record", status: "as-filed", rosterDate: "2026-06-24",
  role: "named", biographyContains: "原文に含まれる文字列"
});
// 株数条件では欠損理由をexcludedへ残す
searchOfficerDetails([document], {
  metric: "reportedShares", status: "proposed", rosterDate: "2026-06-26",
  role: "named", condition: { operator: "gte", value: 10000 }, sort: "value-desc"
});
```

recordでは数値条件/数値順序を指定できません。nameContains/positionContains/biographyContainsは原文の部分一致です。reportedSharesは厳密な十進比較で、株数が未採用の行を理由付きで除外します。offset/limitとmatched/filtered/excluded、元抽出を返します。100原本/256MiB、100,000外側セル/10,000役員記載まで。同じ提出者の複数原本は訂正・年度を選んでから入力します。

```sh
edinet-ts search-officers --manifest reviewed.json \
  --metric record --status as-filed --roster-date 2026-06-24 \
  --role named --position-contains 取締役
```

manifestはxmlをfileに置き換えた配列です。fileはmanifest基準の相対パスも使えます。UTF-8 BOMを保持し、入力エラー内容は表示しません。

## 原本照合と残工程

保存済みのエクシオ/ミライト2年度と、弘電社/ピーエス・コンストラクション/若築建設2026年度、計7原本から196記載（個人行183・原表合計13）を確認しました。独立XML処理で外側1,715セル、入れ子を含む146セル、1,124項目参照と151数値/45ダッシュが一致しました。PDFで株数196記載、主たる氏名表記183記載、52表の日付根拠も確認し、6検索が独立計算と一致しました。原文の戸籍名・旧姓はXMLの参照で確認し、PDF上で全注記を人物同定したとはしません。現任と予定の冒頭表は画像でも確認しました。新規取得・有料サービスの利用はありません。

索引化では、提出者・原本/本文hash・抽出版・表/行/セル・状態/根拠日付・記載原文・株数十進値/原単位/倍率/採用理由を保存する方針です。補欠/執行役員の別形式、社外属性/任期の自動注記解釈、人物同定、経歴イベント・就退任履歴、永続索引は未完了です。役員報酬の区分/個人明細と他段階も引き続き対象です。
