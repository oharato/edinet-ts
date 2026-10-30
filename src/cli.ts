#!/usr/bin/env node
import {planCorporateRegistryDifferences} from './corporate-registry-calendar';
import { parseDocumentTimestamp } from "./document-timestamp";
import {recoverDedicatedSqliteSnapshot,type DedicatedSqliteRecoveryKind} from "./db/sqlite-recovery";
import {PublishedFinancialIndex} from "./published-financial-index";
import {FinancialIndexPublication} from "./db/financial-index-publication";
import {backfillFinancialDocumentLists,archiveFinancialDocumentObservations} from "./financial-document-sync";
import {FinancialSourceJob,normalizeFinancialSourceJobInput} from "./db/financial-source-job";
import { searchOfficerRemuneration } from "./officer-remuneration";
import { searchOfficerDetails } from "./officer-details";
import { searchPolicyShareholdings } from "./policy-shareholdings";
import { FacilityDetailStore } from "./db/facility-detail-store";
import { LargeHoldingStore } from "./db/large-holding-store";
import { searchObservedLargeHoldingReports } from "./observed-large-holding";
import { searchLargeHoldingReports } from "./large-holding-report";
import { searchMajorShareholderDetails } from "./major-shareholder-details";
import { searchShareholderCategories } from "./shareholder-categories";
import { searchOrderDetails } from "./order-details";
import { searchAffiliatedCompanies } from "./affiliated-company-details";
import { searchSegmentDetails } from "./segment-details";
import { searchMainCustomerDetails } from "./main-customer-details";
import { screenSubsidiaryHumanCapitalMetrics } from "./subsidiary-human-capital-metrics";
import { Command } from "commander";
import { analyzeDocumentRelations } from "./document-relations";
import { createCompanyProfile, CompanyProfileFieldId } from "./company-profile";
import { screenCompanyDocuments, CompanyProfileOperator } from "./company-screening";
import { screenWorkforceDocuments } from "./workforce-screening";
import { searchSubsidiaryHumanCapitalLabels, SubsidiaryHumanCapitalLabelOperator } from "./subsidiary-human-capital-labels";
import { resolveFinancialReportingBasis } from "./financial-reporting-basis";
import { createAutomaticFinancialSnapshots } from "./automatic-financial-snapshots";
import { createObservedFinancialSnapshots,captureObservedFinancialSources } from "./observed-financial-snapshots";
import {captureDocumentVersionObservations} from "./document-version-selection";
import {createHash} from "node:crypto";
import {ObservedFinancialArchive,normalizeArchivedFinancialSnapshotOptions} from "./db/observed-financial-archive";
import {FinancialSearchIndex,normalizeFinancialIndexSearch,isFinancialIndexGenerationId} from "./db/financial-search-index";
import {screenCompanyFinancials} from "./company-financial-screening";
import {compareCompanyFinancialsByIndustry} from "./company-industry-comparison";
import {reconstructCorporateRegistryState} from "./corporate-registry";
import {CorporateRegistryStore} from "./db/corporate-registry-store";
import {FinancialIndexBuild,normalizeFinancialIndexBuildInput} from "./db/financial-index-build";
import { screenIfrsFinancialDetailDocuments } from "./ifrs-financial-detail-screening";
import { screenIfrsBalanceSheetDocuments } from "./ifrs-balance-sheet-screening";
import "dotenv/config";
import { EdinetXbrlDownloader } from "./edinet-xbrl-downloader";
import { EdinetXbrlParser } from "./edinet-xbrl-parser";
import { EdinetRepository } from "./db/edinet-repository";
import { generateFullHelpMarkdown } from "./utils/type-doc-helpers";
import { screenAnnualRevenueGrowth } from "./annual-revenue-growth";
import { screenAnnualOperatingIncomeGrowth } from "./annual-operating-income-growth";
import { screenAnnualNetIncomeGrowth } from "./annual-net-income-growth";
import { screenCagr, screenPerShareGrowth, PerShareGrowthMetricId } from "./annual-cagr";
import { screenFinancialDetailDocuments } from "./financial-detail-screening";
import { screenFinancialDetailSnapshots } from "./financial-detail-snapshots";
import { readRegularFile, LOCAL_IMPORT_LIMITS } from "./local-balance-sheet-import";
import { runLocalBalanceSheetImport, runLocalBalanceSheetDiff } from "./local-balance-sheet-import";
import { createBalanceSheetSnapshot, screenBalanceSheetSnapshots } from "./balance-sheet-screening";
import { screenFinancialSnapshots } from "./financial-screening";
import * as fs from "fs";
import * as path from "path";

import { resolveCliDocumentType } from "./cli-document-type";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Read version from package.json
const packageJsonPath = path.join(__dirname, "..", "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

const program = new Command();

program
    .name("edinet-ts")
    .description("EDINET XBRLファイルをダウンロードおよび解析するためのCLI")
    .version(packageJson.version);

program.command("download")
    .description("EDINET書類をダウンロードします")
    .option("-t, --ticker <codes>", "証券コード（カンマ区切り、例: 7203,9984）")
    .option("-d, --date <date>", "対象日 (YYYY-MM-DD)。デフォルトは当日")
    .option("--type <type>", "書類種別 (例: Annual, registration-statement/030, securities-notice/010)。既定: Annual", "Annual")
    .option("--dir <path>", "出力先ディレクトリ", "./downloads")
    .action(async (options) => {
        const downloader = new EdinetXbrlDownloader({ rootDir: options.dir });
        const date = options.date || new Date().toISOString().split("T")[0];

        const docType = resolveCliDocumentType(options.type);

        const tickers = options.ticker ? options.ticker.split(",") : [];
        if (tickers.length === 0) {
            console.error("--ticker オプションで少なくとも1つの証券コードを指定してください");
            process.exit(1);
        }

        console.log(`Downloading ${options.type} for ${tickers.join(", ")} on ${date}...`);

        for (const ticker of tickers) {
            try {
                const result = await downloader.downloadByTicker(ticker.trim(), options.dir, date, docType);
                if (result) {
                    console.log(`Downloaded: ${result}`);
                } else {
                    console.warn(`Not found: ${ticker}`);
                }
            } catch (e: any) {
                console.error(`Failed to download ${ticker}:`, e.message);
            }
        }
    });

program.command("import-bs")
    .description("指定したローカル原本だけを財務試験DBへ差分取り込みします（ネット取得なし）")
    .requiredOption("--manifest <path>", "原本の一覧JSON（相対fileはmanifest基準、100件以下）")
    .requiredOption("--db <path>", "専用の試験用財務DB")
    .requiredOption("--extractor-version <version>", "利用する解析器の版（利用側の宣言）")
    .option("--mapping-version <version>", "対応表の版（既定: 現行BS3辞書の版）")
    .option("--source-commit <sha>", "解析器ソースの40桁commit、小文字16進")
    .option("--dry-run", "全指定原本のhashを計算して計画だけ返す。DBを作成・変更しない")
    .option("--create", "未作成の試験用DBを排他的に新規作成する")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const result = runLocalBalanceSheetImport(options);
            console.log(JSON.stringify(result, null, options.pretty ? 2 : undefined));
            if (result.plan.counts.conflict) process.exitCode = 1;
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    });

program.command("diff-bs")
    .description("同一原本の2つの保存版について財務値・採用状態・出典を読み取り比較します")
    .requiredOption("--db <path>", "停止済みの専用試験用財務DB")
    .requiredOption("--before <id>", "比較元のsnapshot ID")
    .requiredOption("--after <id>", "比較先のsnapshot ID（新旧を自動判断しません）")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const result = runLocalBalanceSheetDiff(options);
            console.log(JSON.stringify(result, null, options.pretty ? 2 : undefined));
            if (result.status === "incomparable") process.exitCode = 1;
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    });

program.command("explain-document-relations")
    .description("明示した一覧JSONの親子関係・複数観測を説明します（取得・最新版選択なし）")
    .requiredOption("--file <path>", "観測IDとdocumentを持つJSON配列、2MiB以下")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const bytes = readRegularFile(path.resolve(options.file), LOCAL_IMPORT_LIMITS.manifestBytes).bytes;
            const input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
            const result = analyzeDocumentRelations(input);
            console.log(JSON.stringify(result, null, options.pretty ? 2 : undefined));
        } catch {
            // 元JSON・例外・書類情報をエラー出力へ転載しません。
            console.error("書類関係の入力を確認してください（通常JSONファイル・2MiB以下・有効な観測一覧が必要です）");
            process.exitCode = 1;
        }
    });


program.command("screen-ifrs-bs")
    .description("同じ期末のIFRS連結・円の直接項目で、明示した会社を検索します")
    .requiredOption("--manifest <path>", "fileとIFRS metadataを持つJSON配列")
    .option("--metrics <ids>", "既定3項目に追加する直接項目ID（カンマ区切り）")
    .option("--conditions <json>", "直接項目のAND条件（追加項目は--metricsにも指定）", "[]")
    .option("--sort-by <id>", "並べ替える直接項目ID")
    .option("--order <order>", "asc/desc")
    .option("--offset <number>", "条件一致後に読み飛ばす件数", Number)
    .option("--limit <number>", "返す最大件数", Number)
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const manifestPath = path.resolve(options.manifest);
            const entries = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readRegularFile(manifestPath, LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            if (!Array.isArray(entries) || entries.length > LOCAL_IMPORT_LIMITS.entries) throw new Error("入力件数の上限です");
            let bytes = 0;
            const documents = entries.map(entry => {
                if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(key => !["file", "metadata"].includes(key)) || typeof entry.file !== "string" || !entry.file.trim()) throw new Error("入力項目が不正です");
                const input = readRegularFile(path.resolve(path.dirname(manifestPath), entry.file), Math.min(LOCAL_IMPORT_LIMITS.sourceBytes, LOCAL_IMPORT_LIMITS.totalBytes - bytes));
                bytes += input.bytes.byteLength;
                return { xml: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input.bytes), metadata: entry.metadata };
            });
            const result = screenIfrsBalanceSheetDocuments(documents, { metricIds: options.metrics === undefined ? undefined : options.metrics.split(",").map((id:string) => id.trim()), conditions: JSON.parse(options.conditions), sortBy: options.sortBy, order: options.order, offset: options.offset, limit: options.limit });
            console.log(JSON.stringify(result, null, options.pretty ? 2 : undefined));
        } catch {
            console.error("IFRS検索の入力を確認してください（同一期末・IFRS連結・JPYの明示一覧と有効な検索条件が必要です）");
            process.exitCode = 1;
        }
    });

program.command("search-subsidiary-labels")
    .description("連結子会社の人的資本表の解析済み会社ラベルを、明示原本から探します")
    .requiredOption("--manifest <path>", "fileとdocID/instant等のmetadataを持つJSON配列")
    .option("--conditions <json>", "eq/containsのAND条件", "[]")
    .option("--equals <text>", "解析済みラベルとの完全一致を追加")
    .option("--contains <text>", "解析済みラベルとの部分一致を追加")
    .option("--order <order>", "ラベルのasc/desc")
    .option("--offset <number>", "条件一致後に読み飛ばす行数", Number)
    .option("--limit <number>", "返す最大行数", Number)
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const manifestPath = path.resolve(options.manifest);
            const entries = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readRegularFile(manifestPath, LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            if (!Array.isArray(entries) || entries.length > LOCAL_IMPORT_LIMITS.entries) throw new Error("入力件数の上限です");
            let bytes = 0;
            const documents = entries.map(entry => {
                if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(key => !["file", "metadata"].includes(key)) || typeof entry.file !== "string" || !entry.file.trim()) throw new Error("入力項目が不正です");
                const input = readRegularFile(path.resolve(path.dirname(manifestPath), entry.file), Math.min(LOCAL_IMPORT_LIMITS.sourceBytes, LOCAL_IMPORT_LIMITS.totalBytes - bytes));
                bytes += input.bytes.byteLength;
                return { xml: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input.bytes), metadata: entry.metadata };
            });
            const conditions = JSON.parse(options.conditions);
            if (!Array.isArray(conditions)) throw new Error("条件は配列です");
            if (options.equals !== undefined) conditions.push({ operator: SubsidiaryHumanCapitalLabelOperator.Equal, value: options.equals });
            if (options.contains !== undefined) conditions.push({ operator: SubsidiaryHumanCapitalLabelOperator.Contains, value: options.contains });
            const result = searchSubsidiaryHumanCapitalLabels(documents, { conditions, order: options.order, offset: options.offset, limit: options.limit });
            console.log(JSON.stringify(result, null, options.pretty ? 2 : undefined));
        } catch {
            console.error("会社ラベル検索の入力を確認してください（明示原本一覧・対象期末・有効な文字列条件が必要です）");
            process.exitCode = 1;
        }
    });

program.command("screen-workforce")
    .description("提出会社単体の給与・明示した年齢/勤続年数/従業員数/平均臨時雇用人員を検索します（期末指定）")
    .requiredOption("--manifest <path>", "fileとmetadataを持つJSON配列（相対fileは一覧基準）")
    .option("--metrics <ids>", "追加して読むIDをカンマ区切りで明示（省略は給与のみ）")
    .option("--conditions <json>", "選択した人的資本項目のAND条件", "[]")
    .option("--sort-by <metric>", "選択した人的資本項目のID")
    .option("--order <order>", "ascまたはdesc", "desc")
    .option("--offset <number>", "開始位置", "0")
    .option("--limit <number>", "最大件数")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const manifestPath = path.resolve(options.manifest);
            const entries = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readRegularFile(manifestPath, LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            if (!Array.isArray(entries) || entries.length > LOCAL_IMPORT_LIMITS.entries) throw new Error("manifestは100件以下の配列です");
            let bytes = 0;
            const documents = entries.map(entry => {
                if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(key => !["file", "metadata"].includes(key)) || typeof entry.file !== "string" || !entry.file.trim())
                    throw new Error("不正な人的資本manifestです");
                const input = readRegularFile(path.resolve(path.dirname(manifestPath), entry.file), Math.min(LOCAL_IMPORT_LIMITS.sourceBytes, LOCAL_IMPORT_LIMITS.totalBytes - bytes));
                bytes += input.bytes.byteLength;
                return { xml: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input.bytes), metadata: entry.metadata };
            });
            for (const value of [options.offset, options.limit]) if (value !== undefined && !/^\d+$/.test(value)) throw new Error("offset/limitは0以上の整数です");
            console.log(JSON.stringify(screenWorkforceDocuments(documents, {
                metricIds: options.metrics === undefined ? undefined : options.metrics.split(",").map((id: string) => id.trim()),
                conditions: JSON.parse(options.conditions), sortBy: options.sortBy, order: options.order,
                offset: Number(options.offset), limit: options.limit === undefined ? undefined : Number(options.limit)
            }), null, options.pretty ? 2 : undefined));
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    });

