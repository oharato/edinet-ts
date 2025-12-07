SQLite（`better-sqlite3`）を軸にした、TypeScript製EDINETライブラリ（仮称: `edinet-ts`）の堅実な実装計画を提案します。

「メタデータ（検索用インデックス）はローカルDB、実データ（XBRL）は都度APIから取得」という**ハイブリッド構成**で進めます。

-----

### プロジェクト構成図

まずはフォルダ構成のイメージです。

```text
edinet-ts/
├── src/
│   ├── api/           # API通信 (RateLimit含む)
│   ├── db/            # SQLite操作 (Schema, CRUD)
│   ├── parser/        # ZIP解凍 & XBRL解析
│   ├── types/         # 型定義 (Interface)
│   └── index.ts       # エントリーポイント (Facade)
├── scripts/           # 初期セットアップ用スクリプト (過去データ取得)
├── data/              # DBファイルの保存場所 (デフォルト)
├── package.json
└── tsconfig.json
```

-----

### Phase 1: 依存ライブラリの選定

以下のスタックで確定させます。

```bash
npm install better-sqlite3 axios adm-zip fast-xml-parser p-queue dotenv
npm install -D typescript @types/node @types/better-sqlite3 @types/adm-zip
```

  * **better-sqlite3**: Node.jsで最速・同期処理可能なSQLiteドライバ。
  * **p-queue**: レートリミット（1秒1回など）の制御を簡単にするため。
  * **fast-xml-parser**: XBRL(XML)をJSオブジェクトに変換。
  * **adm-zip**: ZIP解凍用。

-----

### Phase 2: データベース設計 (Cache Layer)

これが今回の肝です。検索に必要なカラムにインデックスを貼ります。

**ファイル:** `src/db/schema.ts` / `repository.ts`

#### テーブル定義 (SQL)

```sql
CREATE TABLE IF NOT EXISTS documents (
  doc_id TEXT PRIMARY KEY,
  sec_code TEXT,        -- "72030" (末尾0付き)
  filer_name TEXT,      -- "トヨタ自動車株式会社"
  doc_type_code TEXT,   -- "120"(有報), "130"(四半期) 等
  submit_date TEXT,     -- "2024-06-25" (提出日)
  period_end TEXT,      -- "2024-03-31" (決算日)
  doc_description TEXT  -- "有価証券報告書" (念のためタイトルも)
);

-- 検索用インデックス
CREATE INDEX IF NOT EXISTS idx_sec_code ON documents(sec_code);
CREATE INDEX IF NOT EXISTS idx_submit_date ON documents(submit_date);
```

  * **ポイント**: `sec_code` はEDINET独自の5桁（例: 72030）で保存します。ユーザーが入力する4桁（7203）との変換はTypeScript側で行います。

-----

### Phase 3: APIクライアントの実装 (Fetch Layer)

APIを叩く部分です。ここで**レートリミット**を強制します。

**ファイル:** `src/api/client.ts`

  * **機能:**
      * APIキーの管理。
      * `/documents.json` (一覧) の取得。
      * `/documents/{id}` (ZIP) の取得。
      * **重要:** `p-queue` を使い、`interval: 1000, concurrency: 1` を設定して、ユーザーがループで叩いてもサーバーを攻撃しないように制御します。

-----

### Phase 4: XBRLパーサーの実装 (Logic Layer)

最も難易度が高い部分です。「松」レベル（主要財務数値）の抽出に集中します。

**ファイル:** `src/parser/xbrl.ts`

  * **ステップ:**
    1.  `adm-zip` でZIPを展開。
    2.  `PublicDoc/*.xbrl` を探す。
    3.  `fast-xml-parser` でJSON化。
    4.  **重要:** コンテキスト(`contextRef`)の判定ロジックを実装。
          * `CurrentYearConsolidatedDuration` (当期・連結・期間) を特定するヘルパー関数を作る。
    5.  以下のタグをマッピングして `FinancialMetrics` オブジェクトを返す。
          * `NetSales` (売上高)
          * `OperatingIncome` (営業利益)
          * `OrdinaryIncome` (経常利益)
          * `ProfitAttributableToOwnersOfParent` (純利益)

-----

### Phase 5: 統合とファサード (User Interface)

ユーザーが触るメインクラスです。

**ファイル:** `src/index.ts`

```typescript
export class Edinet {
  private db: EdinetRepository;
  private api: EdinetApiClient;

  constructor(apiKey: string, dbPath?: string) {
    // ...初期化
  }

  // メイン機能: 財務推移の取得
  async getFinancialHistory(ticker: string, years: number = 5) {
    // 1. 4桁コードを5桁に変換 (7203 -> 72030)
    const edinetCode = `${ticker}0`;

    // 2. DBから該当する有報(120)のdocIDリストを取得
    const docs = this.db.findDocuments({
      secCode: edinetCode,
      docTypeCode: '120', // 有価証券報告書
      limit: years
    });

    // 3. ループして詳細を取得
    const results = [];
    for (const doc of docs) {
      // APIからZIP取得 -> XBRL解析
      const metrics = await this.fetchAndParseXbrl(doc.doc_id);
      results.push({
        period: doc.period_end,
        metrics: metrics
      });
    }
    return results;
  }
}
```

-----

### Phase 6: 初期データ投入スクリプト (Seeding)

ユーザーがライブラリを使い始める前に、過去5年分のメタデータをDBに入れるためのスクリプトです。

**ファイル:** `scripts/seed.ts`

  * **処理:**
      * `dayjs` 等で過去5年分の「日付リスト」を作成。
      * ループで API `/documents.json` を叩く。
      * 取得したJSONを SQLite に `INSERT`。
      * **注意:** 1秒1回制限を守ると、5年分（約1200日）の取得には **約20分** かかります。「進捗バー（cli-progress）」を表示してユーザーを安心させましょう。

-----

### 開発の進め方（ロードマップ）

以下の順序で実装・テストすることをお勧めします。

1.  **Step 1:** APIクライアントだけ作る（`console.log` でJSONが見れる状態）。
2.  **Step 2:** SQLiteへの保存ロジックを作る（Seedスクリプトの完成）。
3.  **Step 3:** DBから `docID` を検索できる機能を作る。
4.  **Step 4:** 特定の `docID` のXBRLを解析して「売上高」だけ出す機能を作る。
5.  **Step 5:** 全部つなげる。

まずは **「Step 2 (Seedスクリプト)」** まで作って、手元に `edinet.db` が生成されるところまでを目指してみてください。これができれば勝ったも同然です。