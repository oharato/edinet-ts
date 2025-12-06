import { describe, it, expect } from "vitest";
import { EdinetXbrlParser } from "../src";
import * as path from "path";

describe("EdinetXbrlParser", () => {
    const TEST_DIR = path.resolve(__dirname, "../reference/tests/test_data");
    const EMPLOYEES_NUM_KEY = "jpcrp_cor:NumberOfEmployees";
    const ASSETS_NUM_KEY = "jppfs_cor:Assets";
    const NETSALES_KEY = "jppfs_cor:NetSales";

    const CURRENT_YEAR_INSTANT_CONTEXT = "CurrentYearInstant";
    const CURRENT_YEAR_DURATION_CONTEXT = "CurrentYearDuration";
    const CURRENT_YEAR_INSTANT_NON_CON_CONTEXT = "CurrentYearInstant_NonConsolidatedMember";
    const CURRENT_YEAR_DURATION_NON_CON_CONTEXT = "CurrentYearDuration_NonConsolidatedMember";

    const parser = new EdinetXbrlParser();

    it("parses Kakaku.com XBRL correctly", () => {
        const xbrlFile = path.join(TEST_DIR, "CJ_2371_kakakucom.xbrl");
        const dataContainer = parser.parseFile(xbrlFile);

        // Expected values from CJ_2371_kakakucom.yaml
        // employees_num: 727
        // assets: 42129126000
        // netsales: 45089432000

        const employees = dataContainer.getDataByContextRef(EMPLOYEES_NUM_KEY, CURRENT_YEAR_INSTANT_CONTEXT);
        expect(employees).not.toBeNull();
        expect(parseInt(employees!.value)).toBe(727);

        const assets = dataContainer.getDataByContextRef(ASSETS_NUM_KEY, CURRENT_YEAR_INSTANT_CONTEXT);
        expect(assets).not.toBeNull();
        expect(parseInt(assets!.value)).toBe(42129126000);

        const netsales = dataContainer.getDataByContextRef(NETSALES_KEY, CURRENT_YEAR_DURATION_CONTEXT);
        expect(netsales).not.toBeNull();
        expect(parseInt(netsales!.value)).toBe(45089432000);
    });

    it("parses Yahoo XBRL correctly", () => {
        const xbrlFile = path.join(TEST_DIR, "CI_4689_yahoo.xbrl");
        const dataContainer = parser.parseFile(xbrlFile);

        // Expected values from CI_4689_yahoo.yaml
        // employees_num: 5826
        // assets: 1066775000000
        // netsales: 406793000000

        const employees = dataContainer.getDataByContextRef(EMPLOYEES_NUM_KEY, CURRENT_YEAR_INSTANT_NON_CON_CONTEXT);
        expect(employees).not.toBeNull();
        expect(parseInt(employees!.value)).toBe(5826);

        const assets = dataContainer.getDataByContextRef(ASSETS_NUM_KEY, CURRENT_YEAR_INSTANT_NON_CON_CONTEXT);
        expect(assets).not.toBeNull();
        expect(parseInt(assets!.value)).toBe(1066775000000);

        const netsales = dataContainer.getDataByContextRef(NETSALES_KEY, CURRENT_YEAR_DURATION_NON_CON_CONTEXT);
        expect(netsales).not.toBeNull();
        expect(parseInt(netsales!.value)).toBe(406793000000);
    });
});
