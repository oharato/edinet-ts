# 版付き解析済みSQLite Store

2026-10-31。取得用SQLite・検索用DuckDB計画のP1として追加する内部モジュール。既存の原本DB・取得ジョブDBは変更せず、専用ファイルを作る。通常読取にXMLは不要。

## 保存の識別と意味

`ParsedFinancialStore` は `createAutomaticFinancialSnapshots` の直接抽出結果を保存する。呼出側が検査した原本から得た結果を渡す低levelのStoreであり、XMLを再解析して数値の正当性を認証する機能ではない。原本照合・訂正系列の最終採用は別工程。

| 項目 | 契約 |
|---|---|
| 解析キー | Store版、docID、原本SHA-256、解析版、source commit、対応表5種の版、正規化した明細項目集合をcanonical JSONにしてSHA-256 |
| 同じ条件 | 明細項目の並びを同一視。省略による既定集合と明示集合は別キー |
| 処理時刻 | timezone必須の `parsedAt` をUTCへ正規化。キーに含めず、同内容の再投入でも最初の時刻を保持 |
| 原本利用可能時刻・cutoff | 本Storeで推定しない。原本観測と検索世代の入力manifestで保持する |
| 完了 | `outcome.status=completed` は解析が結果を返した意味。`result.status=unresolved` やgroupのunavailableも理由とともに保持 |
| 解析失敗 | `outcome.status=failed` と `parse-failed` / `projection-failed` を保持。正常値・0へ変えない |
| 再処理 | 同じキー・同じ結果は再利用。同じキーの異なる結果は拒否。失敗の修正も解析版を変えて別キーへ保存 |
| 保存限界 | 一結果64 MiBまで。巨大な改変本文はSQLの長さ検査後に拒否する |

対応表版は `basis / balanceSheet / details / ifrsBalanceSheet / ifrsDetails`。`parsedFinancialMappingVersions()` で現在の版を得る。解析版・source commitは呼出側が固定する。未commitの検証用snapshotを使う場合は、そのsource manifestのhashを解析版へ含め、manifestと基準commitを証跡へ保存する。

## テーブル

| テーブル | 主な列・用途 |
|---|---|
| `parsed_format` | 専用形式 `edinet-ts-parsed-financial-v1` |
| `parsed_extractions` | 解析ID、docID、原本hash、完了/失敗、処理時刻、完全な解析結果JSON、整合hash |
| `parsed_rows` | 解析ID・行ID、BS/明細、会社、基準、scope、通貨、期間、期間分類、訂正対象、snapshot JSON、整合hash |
| `parsed_values` | 解析ID・行ID・指標ID、順序、利用可否、数値、原文字列、状態、理由、失敗区分、原単位、decimals、全候補/根拠JSON、整合hash |

数値列は検索用。原文字列・原単位・精度・全候補はJSONも含めて保持する。基準・期間・会社・原本hashと各snapshotの対応を検査し、選択済み数値の安全な十進往復、根拠との一致も検査する。未知の基準やIFRS単体の保留は行・値を無理に生成しない。

## 内部API

```ts
import {ParsedFinancialStore, parsedFinancialMappingVersions} from './db/parsed-financial-store';

const store = new ParsedFinancialStore('data/parsed.sqlite');
try {
  const saved = store.put({
    identity: {
      docID, sourceSha256, extractorVersion, sourceCommit,
      mappingVersions: parsedFinancialMappingVersions(),
      // detailMetricIdsを指定する場合は解析時と同じ集合。
    },
    parsedAt: new Date().toISOString(),
    outcome: {status: 'completed', result},
  });
  store.get(saved.id); // XMLなしで完全な結果を再取得。
  store.page({limit: 100}); // ID順のcursor付き読取。最大100件・本文合計64 MiBで区切る。
} finally {
  store.close();
}
```

書込は原本単位の1transaction。header・財務行・値の途中で失敗した場合は全部戻す。読取は保存JSONから再構成した列・hashとSQLの実列・件数を突合する。原本1件の読み出しのためにStore全体を再検査しない。

既存 `DedicatedSqliteDatabase` の固定schema・通常ファイル・副ファイル・リンク拒否、読取専用の私有コピーを利用する。停止済みの専用DBを前提とし、稼働中DBを無保証に開く入口は追加しない。`snapshotSha256()` はreadOnlyの固定コピーに対してだけ使える。

## 検証と残工程

`test/parsed-financial-store.test.ts` で日本基準/IFRS、複数期、半期・訂正対象、0/nil/曖昧/安全範囲外、再投入、版・条件分離、途中中断、再open、改変、巨大本文、別形式・リンク・副ファイル、readOnly原DB不変を検査する。

実原本検証は `scripts/verify-parsed-financial-store.ts <停止済みarchive.sqlite> <新規出力先>`。原本hash、保存前後の全結果一致、readOnlyでの再読取、原本DBの前後全体hashを確認する。これは元XML/PDFからの独立した金額認証ではなく、既存パーサーの結果と新しい保存経路の一致確認。

解析ジョブの計画・checkpointとアーカイブ読込は[解析ジョブ](PARSED_FINANCIAL_JOB.md)として追加した。DuckDB構築、公開export・CLI・正式catalogとの統合は後続工程。現在の同期API・稼働サービスは変更しない。
