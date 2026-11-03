# edinet-ts

EDINETのXBRLから財務数値（売上高・営業利益）を読み取り、**前年より利益率が伸びた企業を高速にスクリーニング・抽出**するための軽量TypeScriptライブラリ＆CLIです。

保存先・検索エンジンには **DuckDB** を採用しており、大量の決算書データを高速にSQL絞り込み・ソートできます。

---

## 主な機能

- **高精度な財務抽出**:
  - 日本基準（J-GAAP）および国際財務報告基準（IFRS）に対応
  - 連結決算を優先抽出し、なければ単体決算を採用
  - 1つの有報から**当期と前期の数値を自動突合**
- **利益率・成長率の自動計算**:
  - 営業利益率（当期・前期）
  - 利益率成長率（前年比で何%伸びたか）
  - 利益率ポイント差（例: +3.5%pt）
  - 売上高成長率・営業利益成長率
- **DuckDB による高速スクリーニング**:
  - インメモリまたはファイルベースのDuckDBに一括ロード
  - 「前年比で利益率が20%以上伸びた企業」「営業利益率順にソート」などを瞬時に出力
- **直感的な CLI ツール**:
  - `parse`: 単一XBRLの確認
  - `load`: ディレクトリ内の全XBRLをDuckDBにインポート
  - `screen`: 条件を指定してコンソールテーブル表示

---

## クイックスタート (CLI)

### 1. 単一のXBRLファイルを解析する

```bash
# カカクコムの決算を解析
npx edinet-ts parse --file ./test/test_data/CJ_2371_kakakucom.xbrl
```

**出力例**:
```text
================ 企業情報 ================
会社名:   株式会社カカクコム
証券コード: 2371
EDINET:   E05350
決算期末: 2017-03-31
決算区分: 連結

================ 財務比較 ================
売上高:       当期 450.89 億円 / 前期 412.75 億円 (前年比: 9.24 %)
営業利益:     当期 211.61 億円 / 前期 195.35 億円 (前年比: 8.33 %)
営業利益率:   当期 46.93 % / 前期 47.33 %
利益率成長率: -0.84 % (ポイント差: -0.40 %)
```

### 2. フォルダ内の全XBRLをDuckDBにインポートする

```bash
npx edinet-ts load --dir ./data/xbrl --db ./data/screening.duckdb
```

### 3. 条件を指定してスクリーニングする

```bash
# 利益率成長率がプラスの企業を、当期利益率順に表示
npx edinet-ts screen --db ./data/screening.duckdb --min-growth 0.0 --order-by current_margin

# 営業利益率20%以上 かつ 利益率が前年より20%以上伸びた企業
npx edinet-ts screen --db ./data/screening.duckdb --min-margin 0.20 --min-growth 0.20
```

**スクリーニング結果表示**:
```text
スクリーニング結果 (3 件):
┌─────────┬────────┬──────────────────────┬──────────────┬────────────────┬──────────────────┬───────────────┬───────────────┬─────────────────┬───────────────┐
│ (index) │ コード │ 会社名               │ 決算期       │ 当期売上(億円) │ 当期営業益(億円) │ 当期利益率(%) │ 前期利益率(%) │ 利益率成長率(%) │ 売上成長率(%) │
├─────────┼────────┼──────────────────────┼──────────────┼────────────────┼──────────────────┼───────────────┼───────────────┼─────────────────┼───────────────┤
│ 0       │ '2371' │ '株式会社カカクコム' │ '2017-03-31' │ '450.9'        │ '211.6'          │ '46.93'       │ '47.33'       │ '-0.84'         │ '9.24'        │
│ 1       │ '7974' │ '任天堂株式会社'     │ '2024-03-31' │ '16718.7'      │ '5289.4'         │ '31.64'       │ '31.49'       │ '0.47'          │ '4.38'        │
│ 2       │ '4689' │ 'ヤフー株式会社'     │ '2017-03-31' │ '8537.3'       │ '1920.5'         │ '22.50'       │ '34.49'       │ '-34.78'        │ '30.87'       │
└─────────┴────────┴──────────────────────┴──────────────┴────────────────┴──────────────────┴───────────────┴───────────────┴─────────────────┴───────────────┘
```

---

## TypeScript API としての利用

```typescript
import { readFileSync } from "node:fs";
import { XbrlParser, FinancialExtractor, FinancialStore } from "edinet-ts";

// 1. XBRL をパースして財務指標・利益率を抽出
const xml = readFileSync("./report.xbrl", "utf8");
const doc = new XbrlParser().parse(xml);
const result = new FinancialExtractor().extract(doc);

console.log(`${result.metadata.companyName}: 当期利益率 ${result.operatingMarginCurrent}`);

// 2. DuckDB に保存してスクリーニング
const store = new FinancialStore(":memory:");
await store.init();
await store.insert(result);

const screened = await store.screen({
  minMarginGrowth: 0.20, // 利益率成長率 20%以上
  orderBy: "current_margin",
  orderDirection: "desc",
});
```

---

## アーキテクチャ

```
src/
├── xbrl/          # XBRL/iXBRL XMLパーサー (fast-xml-parserベース)
├── financial/     # 財務指標抽出・前期突合・利益率/成長率計算
├── db/            # DuckDB 保存・高速スクリーニングクエリ
├── edinet/        # EDINET API クライアント (一覧取得・ZIPダウンロード)
├── cli.ts         # CLI コマンド (parse, load, screen)
├── index.ts       # 公開API
└── types.ts       # 型定義
```

詳細なアーキテクチャや抽出ロジックについては [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照してください。