program.command("screen-companies")
    .description("明示原本の会社名・コード・決算月を検索します（最新選択・企業結合なし）")
    .requiredOption("--manifest <path>", "fileとdocIDを持つJSON配列（相対fileは一覧基準）")
    .option("--name-contains <text>", "原本の会社名に含まれる文字列")
    .option("--edinet-code <code>", "原本のEDINETコードに完全一致")
    .option("--security-code <code>", "原本の証券コードに完全一致（文字列のまま）")
    .option("--fiscal-year-end-month <number>", "当期終了日の月（1〜12）")
    .option("--conditions <json>", "会社情報のAND条件", "[]")
    .option("--sort-by <field>", "会社情報6項目のID", "edinetCode")
    .option("--order <order>", "ascまたはdesc", "asc")
    .option("--offset <number>", "開始位置", "0")
    .option("--limit <number>", "最大件数")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const manifestPath = path.resolve(options.manifest);
            const entries = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readRegularFile(manifestPath, LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            if (!Array.isArray(entries) || entries.length > LOCAL_IMPORT_LIMITS.entries) throw new Error("manifestは100件以下の配列です");
            let bytes = 0;
            const documents = entries.map(entry => {
                if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(key => !["file", "docID"].includes(key)) ||
                    typeof entry.file !== "string" || !entry.file.trim() || typeof entry.docID !== "string") throw new Error("不正な会社情報manifestです");
                const input = readRegularFile(path.resolve(path.dirname(manifestPath), entry.file), Math.min(LOCAL_IMPORT_LIMITS.sourceBytes, LOCAL_IMPORT_LIMITS.totalBytes - bytes));
                bytes += input.bytes.byteLength;
                return { xml: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input.bytes), docID: entry.docID };
            });
            const conditions = JSON.parse(options.conditions);
            if (!Array.isArray(conditions)) throw new Error("conditionsは配列です");
            for (const [value, field, operator] of [
                [options.nameContains, CompanyProfileFieldId.FilerName, CompanyProfileOperator.Contains],
                [options.edinetCode, CompanyProfileFieldId.EdinetCode, CompanyProfileOperator.Equal],
                [options.securityCode, CompanyProfileFieldId.SecurityCode, CompanyProfileOperator.Equal]
            ]) if (value !== undefined) conditions.push({ field, operator, value });
            for (const value of [options.offset, options.limit, options.fiscalYearEndMonth])
                if (value !== undefined && !/^\d+$/.test(value)) throw new Error("月/offset/limitは整数で指定してください");
            console.log(JSON.stringify(screenCompanyDocuments(documents, {
                conditions, fiscalYearEndMonth: options.fiscalYearEndMonth === undefined ? undefined : Number(options.fiscalYearEndMonth),
                sortBy: options.sortBy, order: options.order, offset: Number(options.offset), limit: options.limit === undefined ? undefined : Number(options.limit)
            }), null, options.pretty ? 2 : undefined));
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    });

program.command("company-profile")
    .description("明示した原本から会社情報を出典付きで読みます（取得・DB更新なし）")
    .requiredOption("--file <path>", "通常ファイルのローカルXBRL（64MiB以下）")
    .requiredOption("--doc-id <id>", "利用者が原本と対応を確認した書類ID")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const input = readRegularFile(path.resolve(options.file), LOCAL_IMPORT_LIMITS.sourceBytes);
            const xml = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input.bytes);
            console.log(JSON.stringify(createCompanyProfile(xml, options.docId), null, options.pretty ? 2 : undefined));
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    });

program.command("screen-details-json")
    .description("保存済み財務snapshotの原値・出典の整合を検査して検索します")
    .requiredOption("--file <path>", "FinancialDetailSnapshotのJSON配列（100件/64MiB以下）")
    .option("--metrics <ids>", "保存済みの項目IDをカンマ区切りで明示（省略は従来5項目）")
    .option("--conditions <json>", "AND条件のJSON配列", "[]")
    .option("--sort-by <metric>", "選択した直接財務項目のID")
    .option("--order <order>", "ascまたはdesc", "desc")
    .option("--offset <number>", "開始位置", "0")
    .option("--limit <number>", "最大件数")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const bytes = readRegularFile(path.resolve(options.file), LOCAL_IMPORT_LIMITS.sourceBytes).bytes;
            const snapshots = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
            if (!Array.isArray(snapshots) || snapshots.length > LOCAL_IMPORT_LIMITS.entries) throw new Error("snapshotは100件以下の配列です");
            for (const value of [options.offset, options.limit]) if (value !== undefined && !/^\d+$/.test(value)) throw new Error("offset/limitは0以上の整数です");
            console.log(JSON.stringify(screenFinancialDetailSnapshots(snapshots, {
                metricIds: options.metrics === undefined ? undefined : options.metrics.split(",").map((id: string) => id.trim()),
                conditions: JSON.parse(options.conditions), sortBy: options.sortBy, order: options.order,
                offset: Number(options.offset), limit: options.limit === undefined ? undefined : Number(options.limit)
            }), null, options.pretty ? 2 : undefined));
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    });

program.command("screen-details")
    .description("明示原本から直接財務項目を検索します（既定5項目、CFは--metricsで明示）")
    .requiredOption("--manifest <path>", "fileとmetadataを持つJSON配列（相対fileは一覧基準）")
    .option("--metrics <ids>", "読む項目IDをカンマ区切りで明示（省略は従来5項目）")
    .option("--conditions <json>", "AND条件のJSON配列", "[]")
    .option("--sort-by <metric>", "選択した直接財務項目のID")
    .option("--order <order>", "ascまたはdesc", "desc")
    .option("--offset <number>", "開始位置", "0")
    .option("--limit <number>", "最大件数")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const manifestPath = path.resolve(options.manifest);
            const entries = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(readRegularFile(manifestPath,LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            if (!Array.isArray(entries) || entries.length > LOCAL_IMPORT_LIMITS.entries) throw new Error("manifestは100件以下の配列です");
            let bytes = 0;
            const documents = entries.map(entry => {
                if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(key => !["file","metadata"].includes(key)) || typeof entry.file !== "string" || !entry.file.trim()) throw new Error("不正な財務明細manifestです");
                const input = readRegularFile(path.resolve(path.dirname(manifestPath),entry.file),Math.min(LOCAL_IMPORT_LIMITS.sourceBytes,LOCAL_IMPORT_LIMITS.totalBytes-bytes));bytes+=input.bytes.byteLength;
                return {xml:new TextDecoder("utf-8",{fatal:true}).decode(input.bytes),metadata:entry.metadata};
            });
            for (const value of [options.offset,options.limit]) if (value!==undefined&&!/^\d+$/.test(value)) throw new Error("offset/limitは0以上の整数です");
            console.log(JSON.stringify(screenFinancialDetailDocuments(documents,{metricIds:options.metrics===undefined?undefined:options.metrics.split(",").map((id:string)=>id.trim()),conditions:JSON.parse(options.conditions),sortBy:options.sortBy,order:options.order,offset:Number(options.offset),limit:options.limit===undefined?undefined:Number(options.limit)}),null,options.pretty?2:undefined));
        } catch(error) { console.error(error instanceof Error?error.message:String(error));process.exitCode=1; }
    });

/** 両前年比CLIの読取り上限・入力形式を同じに保ちます。数値の検査は各APIが行います。 */
function registerAnnualGrowthCommand(name:string,description:string,metric:string,screen:(pairs:any[],options:any)=>unknown,perShare=false):void {
program.command(name)
    .description(description)
    .requiredOption("--manifest <path>", "previous/currentにfileとmetadataを持つJSON配列")
    .option("--conditions <json>", perShare ? "operator/valueのAND条件" : `${metric}のAND条件`, "[]")
    .option("--order <order>", "ascまたはdesc", "desc")
    .option("--offset <number>", "開始位置", "0")
    .option("--limit <number>", "最大件数")
    .option("--pretty", "JSONを整形")
    .action(options=>{
        try{
            const manifestPath=path.resolve(options.manifest),entries=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(readRegularFile(manifestPath,LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            if(!Array.isArray(entries)||entries.length>LOCAL_IMPORT_LIMITS.entries)throw new Error("manifestは100pair以下の配列です");let bytes=0;
            const load=(entry:any)=>{if(!entry||typeof entry!=="object"||Array.isArray(entry)||Object.keys(entry).some(key=>!["file","metadata",...(perShare?["shareBasis"]:[])].includes(key))||typeof entry.file!=="string"||!entry.file.trim())throw new Error("不正な原本指定です");
                const input=readRegularFile(path.resolve(path.dirname(manifestPath),entry.file),Math.min(LOCAL_IMPORT_LIMITS.sourceBytes,LOCAL_IMPORT_LIMITS.totalBytes-bytes));bytes+=input.bytes.byteLength;return {xml:new TextDecoder("utf-8",{fatal:true}).decode(input.bytes),metadata:entry.metadata,...(perShare?{shareBasis:entry.shareBasis}:{})};};
            const pairs=entries.map(pair=>{if(!pair||typeof pair!=="object"||Array.isArray(pair)||Object.keys(pair).some(key=>!["previous","current"].includes(key)))throw new Error("previous/currentを明示してください");return {previous:load(pair.previous),current:load(pair.current)};});
            for(const value of [options.offset,options.limit])if(value!==undefined&&!/^\d+$/.test(value))throw new Error("offset/limitは0以上の整数です");
            console.log(JSON.stringify(screen(pairs,{conditions:JSON.parse(options.conditions),order:options.order,offset:Number(options.offset),limit:options.limit===undefined?undefined:Number(options.limit)}),null,options.pretty?2:undefined));
        }catch(error){console.error(perShare?"1株当たり前年比の入力・株式基準・条件を確認してください（入力内容は非表示）":error instanceof Error?error.message:String(error));process.exitCode=1;}
    });

}
registerAnnualGrowthCommand("screen-sales-growth","明示した前年/当年の12暦月売上高pairを前年比で検索します（1=100%）","netSalesGrowth",screenAnnualRevenueGrowth);
registerAnnualGrowthCommand("screen-operating-income-growth","明示した前年/当年の12暦月営業利益pairを前年比で検索します（前期正値・1=100%）","operatingIncomeGrowth",screenAnnualOperatingIncomeGrowth);

registerAnnualGrowthCommand("screen-net-income-growth", "明示した親会社株主利益pairを前年比で検索します（前期正値）", "netIncomeGrowth", screenAnnualNetIncomeGrowth);

registerAnnualGrowthCommand("screen-eps-growth", "根拠付きの同一株式基準で実績EPS前年比を検索します", "earningsPerShareGrowth", (pairs, options) => screenPerShareGrowth(pairs, PerShareGrowthMetricId.EarningsPerShare, options), true);
registerAnnualGrowthCommand("screen-dividend-growth", "根拠付きの同一株式基準で支払済み配当前年比を検索します", "dividendPerShareGrowth", (pairs, options) => screenPerShareGrowth(pairs, PerShareGrowthMetricId.DividendPerShare, options), true);

program.command("screen-cagr")
    .description("連続する年次原本の明示系列からCAGRを検索します（3年は4原値）")
    .requiredOption("--manifest <path>", "各社のfile/metadata配列を持つJSON二重配列")
    .requiredOption("--metric <id>", "netSalesCagr/operatingIncomeCagr/netIncomeCagr/earningsPerShareCagr/dividendPerShareCagr")
    .option("--conditions <json>", "operator/valueのAND条件", "[]")
    .option("--order <order>", "ascまたはdesc", "desc")
    .option("--offset <number>", "開始位置", "0")
    .option("--limit <number>", "最大件数")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const manifestPath = path.resolve(options.manifest);
            const entries = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readRegularFile(manifestPath, LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            if (!Array.isArray(entries) || entries.length > LOCAL_IMPORT_LIMITS.entries) throw new Error("manifestは100系列以下です");
            let bytes = 0;
            const series = entries.map(items => {
                if (!Array.isArray(items) || items.length < 2 || items.length > 21) throw new Error("各系列は2〜21原本です");
                return items.map(entry => {
                    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(key => !["file", "metadata", "shareBasis"].includes(key)) || typeof entry.file !== "string" || !entry.file.trim()) throw new Error("file/metadataが必要です");
                    const input = readRegularFile(path.resolve(path.dirname(manifestPath), entry.file), Math.min(LOCAL_IMPORT_LIMITS.sourceBytes, LOCAL_IMPORT_LIMITS.totalBytes - bytes));
                    bytes += input.bytes.byteLength;
                    return { xml: new TextDecoder("utf-8", { fatal: true }).decode(input.bytes), metadata: entry.metadata, ...(Object.hasOwn(entry, "shareBasis") ? { shareBasis: entry.shareBasis } : {}) };
                });
            });
            for (const value of [options.offset, options.limit]) if (value !== undefined && !/^\d+$/.test(value)) throw new Error("ページ指定は0以上の整数です");
            console.log(JSON.stringify(screenCagr(series, options.metric, { conditions: JSON.parse(options.conditions), order: options.order, offset: Number(options.offset), limit: options.limit === undefined ? undefined : Number(options.limit) }), null, options.pretty ? 2 : undefined));
        } catch {
            console.error("CAGR検索の原本一覧・項目・条件・期間を確認してください（入力内容は非表示）");
            process.exitCode = 1;
        }
    });

program.command("screen-subsidiary-human-capital")
    .description("子会社人的資本表の同じ項目・定義を検索します（比率1=100%）")
    .requiredOption("--manifest <path>", "file/metadataと任意のannotationsを持つJSON配列")
    .requiredOption("--metric <id>", "女性管理職・賃金差・報告育休率の項目ID")
    .option("--childcare-method <method>", "育休率ではordinance-item1/ordinance-item2/womens-actを必須指定")
    .option("--label-contains <text>", "原表の会社ラベルに含まれるliteral文字列")
    .option("--conditions <json>", "operator/valueのAND条件", "[]")
    .option("--order <order>", "ascまたはdesc", "desc")
    .option("--offset <number>", "開始位置", "0")
    .option("--limit <number>", "最大件数")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const manifest = path.resolve(options.manifest), entries = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readRegularFile(manifest, LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            if (!Array.isArray(entries) || entries.length > LOCAL_IMPORT_LIMITS.entries) throw new Error();
            let bytes = 0;
            const documents = entries.map(entry => {
                if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(k => !["file", "metadata", "annotations"].includes(k)) || typeof entry.file !== "string" || !entry.file.trim()) throw new Error();
                const input = readRegularFile(path.resolve(path.dirname(manifest), entry.file), Math.min(LOCAL_IMPORT_LIMITS.sourceBytes, LOCAL_IMPORT_LIMITS.totalBytes - bytes)); bytes += input.bytes.byteLength;
                return { xml: new TextDecoder("utf-8", { fatal: true }).decode(input.bytes), metadata: entry.metadata, annotations: entry.annotations };
            });
            for (const value of [options.offset, options.limit]) if (value !== undefined && !/^\d+$/.test(value)) throw new Error();
            console.log(JSON.stringify(screenSubsidiaryHumanCapitalMetrics(documents, options.metric, { conditions: JSON.parse(options.conditions), labelContains: options.labelContains, childcareMethod: options.childcareMethod, order: options.order, offset: Number(options.offset), limit: options.limit === undefined ? undefined : Number(options.limit) }), null, options.pretty ? 2 : undefined));
        } catch { console.error("子会社表の原本・対象期末・項目・定義・注記宣言を確認してください（入力内容は非表示）"); process.exitCode = 1; }
    });

