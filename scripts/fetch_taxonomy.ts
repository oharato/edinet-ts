
import https from "https";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";

// 2024 Version EDINET Taxonomy (Published 2023-12-11)
// https://www.fsa.go.jp/search/20231211.html
const TAXONOMY_URL = "https://www.fsa.go.jp/search/20231211/1c_Taxonomy.zip";
const DOWNLOAD_DIR = path.resolve(__dirname, "../taxonomy");
const ZIP_FILE_PATH = path.join(DOWNLOAD_DIR, "taxonomy.zip");

async function main() {
    if (!fs.existsSync(DOWNLOAD_DIR)) {
        fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    }

    console.log(`Downloading taxonomy from ${TAXONOMY_URL}...`);
    await downloadFile(TAXONOMY_URL, ZIP_FILE_PATH);

    console.log("Extracting zip file with cp932 encoding...");
    // Use system unzip command with cp932 encoding to handle Japanese filenames correctly
    try {
        const { execSync } = await import("child_process");
        // -O cp932: 指定CHARSET for DOS/Windows (Shift-JIS)
        // -q: Quiet mode
        // -d: Destination directory
        execSync(`unzip -O cp932 -q "${ZIP_FILE_PATH}" -d "${DOWNLOAD_DIR}"`);
    } catch (error) {
        console.error("Failed to unzip using system command. Ensure 'unzip' is installed.");
        throw error;
    }

    console.log("Cleanup...");
    fs.unlinkSync(ZIP_FILE_PATH);

    console.log(`Taxonomy downloaded and extracted to ${DOWNLOAD_DIR}`);
}

function downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: Status Code ${response.statusCode}`));
                return;
            }

            response.pipe(file);

            file.on("finish", () => {
                file.close();
                resolve();
            });
        }).on("error", (err) => {
            fs.unlink(dest, () => { });
            reject(err);
        });
    });
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
