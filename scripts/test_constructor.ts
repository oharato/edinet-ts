import { EdinetXbrlDownloader } from "../src/edinet-xbrl-downloader";
import * as assert from "assert";

async function main() {
    console.log("=== Constructor Test (New Signature Only) ===");

    // Case 1: Config object
    console.log("1. New style: new EdinetXbrlDownloader({ apiKey: 'key2', rootDir: 'dir2' })");
    const dl2 = new EdinetXbrlDownloader({ apiKey: "key2", rootDir: "dir2" });
    if ((dl2 as any).apiKey === "key2" && (dl2 as any).rootDir === "dir2") {
        console.log("SUCCESS");
    } else {
        console.error("FAILURE", dl2);
    }

    // Case 2: Config object with only rootDir
    console.log("2. RootDir only: new EdinetXbrlDownloader({ rootDir: 'dir3' })");
    const dl3 = new EdinetXbrlDownloader({ rootDir: "dir3" });
    if ((dl3 as any).rootDir === "dir3") {
        console.log("SUCCESS");
    } else {
        console.error("FAILURE", dl3);
    }
}

main();
