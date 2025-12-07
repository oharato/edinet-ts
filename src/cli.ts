#!/usr/bin/env node
import { Command } from "commander";
import "dotenv/config";
import { EdinetXbrlDownloader } from "./edinet-xbrl-downloader";
import { EdinetXbrlParser } from "./edinet-xbrl-parser";
import { EdinetDocumentType } from "./edinet-document-type";
import { EdinetRepository } from "./db/edinet-repository";
import * as fs from "fs";
import * as path from "path";

const program = new Command();

program
    .name("edinet-ts")
    .description("EDINET XBRLファイルをダウンロードおよび解析するためのCLI")
    .version("0.0.1");

const DOCUMENT_TYPE_MAP: Record<string, EdinetDocumentType | EdinetDocumentType[]> = {
    // Aliases
    "annual": EdinetDocumentType.AnnualCards,
    "quarterly": EdinetDocumentType.QuarterlyReport,
    "semiannual": EdinetDocumentType.SemiAnnualReport,
    "extraordinary": EdinetDocumentType.ExtraordinaryReport,
    "registration": EdinetDocumentType.SecuritiesRegistrationStatement,
    "amended": EdinetDocumentType.AmendedSecuritiesRegistrationStatement,
    "confirmation": EdinetDocumentType.ConfirmationLetter,
    "internalcontrol": EdinetDocumentType.InternalControlReport,
    "largeshareholding": [
        EdinetDocumentType.LargeShareholdingReport,
        EdinetDocumentType.ChangeReport,
        EdinetDocumentType.CorrectionReport
    ],
    "change": EdinetDocumentType.ChangeReport,
    "correction": EdinetDocumentType.CorrectionReport,
    "tenderoffer": EdinetDocumentType.TenderOfferStatement,
    "tenderofferreport": EdinetDocumentType.TenderOfferReport,
    // Short codes
    "120": EdinetDocumentType.AnnualCards,
    "140": EdinetDocumentType.QuarterlyReport,
    "160": EdinetDocumentType.SemiAnnualReport,
    "180": EdinetDocumentType.ExtraordinaryReport,
    "010": EdinetDocumentType.SecuritiesRegistrationStatement,
    "040": EdinetDocumentType.AmendedSecuritiesRegistrationStatement,
    "135": EdinetDocumentType.ConfirmationLetter,
    "235": EdinetDocumentType.InternalControlReport,
    "340": EdinetDocumentType.LargeShareholdingReport,
    "350": EdinetDocumentType.ChangeReport,
    "360": EdinetDocumentType.CorrectionReport,
    "240": EdinetDocumentType.TenderOfferStatement,
    "270": EdinetDocumentType.TenderOfferReport,
};

function resolveDocumentType(input: string): EdinetDocumentType | EdinetDocumentType[] {
    const lower = input.toLowerCase();

    // Check aliases
    if (DOCUMENT_TYPE_MAP[lower]) {
        return DOCUMENT_TYPE_MAP[lower];
    }

    // Check if raw value exists in Enum
    const values = Object.values(EdinetDocumentType);
    if (values.includes(input as EdinetDocumentType)) {
        return input as EdinetDocumentType;
    }

    // Default to Annual if unknown
    return EdinetDocumentType.AnnualCards;
}

program.command("download")
    .description("EDINET書類をダウンロードします")
    .option("-t, --ticker <codes>", "証券コード（カンマ区切り、例: 7203,9984）")
    .option("-d, --date <date>", "対象日 (YYYY-MM-DD)。デフォルトは当日")
    .option("--type <type>", "書類種別 (例: Annual, Quarterly, 120...)。デフォルト: Annual", "Annual")
    .option("--dir <path>", "出力先ディレクトリ", "./downloads")
    .action(async (options) => {
        const downloader = new EdinetXbrlDownloader({ rootDir: options.dir });
        const date = options.date || new Date().toISOString().split("T")[0];

        const docType = resolveDocumentType(options.type);

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

program.command("get")
    .description("EDINET書類をダウンロードし、即座に解析します")
    .option("-t, --ticker <code>", "証券コード (例: 7203)")
    .option("-d, --date <date>", "対象日 (YYYY-MM-DD)。デフォルトは当日")
    .option("-l, --lookback <days>", "対象日に見つからない場合に遡る日数 (デフォルト: 90)", "90")
    .option("--type <type>", "書類種別 (例: Annual, Quarterly, 120...)。デフォルト: Annual", "Annual")
    .option("--save-dir <path>", "ダウンロードファイルの保存先ディレクトリ")
    .option("--pretty", "JSONを整形して出力")
    .option("-v, --verbose", "進捗ログを表示")
    .action(async (options) => {
        // デフォルトを ./downloads にすることでキャッシュを効かせる
        const saveDir = options.saveDir || "./downloads";
        const downloader = new EdinetXbrlDownloader({ rootDir: saveDir });
        const parser = new EdinetXbrlParser();

        const docType = resolveDocumentType(options.type);

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
