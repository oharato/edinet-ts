#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { XbrlParser } from "./xbrl/parser.js";
import { FinancialExtractor } from "./financial/extractor.js";
import { FinancialStore } from "./db/store.js";

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
    const formatYen = (val?: number) => (val !== undefined ? `${(val / 100_000_000).toFixed(2)} 億円` : "N/A");
    const formatPercent = (val?: number) => (val !== undefined ? `${(val * 100).toFixed(2)} %` : "N/A");

    console.log(`売上高:       当期 ${formatYen(result.current.netSales)} / 前期 ${formatYen(result.prior.netSales)} (前年比: ${formatPercent(result.salesGrowthRate)})`);
    console.log(`営業利益:     当期 ${formatYen(result.current.operatingIncome)} / 前期 ${formatYen(result.prior.operatingIncome)} (前年比: ${formatPercent(result.operatingIncomeGrowthRate)})`);
    console.log(`営業利益率:   当期 ${formatPercent(result.operatingMarginCurrent)} / 前期 ${formatPercent(result.operatingMarginPrior)}`);
    console.log(`利益率成長率: ${formatPercent(result.operatingMarginGrowthRate)} (ポイント差: ${formatPercent(result.operatingMarginDelta)})`);
    console.log(`自己資本比率: 当期 ${formatPercent(result.equityRatioCurrent)} / 前期 ${formatPercent(result.equityRatioPrior)}`);
    console.log(`ROE:          当期 ${formatPercent(result.roeCurrent)}`);
    console.log(`営業活動CF:   当期 ${formatYen(result.current.operatingCashFlow)} / 前期 ${formatYen(result.prior.operatingCashFlow)}`);
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
        await store.insert(comparison);
        successCount++;
        process.stdout.write(`\rLoaded [${successCount}/${files.length}]: ${comparison.metadata.companyName.padEnd(20)}`);
      } catch (e: any) {
        console.error(`\nFailed to parse ${file}: ${e.message}`);
      }
    }

    console.log(`\nSuccessfully loaded ${successCount} files into DuckDB (${dbPath})`);
    store.close();
  });

/**
 * 3. screen コマンド: DuckDBから条件検索して表示
 */
program
  .command("screen")
  .description("DuckDBから利益率や成長率の条件で企業をスクリーニングします")
  .option("--db <path>", "DuckDBファイルのパス", "./data/screening.duckdb")
  .option("-w, --where <sql>", "任意のSQL条件式 (例: \"operating_margin_current > 0.15 AND equity_ratio_current > 0.5\")")
  .option("--min-growth <number>", "営業利益率の前年比成長率の下限 (例: 0.20 で +20%以上)", parseFloat)
  .option("--min-margin <number>", "当期営業利益率の下限 (例: 0.10 で 10%以上)", parseFloat)
  .option("--min-sales-growth <number>", "売上成長率の下限", parseFloat)
  .option("--min-equity-ratio <number>", "自己資本比率の下限 (例: 0.50 で 50%以上)", parseFloat)
  .option("--min-roe <number>", "ROEの下限 (例: 0.10 で 10%以上)", parseFloat)
  .option("--order-by <field>", "ソート項目 (margin_growth, current_margin, sales_growth, equity_ratio, roe)", "current_margin")
  .option("--order-dir <dir>", "ソート順 (asc, desc)", "desc")
  .option("-l, --limit <number>", "取得件数上限", parseInt, 50)
  .option("--json", "JSON形式で出力")
  .action(async (options) => {
    const dbPath = resolve(process.cwd(), options.db);
    const store = new FinancialStore(dbPath);
    await store.init();

    const rows = await store.screen({
      whereClause: options.where,
      minMarginGrowth: options.minGrowth,
      minCurrentMargin: options.minMargin,
      minSalesGrowth: options.minSalesGrowth,
      minEquityRatio: options.minEquityRatio,
      minRoe: options.minRoe,
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
        会社名: r.companyName.length > 12 ? r.companyName.slice(0, 11) + "…" : r.companyName,
        決算期: r.periodEnd,
        "売上(億円)": r.netSalesCurrent ? (r.netSalesCurrent / 100_000_000).toFixed(1) : "-",
        "営業益(億円)": r.operatingIncomeCurrent ? (r.operatingIncomeCurrent / 100_000_000).toFixed(1) : "-",
        "利益率(%)": r.operatingMarginCurrent ? (r.operatingMarginCurrent * 100).toFixed(2) : "-",
        "利益率成長(%)": r.operatingMarginGrowthRate ? (r.operatingMarginGrowthRate * 100).toFixed(2) : "-",
        "自己資本比率(%)": r.equityRatioCurrent ? (r.equityRatioCurrent * 100).toFixed(2) : "-",
        "ROE(%)": r.roeCurrent ? (r.roeCurrent * 100).toFixed(2) : "-",
      }))
    );
  });

program.parse(process.argv);