program.command("import-facility-details")
    .description("確認済み設備表の原文と根拠付き明細を専用Storeへ保存します")
    .requiredOption("--db <path>", "設備明細専用SQLite")
    .requiredOption("--manifest <path>", "file/selection/accountingStandard/declarationsのJSON配列")
    .option("--pretty", "JSONを整形")
    .action(options => {
        let store: FacilityDetailStore | undefined;
        try {
            const manifest = path.resolve(options.manifest), entries = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readRegularFile(manifest, LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            if (!Array.isArray(entries) || entries.length > LOCAL_IMPORT_LIMITS.entries) throw new Error();
            let bytes = 0;
            const documents = entries.map(entry => {
                if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(k => !["file", "selection", "accountingStandard", "declarations"].includes(k)) || typeof entry.file !== "string" || !entry.file.trim()) throw new Error();
                const input = readRegularFile(path.resolve(path.dirname(manifest), entry.file), Math.min(LOCAL_IMPORT_LIMITS.sourceBytes, LOCAL_IMPORT_LIMITS.totalBytes - bytes)); bytes += input.bytes.byteLength;
                return { xml: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input.bytes), selection: entry.selection, accountingStandard: entry.accountingStandard, declarations: entry.declarations };
            });
            store = new FacilityDetailStore(options.db);
            console.log(JSON.stringify(store.append(documents), null, options.pretty ? 2 : undefined));
        } catch { console.error("設備Storeの保存先・原本・表宣言を確認してください（入力内容は非表示）"); process.exitCode = 1; }
        finally { store?.close(); }
    });

program.command("search-facility-detail-store")
    .description("保存済み設備表を同じ基準日・円/平方メートルの条件で検索します")
    .requiredOption("--db <path>", "設備明細専用SQLite")
    .requiredOption("--as-of-date <date>", "確認済みの表の基準日")
    .option("--snapshot-ids <csv>", "投入結果のsnapshotIdsをカンマ区切りで選択")
    .option("--conditions <json>", "field/operator/valueのAND条件", "[]")
    .option("--contains <text>", "所在地・会社名・セグメントに含まれる文字列")
    .option("--organization <kind>", "reporting-company/domestic-subsidiaries/overseas-subsidiaries")
    .option("--sort-by <field>", "totalBookValueJPY/landBookValueJPY/buildingsBookValueJPY/landAreaM2")
    .option("--order <order>", "ascまたはdesc", "desc")
    .option("--offset <number>", "開始位置", "0")
    .option("--limit <number>", "最大件数", "100")
    .option("--pretty", "JSONを整形")
    .action(options => {
        let store: FacilityDetailStore | undefined;
        try {
            for (const value of [options.offset, options.limit]) if (!/^\d+$/.test(value)) throw new Error();
            store = new FacilityDetailStore(options.db, { readOnly: true });
            const result = store.search({ asOfDate: options.asOfDate, snapshotIds: options.snapshotIds === undefined ? undefined : options.snapshotIds.split(",").map((id: string) => id.trim()), conditions: JSON.parse(options.conditions), contains: options.contains, organization: options.organization, sort: options.sortBy === undefined ? undefined : { field: options.sortBy, order: options.order }, offset: Number(options.offset), limit: Number(options.limit) });
            console.log(JSON.stringify(result, null, options.pretty ? 2 : undefined));
        } catch { console.error("設備Store・基準日・対象snapshot・検索条件を確認してください（入力内容は非表示）"); process.exitCode = 1; }
        finally { store?.close(); }
    });

program.command("import-large-holdings")
    .description("一覧観測と原本hash付き解析結果を専用Storeへ追記します")
    .requiredOption("--db <path>", "大量保有専用SQLite")
    .requiredOption("--observations <path>", "一覧観測JSON配列。原本だけの追記は空配列")
    .option("--manifest <path>", "任意fileとdocID/availableAt/sourceSha256/coverContextRefのJSON配列")
    .option("--pretty", "JSONを整形")
    .action(options => {
        let store: LargeHoldingStore | undefined;
        try {
            const readJSON = (file: string) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readRegularFile(path.resolve(file), LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            const observations = readJSON(options.observations), manifest = options.manifest === undefined ? undefined : path.resolve(options.manifest), entries = manifest === undefined ? [] : readJSON(manifest);
            if (!Array.isArray(entries) || entries.length > LOCAL_IMPORT_LIMITS.entries) throw new Error();
            let bytes = 0;
            const sources = entries.map(entry => {
                if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(k => !["file", "docID", "availableAt", "sourceSha256", "coverContextRef"].includes(k))) throw new Error();
                const { file, ...source } = entry;
                if (file === undefined) return source;
                if (typeof file !== "string" || !file.trim()) throw new Error();
                const input = readRegularFile(path.resolve(path.dirname(manifest!), file), Math.min(LOCAL_IMPORT_LIMITS.sourceBytes, LOCAL_IMPORT_LIMITS.totalBytes - bytes));
                bytes += input.bytes.byteLength;
                return { ...source, xml: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input.bytes) };
            });
            store = new LargeHoldingStore(options.db);
            console.log(JSON.stringify(store.append(observations, sources), null, options.pretty ? 2 : undefined));
        } catch { console.error("大量保有Storeの保存先・観測・原本宣言・hashを確認してください（入力内容は非表示）"); process.exitCode = 1; }
        finally { store?.close(); }
    });

program.command("search-large-holding-store")
    .description("原XMLを再読込せず、保存済み大量保有を訂正選択付きで検索します")
    .requiredOption("--db <path>", "大量保有専用SQLite")
    .requiredOption("--cutoff <datetime>", "timezone付きの観測cutoff")
    .requiredOption("--duty-date <date>", "報告義務発生日")
    .requiredOption("--scope <scope>", "reportまたはholder")
    .requiredOption("--metric <metric>", "大量保有指標ID")
    .option("--holder-contains <text>", "原表名義に含まれる文字列")
    .option("--issuer-edinet-code <code>", "発行者EDINETコード")
    .option("--condition <json>", "operator/valueの条件")
    .option("--sort <order>", "value-ascまたはvalue-desc")
    .option("--offset <number>", "開始位置", "0")
    .option("--limit <number>", "最大件数", "100")
    .option("--pretty", "JSONを整形")
    .action(options => {
        let store: LargeHoldingStore | undefined;
        try {
            for (const value of [options.offset, options.limit]) if (!/^\d+$/.test(value)) throw new Error();
            store = new LargeHoldingStore(options.db, { readOnly: true });
            const result = store.search({ cutoff: options.cutoff, dutyDate: options.dutyDate, scope: options.scope, metric: options.metric, holderContains: options.holderContains, issuerEdinetCode: options.issuerEdinetCode, condition: options.condition === undefined ? undefined : JSON.parse(options.condition), sort: options.sort, offset: Number(options.offset), limit: Number(options.limit) });
            console.log(JSON.stringify(result, null, options.pretty ? 2 : undefined));
        } catch { console.error("大量保有Store・cutoff・訂正選択・検索条件を確認してください（入力内容は非表示）"); process.exitCode = 1; }
        finally { store?.close(); }
    });

program.command("screen-large-holdings")
    .description("一次大量保有を観測cutoff・義務発生日・報告全体/保有者別に検索します")
    .requiredOption("--manifest <path>", "file/metadataのJSON配列")
    .option("--observations <path>", "一覧観測JSON配列。指定時のmanifestはfile/docID/availableAt/sourceSha256/coverContextRef")
    .requiredOption("--cutoff <datetime>", "timezone付きの観測cutoff")
    .requiredOption("--duty-date <date>", "報告義務発生日")
    .requiredOption("--scope <scope>", "reportまたはholder")
    .requiredOption("--metric <metric>", "heldEquivalents/potentialEquivalents/outstandingEquivalents/holdingPercent/previousHoldingPercent")
    .option("--holder-contains <text>", "原表名義に含まれる文字列（保有者別検索）")
    .option("--issuer-edinet-code <code>", "一覧が宣言する発行者EDINETコード")
    .option("--condition <json>", "operator/valueの条件（株・口換算単位または百分率）")
    .option("--sort <order>", "value-ascまたはvalue-desc")
    .option("--offset <number>", "開始位置", "0")
    .option("--limit <number>", "最大件数", "100")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const manifest = path.resolve(options.manifest), entries = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readRegularFile(manifest, LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            if (!Array.isArray(entries) || entries.length > LOCAL_IMPORT_LIMITS.entries) throw new Error();
            for (const value of [options.offset, options.limit]) if (!/^\d+$/.test(value)) throw new Error();
            const query = { cutoff: options.cutoff, dutyDate: options.dutyDate, scope: options.scope, metric: options.metric,
                holderContains: options.holderContains, issuerEdinetCode: options.issuerEdinetCode, condition: options.condition === undefined ? undefined : JSON.parse(options.condition), sort: options.sort, offset: Number(options.offset), limit: Number(options.limit) };
            let bytes = 0;
            if (options.observations !== undefined) {
                const observations = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readRegularFile(path.resolve(options.observations), LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
                const sources = entries.map(entry => {
                    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(k => !["file", "docID", "availableAt", "sourceSha256", "coverContextRef"].includes(k)) || typeof entry.file !== "string" || !entry.file.trim()) throw new Error();
                    const { file, ...source } = entry; return source;
                });
                const preview = searchObservedLargeHoldingReports(observations, sources, query);
                const selected = new Set(preview.selection.selected.map(s => s.observation.document.docID));
                const loaded = sources.map((source, i) => {
                    if (!selected.has(source.docID) || Date.parse(source.availableAt) > Date.parse(options.cutoff)) return source;
                    try {
                        const input = readRegularFile(path.resolve(path.dirname(manifest), entries[i].file), Math.min(LOCAL_IMPORT_LIMITS.sourceBytes, LOCAL_IMPORT_LIMITS.totalBytes - bytes));
                        bytes += input.bytes.byteLength;
                        return { ...source, xml: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input.bytes) };
                    } catch { return source; }
                });
                console.log(JSON.stringify(searchObservedLargeHoldingReports(observations, loaded, query), null, options.pretty ? 2 : undefined)); return;
            }
            const documents = entries.map(entry => {
                if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(k => !["file", "metadata"].includes(k)) || typeof entry.file !== "string" || !entry.file.trim()) throw new Error();
                const input = readRegularFile(path.resolve(path.dirname(manifest), entry.file), Math.min(LOCAL_IMPORT_LIMITS.sourceBytes, LOCAL_IMPORT_LIMITS.totalBytes - bytes)); bytes += input.bytes.byteLength;
                return { xml: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input.bytes), metadata: entry.metadata };
            });
            console.log(JSON.stringify(searchLargeHoldingReports(documents, query), null, options.pretty ? 2 : undefined));
        } catch { console.error("一次大量保有の原本・一覧メタデータ・cutoff・訂正選択・検索条件を確認してください（入力内容は非表示）"); process.exitCode = 1; }
    });

