import { EdinetXbrlParser } from "../src/edinet-xbrl-parser";
import * as fs from "fs";
import * as path from "path";

async function main() {
    const filePath = "downloads/S100URRO/XBRL/PublicDoc/jplvh010000-lvh-001_E35223-000_2024-11-08_01_2024-11-14.xbrl";
    const absolutePath = path.resolve(__dirname, "../", filePath);

    if (!fs.existsSync(absolutePath)) {
        console.error("File not found:", absolutePath);
        return;
    }

    const xml = fs.readFileSync(absolutePath, "utf-8");
    const parser = new EdinetXbrlParser();
    const object = parser.parse(xml);
    const info = object.getLargeShareholdingInfo();

    console.log("=== Large Shareholding Info ===");
    console.log(`FilerName: ${info.filerName}`);
    console.log(`IssuerName: ${info.issuerName}`);
    console.log(`HoldingRatio: ${info.holdingRatio}`);
    console.log(`PrevHoldingRatio: ${info.prevHoldingRatio}`);

    if (info.holdingRatio !== undefined) {
        console.log("SUCCESS: Holding Ratio extracted.");
    } else {
        console.error("FAILURE: Holding Ratio is undefined.");
    }
}

main();
