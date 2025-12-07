import { EdinetXbrlDownloader } from "./src/edinet-xbrl-downloader";

async function main() {
    // 1. Fail case: No Env, No Arg
    const oldKey = process.env.EDINET_API_KEY;
    delete process.env.EDINET_API_KEY;

    try {
        new EdinetXbrlDownloader();
        console.error("FAIL: Should have thrown for missing API Key");
    } catch (e: any) {
        if (e.message.includes("API Key is required")) {
            console.log("PASS: Throws when missing API Key");
        } else {
            console.error("FAIL: Threw unexpected error: " + e.message);
        }
    }

    // 2. Success case: Arg provided
    try {
        new EdinetXbrlDownloader("test-key");
        console.log("PASS: Accepted explicit API Key");
    } catch (e) {
        console.error("FAIL: Should have accepted explicit API Key");
    }

    // 3. Success case: Env provided
    process.env.EDINET_API_KEY = "env-key";
    try {
        new EdinetXbrlDownloader();
        console.log("PASS: Accepted Env API Key");
    } catch (e) {
        console.error("FAIL: Should have accepted Env API Key");
    }

    // Restore
    if (oldKey) process.env.EDINET_API_KEY = oldKey;
    else delete process.env.EDINET_API_KEY;
}

main();