program.command("plan-financial-index-build")
    .description("母集団・原本指紋・cutoff・版を固定して再開可能な構築計画を保存します")
    .requiredOption("--state <path>", "専用の構築状態DB")
    .requiredOption("--archive <path>", "固定する停止済み原本アーカイブ")
    .requiredOption("--population <path>", "asOf/observedAt/source/sourceSha256/edinetCodesのJSON")
    .requiredOption("--id <id>", "構築ID")
    .requiredOption("--generation <id>", "集約後の検索世代ID")
    .requiredOption("--cutoff <datetime>", "timezone付きcutoff")
    .requiredOption("--extractor-version <version>", "固定する抽出版")
    .option("--source-commit <sha>", "40桁source commit")
    .option("--detail-metrics <csv>", "明示duration明細項目")
    .option("--pretty", "JSONを整形")
    .action(options => {
        let source:ObservedFinancialArchive|undefined,state:FinancialIndexBuild|undefined;
        try {
            const population=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(readRegularFile(path.resolve(options.population),LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            const query={cutoff:options.cutoff,extractorVersion:options.extractorVersion,sourceCommit:options.sourceCommit,detailMetricIds:options.detailMetrics===undefined?undefined:options.detailMetrics.split(",").map((s:string)=>s.trim())};
            normalizeFinancialIndexBuildInput({id:options.id,generation:options.generation,archiveSha256:"0".repeat(64),population,options:query});
            source=new ObservedFinancialArchive(path.resolve(options.archive),{readOnly:true});
            state=new FinancialIndexBuild(path.resolve(options.state));
            console.log(JSON.stringify(state.begin({id:options.id,generation:options.generation,archiveSha256:source.snapshotSha256(),population,options:query}),null,options.pretty?2:undefined));
        } catch { console.error("世代構築の母集団・固定原本・cutoff・抽出版・専用状態DBを確認してください（入力内容は非表示）"); process.exitCode=1; }
        finally { state?.close();source?.close(); }
    });

program.command("run-financial-index-build")
    .description("未処理会社を先に処理し、失敗分を再試行してcheckpointから再開します")
    .requiredOption("--state <path>", "構築状態DB")
    .requiredOption("--archive <path>", "計画時と同じ原本アーカイブ")
    .requiredOption("--db <path>", "会社別世代を保存する財務索引")
    .requiredOption("--id <id>", "構築ID")
    .option("--limit <number>", "一回の会社数（1〜100）", "20")
    .option("--pretty", "JSONを整形")
    .action(options => {
        let source:ObservedFinancialArchive|undefined,state:FinancialIndexBuild|undefined,index:FinancialSearchIndex|undefined;
        try {
            if (!isFinancialIndexGenerationId(options.id)||!/^\d+$/.test(options.limit)||Number(options.limit)<1||Number(options.limit)>100) throw new Error();
            state=new FinancialIndexBuild(path.resolve(options.state));const p=state.progress(options.id);
            source=new ObservedFinancialArchive(path.resolve(options.archive),{readOnly:true});if (source.snapshotSha256()!==p.plan.archiveSha256) throw new Error();
            index=new FinancialSearchIndex(path.resolve(options.db));
            const progress=state.runNext(options.id,source,index,{limit:Number(options.limit)});
            console.log(JSON.stringify(progress,null,options.pretty?2:undefined));if(progress.failed)process.exitCode=1;
        } catch { console.error("構築checkpoint・固定原本・財務索引・処理件数を確認してください（入力内容は非表示）"); process.exitCode=1; }
        finally {index?.close();source?.close();state?.close();}
    });

program.command("finish-financial-index-build")
    .description("全母集団の完了会社世代だけを一つの検索世代へ集約します")
    .requiredOption("--state <path>", "構築状態DB")
    .requiredOption("--db <path>", "会社別世代を保持する財務索引")
    .requiredOption("--id <id>", "構築ID")
    .option("--pretty", "JSONを整形")
    .action(options => {
        let state:FinancialIndexBuild|undefined,index:FinancialSearchIndex|undefined;
        try {state=new FinancialIndexBuild(path.resolve(options.state));state.progress(options.id);index=new FinancialSearchIndex(path.resolve(options.db));console.log(JSON.stringify(state.finish(options.id,index),null,options.pretty?2:undefined));}
        catch {console.error("全会社の完了checkpointと会社別世代を確認してください（入力内容は非表示）");process.exitCode=1;}
        finally {index?.close();state?.close();}
    });

program.command("financial-index-build-progress")
    .description("構築状態を私有コピーから読み、未処理・失敗・完了と対象母集団を返します")
    .requiredOption("--state <path>", "構築状態DB")
    .requiredOption("--id <id>", "構築ID")
    .option("--pretty", "JSONを整形")
    .action(options => {
        let state:FinancialIndexBuild|undefined;
        try {state=new FinancialIndexBuild(path.resolve(options.state),{readOnly:true});console.log(JSON.stringify(state.progress(options.id),null,options.pretty?2:undefined));}
        catch {console.error("構築状態DBと構築IDを確認してください（入力内容は非表示）");process.exitCode=1;}
        finally {state?.close();}
    });

program.command("index-financial-snapshots")
    .description("原本アーカイブを読取り、専用DBに財務検索の固定世代を保存します")
    .requiredOption("--archive <path>", "停止した原本アーカイブ")
    .requiredOption("--db <path>", "新規または同形式の財務検索索引")
    .requiredOption("--generation <id>", "同内容だけ再実行できる固定世代ID")
    .requiredOption("--cutoff <datetime>", "timezone付きの観測cutoff")
    .requiredOption("--extractor-version <version>", "固定した抽出版")
    .option("--source-commit <sha>", "40桁source commit")
    .option("--edinet-codes <csv>", "対象会社（関連する訂正も検査）")
    .option("--detail-metrics <csv>", "保存するduration明細項目")
    .option("--pretty", "JSONを整形")
    .action(options => {
        let archive:ObservedFinancialArchive|undefined,index:FinancialSearchIndex|undefined;
        try {
            if (!isFinancialIndexGenerationId(options.generation)) throw new Error();
            const query=normalizeArchivedFinancialSnapshotOptions({cutoff:options.cutoff,extractorVersion:options.extractorVersion,sourceCommit:options.sourceCommit,edinetCodes:options.edinetCodes===undefined?undefined:options.edinetCodes.split(",").map((s:string)=>s.trim()),detailMetricIds:options.detailMetrics===undefined?undefined:options.detailMetrics.split(",").map((s:string)=>s.trim())});
            archive=new ObservedFinancialArchive(path.resolve(options.archive),{readOnly:true});
            index=new FinancialSearchIndex(path.resolve(options.db));
            console.log(JSON.stringify(index.materialize(options.generation,archive,query),null,options.pretty?2:undefined));
        } catch { console.error("財務索引の専用DB・原本アーカイブ・固定世代・抽出条件を確認してください（入力内容は非表示）"); process.exitCode=1; }
        finally { index?.close(); archive?.close(); }
    });

program.command("screen-financial-index")
    .description("固定世代の直接財務値をSQLで条件検索・並べ替え・ページ指定します")
    .requiredOption("--db <path>", "停止した財務検索索引")
    .requiredOption("--cohort <path>", "generation/group/基準/scope/JPY/period/periodTypeのJSON")
    .requiredOption("--metrics <csv>", "保存済み項目の明示subset")
    .option("--conditions <json>", "metric/operator/valueの配列", "[]")
    .option("--sort-by <metric>", "並べ替える明示項目")
    .option("--order <order>", "ascまたはdesc")
    .option("--offset <number>", "開始位置", "0")
    .option("--limit <number>", "最大件数")
    .option("--company-master <path>", "企業マスター完全観測の配列JSON（64MiB以下）")
    .option("--company-query <path>", "asOf/業種等の属性条件JSON。knownAtは財務世代へ固定")
    .option("--pretty", "JSONを整形")
    .action(options => {
        let index:FinancialSearchIndex|undefined;
        try {
            for (const value of [options.offset,options.limit]) if (value!==undefined&&!/^\d+$/.test(value)) throw new Error();
            const cohort=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(readRegularFile(path.resolve(options.cohort),LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            const query={metricIds:options.metrics.split(",").map((s:string)=>s.trim()),conditions:JSON.parse(options.conditions),sortBy:options.sortBy,order:options.order,offset:Number(options.offset),limit:options.limit===undefined?undefined:Number(options.limit)};
            normalizeFinancialIndexSearch(cohort,query);
            if((options.companyMaster===undefined)!==(options.companyQuery===undefined))throw new Error();
            if(options.companyMaster!==undefined){
                const readJSON=(file:string,limit:number)=>JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(readRegularFile(path.resolve(file),limit).bytes));
                const snapshots=readJSON(options.companyMaster,64*1024*1024),company=readJSON(options.companyQuery,LOCAL_IMPORT_LIMITS.manifestBytes);
                console.log(JSON.stringify(screenCompanyFinancials(path.resolve(options.db),snapshots,{cohort,company,search:query}),null,options.pretty?2:undefined));
            }else{
                index=new FinancialSearchIndex(path.resolve(options.db),{readOnly:true});
                console.log(JSON.stringify(index.screen(cohort,query),null,options.pretty?2:undefined));
            }
        } catch { console.error("財務索引・比較集合・保存項目・数値条件・企業マスターの観測/業種を確認してください（入力内容は非表示）"); process.exitCode=1; }
        finally { index?.close(); }
    });

program.command("compare-financial-industries")
    .description("同一財務集合の業種別件数・平均・中央値を共通採用企業で比較します")
    .requiredOption("--db <path>", "停止した財務検索索引")
    .requiredOption("--cohort <path>", "同一世代・基準・scope・期間のJSON")
    .requiredOption("--metrics <csv>", "共通採用を必要とする保存済み指標")
    .requiredOption("--company-master <path>", "完全マスター観測の配列JSON（64MiB以下）")
    .requiredOption("--company-query <path>", "企業条件JSON。knownAtは財務世代へ固定")
    .option("--pretty", "JSONを整形")
    .action(options=>{
        try{
            const read=(file:string,max:number)=>JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(readRegularFile(path.resolve(file),max).bytes));
            const result=compareCompanyFinancialsByIndustry(path.resolve(options.db),read(options.companyMaster,64*1024*1024),{
                cohort:read(options.cohort,LOCAL_IMPORT_LIMITS.manifestBytes),company:read(options.companyQuery,LOCAL_IMPORT_LIMITS.manifestBytes),metricIds:options.metrics.split(",").map((m:string)=>m.trim())});
            console.log(JSON.stringify(result,null,options.pretty?2:undefined));
        }catch{console.error("同一財務集合・保存指標・企業マスターの観測条件を確認してください（入力内容は非表示）");process.exitCode=1;}
    });

program.command("import-corporate-registry-file")
    .description("固定SHAの法人番号UTF-8 XMLを一記録ずつ専用DBへ原子的に保存します")
    .requiredOption("--db <path>", "法人番号専用DB")
    .requiredOption("--manifest <path>", "file/source/part/sha256のJSON。fileはmanifest基準")
    .option("--pretty", "JSONを整形")
    .action(async options=>{
        let store:CorporateRegistryStore|undefined;const controller=new AbortController(),stop=()=>controller.abort();
        process.once("SIGINT",stop);process.once("SIGTERM",stop);
        try{
            const manifestPath=path.resolve(options.manifest),input=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(readRegularFile(manifestPath,LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            if(!input||typeof input!=="object"||Array.isArray(input)||typeof input.file!=="string")throw Error();
            store=new CorporateRegistryStore(path.resolve(options.db));
            console.log(JSON.stringify(await store.importFile({...input,file:path.resolve(path.dirname(manifestPath),input.file)},{signal:controller.signal}),null,options.pretty?2:undefined));
        }catch{console.error("法人番号取込の原XML・期待SHA・part・出典と保存DBを確認してください（入力内容は非表示）");process.exitCode=1;}
        finally{process.removeListener("SIGINT",stop);process.removeListener("SIGTERM",stop);store?.close();}
    });

program.command("query-corporate-registry-store")
    .description("保存した法人番号原記録を観測cutoff・目的付きで読取専用検索します")
    .requiredOption("--db <path>", "停止した法人番号専用DB")
    .requiredOption("--query <path>", "corporateNumber/knownAt/registryPurposeと任意offset/limitのJSON")
    .option("--pretty", "JSONを整形")
    .action(options=>{
        let store:CorporateRegistryStore|undefined;
        try{const query=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(readRegularFile(path.resolve(options.query),LOCAL_IMPORT_LIMITS.manifestBytes).bytes));store=new CorporateRegistryStore(path.resolve(options.db),{readOnly:true});console.log(JSON.stringify(store.query(query),null,options.pretty?2:undefined));}
        catch{console.error("法人番号保存DB・番号・観測cutoff・目的・ページを確認してください（入力内容は非表示）");process.exitCode=1;}
        finally{store?.close();}
    });

function readRegistryCalendar(inputPath:string|undefined) {
    if(inputPath===undefined)return undefined;
    const file=path.resolve(inputPath),input=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(readRegularFile(file,LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
    if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).some(k=>!["policy","holidays"].includes(k)))throw Error();
    const load=(key:"policy"|"holidays",encoding:string)=>{
        const source=input[key];if(!source||typeof source!=="object"||Array.isArray(source)||Object.keys(source).some(k=>!["file","sourceUrl","observedAt"].includes(k))||typeof source.file!=="string"||!source.file.trim())throw Error();
        return {text:new TextDecoder(encoding,{fatal:true,ignoreBOM:true}).decode(readRegularFile(path.resolve(path.dirname(file),source.file),1024*1024).bytes),sourceUrl:source.sourceUrl,observedAt:source.observedAt};
    };
    const policy=load("policy","utf-8"),holidays=load("holidays","shift_jis");
    return {policy:{html:policy.text,sourceUrl:policy.sourceUrl,observedAt:policy.observedAt},holidays:{csv:holidays.text,sourceUrl:holidays.sourceUrl,observedAt:holidays.observedAt}};
}

program.command("plan-corporate-registry-differences")
    .description("保存した公式カレンダーで取得予定日と未作成日を分けます（通信なし）")
    .requiredOption("--calendar <path>", "保存した方針HTML・祝日CSVのmanifest")
    .requiredOption("--query <path>", "from/through/knownAtのJSON。最大100日")
    .option("--pretty", "JSONを整形")
    .action(options=>{
        try{
            const query=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(readRegularFile(path.resolve(options.query),LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            console.log(JSON.stringify(planCorporateRegistryDifferences(readRegistryCalendar(options.calendar)!,query),null,options.pretty?2:undefined));
        }catch{console.error("取得期間・観測cutoff・保存カレンダーの範囲と出典を確認してください（入力内容は非表示）");process.exitCode=1;}
    });

program.command("reconstruct-corporate-registry-store")
    .description("検査した保存DBの全分割から、原本来歴を保持して法人番号状態を再構成します")
    .requiredOption("--db <path>", "停止した法人番号専用DB")
    .requiredOption("--manifest <path>", "scope/expectedParts/fileIdsを持つ全国配布の配列JSON")
    .requiredOption("--query <path>", "corporateNumber/asOf/knownAt/registryPurposeのJSON")
    .option("--calendar <path>", "保存した未作成日カレンダーのJSON")
    .option("--pretty", "JSONを整形")
    .action(options=>{
        let store:CorporateRegistryStore|undefined;
        try{
            const read=(file:string)=>JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(readRegularFile(path.resolve(file),LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            const manifest=read(options.manifest),query=read(options.query),calendar=readRegistryCalendar(options.calendar);
            store=new CorporateRegistryStore(path.resolve(options.db),{readOnly:true});console.log(JSON.stringify(store.reconstruct(manifest,query,calendar),null,options.pretty?2:undefined));
        }catch{console.error("法人番号保存DB・全国配布の全file ID・対象日/cutoff・カレンダーを確認してください（入力内容は非表示）");process.exitCode=1;}
        finally{store?.close();}
    });

program.command("reconstruct-corporate-registry")
    .description("全国全件と連続する日次差分から法人番号の状態を再構成します")
    .requiredOption("--manifest <path>", "scope/expectedParts/parts(file/source)を持つ配布単位の配列JSON")
    .requiredOption("--query <path>", "corporateNumber/asOf/knownAt/registryPurposeのJSON")
    .option("--calendar <path>", "保存した国税庁方針HTML・内閣府祝日CSVのfile/sourceUrl/observedAt JSON")
    .option("--pretty", "JSONを整形")
    .action(options=>{
        try{
            const read=(file:string)=>JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(readRegularFile(file,LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            const manifestPath=path.resolve(options.manifest),entries=read(manifestPath),query=read(path.resolve(options.query));
            if(!Array.isArray(entries)||entries.length>100)throw Error();let bytes=0,files=0;
            const deliveries=entries.map(entry=>{
                if(!entry||typeof entry!=="object"||Array.isArray(entry)||Object.keys(entry).some(k=>!["scope","expectedParts","parts"].includes(k))||entry.scope!=="national"||!Number.isSafeInteger(entry.expectedParts)||entry.expectedParts<1||!Array.isArray(entry.parts)||entry.parts.length!==entry.expectedParts||(files+=entry.parts.length)>100)throw Error();
                return {...entry,parts:entry.parts.map((part:any)=>{
                    if(!part||typeof part!=="object"||Array.isArray(part)||Object.keys(part).some(k=>!["file","source"].includes(k))||typeof part.file!=="string"||!part.file.trim())throw Error();
                    const input=readRegularFile(path.resolve(path.dirname(manifestPath),part.file),Math.min(LOCAL_IMPORT_LIMITS.sourceBytes,LOCAL_IMPORT_LIMITS.totalBytes-bytes));bytes+=input.bytes.byteLength;
                    return {xml:new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(input.bytes),source:part.source};
                })};
            });
            const calendar=readRegistryCalendar(options.calendar);
            console.log(JSON.stringify(reconstructCorporateRegistryState(deliveries,query,calendar),null,options.pretty?2:undefined));
        }catch{console.error("法人番号・日付/cutoff・全国全件と差分の全分割・XML出典・未作成日カレンダーを確認してください（入力内容は非表示）");process.exitCode=1;}
    });

program.command("screen-published-financial-index")
    .description("公開候補を検査して固定し、公開世代付きの検索結果を返します")
    .requiredOption("--catalog <file>", "公開catalog")
    .requiredOption("--db <file>", "公開世代を含む財務検索索引")
    .requiredOption("--cohort <file>", "generationを含まない比較条件JSON")
    .requiredOption("--query <file>", "指標・条件・順序・ページのJSON")
    .option("--pretty", "JSONを整形")
    .action(options=>{
        let reader:PublishedFinancialIndex|undefined;
        try{const read=(file:string)=>JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(readRegularFile(path.resolve(file),LOCAL_IMPORT_LIMITS.manifestBytes).bytes));const cohort=read(options.cohort),query=read(options.query);reader=new PublishedFinancialIndex(options.catalog,options.db);console.log(JSON.stringify(reader.screen(cohort,query),null,options.pretty?2:undefined));}
        catch{console.error("公開候補・固定索引・比較条件・検索条件を確認してください（入力内容は非表示）");process.exitCode=1;}
        finally{reader?.close();}
    });

program.command("prepare-financial-index-publication")
    .description("全社財務世代の品質と公開条件を固定して候補を保存します（切替は別コマンド）")
    .requiredOption("--catalog <file>", "専用公開catalog")
    .requiredOption("--db <file>", "停止した財務索引")
    .requiredOption("--generation <id>", "固定世代ID")
    .requiredOption("--id <id>", "公開候補ID")
    .option("--policy <file>", "公開条件JSON。省略時は全社利用可/不在・保留・重複0")
    .option("--pretty", "JSONを整形")
    .action(options=>{
        let catalog:FinancialIndexPublication|undefined,index:FinancialSearchIndex|undefined;
        try{const policy=options.policy===undefined?undefined:JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(readRegularFile(path.resolve(options.policy),LOCAL_IMPORT_LIMITS.manifestBytes).bytes));index=new FinancialSearchIndex(path.resolve(options.db),{readOnly:true});catalog=new FinancialIndexPublication(path.resolve(options.catalog));console.log(JSON.stringify(catalog.prepare(options.id,index,options.generation,policy),null,options.pretty?2:undefined));}
        catch{console.error("公開候補・固定世代・公開条件を確認してください（入力内容は非表示）");process.exitCode=1;}
        finally{index?.close();catalog?.close();}
    });
program.command("activate-financial-index-publication")
    .description("候補の品質を再検査して明示切替します。旧候補への復帰も同じ入口です")
    .requiredOption("--catalog <file>", "専用公開catalog")
    .requiredOption("--db <file>", "候補を保存した停止中の財務索引")
    .requiredOption("--id <id>", "切替先の公開候補ID")
    .option("--expected-active <id>", "確認済みの直前公開候補ID")
    .option("--expect-none", "初回公開で現公開候補がないことを要求")
    .option("--pretty", "JSONを整形")
    .action(options=>{
        let catalog:FinancialIndexPublication|undefined,index:FinancialSearchIndex|undefined;
        try{if((options.expectedActive!==undefined)===!!options.expectNone)throw new Error();index=new FinancialSearchIndex(path.resolve(options.db),{readOnly:true});catalog=new FinancialIndexPublication(path.resolve(options.catalog));console.log(JSON.stringify(catalog.activate(options.id,index,{expectedActive:options.expectNone?null:options.expectedActive}),null,options.pretty?2:undefined));}
        catch{console.error("公開条件・固定世代・確認済みの直前公開候補を確認してください（入力内容は非表示）");process.exitCode=1;}
        finally{index?.close();catalog?.close();}
    });
program.command("financial-index-publication-status")
    .description("公開候補と切替履歴をreadOnlyで確認します。db指定時は実索引も再検査します")
    .requiredOption("--catalog <file>", "停止した専用公開catalog")
    .option("--db <file>", "公開候補を含む停止した財務索引")
    .option("--pretty", "JSONを整形")
    .action(options=>{
        let catalog:FinancialIndexPublication|undefined,index:FinancialSearchIndex|undefined;
        try{catalog=new FinancialIndexPublication(path.resolve(options.catalog),{readOnly:true});if(options.db!==undefined)index=new FinancialSearchIndex(path.resolve(options.db),{readOnly:true});const active=index?catalog.resolve(index):catalog.current();console.log(JSON.stringify({active:active??null,indexVerified:!!index&&active!==undefined,history:catalog.history()},null,options.pretty?2:undefined));}
        catch{console.error("公開catalog・履歴・固定索引の整合を確認してください（入力内容は非表示）");process.exitCode=1;}
        finally{index?.close();catalog?.close();}
    });

program.command("financial-index-quality")
    .description("固定財務世代の全本文/値索引を検査し、母集団・書類・値の充足を集計します")
    .requiredOption("--db <file>", "停止した財務検索索引")
    .requiredOption("--generation <id>", "品質検査する世代")
    .option("--pretty", "JSONを整形")
    .action(options=>{
        let index:FinancialSearchIndex|undefined;
        try{index=new FinancialSearchIndex(path.resolve(options.db),{readOnly:true});console.log(JSON.stringify(index.quality(options.generation),null,options.pretty?2:undefined));}
        catch{console.error("固定世代・財務本文・値索引の整合を確認してください（入力内容は非表示）");process.exitCode=1;}
        finally{index?.close();}
    });

program.command("backfill-financial-document-lists")
    .description("閉じた日を再利用し、空の日を含む原観測を日別に取得・保存します")
    .requiredOption("--metadata <file>", "書込可能な一覧メタデータDB")
    .requiredOption("--start-date <date>", "開始日")
    .requiredOption("--end-date <date>", "終了日")
    .option("--max-days <number>", "一回の最大取得日数（1〜100）", "20")
    .option("--after-date <date>", "巡回を続ける日付cursor。失敗の再試行は省略")
    .option("--refresh-after <timestamp>", "この時刻以降の再観測を要求。同じ時刻で途中再開")
    .option("--timeout-ms <number>", "本文受信までの通信timeout", "60000")
    .option("--pretty", "JSONを整形")
    .action(async options=>{
        let repository:EdinetRepository|undefined;const controller=new AbortController(),stop=()=>controller.abort();
        try{
            if(![options.maxDays,options.timeoutMs].every(v=>/^\d+$/.test(v))||Number(options.maxDays)<1||Number(options.maxDays)>100||!Number.isSafeInteger(Number(options.timeoutMs))||Number(options.timeoutMs)<1||Number(options.timeoutMs)>2147483647)throw new Error();
            repository=new EdinetRepository(path.resolve(options.metadata));
            const downloader=new EdinetXbrlDownloader({requestTimeoutMs:Number(options.timeoutMs)});process.once("SIGINT",stop);
            const result=await backfillFinancialDocumentLists(repository,(date,request)=>downloader.search(date,undefined,request),{startDate:options.startDate,endDate:options.endDate,maxDays:Number(options.maxDays),afterDate:options.afterDate,refreshAfter:options.refreshAfter,signal:controller.signal});
            console.log(JSON.stringify(result,null,options.pretty?2:undefined));if(result.aborted||result.days.some(d=>d.status==='failed'))process.exitCode=1;
        }catch{console.error("一覧DB・日付範囲・取得条件を確認してください（入力内容は非表示）");process.exitCode=1;}
        finally{process.removeListener("SIGINT",stop);repository?.close();}
    });
program.command("archive-financial-document-observations")
    .description("保存一覧の原観測を安定した取得元IDで財務アーカイブへ転送します")
    .requiredOption("--metadata <file>", "readOnlyで読む一覧メタデータDB")
    .requiredOption("--archive <file>", "書込可能な財務アーカイブ")
    .requiredOption("--source-id <id>", "取得元を識別する固定ID（英数字/_.-、64文字まで）")
    .option("--after-sequence <number>", "保存済み観測cursor", "0")
    .option("--through-sequence <number>", "同じ計画で固定する観測の末尾")
    .option("--page-size <number>", "一batchの件数（1〜1000）", "1000")
    .option("--max-pages <number>", "一回の最大batch数（1〜1000）", "20")
    .option("--pretty", "JSONを整形")
    .action(options=>{
        let repository:EdinetRepository|undefined,archive:ObservedFinancialArchive|undefined;
        try{
            if(!/^[A-Za-z0-9_.-]{1,64}$/.test(options.sourceId)||![options.afterSequence,options.pageSize,options.maxPages].every(v=>/^\d+$/.test(v))||!Number.isSafeInteger(Number(options.afterSequence))||options.throughSequence!==undefined&&(!/^\d+$/.test(options.throughSequence)||!Number.isSafeInteger(Number(options.throughSequence)))||Number(options.pageSize)<1||Number(options.pageSize)>1000||Number(options.maxPages)<1||Number(options.maxPages)>1000)throw new Error();
            repository=new EdinetRepository(path.resolve(options.metadata),{readOnly:true});
            const last=repository.getLastObservationSequence(),through=options.throughSequence===undefined?last:Number(options.throughSequence);
            if(through>last||Number(options.afterSequence)>through)throw new Error();
            archive=new ObservedFinancialArchive(path.resolve(options.archive));
            console.log(JSON.stringify(archiveFinancialDocumentObservations(repository,archive,{sourceId:options.sourceId,afterSequence:Number(options.afterSequence),throughSequence:options.throughSequence===undefined?undefined:Number(options.throughSequence),pageSize:Number(options.pageSize),maxPages:Number(options.maxPages)}),null,options.pretty?2:undefined));
        }catch{console.error("原観測DB・転送元ID・保存済みcursorを確認してください（入力内容は非表示）");process.exitCode=1;}
        finally{archive?.close();repository?.close();}
    });

program.command("recover-sqlite-snapshot")
    .description("停止した専用DBとhot journalのコピーを新規候補へ復旧します")
    .requiredOption("--source <file>", "停止したDB（同名-journalも必要）")
    .requiredOption("--output-directory <directory>", "まだ存在しない復旧候補directory")
    .requiredOption("--kind <kind>", "専用DB形式")
    .requiredOption("--database-sha256 <hash>", "停止したDBのSHA-256")
    .requiredOption("--journal-sha256 <hash>", "停止したjournalのSHA-256")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const result = recoverDedicatedSqliteSnapshot({source: options.source, outputDirectory: options.outputDirectory, kind: options.kind as DedicatedSqliteRecoveryKind, databaseSha256: options.databaseSha256, journalSha256: options.journalSha256});
            console.log(JSON.stringify(result, null, options.pretty ? 2 : undefined));
        } catch { console.error("停止した専用DB/journal・両指紋・新規復旧先を確認してください（入力内容は非表示）"); process.exitCode = 1; }
    });

program.command("transfer-financial-archive-sources")
    .description("固定原本アーカイブから全版の原本宣言/内容を別アーカイブへ転送します")
    .requiredOption("--source <file>", "停止した転送元アーカイブ")
    .requiredOption("--archive <file>", "転送先アーカイブ")
    .requiredOption("--source-sha256 <hash>", "転送元の物理SHA-256")
    .option("--after-id <id>", "前回のnextAfterId")
    .option("--available-by <timestamp>", "同じ計画で固定する原本の取得時点")
    .option("--limit <number>", "一回の最大原本観測数（1〜100）", "20")
    .option("--pretty", "JSONを整形")
    .action(options => {
        let source: ObservedFinancialArchive | undefined, target: ObservedFinancialArchive | undefined;
        try {
            if (!/^\d+$/.test(options.limit) || Number(options.limit) < 1 || Number(options.limit) > 100 || !/^[a-f0-9]{64}$/.test(options.sourceSha256) || options.afterId !== undefined && !/^[a-f0-9]{64}$/.test(options.afterId) || options.availableBy !== undefined && parseDocumentTimestamp(options.availableBy, true) === undefined || path.resolve(options.source) === path.resolve(options.archive)) throw new Error();
            source = new ObservedFinancialArchive(path.resolve(options.source), { readOnly: true });
            if (source.snapshotSha256() !== options.sourceSha256) throw new Error();
            target = new ObservedFinancialArchive(path.resolve(options.archive));
            console.log(JSON.stringify(source.transferSourcesTo(target, { sourceArchiveSha256: options.sourceSha256, afterId: options.afterId, availableBy: options.availableBy, limit: Number(options.limit) }), null, options.pretty ? 2 : undefined));
        } catch { console.error("固定原本指紋・転送cursor・異なる転送先を確認してください（入力内容は非表示）"); process.exitCode = 1; }
        finally { target?.close(); source?.close(); }
    });

program.command("plan-financial-source-job")
    .description("固定母集団・一覧観測から全社の原本取得jobを計画します")
    .requiredOption("--state <file>", "専用取得状態DB")
    .requiredOption("--archive <file>", "停止した原本アーカイブ")
    .requiredOption("--population <file>", "母集団JSON")
    .requiredOption("--id <id>", "取得job ID")
    .requiredOption("--cutoff <timestamp>", "書類選択の観測時点")
    .option("--pretty", "JSONを整形")
    .action(options=>{
        let state:FinancialSourceJob|undefined,archive:ObservedFinancialArchive|undefined;
        try {
            const population=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(readRegularFile(path.resolve(options.population),LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            const input=normalizeFinancialSourceJobInput({id:options.id,cutoff:options.cutoff,population});
            archive=new ObservedFinancialArchive(path.resolve(options.archive),{readOnly:true});state=new FinancialSourceJob(path.resolve(options.state));
            console.log(JSON.stringify(state.begin(input,archive),null,options.pretty?2:undefined));
        }catch{console.error("取得計画・固定母集団・原本アーカイブを確認してください（入力内容は非表示）");process.exitCode=1;}
        finally{archive?.close();state?.close();}
    });
program.command("run-financial-source-job")
    .description("未処理を先に取得し、失敗/中断履歴を保存して再開します")
    .requiredOption("--state <file>", "専用取得状態DB")
    .requiredOption("--archive <file>", "書込可能な原本アーカイブ")
    .requiredOption("--id <id>", "取得job ID")
    .option("--cache <directory>", "既存XBRL cache", "downloads")
    .option("--limit <number>", "一回の最大取得数（1〜100）", "20")
    .option("--timeout-ms <number>", "本文受信までの通信timeout", "60000")
    .option("--pretty", "JSONを整形")
    .action(async options=>{
        let state:FinancialSourceJob|undefined,archive:ObservedFinancialArchive|undefined;
        const controller=new AbortController(),stop=()=>controller.abort();
        try {
            if(![options.limit,options.timeoutMs].every(v=>/^\d+$/.test(v))||Number(options.limit)<1||Number(options.limit)>100||!Number.isSafeInteger(Number(options.timeoutMs))||Number(options.timeoutMs)<1||Number(options.timeoutMs)>2147483647)throw new Error();
            state=new FinancialSourceJob(path.resolve(options.state));state.progress(options.id);
            archive=new ObservedFinancialArchive(path.resolve(options.archive));
            const downloader=new EdinetXbrlDownloader({rootDir:path.resolve(options.cache),requestTimeoutMs:Number(options.timeoutMs)});
            process.once("SIGINT",stop);
            const result=await state.runNext(options.id,archive,(id,request)=>downloader.fetchXbrl(id,request),{limit:Number(options.limit),signal:controller.signal});
            console.log(JSON.stringify(result,null,options.pretty?2:undefined));
            if(result.failed||result.running||result.aborted)process.exitCode=1;
        }catch{console.error("取得checkpoint・固定一覧・原本取得条件を確認してください（入力内容は非表示）");process.exitCode=1;}
        finally{process.removeListener("SIGINT",stop);archive?.close();state?.close();}
    });
program.command("financial-source-job-progress")
    .description("取得計画・試行履歴・残件をreadOnlyで確認します")
    .requiredOption("--state <file>", "停止した専用取得状態DB")
    .requiredOption("--id <id>", "取得job ID")
    .option("--pretty", "JSONを整形")
    .action(options=>{
        let state:FinancialSourceJob|undefined;
        try{state=new FinancialSourceJob(path.resolve(options.state),{readOnly:true});console.log(JSON.stringify(state.progress(options.id),null,options.pretty?2:undefined));}
        catch{console.error("取得状態・job IDを確認してください（入力内容は非表示）");process.exitCode=1;}
        finally{state?.close();}
    });
program.command("audit-financial-source-job")
    .description("未完了を含む停止checkpointと原本を固定指紋からreadOnlyで照合します")
    .requiredOption("--state <file>", "停止した専用取得状態DB（復旧候補も可）")
    .requiredOption("--archive <file>", "停止した原本アーカイブ")
    .requiredOption("--id <id>", "取得job ID")
    .requiredOption("--plan-sha256 <hash>", "期待する固定計画のSHA-256")
    .requiredOption("--archive-sha256 <hash>", "停止した原本snapshotのSHA-256")
    .option("--pretty", "JSONを整形")
    .action(options => {
        let state: FinancialSourceJob | undefined, archive: ObservedFinancialArchive | undefined;
        try {
            if (![options.planSha256, options.archiveSha256].every(v => /^[a-f0-9]{64}$/.test(v))) throw new Error();
            state = new FinancialSourceJob(path.resolve(options.state), {readOnly: true});
            archive = new ObservedFinancialArchive(path.resolve(options.archive), {readOnly: true});
            console.log(JSON.stringify(state.audit(options.id, archive, {planSha256: options.planSha256, archiveSha256: options.archiveSha256}), null, options.pretty ? 2 : undefined));
        } catch { console.error("停止checkpoint・期待計画/原本指紋・保存原本と未提供の根拠を確認してください（入力内容は非表示）"); process.exitCode = 1; }
        finally { archive?.close(); state?.close(); }
    });

program.command("finish-financial-source-job")
    .description("全原本の完了を再検査し、後続へ渡す固定原本指紋を返します")
    .requiredOption("--state <file>", "停止した専用取得状態DB")
    .requiredOption("--archive <file>", "停止した原本アーカイブ")
    .requiredOption("--id <id>", "取得job ID")
    .option("--pretty", "JSONを整形")
    .action(options=>{
        let state:FinancialSourceJob|undefined,archive:ObservedFinancialArchive|undefined;
        try{state=new FinancialSourceJob(path.resolve(options.state),{readOnly:true});archive=new ObservedFinancialArchive(path.resolve(options.archive),{readOnly:true});console.log(JSON.stringify(state.finish(options.id,archive),null,options.pretty?2:undefined));}
        catch{console.error("原本の全件完了・checkpoint・固定一覧を確認してください（入力内容は非表示）");process.exitCode=1;}
        finally{archive?.close();state?.close();}
    });

program.command("plan-financial-source-acquisition")
    .description("選択された財務書類の保存済み原本と不足原本を、取得せず調べます")
    .requiredOption("--archive <file>", "専用原本アーカイブ")
    .requiredOption("--cutoff <timestamp>", "書類選択の観測時点")
    .option("--edinet-codes <codes>", "会社集合（カンマ区切り、最大100社）")
    .option("--pretty", "JSONを整形")
    .action(options => {
        let archive:ObservedFinancialArchive|undefined;
        try {
            archive=new ObservedFinancialArchive(path.resolve(options.archive),{readOnly:true});
            const plan=archive.planSourceAcquisition({cutoff:options.cutoff,edinetCodes:options.edinetCodes?.split(",")});
            console.log(JSON.stringify(plan,null,options.pretty?2:undefined));
        } catch {console.error("原本アーカイブ・cutoff・会社集合を確認してください（入力内容は非表示）");process.exitCode=1;}
        finally {archive?.close();}
    });
program.command("acquire-financial-sources")
    .description("不足原本だけを既存cache/EDINETから取得し、一件ずつ保存して再開できます")
    .requiredOption("--archive <file>", "書込可能な専用原本アーカイブ")
    .requiredOption("--cutoff <timestamp>", "書類選択の観測時点（取得日時とは別）")
    .option("--edinet-codes <codes>", "会社集合（カンマ区切り、最大100社）")
    .option("--cache <directory>", "既存XBRL cache", "downloads")
    .option("--limit <number>", "一回の最大取得数（1〜100）", "20")
    .option("--after-doc-id <id>", "巡回を続ける書類cursor。失敗再試行時は省略")
    .option("--timeout-ms <number>", "本文受信までの通信timeout", "60000")
    .option("--pretty", "JSONを整形")
    .action(async options => {
        let archive:ObservedFinancialArchive|undefined;
        const controller=new AbortController(), stop=()=>controller.abort();
        try {
            if (![options.limit,options.timeoutMs].every(v=>/^\d+$/.test(v)) || Number(options.limit)<1 || Number(options.limit)>100 || !Number.isSafeInteger(Number(options.timeoutMs)) || Number(options.timeoutMs)<1 || Number(options.timeoutMs)>2147483647) throw new Error();
            archive=new ObservedFinancialArchive(path.resolve(options.archive));
            const downloader=new EdinetXbrlDownloader({rootDir:path.resolve(options.cache),requestTimeoutMs:Number(options.timeoutMs)});
            process.once("SIGINT",stop);
            const result=await archive.acquireSources({cutoff:options.cutoff,edinetCodes:options.edinetCodes?.split(",")},(id,request)=>downloader.fetchXbrl(id,request),{limit:Number(options.limit),afterDocID:options.afterDocId,signal:controller.signal});
            console.log(JSON.stringify(result,null,options.pretty?2:undefined));
            if (result.aborted || result.results.some(r=>r.status==="failed")) process.exitCode=1;
        } catch {console.error("原本取得・アーカイブ・取得条件を確認してください（入力内容は非表示）");process.exitCode=1;}
        finally {process.removeListener("SIGINT",stop);archive?.close();}
    });

program.command("archive-financial-snapshots")
    .description("専用SQLiteへ一覧観測・原本を追記し、版付き解析結果を再利用します")
    .requiredOption("--db <path>", "新規または同形式の専用DB")
    .requiredOption("--cutoff <datetime>", "timezone付きの観測cutoff")
    .requiredOption("--extractor-version <version>", "呼出元が固定した抽出版")
    .option("--source-commit <sha>", "抽出コードの40桁commit")
    .option("--observations <path>", "追記する一覧観測JSON配列（16MiB以下）")
    .option("--manifest <path>", "追記するdocID/availableAt/sourceSha256/file（任意）配列")
    .option("--detail-metrics <csv>", "明示するduration明細項目")
    .option("--read-only", "元DBを変更せず私有コピーから読む")
    .option("--edinet-codes <csv>", "対象会社。関連する親子訂正も同時に読む")
    .option("--pretty", "JSONを整形")
    .action(options => {
        let archive: ObservedFinancialArchive | undefined;
        try {
            if (options.readOnly && (options.observations !== undefined || options.manifest !== undefined)) throw new Error();
            const query = normalizeArchivedFinancialSnapshotOptions({cutoff:options.cutoff,extractorVersion:options.extractorVersion,sourceCommit:options.sourceCommit,edinetCodes:options.edinetCodes===undefined?undefined:options.edinetCodes.split(",").map((s:string)=>s.trim()),detailMetricIds:options.detailMetrics===undefined?undefined:options.detailMetrics.split(",").map((id:string)=>id.trim())});
            const readJson = (file:string,limit:number) => JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(readRegularFile(file,limit).bytes));
            const observations = options.observations === undefined ? [] : readJson(path.resolve(options.observations),16*1024*1024);
            let bytes = 0;
            const sources = options.manifest === undefined ? [] : (() => {
                const manifest = path.resolve(options.manifest),entries = readJson(manifest,LOCAL_IMPORT_LIMITS.manifestBytes);
                if (!Array.isArray(entries) || entries.length > 100) throw new Error();
                return entries.map(entry => {
                    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(k => !["file","docID","availableAt","sourceSha256"].includes(k)) || entry.file !== undefined && (typeof entry.file !== "string" || !entry.file.trim())) throw new Error();
                    const {file,...source} = entry;
                    if (file === undefined) return source;
                    const input = readRegularFile(path.resolve(path.dirname(manifest),file),Math.min(LOCAL_IMPORT_LIMITS.sourceBytes,LOCAL_IMPORT_LIMITS.totalBytes-bytes));
                    bytes += input.bytes.byteLength;
                    return {...source,xml:new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(input.bytes)};
                });
            })();
            // 入力とhashだけを検証し、原本解析は版付きキャッシュへ任せます。
            captureDocumentVersionObservations(observations);
            for (const s of captureObservedFinancialSources(sources)) if (s.xml !== undefined && createHash("sha256").update(s.xml).digest("hex") !== s.sourceSha256) throw new Error();
            archive = new ObservedFinancialArchive(path.resolve(options.db),{readOnly:!!options.readOnly});
            const appended = options.observations !== undefined || options.manifest !== undefined ? archive.append(observations,sources) : undefined;
            console.log(JSON.stringify({appended,...archive.createSnapshots(query)},null,options.pretty?2:undefined));
        } catch { console.error("専用財務アーカイブ・一覧観測・原本hash・cutoff・抽出版を確認してください（入力内容は非表示）"); process.exitCode = 1; }
        finally { archive?.close(); }
    });

program.command("observed-financial-snapshots")
    .description("観測済み訂正系列・原本hash・DEIを照合し、選択原本の直接snapshotを作ります")
    .requiredOption("--observations <path>", "一覧の明示観測JSON配列")
    .requiredOption("--manifest <path>", "docID/availableAt/sourceSha256/file（任意）の原本JSON配列")
    .requiredOption("--cutoff <datetime>", "timezone付きの観測cutoff")
    .option("--detail-metrics <csv>", "明示するduration明細項目")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const manifest = path.resolve(options.manifest);
            const readJson = (file: string, limit = LOCAL_IMPORT_LIMITS.manifestBytes) => JSON.parse(new TextDecoder("utf-8", {fatal:true}).decode(readRegularFile(file,limit).bytes));
            const entries = readJson(manifest), observations = readJson(path.resolve(options.observations),16*1024*1024);
            if (!Array.isArray(entries) || entries.length > 100) throw new Error();
            const sources = entries.map(entry => {
                if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(k => !["docID","availableAt","sourceSha256","file"].includes(k)) || entry.file !== undefined && (typeof entry.file !== "string" || !entry.file.trim())) throw new Error();
                const {file,...source} = entry; return source;
            });
            const query = {cutoff:options.cutoff,detailMetricIds:options.detailMetrics===undefined?undefined:options.detailMetrics.split(",").map((id:string)=>id.trim())};
            const preview = createObservedFinancialSnapshots(observations,sources,query);
            const eligible = new Set(preview.unavailableSources.filter(s => s.reason === "source-not-loaded").map(s => s.docID));
            let bytes = 0;
            const loaded = sources.map((source,i) => {
                if (!eligible.has(source.docID) || entries[i].file === undefined) return source;
                try {
                    const input = readRegularFile(path.resolve(path.dirname(manifest),entries[i].file),Math.min(LOCAL_IMPORT_LIMITS.sourceBytes,LOCAL_IMPORT_LIMITS.totalBytes-bytes));
                    bytes += input.bytes.byteLength;
                    return {...source,xml:new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(input.bytes)};
                } catch { return source; }
            });
            console.log(JSON.stringify(createObservedFinancialSnapshots(observations,loaded,query),null,options.pretty?2:undefined));
        } catch { console.error("財務原本・一覧観測・cutoff・明示項目を確認してください（入力内容は非表示）"); process.exitCode = 1; }
    });

