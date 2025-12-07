import { describe, it, expect } from "vitest";
import { EdinetXbrlParser } from "../src";
import * as path from "path";

describe("EdinetXbrlParser", () => {
    const TEST_DIR = path.resolve(__dirname, "./test_data");
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

    it("parses Raccoon Holdings (3031) XBRL correctly", () => {
        const xbrlFile = path.join(TEST_DIR, "3031_raccoon.xbrl");
        const dataContainer = parser.parseFile(xbrlFile);

        // Values verified from 2024-07-30 Yuho (DocID: S100U4EY)
        // NetSales: 5,808,066,000
        // OperatingIncome: 566,962,000
        // OrdinaryIncome: 535,861,000
        // NetIncome: 325,982,000

        const netsales = dataContainer.getDataByContextRef(NETSALES_KEY, CURRENT_YEAR_DURATION_CONTEXT);
        expect(netsales).not.toBeNull();
        expect(parseInt(netsales!.value)).toBe(5808066000);

        const operatingIncome = dataContainer.getDataByContextRef("jppfs_cor:OperatingIncome", CURRENT_YEAR_DURATION_CONTEXT);
        expect(operatingIncome).not.toBeNull();
        expect(parseInt(operatingIncome!.value)).toBe(566962000);

        const ordinaryIncome = dataContainer.getDataByContextRef("jppfs_cor:OrdinaryIncome", CURRENT_YEAR_DURATION_CONTEXT);
        expect(ordinaryIncome).not.toBeNull();
        expect(parseInt(ordinaryIncome!.value)).toBe(535861000);

        const netIncome = dataContainer.getDataByContextRef("jppfs_cor:ProfitLossAttributableToOwnersOfParent", CURRENT_YEAR_DURATION_CONTEXT);
        expect(netIncome).not.toBeNull();
        expect(parseInt(netIncome!.value)).toBe(325982000);
    });

    it("extracts KeyMetrics object correctly", () => {
        // Test with Yahoo (4689)
        const yahoo = parser.parseFile(path.join(TEST_DIR, "CI_4689_yahoo.xbrl"));
        const ym = yahoo.getKeyMetrics();
        expect(ym.netSales).toBe(406793000000);
        expect(ym.operatingIncome).toBe(185012000000);
        expect(ym.netAssets).toBe(857912000000);

        // New Metrics Check (Values derived from debug/grep)
        // Yahoo uses NonConsolidated for this file
        // EPS: 23.72
        expect(ym.earningsPerShare).toBe(23.72);
        expect(ym.bookValuePerShare).toBe(150.59); // From grep
        expect(ym.numberOfIssuedShares).toBe(5695577000);
        expect(ym.equityToTotalAssetsRatio).toBe(0.804); // NonConsolidated fallback in Yahoo
        expect(ym.rateOfReturnOnEquity).toBe(0.154); // IFRS Value
        expect(ym.dividendPaidPerShare).toBe(8.86);

        // Test with Raccoon (3031)
        const raccoon = parser.parseFile(path.join(TEST_DIR, "3031_raccoon.xbrl"));
        const rm = raccoon.getKeyMetrics();
        expect(rm.netSales).toBe(5808066000);
        expect(rm.operatingCashFlow).toBe(660987000); // Consolidated value
        expect(rm.operatingIncome).toBe(566962000);
        expect(rm.netIncome).toBe(325982000);
        expect(rm.numberOfIssuedShares).toBe(22235143);
        expect(rm.equityToTotalAssetsRatio).toBe(0.311);
        expect(rm.rateOfReturnOnEquity).toBe(0.065);
        // My debug log for Raccoon: "jpcrp_cor:TotalNumberOfIssuedSharesSummaryOfBusinessResults: 20176043"
        // Let's use 20176043.
        // Wait, 18636800 might be from a different context? Latest should be 20176043.
        // I'll put 20176043 and verify.
    });
});
