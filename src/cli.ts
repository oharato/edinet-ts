#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { XbrlParser } from "./xbrl/parser.js";
import { FinancialExtractor } from "./financial/extractor.js";
import { FinancialStore } from "./db/store.js";
import { SCREENING_COLUMNS, QUERY_EXAMPLES } from "./db/schema-info.js";
import { EdinetClient } from "./edinet/client.js";

// 取得対象は有価証券報告書(120)と訂正有価証券報告書(130)のみ。
const SUPPORTED_DOC_TYPES = new Set(["120", "130"]);

// 手動実行でも .env の EDINET_API_KEY を読めるようにする。
// systemd 等の外部実行環境では EnvironmentFile が設定するため、.env がなくても動作する。
try {
  process.loadEnvFile();
} catch {
  // .env がない場合は環境変数をそのまま使う
}

const program = new Command();
program
  .name("edinet-ts")
  .description("EDINET XBRL 解析 & 利益率スクリーニングツール")
  .version("2.0.0");

/**
 * 1. parse コマンド: 単一ファイルの解析
 */
program
  .command("parse")
  .description("単一のXBRLファイルを解析し、財務数値と利益率を表示します")
  .requiredOption("-f, --file <path>", "XBRLファイルのパス")
  .option("--json", "JSON形式で出力")
  .action((options) => {
    const filePath = resolve(process.cwd(), options.file);
    const xml = readFileSync(filePath, "utf8");

    const parser = new XbrlParser();
    const doc = parser.parse(xml);

    const extractor = new FinancialExtractor();
    const result = extractor.extract(doc);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log("\n================ 企業情報 ================");
    console.log(`会社名:   ${result.metadata.companyName}`);
    console.log(`証券コード: ${result.metadata.securityCode || "N/A"}`);
    console.log(`EDINET:   ${result.metadata.edinetCode}`);
    console.log(`決算期末: ${result.metadata.periodEnd}`);
    console.log(`決算区分: ${result.current.isConsolidated ? "連結" : "単体"}`);

    console.log("\n================ 財務比較 ================");
    const formatYen = (val?: number) =>
      val !== undefined ? `${(val / 100_000_000).toFixed(2)} 億円` : "N/A";
    const formatPercent = (val?: number) =>
      val !== undefined ? `${(val * 100).toFixed(2)} %` : "N/A";

    console.log(
      `売上高:       当期 ${formatYen(result.current.netSales)} / 前期 ${formatYen(result.prior.netSales)} (前年比: ${formatPercent(result.salesGrowthRate)})`,
    );
    console.log(
      `営業利益:     当期 ${formatYen(result.current.operatingIncome)} / 前期 ${formatYen(result.prior.operatingIncome)} (前年比: ${formatPercent(result.operatingIncomeGrowthRate)})`,
    );
    console.log(
      `営業利益率:   当期 ${formatPercent(result.operatingMarginCurrent)} / 前期 ${formatPercent(result.operatingMarginPrior)}`,
    );
    console.log(
      `利益率成長率: ${formatPercent(result.operatingMarginGrowthRate)} (ポイント差: ${formatPercent(result.operatingMarginDelta)})`,
    );
    console.log(
      `自己資本比率: 当期 ${formatPercent(result.equityRatioCurrent)} / 前期 ${formatPercent(result.equityRatioPrior)}`,
    );
    console.log(
      `ROE:          当期 ${formatPercent(result.roeCurrent)} / ROA: 当期 ${formatPercent(result.roaCurrent)}`,
    );
    console.log(
      `フリーCF:     当期 ${formatYen(result.freeCashFlowCurrent)} / 営業CF: 当期 ${formatYen(result.current.operatingCashFlow)}`,
    );
    console.log(
      `1株配当金:    当期 ${result.current.dividendPerShare ? result.current.dividendPerShare + " 円" : "N/A"} (増配率: ${formatPercent(result.dividendGrowthRate)})`,
    );
    console.log(
      `1人当たり営業益: ${result.operatingIncomePerEmployee ? (result.operatingIncomePerEmployee / 10_000).toFixed(1) + " 万円/人" : "N/A"} (従業員数: ${result.current.numberOfEmployees ? result.current.numberOfEmployees + " 人" : "N/A"})`,
    );
    console.log(
      `EPS:          当期 ${result.current.eps ? result.current.eps.toFixed(2) + " 円" : "N/A"} / BPS: 当期 ${result.current.bps ? result.current.bps.toFixed(2) + " 円" : "N/A"}`,
    );
    console.log("");
  });

/**
 * 2. load コマンド: ディレクトリ内のXBRLファイルをDuckDBへ一括投入
 */
