import { EdinetXbrlDownloader } from "../src/edinet-xbrl-downloader";
import * as fs from "fs";
import * as path from "path";

// .env を手動で読み込む（dotenv が利用できない場合）
try {
    const envPath = path.resolve(__dirname, "../.env");
    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, "utf-8");
        envConfig.split("\n").forEach(line => {
            const [key, val] = line.split("=");
            if (key && val && !process.env[key.trim()]) {
                process.env[key.trim()] = val.trim();
            }
        });
    }
} catch (e) {
    console.warn("Failed to load .env manually", e);
}

// 指定した日付の書類種別を取得・表示する関数
async function checkDate(downloader: EdinetXbrlDownloader, date: string, label: string) {
    console.log(`\n=== Checking ${label} (${date}) ===`);
    try {
        const docs = await downloader.search(date);
        console.log(`Found ${docs.length} documents.`);

        const typeMap = new Map<string, string>();

        docs.forEach(d => {
            // docTypeCode は API レスポンスに含まれています
            const code = (d as any).docTypeCode;
            const desc = d.docDescription;
            if (code && !typeMap.has(code)) {
                typeMap.set(code, desc);
                console.log(`[${code}] ${desc}`);
            }
        });

    } catch (e) {
        console.error(`Error checking ${date}:`, e);
    }
}

async function main() {
    // 環境変数または引数から API キーを取得
    const apiKey = process.env.EDINET_API_KEY;
    if (!apiKey) {
        console.warn("Please set EDINET_API_KEY in .env");
    }

    const downloader = new EdinetXbrlDownloader({ apiKey, rootDir: "./downloads" });

    // 2024-06-27: 有価証券報告書のピーク（3月決算）
    await checkDate(downloader, "2024-06-27", "Annual Reports Peak");

    // 2024-11-14: 四半期報告書・半期報告書のピーク
    await checkDate(downloader, "2024-11-14", "Quarterly Reports Peak");
}

main();
