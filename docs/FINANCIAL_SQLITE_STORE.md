# 財務3項目と流動比率をSQLiteに保存して検索する

状態: #30/#31が正式stack #32からmain `a5fb840`へ統合済みの小規模試作です。未リリースです。既存の書類一覧DBとは別の、試験用DBだけを使っています。

同じXBRLを毎回解析する代わりに、取り出した財務3項目と出典を保存し、DBを閉じて開き直した後も条件で探せるようにします。対象は日本基準・円の流動資産、流動負債、負債合計と、そこから求める流動比率です。比率は[既存の計算方法](CURRENT_RATIO.md)と同じく小数1=100%、2=200%です。

**全社財務DBや本番移行を完成させたものではありません。** 今回の追加はプログラムから呼ぶAPIだけです。既存の`screen`・`screen-bs`はメモリ検索のままで、自動保存へ切り替えていません。

## 使い方

```ts
import { createHash } from "node:crypto";
import { BalanceSheetSqliteStore, createBalanceSheetSnapshot,
    BALANCE_SHEET_REGISTRY_VERSION, BalanceSheetScreeningMetric,
    AccountingStandard, ConsolidationScope, ComparisonOperator,
    SortOrder } from "edinet-ts";

// xmlは利用者が保持する原本のコピー。例の識別子は合成です。
const metadata = { secCode: "1001", docID: "SYNTHETIC1", instant: "2025-03-31",
    scope: ConsolidationScope.Consolidated,
    accountingStandard: AccountingStandard.JGAAP, currency: "JPY" as const };
const snapshot = createBalanceSheetSnapshot(xml, metadata);
const provenance = { extractorVersion: "my-tested-parser-v1",
    mappingVersion: BALANCE_SHEET_REGISTRY_VERSION,
    sourceSha256: createHash("sha256").update(xml).digest("hex") };

// 必ず新しい試験用パスを指定。既存の書類一覧DBへ接続しません。
const db = new BalanceSheetSqliteStore("./test-financial.sqlite");
try {
    const saved = db.putMany([{ snapshot, provenance }]);
    console.log(saved.inserted, saved.unchanged, saved.ids);
} finally { db.close(); }

const reader = new BalanceSheetSqliteStore("./test-financial.sqlite", { readOnly: true });
try {
    const result = reader.search({ instant: metadata.instant, scope: metadata.scope,
        accountingStandard: metadata.accountingStandard, currency: metadata.currency,
        extractorVersion: provenance.extractorVersion, mappingVersion: provenance.mappingVersion }, {
        conditions: [{ metric: BalanceSheetScreeningMetric.CurrentRatio,
            operator: ComparisonOperator.GreaterThanOrEqual, value: 2 }],
        sortBy: BalanceSheetScreeningMetric.CurrentRatio,
        order: SortOrder.Descending, offset: 0, limit: 20
    });
    console.log(result.rows, result.total, result.excludedRows, result.diagnostics);
} finally { reader.close(); }
```

`putMany()`は複数件をまとめて保存し、`get(id)`は原値・出典・保存時の版を読み出します。`search()`の結果形と条件・順序・除外の意味は、既存の`screenBalanceSheetSnapshots()`に合わせています。結果に出す数値がないときは0で補いません。

抽出器の版（`extractorVersion`）は処理の意味が変わったら利用者が更新します。対応表の版（`mappingVersion`）と原本のSHA256は必須で、必要なら元コードの40桁commitを`sourceCommit`に付けられます。ハッシュとcommitは小文字16進文字列です。これらは入力された情報であり、このAPIが実行ビルドや物理的な原本を自動証明するわけではありません。過去の抽出器を切り替えて実行する機能はなく、読み戻しの再検証は現在の実装で行います。将来処理の意味が変わる場合の形式互換・移行は別途必要です。原本そのものと保存場所は利用側で保持し、DBには書類ID・内容ハッシュ・選択根拠を残します。

## 比較する範囲と版を明示する

検索には、同じ対象日・連結か単体か・日本基準・円・抽出器の版・対応表の版が必要です。DBには異なる日付や範囲を別レコードとして保存できますが、検索では指定した同一範囲だけを選びます。異なる時点の値を足して比率を作りません。

同じ会社や書類の複数版が、その範囲に入るとエラーにします。最新・訂正後などを推測で一つに選びません。必要な版だけを`cohort.snapshotIds`に指定してください。このID一覧が不明・重複、または指定範囲と異なる日付・連結範囲・抽出版を含むと拒否します。空配列は検索対象0件です。

