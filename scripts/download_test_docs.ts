
import { EdinetXbrlDownloader } from "../src/edinet-xbrl-downloader";
import fs from "fs";
import path from "path";

// Manually read .env since we don't have dotenv
const envPath = path.resolve(__dirname, "../.env");
let apiKey = process.env.EDINET_API_KEY;

if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    envConfig.split('\n').forEach(line => {
        if (line.startsWith('EDINET_API_KEY=')) {
            apiKey = line.split('=')[1].trim();
        }
    });
}

if (!apiKey) {
    console.error("API Key not found in .env or environment variables.");
    process.exit(1);
}

const DOWNLOAD_DIR = path.join(__dirname, "../downloads");

async function main() {
    const downloader = new EdinetXbrlDownloader(apiKey, { rootDir: DOWNLOAD_DIR });
    const docs = [
        { id: "S100TP3N", name: "Softbank Group (IFRS)" },
        { id: "S100TL6G", name: "Nintendo (J-GAAP)" }
    ];

    for (const doc of docs) {
        console.log(`Downloading ${doc.name} (${doc.id})...`);
        try {
            const filePath = await downloader.download(doc.id);
            console.log(`Saved to: ${filePath}`);
        } catch (e) {
            console.error(`Failed to download ${doc.name}:`, e);
        }
    }
}

main();