program.command("financial-reporting-basis")
    .description("DEIと実contextから基準・当期を確定し、必要ならJPY専用snapshotを作ります")
    .requiredOption("--file <path>", "保存済みXBRL")
    .requiredOption("--doc-id <id>", "原本に対応すると呼出元が確認した書類ID")
    .option("--with-snapshots", "既存BS/財務明細snapshotへ接続")
    .option("--detail-metrics <csv>", "snapshotのduration明細項目")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            if (options.detailMetrics !== undefined && !options.withSnapshots) throw new Error();
            const input = readRegularFile(path.resolve(options.file), LOCAL_IMPORT_LIMITS.sourceBytes);
            const xml = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input.bytes);
            const result = options.withSnapshots ? createAutomaticFinancialSnapshots(xml, {docID:options.docId,detailMetricIds:options.detailMetrics===undefined?undefined:options.detailMetrics.split(",").map((id:string)=>id.trim())}) : resolveFinancialReportingBasis(xml,options.docId);
            console.log(JSON.stringify(result,null,options.pretty?2:undefined));
        } catch { console.error("財務基準判定の原本・書類ID・明示項目を確認してください（入力内容は非表示）"); process.exitCode = 1; }
    });

program.command("screen-ifrs-details")
    .description("IFRS連結JPYの直接PL/CF明細を同一期間/分類で検索します")
    .requiredOption("--manifest <path>", "file/metadataのJSON配列")
    .option("--metrics <csv>", "明示項目。省略時はPL5項目")
    .option("--conditions <json>", "metric/operator/valueのJSON配列", "[]")
    .option("--sort-by <metric>", "並べ替えの指標")
    .option("--order <order>", "asc/desc")
    .option("--offset <number>", "開始位置", "0")
    .option("--limit <number>", "最大件数", "100")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const manifest = path.resolve(options.manifest), entries = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readRegularFile(manifest, LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            if (!Array.isArray(entries) || entries.length > LOCAL_IMPORT_LIMITS.entries) throw new Error();
            let bytes = 0;
            const documents = entries.map(entry => {
                if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(k => !["file", "metadata"].includes(k)) || typeof entry.file !== "string" || !entry.file.trim()) throw new Error();
                const input = readRegularFile(path.resolve(path.dirname(manifest), entry.file), Math.min(LOCAL_IMPORT_LIMITS.sourceBytes, LOCAL_IMPORT_LIMITS.totalBytes - bytes)); bytes += input.bytes.byteLength;
                return { xml: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input.bytes), metadata: entry.metadata };
            });
            for (const value of [options.offset, options.limit]) if (!/^\d+$/.test(value)) throw new Error();
            console.log(JSON.stringify(screenIfrsFinancialDetailDocuments(documents, { metricIds:options.metrics===undefined?undefined:options.metrics.split(",").map((id:string)=>id.trim()), conditions:JSON.parse(options.conditions), sortBy:options.sortBy, order:options.order, offset:Number(options.offset), limit:Number(options.limit) }), null, options.pretty ? 2 : undefined));
        } catch { console.error("IFRS明細の原本・期間/分類・明示項目・検索条件を確認してください（入力内容は非表示）"); process.exitCode = 1; }
    });

