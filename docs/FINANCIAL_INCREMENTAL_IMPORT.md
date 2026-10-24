# 必要な書類だけを財務DBへ取り込む

状態: main `a5fb840`（#30/#31統合済み）を基準にした実装・ローカル検証済みのDraft PRレビュー対象。今回の差分取り込みはmain未反映です。2026-10-24更新。

保存するたびに全ての原本を解析する代わりに、原本の内容を識別するハッシュと解析版を比べて、必要な分だけを処理します。対象は[財務3項目と流動比率のSQLite保存](FINANCIAL_SQLITE_STORE.md)です。新しいDB形式や追加依存は導入せず、既存の保存形式1を使います。

## 判定と安全側の扱い

原本一覧（manifest）は、利用側が用意する書類情報と原本のSHA256、抽出器の版、対応表の版、任意のソースcommitの組です。SHA256はファイル内容を識別する値です。

| 状態 | 判定 | 処理 |
|---|---|---|
| `new` 新規 | 会社・書類・対象日・連結/単体・基準・通貨の組が未保存 | 原本を読んで解析・保存 |
| `changed` 解析版変更 | 同じ組と同じ原本で、抽出器/対応表の版またはソースcommitが違う | 再解析し別IDで保存。旧版を削除しない |
| `unchanged` 変更なし | 同じ組・原本・版・ソースcommitが保存済み | 原本を読み直さず既存IDを返す |
| `conflict` 衝突 | 同じ書類IDで原本ハッシュや企業・基準・通貨が一致しない | batch全体を止める。静かな上書きはしない |

同じ原本から別の対象日や連結/単体の値を取り出すことはできます。同じbatch内で同じ組を2回指定する入力は拒否します。日本基準・円以外の入力は、既存APIと同様に未対応として拒否します。

解析版を指定しても過去の解析器へ自動切替しません。実行している現在のコードが解析し、版は利用側が正しく宣言する前提です。XBRLのentityと証券コード・会計基準の公式な対応を自動証明する機能ではありません。

**変更なしの判定は最新のmanifestが前提です。** ファイルだけを変えて古いSHA256を渡すと、既存分は再読取しないため変更を検出できません。利用側で現原本のハッシュを更新してください。このAPIはファイル探索・全原本の再ハッシュ・自動取得を行いません。新規・再解析分については実際に読んだbyte列のSHA256を保存前に確認します。

## 使い方（プログラム向けAPI）

```ts
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { BalanceSheetSqliteStore, planBalanceSheetImport, importBalanceSheets,
    BalanceSheetImportStatus, ConsolidationScope, AccountingStandard,
    BALANCE_SHEET_REGISTRY_VERSION, type BalanceSheetImportSource } from "edinet-ts";

// 例の書類ID・証券コードは合成。原本とDBはGit管理外に置きます。
const path = "/tmp/synthetic-source.xbrl";
const bytes = readFileSync(path);
const source: BalanceSheetImportSource = {
    metadata: { secCode: "1001", docID: "SYNTHETIC1", instant: "2025-03-31",
        scope: ConsolidationScope.Consolidated,
        accountingStandard: AccountingStandard.JGAAP, currency: "JPY" },
    provenance: { sourceSha256: createHash("sha256").update(bytes).digest("hex"),
        extractorVersion: "my-tested-parser-v1", mappingVersion: BALANCE_SHEET_REGISTRY_VERSION }
};
const store = new BalanceSheetSqliteStore("/tmp/test-financial.sqlite");
try {
    const preview = planBalanceSheetImport(store, [source]);
    console.log(preview.counts);
    if (preview.items.some(item => item.status === BalanceSheetImportStatus.Conflict)) {
        throw new Error("同じ書類の原本情報を確認してください");
    }
    // 実行時には再計画するため、外で書換えたpreviewを信用して実行しません。
    const result = importBalanceSheets(store, [source], () => readFileSync(path));
    console.log(result.processed, result.inserted, result.unchanged, result.snapshotIds);
} finally { store.close(); }
```

`readSource`は同期関数で、必要な書類のUTF-8原本を`Uint8Array`（Bufferも可）で返します。複数書類の場合は、渡されたdocID等から利用側の原本パスを選んでください。原本byte列が計画と違う、不正UTF-8、別エンコーディングのXML宣言、途中で切れたXMLなら保存しません。既存依存の構文検査であり、XBRLスキーマや財務内容の正しさを証明する検査ではありません。

`processed`は今回原本を解析した件数、`inserted`は保存件数、`unchanged`は既存分で処理不要だった件数です。`snapshotIds`は入力順で、既存分も含む検索対象IDです。再解析後に旧版と新版が同じ比較範囲にある場合は、既存検索の`cohort.snapshotIds`へ必要なIDを明示します。最新を推測して自動選択しません。

## 途中失敗と別接続の更新

一回の呼び出しを有限のbatchとして扱います。

1. DB一覧を一つの読み取り処理で取得し、全保存行の整合性を確認して計画します。
2. 新規・解析版変更だけを原本から解析します。この段階では保存しません。
3. 全対象の解析が成功したら、書き込みロックを取って一覧の指紋（fingerprint）を比較します。指紋は保存IDと内容ハッシュの組から求める比較値です。
4. 計画後に別接続がDBを変更していたら再計画を求めます。内容破損も再検査します。変更0件でもこの確認を省きません。
5. 一致すれば一回のトランザクションで全変更を保存します。SQL失敗は全件を取り消します。

失敗したbatchの途中から処理を飛ばす仕組みではありません。原因を直して同じ一覧を再実行します。前に成功した分は変更なしになり、失敗したbatchは保存0件なので重複しません。永続ジョブ台帳・書類ごとの途中状態・自動リトライはありません。

原本読取callback自体が行う外部操作は、このDBの取り消し対象にできません。読み取りだけの関数を渡してください。別接続が正当に保存した変更も、こちらの失敗で消しません。

`store.inventory()`は検証済みの書類情報・来歴と指紋を返します。低水準APIの`store.putMany(inputs, { expectedInventoryFingerprint })`でも書き込み中の再確認が可能です。readOnly接続では計画だけが可能で、実行は変更なしの入力でも拒否します。

## 確認した範囲と残ること

合成XMLと新しい試験DBで、新規/版変更/変更なし/衝突、別期末と単体、欠損、再open後の再実行、原本ハッシュ不一致、UTF-8/解析失敗、SQL途中失敗と再開、別接続更新、入力改変、既存JSON破損、readOnlyを確認しました。既存メモリ検索との同等性・精度境界のテストも継続します。Node26.12.1で型検査（本体と使用例）・build・全668テスト（既存635＋新規33件）・保存保護Python5件が成功しました。独立レビューでは別の合成入力による18検証も成功し、修正必須の未解決事項はありません。lint設定はありません。

差分だけを**原本解析**しますが、現在の小規模実装では計画と保存直前に保存行全体を検査します。判定も入力件数と保存件数に応じた比較を行い、大規模向けの最適化ではありません。今回の差分APIの性能・容量測定は未実施で、高速化を保証しません。以前の保存検索の測定値を差分取り込みの性能として流用しません。

今回は新たな実原本検証・ネット取得を行っていません。既存DB/キャッシュへ接続せず、原本・金額・試験DB・認証情報はGitへ含めません。訂正/取下げの全履歴や同書類IDの原本差し替えの自動解決、全市場取得、定期実行、本番DB移行、PL/CF・他基準、新しいCLIは範囲外です。