同じ会社・書類・時点・範囲・基準・通貨・出典の版で同じ内容を再投入した場合、`unchanged`として件数を増やしません。同じIDで内容だけ違うと更新せず、バッチ全体を戻します。訂正履歴の自動統合や提出時点の自動選択は対象外です。

## SQLとTypeScriptの分担

| 処理 | 実際に担当する場所 |
|---|---|
| 指定日・範囲・抽出版・ID一覧の選択、会社/書類重複の検出 | SQL。範囲の複合索引を使用 |
| 保存内容の整合性チェック | SQLから呼ぶTypeScriptのハッシュ関数。条件で行を落とす前に、選択範囲全体を確認 |
| 金額3項目の条件・並べ替え・ページ指定 | SQL。保存した利用可能な値を使用 |
| 流動比率の条件 | SQLの`WHERE`から接続専用の`edinet_fraction_compare`を呼ぶ。その関数内でTypeScriptのBigInt分数を厳密比較 |
| 流動比率の並べ替え・ページ指定 | SQLで条件一致候補のID・証券コード・分子分母だけを読み、TypeScriptが厳密に並べてからページ指定 |
| 総件数・除外件数・条件不一致件数、診断用の行 | SQLで集計・選択し、TypeScriptで既存の返値形式へ整形 |
| 返却ページの元情報・計算結果 | ページ分だけ読み直して再検証し、既存APIで必要項目と計算を再確認 |

比率の並べ替え前に、近似値のSQL順序や`LIMIT/OFFSET`で候補を落としません。SQLで全処理を完結する実装ではありません。比率の並べ替えには、条件一致候補数に応じたTypeScript側の時間とメモリが必要です。

SQLの比率比較へNULL分数を渡さないよう、未計算の状態を先に分けます。分数の積はSQLiteの64bit整数ではなくBigIntで求めるため、積が64bitを超えるケースや、number表示が同じになる異なる分数も区別します。`REAL`の近似値だけで比率の条件や順序を決めません。

## 保存するものと形式

試作では、次の小さな形式を選びました。本番用の最終スキーマや移行方式を確定したものではありません。

- `financial_store_meta`: このDBの用途と保存形式の版（1）。別用途のDBや未対応版は変更せず拒否します。
- `financial_snapshots`: 書類・会社・対象日・範囲・会計基準・通貨・抽出版・原本ハッシュと、元のsnapshot/provenanceを含む`record_json`、検索用の`projection_json`、整合性用ハッシュ。
- `financial_cohort`: 同じ対象日・範囲・基準・通貨・抽出版を選ぶ複合索引。
- `financial_metric_values`: 一般のSQLiteクライアントから読みやすくしたview（保存済みJSONを表として見せる仕組み）。4項目の状態、元の数値文字列、表示用値、比率の分子分母を公開します。

元の数値文字列、タグ、名前空間、context、対象期間、entity、単位、`decimals`、明細次元、候補と採用/不採用理由をsnapshot内に保持します。比率の元金額2項目と、計算後の約分済み分子・分母も追えます。原数値を整数64bitやREALへ置き換えて捨てません。

optionalな`undefined`はJSONでは省略します。`-0`は原値の文字列に残し、APIの読み戻しではその原値からsafeNumberを復元します。循環参照、BigInt等のJSONへ保存できない値、疎配列・配列の追加属性、不正なprovenanceは黙って変換せず拒否します。

## 通常のSQLiteクライアントでできること

アプリを閉じた後も、JSON関数が使えるSQLiteクライアントでメタデータ・原数値・選択状態・分数を読めます。たとえば次のSQLです。

```sql
SELECT sec_code, doc_id, instant, scope, metric_id,
       extractor_version, mapping_version, available, raw_text, value_approx, numerator, denominator, reason
FROM financial_metric_values
WHERE instant = '2025-03-31' AND metric_id = 'currentRatio';
```

`record_json`を`json_extract()`で読めば、元タグや採用元の詳細も確認できます。ただし、通常の別接続にはアプリの`edinet_fraction_compare`やハッシュ検査関数は登録されません。`value_approx`での比率比較は近似であり、APIの厳密比較と同じ保証にはなりません。SQL内で分子分母をそのまま掛ける方法にも整数あふれの問題があります。

外部クライアントは読み取り用途を想定しています。SQLから保存JSON・投影値・ハッシュを直接書き換える操作はサポートしません。ハッシュは選択した範囲の偶発的な破損を検出するためのもので、全DBの真正性や悪意ある書き換えがないことを証明しません。外部SQLで索引用の日付等を変えて元の範囲の外へ移した行は、元の範囲の検索では検査対象になりません。

