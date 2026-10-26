/**
 * EDINET実APIの最小スモーク確認（手動実行専用）。
 *
 * 目的: 書類種別コードの対応が実データと合っているかを、書類一覧APIの
 * 少ないリクエストだけで確認します。書類本体は取得しません。
 *
 * 使い方:
 *   EDINET_API_KEY=... npx tsx scripts/live-smoke.ts [YYYY-MM-DD]
 *
 * 日付を省略した場合は日本時間の当日を起点に、最大10日さかのぼって
 * 大量保有報告書（350）のある日を探します（1日につき一覧取得1回だけ）。
 * 検証内容:
 *   - 350の書類名は「大量保有報告書」または「変更報告書」で始まる
 *   - 350の様式コードは、大量保有報告書なら末尾000、変更報告書なら末尾002
 *   - 340の書類名は別途買付け関係であり、大量保有ではない
 *   - 360の書類名は「訂正報告書」で始まる
 */
import { EdinetXbrlDownloader, type EdinetDocument } from "../src/edinet-xbrl-downloader";

export interface LiveSmokeSummary {
    total: number;
    largeShareholding: number;
    changeReports: number;
    corrections: number;
    separatePurchaseCorrections: number;
    problems: string[];
}

function formCodeOf(doc: EdinetDocument): string | null {
    const value = doc["formCode"];
    return typeof value === "string" ? value : null;
}

/** 実APIの一覧（1日分）に対する種別コード対応の純粋な検証。 */
export function checkLargeShareholdingSamples(docs: EdinetDocument[]): LiveSmokeSummary {
    const summary: LiveSmokeSummary = {
        total: docs.length,
        largeShareholding: 0,
        changeReports: 0,
        corrections: 0,
        separatePurchaseCorrections: 0,
        problems: [],
    };
    for (const doc of docs) {
        const description = doc.docDescription ?? "";
        const formCode = formCodeOf(doc);
        if (doc.docTypeCode === "350") {
            summary.largeShareholding += 1;
            const isChange = description.startsWith("変更報告書");
            const isInitial = description.startsWith("大量保有報告書");
            if (!isChange && !isInitial) {
                summary.problems.push(`${doc.docID}: 350なのに書類名が大量保有/変更ではない: ${description}`);
                continue;
            }
            if (isChange) summary.changeReports += 1;
            if (formCode !== null) {
                if (isInitial && !formCode.endsWith("000")) {
                    summary.problems.push(`${doc.docID}: 大量保有報告書なのに様式コードが末尾000ではない: ${formCode}`);
                }
                if (isChange && !formCode.endsWith("002")) {
                    summary.problems.push(`${doc.docID}: 変更報告書なのに様式コードが末尾002ではない: ${formCode}`);
                }
            }
        } else if (doc.docTypeCode === "360") {
            summary.corrections += 1;
            if (!description.startsWith("訂正報告書")) {
                summary.problems.push(`${doc.docID}: 360なのに書類名が訂正報告書ではない: ${description}`);
            }
        } else if (doc.docTypeCode === "340") {
            summary.separatePurchaseCorrections += 1;
            if (!description.includes("別途買付け")) {
                summary.problems.push(`${doc.docID}: 340なのに書類名が別途買付け関係ではない: ${description}`);
            }
        }
    }
    return summary;
}

function todayInTokyo(): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}

function shiftDate(iso: string, days: number): string {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
    const apiKey = process.env.EDINET_API_KEY ?? "";
    if (apiKey === "") {
        throw new Error("EDINET_API_KEY が設定されていません。GitHub Secretsまたは環境変数で指定してください。");
    }
    const startDate = process.argv[2] ?? todayInTokyo();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        throw new Error(`日付は YYYY-MM-DD で指定してください: ${startDate}`);
    }
    const client = new EdinetXbrlDownloader({ apiKey });
    const maxDays = 10;
    for (let back = 0; back < maxDays; back += 1) {
        const date = shiftDate(startDate, -back);
        const docs = await client.search(date);
        const summary = checkLargeShareholdingSamples(docs);
        console.log(`${date}: 全${summary.total}件 / 350 大量保有系${summary.largeShareholding}件（うち変更${summary.changeReports}件） / 360 訂正${summary.corrections}件 / 340 別途買付け訂正${summary.separatePurchaseCorrections}件`);
        if (summary.problems.length > 0) {
            for (const problem of summary.problems) console.error(`NG: ${problem}`);
            process.exitCode = 1;
            return;
        }
        if (summary.largeShareholding > 0) {
            console.log("OK: 実データの種別コード対応（350=大量保有/変更、360=訂正、340=別途買付け訂正）を確認しました。");
            return;
        }
    }
    throw new Error(`${startDate} から${maxDays}日以内に大量保有報告書（350）が見つからず、確認できませんでした。`);
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("live-smoke.ts") || entry.endsWith("live-smoke.js")) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : "live smoke failed");
        process.exitCode = 1;
    });
}
