

import JSZip from "jszip";
import fs from "fs";
import path from "path";
import { performance } from "perf_hooks";

// テスト用の大きなファイルを探す
const downloadDir = path.join(__dirname, "../downloads");
function findZipOrXbrl(dir: string): string | null {
    if (!fs.existsSync(dir)) return null;
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
        if (item.isDirectory()) {
            const found = findZipOrXbrl(path.join(dir, item.name));
            if (found) return found;
        } else if (item.name.endsWith(".xbrl")) {
            return path.join(dir, item.name);
        }
    }
    return null;
}

// Adm-Zip usually reads ZIP files. 
// If we only have extracted XBRLs, we might need to ZIP them up first to test extraction?
// Or we can mock the Buffer.
// Actually, EdinetXbrlDownloader downloads a ZIP.
// If we have saved ZIPs, that's great. But we usually extract them.
// Let's see if we have any .zip files in downloads? 
// The current downloader logic deletes the zip after extraction?
// Let's check the code: yes, it does `zip.extractAllTo` but might not start with a file...
// Ah, `download()` fetches buffer and unzips immediately. It doesn't save .zip.

// テストのために、既存のXBRLファイルからZIPバッファを作成する
async function createBenchmarkZip(xbrlPath: string): Promise<Buffer> {
    const content = fs.readFileSync(xbrlPath);
    const zip = new JSZip();
    zip.file("report.xbrl", content);
    return await zip.generateAsync({ type: "nodebuffer" });
}

async function main() {
    const xbrlPath = findZipOrXbrl(downloadDir);
    if (!xbrlPath) {
        console.error("ベンチマーク用のXBRLファイルが見つかりません。");
        return;
    }

    console.log(`Using file for benchmark: ${xbrlPath}`);
    const fileSize = fs.statSync(xbrlPath).size;
    console.log(`File Size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

    // ZIPバッファの準備
    const zipBuffer = await createBenchmarkZip(xbrlPath);
    console.log(`Zip Buffer created. Size: ${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB`);

    const ITERATIONS = 20;


    // 1. JSZip ベンチマーク
    {
        const times: number[] = [];
        for (let i = 0; i < ITERATIONS; i++) {
            const start = performance.now();
            const zip = await JSZip.loadAsync(zipBuffer);
            const file = zip.file("report.xbrl");
            if (file) {
                await file.async("string");
            }
            const end = performance.now();
            times.push(end - start);
        }
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        console.log(`[JSZip]   Average: ${avg.toFixed(2)} ms`);
    }


}

main();