program
  .command("load")
  .description("指定ディレクトリ内のXBRLファイルを解析し、DuckDBに保存します")
  .requiredOption("-d, --dir <path>", "XBRLファイルが格納されているディレクトリ")
  .option("--db <path>", "DuckDBファイルの保存先", "./data/screening.duckdb")
  .action(async (options) => {
    const targetDir = resolve(process.cwd(), options.dir);
    const dbPath = resolve(process.cwd(), options.db);

    const store = new FinancialStore(dbPath);
    await store.init();

    const parser = new XbrlParser();
    const extractor = new FinancialExtractor();

    const findXbrlFiles = (dir: string): string[] => {
      let results: string[] = [];
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          results = results.concat(findXbrlFiles(fullPath));
        } else if (entry.endsWith(".xbrl")) {
          results.push(fullPath);
        }
      }
      return results;
    };

    const files = findXbrlFiles(targetDir);
    console.log(`Found ${files.length} XBRL files in ${targetDir}`);

    let successCount = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const xml = readFileSync(file, "utf8");
        const doc = parser.parse(xml);
        const comparison = extractor.extract(doc);
        await store.insert(comparison, { docTypeCode: "120" });
        successCount++;
        process.stdout.write(
          `\rLoaded [${successCount}/${files.length}]: ${comparison.metadata.companyName.padEnd(20)}`,
        );
      } catch (e: any) {
        console.error(`\nFailed to load ${file}: ${e.message}`);
      }
    }

    console.log(`\nSuccessfully loaded ${successCount} files into DuckDB (${dbPath})`);
    store.close();
  });

/**
 * 2b. import-archive コマンド: 既存の archive.sqlite から有報を一括ロード
 */
program
  .command("import-archive")
  .description("既存の archive.sqlite（有報原本アーカイブ）からDuckDBへ一括ロードします")
  .option(
    "--archive <path>",
    "archive.sqlite のパス",
    "./data/old/production/duck-financial/daily/2026-11-03/candidate/archive.sqlite",
  )
  .option("--db <path>", "DuckDBファイルの保存先", "./data/screening.duckdb")
  .option(
    "--doc-types <list>",
    "取り込む書類種別 (カンマ区切り。120=有報, 130=訂正有報)",
    "120,130",
  )
  .option("-l, --limit <number>", "処理する書類の上限件数 (テスト用)", parseInteger)
  .action(async (options) => {
    const archivePath = resolve(process.cwd(), options.archive);
    const dbPath = resolve(process.cwd(), options.db);

    console.log(`Loading from archive: ${archivePath}`);
    console.log(`Target DuckDB:       ${dbPath}`);

    const { DatabaseSync } = await import("node:sqlite");
    const { gunzipSync } = await import("node:zlib");

    const sqlite = new DatabaseSync(archivePath, { readOnly: true });
    const store = new FinancialStore(dbPath);
    await store.init();

    const parser = new XbrlParser();
    const extractor = new FinancialExtractor();

    const docTypes = parseDocTypes(options.docTypes);
    const placeholders = docTypes.map(() => "?").join(",");
    const limitClause = options.limit ? `LIMIT ${options.limit}` : "";
    const query = `
      SELECT DISTINCT
        s.doc_id,
        json_extract(o.body, '$.document.docTypeCode') AS doc_type_code,
        json_extract(o.body, '$.document.submitDateTime') AS submitted_at,
        c.xml
      FROM archive_sources s
      JOIN archive_observations o ON s.doc_id = o.doc_id
      JOIN archive_contents c ON json_extract(s.body, '$.sourceSha256') = c.sha256
      WHERE json_extract(o.body, '$.document.docTypeCode') IN (${placeholders})
      ORDER BY doc_type_code, s.doc_id
      ${limitClause};
    `;

    const rows = sqlite.prepare(query).all(...docTypes) as Array<{
      doc_id: string;
      doc_type_code: string;
      submitted_at: string | null;
      xml: Buffer;
    }>;
    console.log(`Found ${rows.length} reports (${docTypes.join(",")}) with XBRL content.\n`);

    let annualCount = 0;
    let correctionCount = 0;
    let excludedCount = 0;
    let errorCount = 0;
    const startTime = Date.now();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const xmlContent = gunzipSync(row.xml).toString("utf8");
        const doc = parser.parse(xmlContent);
        const comparison = extractor.extract(doc);
        if (!comparison.metadata.securityCode) {
          excludedCount++;
          continue;
        }
        // 120 を先、130 を後に処理する（ORDER BY doc_type_code）ため、訂正が必ず最後に上書きする。
        await store.insert(comparison, {
          docId: row.doc_id,
          docTypeCode: row.doc_type_code,
          submittedAt: row.submitted_at ?? undefined,
        });
        if (row.doc_type_code === "120") {
          annualCount++;
        } else {
          correctionCount++;
        }

        if (i % 50 === 0 || i === rows.length - 1) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const name =
            comparison.metadata.companyName.length > 14
              ? comparison.metadata.companyName.slice(0, 13) + "…"
              : comparison.metadata.companyName;
          process.stdout.write(
            `\rProgress: [${i + 1}/${rows.length}] ${row.doc_type_code} (${elapsed}s) - Last: ${name.padEnd(16)}`,
          );
        }
      } catch (e: any) {
        errorCount++;
      }
    }

    const totalSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `\n\nDone! annual=${annualCount}, correction=${correctionCount}, excluded=${excludedCount}, errors=${errorCount} in ${totalSeconds}s.`,
    );
    store.close();
  });

