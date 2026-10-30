# 法人番号公表データの原記録

法人番号公表サイトのダウンロードXMLを読み、番号で原記録を探します。後半では、EDINET企業マスターの法人番号から同じ記録を参照する方法を説明します。

`parseCorporateRegistryDownloadXml(xml, source)` と `queryCorporateRegistryDownloads(inputs, query)` は、国税庁の30項目のダウンロードXMLを読みます。既存のXML安全検査を共有し、外部参照/DTDを拒否、1 XMLは64MiB以下・10万記録以下、検索は100入力/合計256MiB以下です。

全国全件XMLのストリーミング読取・CSV・Web-API応答は後続です。

```ts
const source = {
  sourceUrl: 'https://www.houjin-bangou.nta.go.jp/download/',
  observedAt: '2026-10-29T12:00:00Z', // 実際にこのデータを得た時刻
  dataDate: '2026-10-28',           // 取得ファイルの基準日/差分対象日を確認して宣言
  kind: 'diff' as const,
  purpose: 'download' as const     // 公式の架空サンプルは必ず sample
};
const document = parseCorporateRegistryDownloadXml(xml, source);
const result = queryCorporateRegistryDownloads([{xml, source}], {
  corporateNumber: '1010001001202', knownAt: source.observedAt
});
```

sourceは呼出元の宣言です。URLやhashだけで提供者の真正性を認証しません。

`inputXmlSha256` は入力文字列のUTF-8 hash、`recordNumber` はそのXML内の1始まりの記録位置です。公式の一連番号とは別です。

検索は13桁の法人番号を完全一致させ、sourceの実観測がcutoffより後なら `excludedSources` へ分けます。名称一致による名寄せや、過去時点の会社状態の認定はしません。

各記録は30項目すべてを `values` の文字列で返します。変更年月日・更新年月日・閉鎖年月日・指定年月日を混同せず、空欄、先頭0、外字イメージID、訂正/最新履歴/検索対象除外のフラグ、承継先番号を保持します。数値変換・住所の結合・外字の推定補完は行いません。

削除99も原記録として返し、空欄の会社情報を補いません。削除で本来空欄とされる列が非空なら `deletionExtraFields` に残します。

現行処理区分表にない2桁コードは `processKnown:false` とし、既知コードへ置換しません。公式サンプルには処理区分31と、削除行の検索対象除外フラグ0が含まれました。

サンプルと定義書の相違を無言で補正しないための診断です。

差分ファイルには同じ法人の過去履歴や訂正一式が含まれます。このAPIは原記録の検索であり、訂正/削除を適用した最新状態の合成器ではありません。`latest:1` を入力群全体の最新として選択せず、承継先をたどって別法人を自動統合しません。EDINET masterの法人番号への接続、状態再構成・永続保存/差分巡回は引き続き対象です。

## 出典と利用条件

出典: [国税庁法人番号公表サイト](https://www.houjin-bangou.nta.go.jp/download/)を加工して作成。形式は[リソース定義書4.1版](https://www.houjin-bangou.nta.go.jp/pc/download/images/k-resource-dl.pdf)、検証入力は同ページの令和4年4月サンプルを参照しました。

[利用規約](https://www.houjin-bangou.nta.go.jp/riyokiyaku/)は出典と加工の明示を求めており、出力sourceにもその文言を保持します。第三者の権利に係る情報は規約に従って扱います。

取得・API認証・課金・公表はこの読取APIから実行しません。検証で取得したのは公開仕様書と公式サンプルです。サンプルは実在企業の照合や最新データの検証に使いません。

独立Python/XML処理で、全件/差分の公式55 XML・5,208記録・156,240項目、原XML hash、未知処理区分と削除追加列の診断が一致しました。これは公開サンプルによる形式検証です。

検証: 全135ファイル/3,671テスト・型・buildが成功。source/built/CommonJSで全55入力と法人番号検索6件が一致し、6検索の行/順序/出典も独立処理で照合。配布用NodeNext型検査も成功しました。この時点では固定配布物53eb2adへ未反映でした。現在は3cc4618と利用先vendorへ反映済みです。

## EDINETマスターからの番号参照

`linkCompanyMasterCorporateRecords(snapshots, inputs, query)` は、会社マスターのas-of/knownAt検索と同じ条件に、必須の `registryPurpose: "download" | "sample"` を加えます。選択した企業の法人番号を完全一致で照合し、元のEDINET ID・会社行、NTA原記録の出典/位置を保持します。

名称の類似度や承継先への追跡では結合しません。結果の `query` にcutoff・基準日・フィルタも残します。

`number-matched` は単一の原記録に番号が一致したという意味です。法人の最新状態や名称・住所の一致、上場の継続、同一法人の認証ではありません。閉鎖等の記録であっても原処理区分/日付を保持します。EDINET側の名称等はNTA値で上書きしません。

番号なし/入力内に記録なしは `unavailable` とし、法人の不在とは断定しません。EDINET側の番号共有・NTA複数記録・削除・未知処理・訂正/過去記録は理由付きの `unresolved`。最新フラグや配列順で勝手に一件へ絞りません。番号共有の検査は検索フィルタ外も含めた同じmaster全体を使い、別EDINET IDを統合しません。

目的が違うsource、実観測がcutoffより後のsource、基準日がas-ofより後のsourceは、それぞれ `excludedSources` へ分けます。架空サンプルはsample目的で分離し、download目的へ混ぜません。日次差分を完全な企業集合や会社状態へ読み替えない入口です。

### 実データの限定照合

公式の2026-10-28日次差分を取得し、[公開PGP鍵](https://www.houjin-bangou.nta.go.jp/download/kokaikagi/)のフィンガープリントとの一致と署名の検証に成功しました。SDKの全XMLに署名検証を自動実行する機能ではなく、この検証入力に対して行った確認です。

独立XML処理で全2,181記録/65,430項目と原本hashが一致。2026-10-29基準のEDINET master全11,432行と照合し、候補あり9提出者（単一番号一致7、訂正/過去記録1、複数記録1）を確認。

番号なし4,154・入力内に記録なし7,269は補完しません。上場区分3,812行中では4提出者に候補がありました。

全行と上場のみの行・順序・各候補・両出典が独立処理と一致しました。

これは当日差分への原記録参照の確認です。全国全件masterの構築・完全履歴の再構成、すべてのEDINET法人番号の検証や本番反映は残工程です。

番号参照追加の検証: 全136ファイル/3,683テスト・型・build・公開NodeNext型が成功。実データの全master/上場のみの結果はsource/built/CommonJSで完全一致しました。

初回回帰は結果へquery条件の保持を追加するため停止し、追加後に全件を再実行した結果です。現在は固定配布物3cc4618/利用先vendorへ反映済みで、状態再構成と完全な法人結合・利用先の実運用は残工程です。
