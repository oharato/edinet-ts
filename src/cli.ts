#!/usr/bin/env node
import { screenSubsidiaryHumanCapitalMetrics } from "./subsidiary-human-capital-metrics";
import { Command } from "commander";
import { analyzeDocumentRelations } from "./document-relations";
import { createCompanyProfile, CompanyProfileFieldId } from "./company-profile";
import { screenCompanyDocuments, CompanyProfileOperator } from "./company-screening";
import { screenWorkforceDocuments } from "./workforce-screening";
import { searchSubsidiaryHumanCapitalLabels, SubsidiaryHumanCapitalLabelOperator } from "./subsidiary-human-capital-labels";
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
    .description("同じ期末のIFRS連結・円の直接3項目で、明示した会社を検索します")
    .requiredOption("--manifest <path>", "fileとIFRS metadataを持つJSON配列")
    .option("--conditions <json>", "currentAssets/currentLiabilities/totalLiabilitiesのAND条件", "[]")
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
            const result = screenIfrsBalanceSheetDocuments(documents, { conditions: JSON.parse(options.conditions), sortBy: options.sortBy, order: options.order, offset: options.offset, limit: options.limit });
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
