import { EdinetXbrlDownloader } from "./src/edinet-xbrl-downloader";

async function main() {
    process.env.EDINET_DOWNLOAD_DIR = "";
    const dl1 = new EdinetXbrlDownloader("fake-key");

    try {
        await dl1.download("doc123");
        console.error("FAIL: Should have thrown error for missing targetDir");
    } catch (e: any) {
        if (e.message.includes("Target directory is not specified")) {
            console.log("PASS: Throws when missing targetDir");
        } else {
            console.error("FAIL: Threw unexpected error: " + e.message);
        }
    }

    process.env.EDINET_DOWNLOAD_DIR = "./test-downloads";
    const dl2 = new EdinetXbrlDownloader("fake-key");

    // We expect it to try to fetch (and fail on network), but NOT on missing directory
    try {
        await dl2.download("doc123");
        console.error("FAIL: Network call should have failed (unless mocked)");
    } catch (e: any) {
        if (e.message.includes("Target directory")) {
            console.error("FAIL: Should have accepted env var, but complained about missing directory");
        } else {
            console.log("PASS: Did not complain about directory (failed on network as expected: " + e.message + ")");
        }
    }
}

main();
