# 大量保有報告の取引表（原本限定）

`extractLargeHoldingTransactions(document)` は最近60日取引TextBlockの既知7列を読み、`searchLargeHoldingTransactions(documents, options)` は報告された日付・種類・市場内外・取得処分で検索します。親/訂正/競合訂正を同時に渡すと拒否します。先に一覧の訂正系列を選択してください。親factの補完や全文再構成は行いません。

数量・割合・単価は表示原値とscale1のdecimalだけを保持し、`unit: not-stated` です。株/口/%/JPY・割合の分母を認証しません。普通株式/新株予約権の原表記を分け、空単価を0や市場価格に補完しません。`reportedDate` は原文の暦文字列の解析結果で、実取引日の認証ではありません。原記載2020年を2025年へ直したり、表題の60日条件で黙って落としません。

metadataのknownAt/submitDateTimeは呼出元提供値であり、この関数は公式観測との照合を認証しません。cutoffは提供metadataへのフィルタです。XML表紙日を取得時刻へ読み替えません。保持者の法的同一性も認証しません。

形式は正確な7列・1table・非結合データセル・既知namespace/contextに限定します。別見出し、多table、mergedセル、同値を含む重複TextBlockは保留します。欠落/nil/ヘッダのみ/全blank物理行は分離し、無取引の証明にはしません。数値を単位跨ぎで比較/合計する検索はありません。

旧5保有指標、旧report JSON、既存Store形式/CLIは不変です。今回は独立したopt-in抽出/検索APIであり、取引永続索引・CLI接続・全形式/全市場/全文再構成は残工程です。

保存6原本を限定再生し83行/単価空欄65を確認しました。親と訂正の市場外4月23日の2行を88500000→8850000として別々に保持し、旧6reportの全保存JSONは一致。83行/581セルを独立XML台帳と比較し、62行はPDFにも一致しました。訂正S100W23Pの残21行はXMLのみの照合です。部分訂正PDFだけで訂正後全文を照合済みとはしません。独立証跡は `data/roadmap/large-holding-transaction-domain-review-20261031/sdk-independent-comparison.json` です。

公開barrelへopt-in抽出/検索APIと型を追加し、metadataとdocIDのgetterを各一度だけ読むことも確認しています。関連する既存/新規2ファイル27テストと公開型検査が成功しました。全体build、取引永続Store、CLI接続、全形式/全市場対応は残工程です。親のテスト・型検査・getter証跡は `data/roadmap/large-holding-transactions-staged-20261031/parent-root-verification.json`。