/**
 * 3. screen コマンド: DuckDBから条件検索して表示
 */
program
  .command("screen")
  .description("DuckDBから利益率や成長率の条件で企業をスクリーニングします")
  .option("--db <path>", "DuckDBファイルのパス", "./data/screening.duckdb")
  .option(
    "-w, --where <sql>",
    '任意のSQL条件式 (例: "operating_margin_current > 0.15 AND equity_ratio_current > 0.5")',
  )
  .option(
    "--order-by <field>",
    "ソート項目 (margin_growth, current_margin, sales_growth, operating_income_growth, equity_ratio, roe, roa, fcf, per_employee)",
    "current_margin",
  )
  .option("--order-dir <dir>", "ソート順 (asc, desc)", "desc")
  .option("-l, --limit <number>", "取得件数上限", parseInteger, 50)
  .option("--json", "JSON形式で出力")
  .addHelpText(
    "after",
    `
利用可能なSQLカラム一覧 (--where で指定可能):
  operating_margin_current     当期 営業利益率 (例: >= 0.15)
  operating_margin_prior       前期 営業利益率
  operating_margin_growth_rate 利益率の前年比成長率 (例: >= 0.20 で+20%以上)
  equity_ratio_current         当期 自己資本比率 (例: >= 0.50 で50%以上)
  roe_current                  当期 ROE (例: >= 0.10 で10%以上)
  sales_growth_rate            売上高の前年比成長率 (例: >= 0.10)
  operating_income_growth_rate 営業利益の前年比成長率 (例: >= 0.20)
  net_sales_current            当期 売上高(円) (例: >= 10000000000 で100億円以上)
  operating_income_current     当期 営業利益(円)
  operating_cf_current         当期 営業活動CF(円) (例: > 0 で黒字)
  security_code                証券コード (例: = '2371')
  company_name                 会社名 (例: LIKE '%カカクコム%')
  period_end                   決算期 (例: >= '2024-01-01')
  is_consolidated              連結決算フラグ (true / false)
  doc_type_code                書類種別 (120=有報, 130=訂正有報) (例: = '130')
  submitted_at                 提出日時 (例: >= '2024-01-01')

※ 訂正有報(130)は同じ証券コード・決算期の年次データを上書きします。

クエリ例:
  # 利益率成長率+20%以上 かつ 利益率15%以上
  edinet-ts screen --where "operating_margin_growth_rate >= 0.20 AND operating_margin_current >= 0.15"

  # 自己資本比率50%以上 かつ ROE 10%以上
  edinet-ts screen --where "equity_ratio_current >= 0.50 AND roe_current >= 0.10"

※ 詳細な一覧やJSONスキーマは 'edinet-ts schema' を実行してください。
`,
  )
  .action(async (options) => {
    const dbPath = resolve(process.cwd(), options.db);
    const store = new FinancialStore(dbPath);
    await store.init();

    const rows = await store.screen({
      whereClause: options.where,
      orderBy: options.orderBy,
      orderDirection: options.orderDir,
      limit: options.limit,
    });

    store.close();

    if (options.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }

    if (rows.length === 0) {
      console.log("条件に合致する企業は見つかりませんでした。");
      return;
    }

    console.log(`\nスクリーニング結果 (${rows.length} 件):`);
    console.table(
      rows.map((r) => ({
        コード: r.securityCode || r.edinetCode,
        種別: r.docTypeCode || "-",
        提出日: r.submittedAt || "-",
        会社名: r.companyName.length > 11 ? r.companyName.slice(0, 10) + "…" : r.companyName,
        決算期: r.periodEnd,
        "売上(億)": r.netSalesCurrent ? (r.netSalesCurrent / 100_000_000).toFixed(1) : "-",
        "営業益(億)": r.operatingIncomeCurrent
          ? (r.operatingIncomeCurrent / 100_000_000).toFixed(1)
          : "-",
        "利益率(%)": r.operatingMarginCurrent ? (r.operatingMarginCurrent * 100).toFixed(2) : "-",
        "利益率成長(%)": r.operatingMarginGrowthRate
          ? (r.operatingMarginGrowthRate * 100).toFixed(2)
          : "-",
        "自己資本比率(%)": r.equityRatioCurrent ? (r.equityRatioCurrent * 100).toFixed(2) : "-",
        "ROE(%)": r.roeCurrent ? (r.roeCurrent * 100).toFixed(2) : "-",
        "FCF(億)": r.freeCashFlowCurrent ? (r.freeCashFlowCurrent / 100_000_000).toFixed(1) : "-",
        "1人当り営業益(万)": r.operatingIncomePerEmployee
          ? (r.operatingIncomePerEmployee / 10_000).toFixed(0)
          : "-",
      })),
    );
  });

