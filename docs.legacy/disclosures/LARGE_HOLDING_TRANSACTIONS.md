# 大量保有報告の取引表（原本限定）

`extractLargeHoldingTransactions(document)` は最近60日取引TextBlockの既知7列を読み、`searchLargeHoldingTransactions(documents, options)` は報告された日付・種類・市場内外・取得処分で検索します。親/訂正/競合訂正を同時に渡すと拒否します。先に一覧の訂正系列を選択してください。親factの補完や全文再構成は行いません。

数量・割合・単価は表示原値とscale1のdecimalだけを保持し、`unit: not-stated` です。株/口/%/JPY・割合の分母を認証しません。普通株式/新株予約権の原表記を分け、空単価を0や市場価格に補完しません。`reportedDate` は原文の暦文字列の解析結果で、実取引日の認証ではありません。原記載2020年を2025年へ直したり、表題の60日条件で黙って落としません。

metadataのknownAt/submitDateTimeは呼出元提供値であり、この関数は公式観測との照合を認証しません。cutoffは提供metadataへのフィルタです。XML表紙日を取得時刻へ読み替えません。保持者の法的同一性も認証しません。

形式は正確な7列・1table・非結合データセル・既知namespace/contextに限定します。別見出し、多table、mergedセル、同値を含む重複TextBlockは保留します。欠落/nil/ヘッダのみ/全blank物理行は分離し、無取引の証明にはしません。数値を単位跨ぎで比較/合計する検索はありません。

旧5保有指標、旧report JSON、既存Store形式/CLIは不変です。今回は独立したopt-in抽出/検索APIであり、全形式/全市場/全文再構成は残工程です。

保存6原本を限定再生し83行/単価空欄65を確認しました。親と訂正の市場外4月23日の2行を88500000→8850000として別々に保持し、旧6reportの全保存JSONは一致。83行/581セルを独立XML台帳と比較し、62行はPDFにも一致しました。訂正S100W23Pの残21行はXMLのみの照合です。部分訂正PDFだけで訂正後全文を照合済みとはしません。独立証跡は `data/roadmap/large-holding-transaction-domain-review-20261031/sdk-independent-comparison.json` です。

公開barrelへopt-in抽出/検索APIと型を追加し、metadataとdocIDのgetterを各一度だけ読むことも確認しています。関連する既存/新規2ファイル27テストと公開型検査が成功しました。全形式/全市場対応は残工程です。親のテスト・型検査・getter証跡は `data/roadmap/large-holding-transactions-staged-20261031/parent-root-verification.json`。

## CLIで取引表を検索する

`screen-large-holding-transactions` はAPIと同じ原本限定の検索です。manifestは既存の `screen-large-holdings` と同じ `file` / `metadata` の配列で、fileはmanifestのあるディレクトリから解決します。metadataにはAPIと同じ書類・提出日時・knownAt等を指定します。

```sh
edinet-ts screen-large-holding-transactions \
  --manifest ./reports/manifest.json \
  --cutoff 2026-10-29T00:00:00Z \
  --reported-start-date 2025-04-01 \
  --reported-end-date 2025-04-30 \
  --instrument ordinary-shares --market off-market --action acquisition \
  --limit 100 --pretty
```

`--issuer-edinet-code` で発行者、`--offset` / `--limit` で表示範囲を指定できます。結果の `reports` は原本別の根拠、`rows` は検索結果、`matched` はページ分割前の該当件数です。親と訂正、競合する訂正、同じ書類を同時に渡すと失敗します。CLIは訂正系列を自動選択しません。

入力は100原本、1原本2MiB、合計32MiBまでです。不正UTF-8や入力超過・条件不正は終了コード1となり、入力内容をエラーへ出しません。数量・割合・単価の単位認証や合算は行いません。保存は次のStore経路を使います。

## 保存した取引表を再検索する

既存の `LargeHoldingStore.append(observations, sources)` と `import-large-holdings` は、原XMLから保有指標と取引表を同時に解析します。DBには原セル・解析結果・原本hashを保存し、原XMLは保存しません。取引検索は保存結果だけで動作します。

```ts
const store = new LargeHoldingStore("holdings.sqlite", { readOnly: true });
try {
  const result = store.searchTransactions({
    cutoff: "2026-10-31T23:59:59Z",
    action: "acquisition",
  });
} finally {
  store.close();
}
```

```sh
edinet-ts search-large-holding-transactions-store \
  --db holdings.sqlite --cutoff 2026-10-31T23:59:59Z \
  --action acquisition --pretty
```

Storeは一覧観測から訂正系列を選び、cutoff以前に利用可能な原本宣言を確認してから検索します。訂正原本が未取得・未解析・競合の場合、親の取引へ戻しません。`selection` と `unavailableSources` で採用・保留理由を確認できます。cutoffは保存された観測と原本宣言に基づき、実取引日の認証ではありません。

旧DBの保有指標検索は継続できます。取引解析結果のないsnapshotは `transactions-not-materialized` として保留します。同じhashの原XMLを再投入すると、保有指標を変えずに取引解析結果を補完できます。2MiB超の原XMLは従来どおり保有指標を保存しますが、取引は `source-too-large` となります。取引解析に失敗した原本は `source-parse-failed` として区別します。

一検索は最大100原本・10,000取引行・保存本文合計32MiBです。上限超過時は発行者等で検索集合を分けてください。全レコードの整合性検査では、取引の数値・日付・分類と行キーを保存原セルから再計算します。これは保存内容の整合性検査であり、原本や法人同一性の外部認証ではありません。全市場の性能・移行運用・他形式への対応は引き続き検証が必要です。
