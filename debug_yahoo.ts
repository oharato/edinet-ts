import { EdinetXbrlParser } from "./src";
import * as path from "path";

const parser = new EdinetXbrlParser();
const file = path.resolve(__dirname, "test/test_data/CI_4689_yahoo.xbrl");

console.log(`Parsing ${file}...`);
const data = parser.parseFile(file);

const key = "jppfs_cor:NetSales";
const list = data.getDataList(key);

console.log(`\nChecking key: '${key}'`);
console.log(`Found ${list.length} entries.`);
list.forEach(d => {
    console.log(`- ContextRef: '${d.contextRef}', Value: ${d.value}`);
});

const metrics = data.getKeyMetrics();
console.log("\nMetrics extracted:", metrics);