program.command("search-officer-remuneration")
    .description("役員報酬の区分集計・個人総額・会社別内訳を分けて検索します")
    .requiredOption("--manifest <path>", "file/selection/period/tablesのJSON配列")
    .requiredOption("--kind <kind>", "category/individual")
    .requiredOption("--period-start <date>", "対象期間の開始日")
    .requiredOption("--period-end <date>", "対象期間の末日")
    .requiredOption("--role <role>", "detail/reported-total")
    .requiredOption("--metric <metric>", "total/recipientCount/component")
    .option("--component-path <json>", "内訳の原見出し階層（文字列のJSON配列）")
    .option("--label-contains <text>", "役員区分/氏名の原文に含まれる文字列")
    .option("--company-contains <text>", "個人の会社別内訳だけに使う原文部分一致")
    .option("--condition <json>", "operator/valueの条件（円/人）")
    .option("--sort <order>", "value-asc/value-desc")
    .option("--offset <number>", "開始位置", "0")
    .option("--limit <number>", "最大件数", "100")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const manifest = path.resolve(options.manifest), entries = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readRegularFile(manifest, LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            if (!Array.isArray(entries) || entries.length > LOCAL_IMPORT_LIMITS.entries) throw new Error();
            let bytes = 0;
            const documents = entries.map(entry => {
                if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(k => !["file", "selection", "period", "tables"].includes(k)) || typeof entry.file !== "string" || !entry.file.trim()) throw new Error();
                const input = readRegularFile(path.resolve(path.dirname(manifest), entry.file), Math.min(LOCAL_IMPORT_LIMITS.sourceBytes, LOCAL_IMPORT_LIMITS.totalBytes - bytes)); bytes += input.bytes.byteLength;
                return { xml: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input.bytes), selection: entry.selection, period: entry.period, tables: entry.tables };
            });
            for (const value of [options.offset, options.limit]) if (!/^\d+$/.test(value)) throw new Error();
            console.log(JSON.stringify(searchOfficerRemuneration(documents, { kind: options.kind, period: {startDate:options.periodStart,endDate:options.periodEnd}, role: options.role, metric: options.metric, componentPath:options.componentPath===undefined?undefined:JSON.parse(options.componentPath), labelContains:options.labelContains, companyContains:options.companyContains, condition: options.condition === undefined ? undefined : JSON.parse(options.condition), sort: options.sort, offset: Number(options.offset), limit: Number(options.limit) }), null, options.pretty ? 2 : undefined));
        } catch { console.error("役員報酬の原本・期間・表参照・検索条件を確認してください（入力内容は非表示）"); process.exitCode = 1; }
    });