/**
 * 4. schema コマンド: 利用可能なカラム定義・クエリ例の表示 (人間 & AI向け)
 */
program
  .command("schema")
  .description("スクリーニング（--where）で指定可能なカラム定義とクエリ例を表示します")
  .option("--json", "AI/プログラム向けのJSONスキーマ形式で出力")
  .action((options) => {
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            columns: SCREENING_COLUMNS,
            examples: QUERY_EXAMPLES,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log("\n================ スクリーニング項目一覧 (DuckDB カラム) ================\n");
    console.table(
      SCREENING_COLUMNS.map((col) => ({
        カラム名: col.name,
        型: col.type,
        単位: col.unit,
        説明: col.description,
        条件指定例: col.example,
      })),
    );

    console.log("\n================ よく使うクエリ例 (レシピ) ================\n");
    for (const ex of QUERY_EXAMPLES) {
      console.log(`【${ex.title}】`);
      console.log(`  説明: ${ex.description}`);
      console.log(`  SQL:  edinet-ts screen --where "${ex.sql}"\n`);
    }
  });

/**
 * 5. sync コマンド: EDINET APIから最新の有価証券報告書を取得し、DuckDBに差分反映
 */
program
  .command("sync")
  .description(
    "EDINET APIから指定期間の書類を取得し、DuckDBに差分更新します（--since/--untilでバックフィル可能）",
  )
  .option("--db <path>", "DuckDBファイルの保存先", "./data/screening.duckdb")
  .option("-d, --days <number>", "取得する直近の日数 (例: 14 で直近14日分)", "7")
  .option("--since <date>", "同期開始日 (YYYY-MM-DD)")
  .option("--until <date>", "同期終了日 (YYYY-MM-DD, デフォルト: 本日)")
  .option(
    "--doc-types <list>",
    "取得する書類種別 (カンマ区切り。120=有報, 130=訂正有報)",
    "120,130",
  )
  .option("--api-key <key>", "EDINET APIキー (省略時は環境変数 EDINET_API_KEY を使用)")
  .option("--keep-cache", "取込後もXBRLキャッシュを残す")
  .option("--dry-run", "実際のダウンロードやDB更新を行わず、対象書類の件数と一覧のみ表示")
  .action(async (options) => {
    // バッチはJSTで動くため、UTCのtoISOStringではなくAsia/Tokyoの日付を使う。
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
    const until = options.until || today;
    const docTypes = parseDocTypes(options.docTypes);

    let since = options.since;
    if (!since) {
      const days = parseInt(options.days, 10) || 7;
      const d = new Date(until);
      d.setDate(d.getDate() - (days - 1));
      since = d.toISOString().slice(0, 10);
    }

    const apiKey = options.apiKey || process.env.EDINET_API_KEY;
    if (!apiKey) {
      console.log(
        "ℹ️  注意: EDINET_API_KEY が設定されていません。v2 API のアクセス制限や仕様に従い動作します。",
      );
    }

    console.log(`\n🔄 EDINET 同期を開始します (期間: ${since} 〜 ${until})`);
    const client = new EdinetClient({ apiKey });

    process.stdout.write("開示書類一覧を取得中...");
    const allReports = await client.getReportsInRange(since, until, docTypes, (date, count) => {
      process.stdout.write(`\r開示書類一覧を取得中... [${date}] (${count}件の対象書類)`);
    });
    // 投資信託等の非上場書類は証券コードを持たないため、スクリーニング対象から除外する。
    // 訂正有報が後から処理されるよう、提出日時順に並べる。
    const reports = allReports
      .filter((r) => r.secCode)
      .sort((a, b) => a.submitDateTime.localeCompare(b.submitDateTime));
    console.log(
      `\n合計 ${allReports.length} 件の対象書類のうち、上場企業 ${reports.length} 件を同期対象にします。\n`,
    );

    if (reports.length === 0) {
      console.log("同期対象の有価証券報告書はありませんでした。");
      return;
    }

    if (options.dryRun) {
      console.log("【Dry Run】対象書類一覧:");
      console.table(
        reports.map((r) => ({
          書類ID: r.docId,
          提出日時: r.submitDateTime,
          コード: r.secCode || r.edinetCode,
          提出者名: r.filerName,
          件名: r.docDescription.slice(0, 30),
        })),
      );
      console.log(`Dry Run 終了: ${reports.length} 件が取得候補です。`);
      return;
    }

    const dbPath = resolve(process.cwd(), options.db);
    const store = new FinancialStore(dbPath);
    await store.init();

    const existing = await store.getExistingDocuments();
    console.log(`DuckDB既存レコード数: ${existing.bySecurityPeriod.size} 件`);

    const parser = new XbrlParser();
    const extractor = new FinancialExtractor();

    let annualCount = 0;
    let correctionCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (let i = 0; i < reports.length; i++) {
      const report = reports[i];
      const prefix = `[${i + 1}/${reports.length}] ${report.filerName} (${report.secCode || report.edinetCode})`;

      try {
        const reportKey = report.periodEnd
          ? `${normalizeSecCode(report.secCode)}:${report.periodEnd}`
          : undefined;

        // 同じ書類を再取得しない。
        if (existing.docIds.has(report.docId)) {
          if (!options.keepCache) client.removeCached(report.docId);
          skipCount++;
          continue;
        }
        // 訂正有報が入っている決算期に、訂正前の有報で上書きしない。
        if (report.docTypeCode === "120" && reportKey && existing.bySecurityPeriod.has(reportKey)) {
          if (!options.keepCache) client.removeCached(report.docId);
          skipCount++;
          continue;
        }

        const xml = await client.getXbrlContent(report.docId);
        const doc = parser.parse(xml);
        const record = extractor.extract(doc);

        // 120 は新規、130 は同じ (証券コード, 決算期) の行を上書きする。
        await store.insert(record, {
          docId: report.docId,
          docTypeCode: report.docTypeCode,
          submittedAt: report.submitDateTime,
        });
        if (!options.keepCache) {
          client.removeCached(report.docId);
        }

        const recordKey = `${record.metadata.securityCode || normalizeSecCode(report.secCode)}:${
          record.metadata.periodEnd || report.periodEnd
        }`;
        existing.bySecurityPeriod.set(recordKey, {
          docId: report.docId,
          docTypeCode: report.docTypeCode,
        });
        existing.docIds.add(report.docId);

        if (report.docTypeCode === "120") {
          annualCount++;
        } else {
          correctionCount++;
        }
        console.log(
          `✅ ${prefix} [${report.docTypeCode}]: 登録完了 (期末: ${record.metadata.periodEnd})`,
        );
        // EDINET APIへの負荷を抑える
        await new Promise((r) => setTimeout(r, 500));
      } catch (err: any) {
        errorCount++;
        console.error(`⚠️ ${prefix}: スキップ (${err.message})`);
      }
    }

    store.close();

    console.log("\n================ 同期サマリ ================");
    console.log(`期間:           ${since} 〜 ${until}`);
    console.log(`対象書類数:     ${reports.length} 件`);
    console.log(`年次登録:       ${annualCount} 件`);
    console.log(`訂正反映:       ${correctionCount} 件`);
    console.log(`既存スキップ:   ${skipCount} 件`);
    console.log(`エラー/除外:    ${errorCount} 件`);
    console.log(`DB保存先:       ${dbPath}`);
    console.log("===========================================\n");
  });

function parseInteger(value: string): number {
  return parseInt(value, 10);
}

function parseDocTypes(value: unknown): string[] {
  const docTypes = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const unsupported = docTypes.filter((docType) => !SUPPORTED_DOC_TYPES.has(docType));
  if (unsupported.length > 0) {
    console.error(`未対応の書類種別です: ${unsupported.join(",")} (120,130 のみ対応)`);
    process.exit(1);
  }
  return docTypes;
}

function normalizeSecCode(secCode?: string): string {
  if (!secCode) return "";
  return secCode.length === 5 && secCode.endsWith("0") ? secCode.slice(0, 4) : secCode;
}

program.parse(process.argv);
