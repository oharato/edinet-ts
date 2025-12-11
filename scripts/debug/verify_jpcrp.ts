import * as path from "path";
import * as fs from "fs";
import { EdinetXbrlParser } from "../src/edinet-xbrl-parser";

const SOFTBANK_DOC_ID = "S100TP3N";
const FILE_PATH = `downloads/${SOFTBANK_DOC_ID}/XBRL/PublicDoc/jpcrp030000-asr-001_E02778-000_2024-03-31_01_2024-06-21_ixbrl.htm`;

// Note: SoftbankのファイルはInline XBRL (htm)。パーサーは.xbrlを処理します。
// .xbrlファイルが存在するか確認する必要があります。
// ダウンローダーは利用可能であれば.xbrlを展開します。
// downloads/S100TP3N の中身を確認します。

async function main() {
    const downloadDir = path.join(__dirname, "../downloads", SOFTBANK_DOC_ID);

    // .xbrlファイルを探す（PublicDocを優先）
    const files = fs.readdirSync(downloadDir, { recursive: true }) as string[];
    const xbrlFile = files.find(f => f.endsWith(".xbrl") && f.includes("PublicDoc")) || files.find(f => f.endsWith(".xbrl"));

    if (!xbrlFile) {
        console.warn("No .xbrl file found for verification. Skipping.");
        // downloads内の任意のxbrlを探す
        return;
    }

    const fullPath = path.join(downloadDir, xbrlFile);
    console.log(`Testing with: ${fullPath}`);

    const parser = new EdinetXbrlParser();
    const xml = fs.readFileSync(fullPath, "utf-8");
    const xbrl = parser.parse(xml);

    const jpcrp = xbrl.getJpcrpCor();

    // Proxy経由でのアクセスをテスト
    // 存在するプロパティを推測する必要があります。
    // 通常 "CompanyNameCoverPage" などが表紙に存在します。
    // まず jpcrp_cor で始まるすべてのキーをダンプして確認します。

    console.log("生マップから jpcrp_cor キーを検索中...");
    const keys = Array.from(xbrl.getKeys()).filter(k => k.startsWith("jpcrp_cor:"));
    console.log(`Found ${keys.length} jpcrp_cor items.`);

    if (keys.length > 0) {
        console.log("Sample keys:", keys.slice(0, 5));

        // 1つアクセスしてみる
        const sampleKeyFull = keys[0];
        const sampleProp = sampleKeyFull.replace("jpcrp_cor:", "");

        console.log(`Accessing getJpcrpCor().${sampleProp}...`);
        // @ts-ignore
        const value = jpcrp[sampleProp];
        console.log(`Value: ${value}`);

        if (value !== undefined) {
            console.log("SUCCESS: Retrieved value via proxy.");
        } else {
            console.error("FAILURE: Value undefined via proxy (context mismatch?)");
        }
    } else {
        console.warn("No jpcrp_cor data found in this file.");
    }
}

main();