program.command("search-officers")
    .description("現任/予定と原表合計を分けて役員名・略歴・株数を検索します")
    .requiredOption("--manifest <path>", "file/selection/tablesのJSON配列")
    .requiredOption("--status <status>", "as-filed/proposed")
    .requiredOption("--roster-date <date>", "本文記載の提出日または開催予定日")
    .requiredOption("--role <role>", "named/reported-total")
    .requiredOption("--metric <metric>", "record/reportedShares")
    .option("--name-contains <text>", "氏名原文に含まれる文字列")
    .option("--position-contains <text>", "役職原文に含まれる文字列")
    .option("--biography-contains <text>", "略歴原文に含まれる文字列")
    .option("--condition <json>", "operator/valueの条件（株）")
    .option("--sort <order>", "value-asc/value-desc（株数検索のみ）")
    .option("--offset <number>", "開始位置", "0")
    .option("--limit <number>", "最大件数", "100")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const manifest = path.resolve(options.manifest), entries = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readRegularFile(manifest, LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            if (!Array.isArray(entries) || entries.length > LOCAL_IMPORT_LIMITS.entries) throw new Error();
            let bytes = 0;
            const documents = entries.map(entry => {
                if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(k => !["file", "selection", "tables"].includes(k)) || typeof entry.file !== "string" || !entry.file.trim()) throw new Error();
                const input = readRegularFile(path.resolve(path.dirname(manifest), entry.file), Math.min(LOCAL_IMPORT_LIMITS.sourceBytes, LOCAL_IMPORT_LIMITS.totalBytes - bytes)); bytes += input.bytes.byteLength;
                return { xml: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input.bytes), selection: entry.selection, tables: entry.tables };
            });
            for (const value of [options.offset, options.limit]) if (!/^\d+$/.test(value)) throw new Error();
            console.log(JSON.stringify(searchOfficerDetails(documents, { status: options.status, rosterDate: options.rosterDate, role: options.role, metric: options.metric, nameContains: options.nameContains, positionContains: options.positionContains, biographyContains: options.biographyContains, condition: options.condition === undefined ? undefined : JSON.parse(options.condition), sort: options.sort, offset: Number(options.offset), limit: Number(options.limit) }), null, options.pretty ? 2 : undefined));
        } catch { console.error("役員の原本・状態/日付根拠・表参照・検索条件を確認してください（入力内容は非表示）"); process.exitCode = 1; }
    });

program.command("search-policy-shareholdings")
    .description("政策保有の集計/特定投資/みなし保有を分けて逆引きします")
    .requiredOption("--manifest <path>", "file/selection/periodEnds/tablesのJSON配列")
    .requiredOption("--kind <kind>", "non-pure-summary/specified/deemed")
    .requiredOption("--period-end <date>", "確認済みの対象期末日")
    .requiredOption("--metric <metric>", "shares/reportedAmount/issueCount")
    .option("--listing-class <class>", "non-listed/other-than-non-listed/not-established")
    .option("--name-contains <text>", "原表の銘柄名に含まれる文字列")
    .option("--condition <json>", "operator/valueの条件（円/株/銘柄）")
    .option("--sort <order>", "value-asc/value-desc")
    .option("--offset <number>", "開始位置", "0")
    .option("--limit <number>", "最大件数", "100")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const manifest = path.resolve(options.manifest), entries = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readRegularFile(manifest, LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            if (!Array.isArray(entries) || entries.length > LOCAL_IMPORT_LIMITS.entries) throw new Error();
            let bytes = 0;
            const documents = entries.map(entry => {
                if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(k => !["file", "selection", "periodEnds", "tables"].includes(k)) || typeof entry.file !== "string" || !entry.file.trim()) throw new Error();
                const input = readRegularFile(path.resolve(path.dirname(manifest), entry.file), Math.min(LOCAL_IMPORT_LIMITS.sourceBytes, LOCAL_IMPORT_LIMITS.totalBytes - bytes)); bytes += input.bytes.byteLength;
                return { xml: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input.bytes), selection: entry.selection, periodEnds: entry.periodEnds, tables: entry.tables };
            });
            for (const value of [options.offset, options.limit]) if (!/^\d+$/.test(value)) throw new Error();
            console.log(JSON.stringify(searchPolicyShareholdings(documents, { kind: options.kind, periodEnd: options.periodEnd, metric: options.metric, listingClass: options.listingClass, nameContains: options.nameContains, condition: options.condition === undefined ? undefined : JSON.parse(options.condition), sort: options.sort, offset: Number(options.offset), limit: Number(options.limit) }), null, options.pretty ? 2 : undefined));
        } catch { console.error("政策保有の原本・期間・表参照・検索条件を確認してください（入力内容は非表示）"); process.exitCode = 1; }
    });

program.command("search-major-shareholders")
    .description("大株主表と大量保有の引用を分け、日付/名義/数値で検索します")
    .requiredOption("--manifest <path>", "file/selection/tablesのJSON配列")
    .requiredOption("--kind <kind>", "major-shareholders-tableまたはlarge-holding-reference")
    .requiredOption("--date-basis <basis>", "holding-as-ofまたはpublic-inspection-date")
    .requiredOption("--date <date>", "日付の値")
    .requiredOption("--role <role>", "namedまたはreported-total")
    .requiredOption("--metric <metric>", "reportedCountまたはholdingPercent")
    .option("--holder-contains <text>", "原表の氏名/名義に含まれる文字列")
    .option("--address-contains <text>", "原表の住所に含まれる文字列")
    .option("--condition <json>", "operator/value（株単位または百分率）")
    .option("--sort <order>", "value-ascまたはvalue-desc")
    .option("--offset <number>", "開始位置", "0")
    .option("--limit <number>", "最大件数", "100")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const manifest = path.resolve(options.manifest), entries = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readRegularFile(manifest, LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            if (!Array.isArray(entries) || entries.length > LOCAL_IMPORT_LIMITS.entries) throw new Error();
            let bytes = 0;
            const documents = entries.map(entry => {
                if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(k => !["file", "selection", "tables"].includes(k)) || typeof entry.file !== "string" || !entry.file.trim()) throw new Error();
                const input = readRegularFile(path.resolve(path.dirname(manifest), entry.file), Math.min(LOCAL_IMPORT_LIMITS.sourceBytes, LOCAL_IMPORT_LIMITS.totalBytes - bytes)); bytes += input.bytes.byteLength;
                return { xml: new TextDecoder("utf-8", { fatal: true }).decode(input.bytes), selection: entry.selection, tables: entry.tables };
            });
            for (const value of [options.offset, options.limit]) if (!/^\d+$/.test(value)) throw new Error();
            console.log(JSON.stringify(searchMajorShareholderDetails(documents, { kind: options.kind, date: { basis: options.dateBasis, value: options.date }, role: options.role, metric: options.metric,
                holderContains: options.holderContains, addressContains: options.addressContains, condition: options.condition === undefined ? undefined : JSON.parse(options.condition), sort: options.sort, offset: Number(options.offset), limit: Number(options.limit) }), null, options.pretty ? 2 : undefined));
        } catch { console.error("大株主の原本・日付の種類・表/引用・分母・検索条件を確認してください（入力内容は非表示）"); process.exitCode = 1; }
    });

program.command("search-shareholder-categories")
    .description("同じ基準日の株主分類を、人数/単元数/株数/割合で検索します")
    .requiredOption("--manifest <path>", "file/selection/declarationsのJSON配列")
    .requiredOption("--as-of <date>", "所有者別状況の基準日")
    .requiredOption("--category <category>", "foreign-non-individuals/reported-total/odd-lots等")
    .requiredOption("--metric <metric>", "shareholderCount/ownedLots/ownedShares/ownershipPercent")
    .option("--condition <json>", "operator/value（指標の単位による条件）")
    .option("--sort <order>", "value-ascまたはvalue-desc")
    .option("--offset <number>", "開始位置", "0")
    .option("--limit <number>", "最大件数", "100")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const manifest = path.resolve(options.manifest), entries = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readRegularFile(manifest, LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            if (!Array.isArray(entries) || entries.length > LOCAL_IMPORT_LIMITS.entries) throw new Error();
            let bytes = 0;
            const documents = entries.map(entry => {
                if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(k => !["file", "selection", "declarations"].includes(k)) || typeof entry.file !== "string" || !entry.file.trim()) throw new Error();
                const input = readRegularFile(path.resolve(path.dirname(manifest), entry.file), Math.min(LOCAL_IMPORT_LIMITS.sourceBytes, LOCAL_IMPORT_LIMITS.totalBytes - bytes)); bytes += input.bytes.byteLength;
                return { xml: new TextDecoder("utf-8", { fatal: true }).decode(input.bytes), selection: entry.selection, declarations: entry.declarations };
            });
            for (const value of [options.offset, options.limit]) if (!/^\d+$/.test(value)) throw new Error();
            console.log(JSON.stringify(searchShareholderCategories(documents, { asOf: options.asOf, category: options.category, metric: options.metric, condition: options.condition === undefined ? undefined : JSON.parse(options.condition), sort: options.sort, offset: Number(options.offset), limit: Number(options.limit) }), null, options.pretty ? 2 : undefined));
        } catch { console.error("株主分類の原本・基準日・表/単位の確認宣言・検索条件を確認してください（入力内容は非表示）"); process.exitCode = 1; }
    });

program.command("search-orders")
    .description("同一期間・範囲・役割の受注高/工事高/繰越残高を逆引きします")
    .requiredOption("--manifest <path>", "file/selection/accountingStandard/declarationsのJSON配列")
    .requiredOption("--start <date>", "期間開始日")
    .requiredOption("--end <date>", "期間終了日")
    .requiredOption("--scope <scope>", "ConsolidatedまたはNonConsolidated")
    .requiredOption("--role <role>", "detail/subtotal/reported-total")
    .requiredOption("--metric <metric>", "ordersReceivedJPY/completedConstructionJPY/salesJPY/openingBacklogJPY/closingBacklogJPY")
    .option("--label-contains <text>", "原表区分名に含まれる文字列")
    .option("--condition <json>", "operator/valueの円単位条件")
    .option("--sort <order>", "value-ascまたはvalue-desc")
    .option("--offset <number>", "開始位置", "0")
    .option("--limit <number>", "最大件数", "100")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const manifest = path.resolve(options.manifest), entries = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readRegularFile(manifest, LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            if (!Array.isArray(entries) || entries.length > LOCAL_IMPORT_LIMITS.entries) throw new Error();
            let bytes = 0;
            const documents = entries.map(entry => {
                if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(k => !["file", "selection", "accountingStandard", "declarations"].includes(k)) || typeof entry.file !== "string" || !entry.file.trim()) throw new Error();
                const input = readRegularFile(path.resolve(path.dirname(manifest), entry.file), Math.min(LOCAL_IMPORT_LIMITS.sourceBytes, LOCAL_IMPORT_LIMITS.totalBytes - bytes)); bytes += input.bytes.byteLength;
                return { xml: new TextDecoder("utf-8", { fatal: true }).decode(input.bytes), selection: entry.selection, accountingStandard: entry.accountingStandard, declarations: entry.declarations };
            });
            for (const value of [options.offset, options.limit]) if (!/^\d+$/.test(value)) throw new Error();
            console.log(JSON.stringify(searchOrderDetails(documents, { period: { startDate: options.start, endDate: options.end }, scope: options.scope, role: options.role, metric: options.metric,
                labelContains: options.labelContains, condition: options.condition === undefined ? undefined : JSON.parse(options.condition), sort: options.sort, offset: Number(options.offset), limit: Number(options.limit) }), null, options.pretty ? 2 : undefined));
        } catch { console.error("受注原本・期間・範囲・表/単位の確認宣言・検索条件を確認してください（入力内容は非表示）"); process.exitCode = 1; }
    });

program.command("search-affiliated-companies")
    .description("関係会社区分・記載名・通貨/議決権条件で逆引きします")
    .requiredOption("--manifest <path>", "file/selection/reportingPeriodEnd/accountingStandard/proof/tablesのJSON配列")
    .requiredOption("--period-end <date>", "報告年度の期末（関係成立日ではありません）")
    .requiredOption("--relationship <kind>", "consolidated-subsidiary/parent等の記載区分")
    .requiredOption("--entry-kind <kind>", "namedまたはaggregate")
    .option("--name-contains <text>", "元の会社表示名に含まれる文字列")
    .option("--address-contains <text>", "元の住所に含まれる文字列")
    .option("--business-contains <text>", "元の事業内容に含まれる文字列")
    .option("--capital <json>", "currency/operator/valueの基本通貨単位条件")
    .option("--voting <json>", "direction/component/operator/valueの百分率条件")
    .option("--sort <order>", "name-ascまたはname-desc")
    .option("--offset <number>", "開始位置", "0")
    .option("--limit <number>", "最大件数", "100")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const manifest = path.resolve(options.manifest), entries = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readRegularFile(manifest, LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            if (!Array.isArray(entries) || entries.length > LOCAL_IMPORT_LIMITS.entries) throw new Error();
            let bytes = 0;
            const documents = entries.map(entry => {
                if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(k => !["file", "selection", "reportingPeriodEnd", "accountingStandard", "proof", "tables"].includes(k)) || typeof entry.file !== "string" || !entry.file.trim()) throw new Error();
                const input = readRegularFile(path.resolve(path.dirname(manifest), entry.file), Math.min(LOCAL_IMPORT_LIMITS.sourceBytes, LOCAL_IMPORT_LIMITS.totalBytes - bytes)); bytes += input.bytes.byteLength;
                return { xml: new TextDecoder("utf-8", { fatal: true }).decode(input.bytes), selection: entry.selection, reportingPeriodEnd: entry.reportingPeriodEnd, accountingStandard: entry.accountingStandard, proof: entry.proof, tables: entry.tables };
            });
            for (const value of [options.offset, options.limit]) if (!/^\d+$/.test(value)) throw new Error();
            console.log(JSON.stringify(searchAffiliatedCompanies(documents, { reportingPeriodEnd: options.periodEnd, relationship: options.relationship, entryKind: options.entryKind, nameContains: options.nameContains,
                addressContains: options.addressContains, businessContains: options.businessContains, capital: options.capital === undefined ? undefined : JSON.parse(options.capital), voting: options.voting === undefined ? undefined : JSON.parse(options.voting), sort: options.sort, offset: Number(options.offset), limit: Number(options.limit) }), null, options.pretty ? 2 : undefined));
        } catch { console.error("関係会社の原本・報告期末・表の区分/継続・通貨・注記・検索条件を確認してください（入力内容は非表示）"); process.exitCode = 1; }
    });

