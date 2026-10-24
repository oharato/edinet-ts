# 固定資産・固定負債・現金及び預金をSQLiteへ保存する

状態: この変更で追加する試験用API。専用Storeの追加115テストを含む全1,493テスト・型・build・保存保護と独立レビューが成功しています。限定実データと性能は下記の範囲で確認しました。公開CI・統合状態は[対応PR #46](https://github.com/oharato/edinet-ts/pull/46)を参照してください。本番利用可能とは扱いません。

一度読み取った3項目を専用の試験DBへ保存し、プログラムを終了して開き直した後も検索できます。「Store」は保存・読み出しをまとめたAPIです。[直接財務項目](FINANCIAL_DETAILS.md)の保存JSONを検査する仕組みを使い、元の文字列、採用・欠損などの状態、採用理由と候補、出典を残します。

## 対象と既存機能との違い

対象は日本基準（`J-GAAP`）・円（`JPY`）・明示した時点（`instant`）の次の3項目だけです。

| 定数 `FinancialDetailMetricId` | ID | 内容 |
|---|---|---|
| `NoncurrentAssets` | `noncurrentAssets` | 固定資産 |
| `NoncurrentLiabilities` | `noncurrentLiabilities` | 固定負債 |
| `CashAndDeposits` | `cashAndDeposits` | 現金及び預金 |

保存時は3項目の選択記録をすべて渡します。値が欠けていても`missing`などの記録として保存できます。記録を省いた2項目だけのsnapshotや、売上原価・CF・借入等を含むsnapshotは保存しません。`FINANCIAL_DETAIL_STORE_METRICS`がこの固定集合です。検索時は`metricIds`でその一部を指定できます。

これは`FinancialDetailSqliteStore`という別APIで、**CLIはまだありません**。[BS3＋流動比率のStore](FINANCIAL_SQLITE_STORE.md)、既存書類メタデータDB、21指標検索のDBや形式は変更しません。全15財務項目のSQL保存、流動比率、差分取り込み、訂正履歴、自動の最新選択は追加していません。

## 新しい試験DBへ保存し、開き直す

次は合成の会社コード・書類IDを使う例です。`./saved-report.xbrl`は利用者が指定するGit管理外の原本です。新しい一時フォルダを使い、既存利用中DBへ書き込みません。

```ts
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FinancialDetailSqliteStore, createFinancialDetailSnapshot,
  FINANCIAL_DETAIL_REGISTRY_VERSION, FinancialDetailMetricId,
  AccountingStandard, ConsolidationScope, ComparisonOperator, SortOrder
} from "edinet-ts";

const xml = readFileSync("./saved-report.xbrl", "utf8");
const snapshot = createFinancialDetailSnapshot(xml, {
  secCode: "1001", docID: "SYNTHETIC1",
  accountingStandard: AccountingStandard.JGAAP,
  scope: ConsolidationScope.Consolidated, currency: "JPY",
  period: { instant: "2025-03-31" }
}); // instantの既定3項目を保持
const provenance = {
  extractorVersion: "local-extractor-v1",
  mappingVersion: FINANCIAL_DETAIL_REGISTRY_VERSION,
  sourceSha256: createHash("sha256").update(xml).digest("hex")
};
const file = join(mkdtempSync(join(tmpdir(), "edinet-details-example-")), "details.sqlite");
const writer = new FinancialDetailSqliteStore(file);
let ids: string[];
try {
  ids = writer.putMany([{ snapshot, provenance }]).ids;
  // 同じ入力ならinserted:0、unchanged:1。原値を上書きしません。
  const repeated = writer.putMany([{ snapshot, provenance }]);
  console.log(repeated.inserted, repeated.unchanged);
} finally {
  writer.close();
}

const reader = new FinancialDetailSqliteStore(file, { readOnly: true });
try {
  const stored = reader.get(ids[0]); // 不明な形式のIDはエラー、存在しない正しい形式のIDはundefined
  const result = reader.screen({
    instant: "2025-03-31", scope: ConsolidationScope.Consolidated,
    accountingStandard: AccountingStandard.JGAAP, currency: "JPY",
    extractorVersion: provenance.extractorVersion,
    mappingVersion: provenance.mappingVersion,
    snapshotIds: ids
  }, {
    metricIds: [FinancialDetailMetricId.CashAndDeposits],
    conditions: [{ metric: FinancialDetailMetricId.CashAndDeposits,
      operator: ComparisonOperator.GreaterThanOrEqual, value: 0 }],
    sortBy: FinancialDetailMetricId.CashAndDeposits,
    order: SortOrder.Descending, limit: 20
  });
  console.log(stored?.id, result.total, result.excludedRows);
} finally {
  reader.close();
}
```

例の基準・範囲・日付・識別子は、実際に使う原本に合わせて確認してください。`provenance`は「どの原本・解析コード・対応表を使ったか」という記録です。`sourceSha256`は小文字16進64文字、任意の`sourceCommit`は小文字16進40文字です。版の文字列は空白だけを許さず256文字以内です。版や会社コードと原本の対応は利用側の宣言で、公式情報との一致や原本の真正性を認証しません。

この例のhashは渡したXML文字列のUTF-8表現を対象にします。別の文字コードから変換した場合は原ファイルbyte列と同じhashとは限りません。保存した原本を識別するhashの作り方を、利用側で統一してください。

## 保存・再実行・版の扱い

- `putMany(inputs)`は`inserted`・`unchanged`・入力順の`ids`を返します。同じ保存ID・内容は再追加せず、同一batchの重複入力も`unchanged`として数えます。
- 保存IDにはmetadataと原本hash・解析版・対応表版等を使います。版を変えた再解析は旧版を残して別IDになります。同じ版・保存IDなのに内容が変われば停止します。
- 同じdocIDで証券コードまたは原本hashが異なれば、上書きせず停止します。訂正・差し替えの自動判断はしません。
- 一括保存の途中で失敗した場合は、そのbatchを保存しません。保存の前後で全保存行を検査します。

`screen(cohort, options)`の`cohort`は、比較対象の時点・連結/単体・基準・通貨・解析版・対応表版を明示する指定です。同じ会社や書類の候補が複数あれば、自動で最新版を選ばずエラーにします。`snapshotIds`で使う版を指定してください。IDが対象範囲や版と合わない場合もエラーです。空のID配列は空集合になります。

検索設定は[保存JSON検索](FINANCIAL_DETAILS.md#保存jsonの原値出典を検査して検索する)と共通です。条件・並べ替えに使う項目は`metricIds`に含めます。既定は固定3項目、並べ替え指定時は既定降順、同値は証券コード・docID昇順です。`total`はページ指定前の一致数、`excludedRows`は必要項目が使えない行数、`filteredRows`は利用可能だが条件不一致の行数です。`reasonCounts`は行数ではなく、項目ごとの診断件数です。

欠損・未対応・曖昧・安全なnumberを作れない値を0へ置き換えません。実際の0と負数は元の直接財務APIどおり保持します。検索に使わない項目の欠損だけでは行を除外しませんが、その項目を返す指定なら診断へ残します。

## SQLとTypeScriptが行うこと

1. TypeScriptで固定DB形式と**全保存行**を検査します。保存JSONから選択結果を再検査し、検索用データ・metadata・内容hashとの整合を確かめます。
2. SQLで同じ対象範囲・版を選び、数値条件、件数、診断、順序、ページを処理します。
3. 返すページを再びTypeScriptの保存JSON検索に通し、SQLとの一致を確認します。

金額は元のdecimal文字列を残し、検索には既存APIが安全と判断した`safeNumber`を使います。安全に変換できない原値をSQLiteの整数や`REAL`へ押し込んで検索可能にしません。このStoreには比率の近似値検索を追加していません。

全件検査を行う小規模設計のため、SQLを使うことだけで高速になるとは限りません。下記の200行の試験では、SQLite検索はJSON検索より遅い結果でした。全市場の速度・規模は保証しません。内容hashは偶発的な変更の検出用で、署名・改ざん防止や原本認証ではありません。

## 読み取り専用と既存DBの保護

新規DBは既存でないファイルを排他的に作成します。親フォルダは用意してください。既存ファイルはこのStoreの専用形式だけを受け付け、空DB・他用途DB・BS3 DBを自動変換しません。`:memory:`も使えますが、未作成のメモリDBをreadOnlyで開くことはできません。

既存DBの確認は**256MiB以下の停止済み通常ファイル**に限ります。`-wal`・`-shm`・`-journal`があるDB、symlink等は拒否します。元ファイルを直接readOnly接続してもSQLiteが副ファイルを作る場合があるため、形式確認には私有の一時コピーを使います。

`readOnly:true`ではそのコピーだけを読みます。**開いた時点の内容に固定**され、後から元DBに追加されたデータは反映されません。再度開く必要があります。`close()`で接続と私有コピーを片付けます。ライブ更新中のDBを安全に共有・監視する仕組みではありません。

## 通常のSQLiteクライアントで読む

保存形式はkind=`edinet-ts-financial-detail-instant`、schema version=`1`です。`detail_metric_values` viewで検索用の項目を読めます。外部クライアントも副ファイルを作り得るため、停止済み試験DBの別コピーを読み取り専用で開いてください。

```sql
SELECT sec_code, doc_id, instant, metric_id,
       raw_text, status, reason, available, numeric_value, unit, source_json
FROM detail_metric_values
WHERE metric_id = 'cashAndDeposits'
ORDER BY sec_code, doc_id;
```

`raw_text`は元の文字列、`numeric_value`は検索用数値、`available`は安全な数値を検索に使えるかを示します。欠損等は`status`・`reason`で区別できます。viewの`source_json`は採用元で、全候補を含む保存記録は`detail_snapshots.record_json`にあります。

外部SQLは閲覧用です。APIの全件検査・範囲/版検査・重複検査と同じ安全性を、このSELECTが提供するわけではありません。**外部書き込み、列・table・view・index・triggerの追加や変更は非対応**です。schema1の固定構造を検査するため、追加indexも拒否します。元DBの構造を変更せず、必要な独自分析は別のコピーや別DBで行ってください。

## 確認済みの範囲と残り

専用の合成テスト115件で、保存と再open、条件・順序・件数・ページ・診断のJSON検索との同等性、欠損/精度/破損/矛盾停止、版選択、失敗時の一括取り消し、既存DB保護を確認しています。Node26.12.1で全1,493テスト、本体と型付き利用例の型検査、build、Python保存保護5件が成功しました。独立レビューはsource229確認・ビルド済み229確認・CJS公開入口が成功しています。公開CI・統合状態は対応PRを参照してください。

保存済み2社・2時点・連結/単体の8snapshot、計24項目はすべて採用され、再open後のSQL検索とJSON検索180件が一致しました。同じ入力の再取り込みは8件とも`unchanged`で、原本2件も不変でした。2026年有報の前年列を含む確認で、2025年に別提出されたXBRL原本は取得できていません。この3項目について新たなPDF表示値との独立照合はしておらず、全市場の充足率確認でもありません。実原本・金額・DBはGitへ含めません。

性能はNode26.12.1のローカル環境で、保存済み1社のsnapshotを会社コード・docIDだけ変えて複製した200行・3項目を使いました。200社の実データではありません。固定資産等の値は同じ試験複製です。現金及び預金の降順・20件ページを10回検索し、毎回の全行検査を含めています。単回のローカル測定で、ファイルキャッシュが温まった状態です。複数環境・繰り返し実験の統計や全市場性能の予測には使えません。

| 操作 | 実測 |
|---|---|
| 新規DB作成（1回） | 6.5ms |
| 200行の一括保存（1回） | 493.4ms |
| 閉じたDBを開き直す（1回） | 3.6ms |
| SQLite検索（10回の合計） | 2,094.1ms |
| JSON検索（10回の合計） | 881.0ms |
| 保存DB容量 | 2,514,944bytes |

SQLiteの検索時間には保存内容の検査を含むため、純粋なSQL文だけの速度比較ではありません。この条件でSQLiteが遅かった事実と、全市場での速度が未検証であることを分けて扱います。

本番移行、全社取得、訂正全履歴、会社・人的資本・PL/CF/借入明細の保存、CLI、定期更新は未実装です。[全体計画の段階7](plans/EDINET_TS_ROADMAP.md#7-永続索引差分更新)に沿う有限の試作として扱います。
