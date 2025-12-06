import { EdinetXbrlParser } from "./src";
import * as path from "path";

const parser = new EdinetXbrlParser();
const files = [
    path.resolve(__dirname, "test/test_data/CI_4689_yahoo.xbrl"),
    path.resolve(__dirname, "test/test_data/3031_raccoon.xbrl")
];

files.forEach(file => {
    console.log(`\nScanning ${path.basename(file)}...`);
    const data = parser.parseFile(file);
    const keys = (data as any).dataMap.keys(); // Hack to access private map

    const relevantKeys = Array.from(keys).filter((k: any) =>
        k.includes("CashProvided") ||
        k.includes("Earnings") ||
        k.includes("PerShare") ||
        k.includes("CashAndCashEquivalents")
    );

    relevantKeys.sort().forEach((k: any) => {
        const d = data.getDataList(k);
        // Show first value found
        console.log(`- ${k}: ${(d[0] && d[0].value) || "empty"} (Count: ${d.length})`);
    });
});
