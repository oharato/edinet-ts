import { EdinetXbrlParser } from "./src";
import * as path from "path";

const parser = new EdinetXbrlParser();
const file = path.resolve(__dirname, "test/test_data/CI_4689_yahoo.xbrl");
const data = parser.parseFile(file);

const keys = ["jppfs_cor:NetSales", "jpcrp_cor:NetSales", "jppfs_cor:OperatingIncome", "jpcrp_cor:OperatingIncome"];

keys.forEach(k => {
    const list = data.getDataList(k);
    if (list.length > 0) {
        console.log(`\nKey: ${k}`);
        list.forEach(d => console.log(`  Context: ${d.contextRef}, Value: ${d.value}`));
    }
});