program.command("search-segments")
    .description("同一期間・役割のセグメント直接値を検索します")
    .requiredOption("--manifest <path>", "file/selection/accountingStandard/declarationsのJSON配列")
    .requiredOption("--start <date>", "対象期間の開始日")
    .requiredOption("--end <date>", "対象期間の終了日")
    .requiredOption("--role <role>", "reported-segment/reported-total/adjustment/financial-statement-total")
    .option("--label-contains <text>", "元表の表示名に含まれる文字列")
    .option("--conditions <json>", "metric/operator/valueの円単位AND条件", "[]")
    .option("--sort-by <metric>", "並べ替える指標ID")
    .option("--order <order>", "ascまたはdesc", "desc")
    .option("--offset <number>", "開始位置", "0")
    .option("--limit <number>", "最大件数", "100")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const manifest = path.resolve(options.manifest), entries = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readRegularFile(manifest, LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            if (!Array.isArray(entries) || entries.length > LOCAL_IMPORT_LIMITS.entries) throw new Error();
            let bytes = 0;
            const documents = entries.map(entry => {
                if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(k => !["file", "selection", "accountingStandard", "declarations"].includes(k)) || typeof entry.file !== "string" || !entry.file.trim()) throw new Error();
                const input = readRegularFile(path.resolve(path.dirname(manifest), entry.file), Math.min(LOCAL_IMPORT_LIMITS.sourceBytes, LOCAL_IMPORT_LIMITS.totalBytes - bytes)); bytes += input.bytes.byteLength;
                return { xml: new TextDecoder("utf-8", { fatal: true }).decode(input.bytes), selection: entry.selection, accountingStandard: entry.accountingStandard, declarations: entry.declarations };
            });
            for (const value of [options.offset, options.limit]) if (!/^\d+$/.test(value)) throw new Error();
            if (!["asc", "desc"].includes(options.order)) throw new Error();
            console.log(JSON.stringify(searchSegmentDetails(documents, { period: { startDate: options.start, endDate: options.end }, role: options.role, labelContains: options.labelContains,
                conditions: JSON.parse(options.conditions), sort: options.sortBy === undefined ? undefined : { metric: options.sortBy, order: options.order }, offset: Number(options.offset), limit: Number(options.limit) }), null, options.pretty ? 2 : undefined));
        } catch { console.error("セグメントの原本・期間・表の関係・役割・単位・検索条件を確認してください（入力内容は非表示）"); process.exitCode = 1; }
    });

program.command("search-main-customers")
    .description("主要顧客の記載を顧客名・セグメント・売上高から逆引きします")
    .requiredOption("--manifest <path>", "file/selection/accountingStandard/scope/proofのJSON配列")
    .requiredOption("--start <date>", "対象期間の開始日")
    .requiredOption("--end <date>", "対象期間の終了日")
    .requiredOption("--scope <scope>", "ConsolidatedまたはNonConsolidated")
    .option("--customer-contains <text>", "記載顧客名の部分文字列")
    .option("--segment-contains <text>", "関連セグメント記載の部分文字列")
    .option("--revenue <json>", "operator/valueの円単位条件")
    .option("--sort <order>", "revenue-ascまたはrevenue-desc")
    .option("--offset <number>", "開始位置", "0")
    .option("--limit <number>", "最大件数", "100")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const manifest = path.resolve(options.manifest), entries = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readRegularFile(manifest, LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            if (!Array.isArray(entries) || entries.length > LOCAL_IMPORT_LIMITS.entries) throw new Error();
            let bytes = 0;
            const documents = entries.map(entry => {
                if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(k => !["file", "selection", "accountingStandard", "scope", "proof"].includes(k)) || typeof entry.file !== "string" || !entry.file.trim()) throw new Error();
                const input = readRegularFile(path.resolve(path.dirname(manifest), entry.file), Math.min(LOCAL_IMPORT_LIMITS.sourceBytes, LOCAL_IMPORT_LIMITS.totalBytes - bytes)); bytes += input.bytes.byteLength;
                return { xml: new TextDecoder("utf-8", { fatal: true }).decode(input.bytes), selection: entry.selection, accountingStandard: entry.accountingStandard, scope: entry.scope, proof: entry.proof };
            });
            for (const value of [options.offset, options.limit]) if (!/^\d+$/.test(value)) throw new Error();
            console.log(JSON.stringify(searchMainCustomerDetails(documents, { period: { startDate: options.start, endDate: options.end }, scope: options.scope, customerContains: options.customerContains,
                segmentContains: options.segmentContains, revenue: options.revenue === undefined ? undefined : JSON.parse(options.revenue), sort: options.sort, offset: Number(options.offset), limit: Number(options.limit) }), null, options.pretty ? 2 : undefined));
        } catch { console.error("主要顧客の原本・期間・連単・単位・本文hash・検索条件を確認してください（入力内容は非表示）"); process.exitCode = 1; }
    });

program.command("screen-bs")
    .description("ローカルXBRL一覧から財務3項目・流動比率を検索します（currentRatio: 1=100%）")
    .requiredOption("--manifest <path>", "ローカルXBRL一覧JSON（相対fileはmanifest基準）")
    .option("--conditions <json>", "AND条件のJSON配列", "[]")
    .option("--sort-by <metric>", "財務3項目またはcurrentRatioで並べ替え")
    .option("--order <order>", "ascまたはdesc", "desc")
    .option("--offset <number>", "開始位置", "0")
    .option("--limit <number>", "最大件数")
    .option("--pretty", "JSONを整形")
    .action(options => {
        try {
            const manifestPath = path.resolve(options.manifest);
            const entries = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readRegularFile(manifestPath, LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
            if (!Array.isArray(entries) || entries.length > LOCAL_IMPORT_LIMITS.entries) throw new Error("manifestは100件以下の配列です");
            let bytes = 0;
            const snapshots = entries.map(entry => {
                if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.file !== "string" || !entry.file.trim() ||
                    Object.keys(entry).some(key => !["secCode", "docID", "file", "instant", "scope", "accountingStandard"].includes(key))) throw new Error("不正なmanifest項目です");
                const input = readRegularFile(path.resolve(path.dirname(manifestPath), entry.file), Math.min(LOCAL_IMPORT_LIMITS.sourceBytes, LOCAL_IMPORT_LIMITS.totalBytes - bytes));
                bytes += input.bytes.byteLength;
                const xml = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
                return createBalanceSheetSnapshot(xml, { secCode: entry.secCode, docID: entry.docID, instant: entry.instant, scope: entry.scope, accountingStandard: entry.accountingStandard, currency: "JPY" });
            });
            for (const value of [options.offset, options.limit]) if (value !== undefined && !/^\d+$/.test(value)) throw new Error("offset/limitは0以上の整数です");
            const result = screenBalanceSheetSnapshots(snapshots, {
                conditions: JSON.parse(options.conditions), sortBy: options.sortBy, order: options.order,
                offset: Number(options.offset), limit: options.limit === undefined ? undefined : Number(options.limit)
            });
            console.log(JSON.stringify(result, null, options.pretty ? 2 : undefined));
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    });

program.command("screen")
    .description("保存済み主要指標JSONをオフライン横断検索します（データ取得なし）")
    .requiredOption("-f, --file <path>", "FinancialSnapshot[] 形式のJSONファイル")
    .option("--conditions <json>", "AND条件配列（metric/operator/value）", "[]")
    .option("--tickers <codes>", "証券コード（カンマ区切り）")
    .option("--type <code>", "書類種別コード", "120")
    .option("--as-of <date>", "提出日・決算日の上限（YYYY-MM-DD または YYYY-MM-DD HH:mm:ss）")
    .option("--sort-by <metric>", "並べ替え指標（例: operatingMargin）")
    .option("--order <order>", "asc / desc", "desc")
    .option("--limit <count>", "最大件数（0も可）")
    .option("--offset <count>", "開始位置", "0")
    .option("--pretty", "JSONを整形して出力")
    .action(options => {
        try {
            const results = screenFinancialSnapshots(JSON.parse(fs.readFileSync(options.file, "utf-8")), {
                conditions: JSON.parse(options.conditions),
                secCodes: options.tickers?.split(",").map((code: string) => code.trim()),
                docTypeCode: options.type,
                asOf: options.asOf,
                sortBy: options.sortBy,
                order: options.order,
                limit: options.limit === undefined ? undefined : Number(options.limit),
                offset: Number(options.offset)
            });
            console.log(JSON.stringify(results, null, options.pretty ? 2 : undefined));
        } catch (error) {
            console.error("横断検索に失敗しました:", error instanceof Error ? error.message : error);
            process.exitCode = 1;
        }
    });

program.command("parse")
    .description("ローカルのXBRLファイルを解析します")
    .requiredOption("-f, --file <path>", ".xbrlファイルへのパス")
    .option("-o, --output <path>", "出力先JSONファイルパス")
    .option("--pretty", "JSONを整形して出力")
    .action((options) => {
        if (!fs.existsSync(options.file)) {
            console.error(`File not found: ${options.file}`);
            process.exit(1);
        }

        const parser = new EdinetXbrlParser();
        try {
            const content = fs.readFileSync(options.file, "utf-8");
            const xbrl = parser.parse(content);
            const metrics = xbrl.getKeyMetrics();

            const json = options.pretty ? JSON.stringify(metrics, null, 2) : JSON.stringify(metrics);

            if (options.output) {
                fs.writeFileSync(options.output, json);
                console.log(`Examples saved to ${options.output}`);
            } else {
                console.log(json);
            }
        } catch (e: any) {
            console.error("Failed to parse XBRL:", e.message);
            process.exit(1);
        }
    });

const getCommand = program.command("get")
    .description("EDINET書類をダウンロードし、即座に解析します")
    .option("-t, --ticker <code>", "証券コード (例: 7203)")
    .option("-d, --date <date>", "対象日 (YYYY-MM-DD)。デフォルトは当日")
    .option("-l, --lookback <days>", "対象日に見つからない場合に遡る日数 (デフォルト: 90)", "90")
    .option("--type <type>", "書類種別 (例: Annual, registration-statement/030, securities-notice/010)。既定: Annual", "Annual")
    .option("--save-dir <path>", "ダウンロードファイルの保存先ディレクトリ")
    .option("--pretty", "JSONを整形して出力")
    .option("-v, --verbose", "進捗ログを表示")
    .option("--help-types", "各書類タイプで返されるJSONの型情報を表示")
    .addHelpText('after', '\n詳細な型情報については --help-types オプションを使用してください。')
    .action(async (options) => {
        // If --help-types is specified, show type documentation and exit
        if (options.helpTypes) {
            console.log(generateFullHelpMarkdown());
            process.exit(0);
        }
        // デフォルトを ./downloads にすることでキャッシュを効かせる
        const saveDir = options.saveDir || "./downloads";
        const downloader = new EdinetXbrlDownloader({ rootDir: saveDir });
        const parser = new EdinetXbrlParser();

        const docType = resolveCliDocumentType(options.type);

        try {
            let docsToProcess: any[] = [];
            const lookback = parseInt(options.lookback, 10);

            // Ticker指定あり: 特定の1件を探す
            if (options.ticker) {
                let doc: any = null;

                // 1. ローカルDB (Seed Index) を最初に試す
                // 配列形式（LargeShareholding等）の場合はDB検索が複雑になるためスキップ
                // また、LargeShareholdingはTickerで検索できないため、そもそもDB検索は無意味
                if (!Array.isArray(docType)) {
                    if (options.verbose) console.error(`Searching for ${options.type} of ${options.ticker}...`);
                    try {
                        const repo = new EdinetRepository();
                        const dbDocs = repo.findDocuments({
                            secCode: options.ticker + "0", // 4桁->5桁
                            docTypeCode: docType,
                            limit: 1
                        });
                        if (dbDocs.length > 0) {
                            const d = dbDocs[0];
                            if (options.verbose) console.error(`Found in Local DB (Fast): ${d.docDescription} (${d.docID}) submitted on ${d.submitDate}`);
                            doc = {
                                ...d,
                                submitDateTime: d.submitDate // normalize key for downstream
                            };
                        }
                    } catch (e) {
                        // DBが存在しないかアクセスできない場合は無視してAPIにフォールバック
                    }
                }

                // 2. DBに見つからない場合はAPI検索にフォールバック
                if (!doc) {
                    if (options.verbose) console.error("Not found in Local DB. Searching via API (this may take time)...");
                    doc = await downloader.findLatest(options.ticker, docType, lookback);
                    if (!doc) {
                        console.error(`No document found for ${options.ticker} in the last ${lookback} days.`);
                        process.exit(1);
                    }
                }
                docsToProcess.push(doc);

            } else {
                // Ticker指定なし: 日付とタイプで検索して一括取得
                const date = options.date || new Date().toISOString().split("T")[0];
                if (options.verbose) console.error(`Searching for ${options.type} on ${date}...`);
                const results = await downloader.search(date, docType);
                if (results.length === 0) {
                    console.error(`No documents found on ${date}.`);
                    process.exit(0);
                }
                if (options.verbose) console.error(`Found ${results.length} documents.`);
                docsToProcess = results;
            }

            const results = [];

            for (const doc of docsToProcess) {
                if (options.verbose) {
                    console.error(`Processing: ${doc.docDescription} (${doc.docID})...`);
                }
                try {
                    const xbrlPath = await downloader.download(doc.docID, saveDir);
                    if (options.verbose) console.error(`Parsing ${xbrlPath}...`);

                    const content = fs.readFileSync(xbrlPath, "utf-8");
                    const xbrl = parser.parse(content);
                    const metrics = xbrl.getKeyMetrics();
                    const largeShareholdingInfo = xbrl.getLargeShareholdingInfo();

                    // Add metadata to output
                    const output = {
                        ...metrics,
                        // If it's a Large Shareholding report, add specific info
                        ...(largeShareholdingInfo.issuerName ? { issuerName: largeShareholdingInfo.issuerName } : {}),
                        ...(largeShareholdingInfo.holdingRatio ? { holdingRatio: largeShareholdingInfo.holdingRatio } : {}),
                        ...(largeShareholdingInfo.prevHoldingRatio ? { prevHoldingRatio: largeShareholdingInfo.prevHoldingRatio } : {}),
                        docID: doc.docID,
                        filerName: doc.filerName,
                        edinetCode: doc.edinetCode,
                        docDescription: doc.docDescription,
                        submitDate: doc.submitDateTime || doc.date
                    };
                    results.push(output);

                } catch (e: any) {
                    // console.error(`Failed to process ${doc.docID}:`, e.message);
                }
            }

            // 配列として一括出力
            console.log(options.pretty ? JSON.stringify(results, null, 2) : JSON.stringify(results));

        } catch (e: any) {
            console.error("Error:", e.message);
            process.exit(1);
        }
    });

program.parse(process.argv);