## 途中失敗と既存データの保護

取り込みは一つのトランザクションで行い、入力不正、内容衝突、SQL失敗では一部だけを残しません。検索も一つの読み取りトランザクションで、途中で別接続の更新が混じった件数・ページを組み立てないようにしています。文は使用後にcloseします。

既存の書類メタデータDBへの自動移行や、利用中DB・キャッシュの更新は行いません。別用途DBの拒否で内容ハッシュが変わらないこと、readOnly、busy失敗後の再開、二重実行、closeと再openを一時DBで確認しています。

## 検証結果

- Node 26.12.1でbuild、型検査、型の使用例、全635テスト（新規107件）、保存保護Python 5件が成功。lint設定はありません。
- 再open後の金額だけの条件、不要項目の欠損、比率の境界・分母0・負値・不安全な値・同値分数・極小値・ページ・混在・複数版・原子性・破損検出を検証しました。
- 独立レビューでも、11件の合成入力に対する540検索を既存メモリ版と比較し全件一致。指摘された返却時の必要項目、NULL分数のガード、配列型境界は修正・回帰化しました。
- 保存済みエクシオとミライト・ワンの実2社・2時点（2025/2026年3月末）を新しい試験DBへ保存し、再open後の4レコード・原値・出典・版が一致しました。公式PDF表示金額から独立に作った期待値に基づく比率64件・金額42件・ページ/空結果6件、計112検索が成功しました。

実2時点のXBRLは2026年有報の当期・前期列です。2025年当時の別XBRL原本を追加取得した結果ではありません。今回の実装では取得再試行を行っていません。原本・金額・試験DB・詳細結果はGit管理外に保持しています。

## 性能・容量の小規模な実測

再現用スクリプトは`scripts/benchmark-balance-sheet-store.ts`です。合成入力だけを作り、一時DBを削除して終了します。

```sh
node --import tsx scripts/benchmark-balance-sheet-store.ts 100 500 1000
```

2026-10-24、Linux x64、Intel Core i5-7260U 2.20GHz、Node 26.12.1、SQLite 3.54.0。各条件1回のウォームアップ後に5回交互に測り、中央値を記録しました。対象は同一範囲の合成データで、金額条件と比率条件をそれぞれ指定し、降順で最大20件を返します。XMLの合成・解析は取り込み/検索の時間に含めず、保存版検索には整合性検査と返却ページの再検証を含めています。

| 件数 | DB容量 MiB | 取り込み ms | 金額検索 ms（保存版 / メモリ） | 比率検索 ms（保存版 / メモリ） |
|---:|---:|---:|---:|---:|
| 100 | 0.48 | 79.55 | 20.53 / 6.58 | 22.99 / 9.32 |
| 500 | 2.30 | 285.37 | 37.06 / 29.53 | 43.02 / 41.62 |
| 1000 | 4.57 | 461.77 | 59.67 / 59.42 | 70.53 / 79.01 |

再openは0.30〜0.32msでした。範囲選択で`financial_cohort`索引が使われることも確認しました。同一プロセスでメモリ用入力も保持した測定で、RSSは約111/132/175MiBです。これはSQL接続だけのメモリや各検索のピーク使用量ではありません。SQLite側のメモリ量を分離した測定は未実施です。

少量では保存版がメモリ版より遅い条件があります。1000件までの限定測定で、全市場や同時利用・長期更新の性能は未確認です。保存による再利用はできても、一般に高速になったという保証はしていません。

## 選んだ理由と次に残すこと

既存のnode:sqliteを使い、元情報をJSONで失わず、比較範囲・状態・条件・件数にSQLを使う形を選びました。初期試作では保存構造を小さく保ち、複雑な表分割や不正確なSQL比率順へ急いで移行しません。既存APIを対照にして、保存後の意味が変わらないことを先に確認しています。

本番用のスキーマ・索引最適化、大規模データ、取得対象の充足率、訂正/取下げ全履歴、DB移行・配布・利用先統合・定期実行、PL/CF・他基準は別段階です。計画更新#30・実装#31は正式なGitHub Stacked PR #32からmainへ統合済みです。リリース・利用先更新は未実施です。[差分取り込みAPI](FINANCIAL_INCREMENTAL_IMPORT.md)も#33でmainへ統合済みです。ローカル原本CLIも#34でmainへ統合済みです。この版では[保存2版の読み取り比較](BALANCE_SHEET_VERSION_DIFF.md)も利用できます。
