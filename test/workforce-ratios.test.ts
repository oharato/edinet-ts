import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createWorkforceSnapshot, screenWorkforceDocuments, WorkforceMetricId as M, WORKFORCE_REGISTRY } from "../src/index";
import { instance, fact, standalone } from "./fixtures/metric-boundaries";
const mappings = [["femaleManagerRatio", "RatioOfFemaleEmployeesInManagerialPositionsMetricsOfReportingCompany"], ["maleChildcareLeaveOrdinanceItem1AllRatio", "AllEmployeesCalculatedBasedOnProvisionsOfArticle714Item1OfOrdinanceForEnforcementOfActOnChildcareLeaveCaregiverLeaveAndOtherMeasuresForTheWelfareOfWorkersCaringForChildrenOrOtherFamilyMembersRatioOfMaleEmployeesTakingChildcareLeaveMetricsOfReportingCompany"], ["maleChildcareLeaveOrdinanceItem1RegularRatio", "RegularEmployeesCalculatedBasedOnProvisionsOfArticle714Item1OfOrdinanceForEnforcementOfActOnChildcareLeaveCaregiverLeaveAndOtherMeasuresForTheWelfareOfWorkersCaringForChildrenOrOtherFamilyMembersRatioOfMaleEmployeesTakingChildcareLeaveMetricsOfReportingCompany"], ["maleChildcareLeaveOrdinanceItem1NonRegularRatio", "NonRegularEmployeesCalculatedBasedOnProvisionsOfArticle714Item1OfOrdinanceForEnforcementOfActOnChildcareLeaveCaregiverLeaveAndOtherMeasuresForTheWelfareOfWorkersCaringForChildrenOrOtherFamilyMembersRatioOfMaleEmployeesTakingChildcareLeaveMetricsOfReportingCompany"], ["maleChildcareLeaveOrdinanceItem2AllRatio", "AllEmployeesCalculatedBasedOnProvisionsOfArticle714Item2OfOrdinanceForEnforcementOfActOnChildcareLeaveCaregiverLeaveAndOtherMeasuresForTheWelfareOfWorkersCaringForChildrenOrOtherFamilyMembersRatioOfMaleEmployeesTakingChildcareLeaveMetricsOfReportingCompany"], ["maleChildcareLeaveWomensActAllRatio", "AllEmployeesCalculatedBasedOnProvisionsOfActOnPromotionOfWomensActiveEngagementInProfessionalLifeRatioOfMaleEmployeesTakingChildcareLeaveMetricsOfReportingCompany"], ["genderWageAllRatio", "AllEmployeesDifferencesInWagesBetweenMaleAndFemaleEmployeesMetricsOfReportingCompany"], ["genderWageRegularRatio", "RegularEmployeesDifferencesInWagesBetweenMaleAndFemaleEmployeesMetricsOfReportingCompany"], ["genderWageNonRegularRatio", "NonRegularEmployeesDifferencesInWagesBetweenMaleAndFemaleEmployeesMetricsOfReportingCompany"]] as const;
const ids = mappings.map(([id]) => id);
const context = (members = standalone) => `<xbrli:context id="current"><xbrli:entity><xbrli:identifier scheme="synthetic">A</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2025-03-31</xbrli:instant></xbrli:period><xbrli:scenario>${members}</xbrli:scenario></xbrli:context>`;
const xml = (raw = "0.25") => instance(mappings.map(([, tag]) => fact(raw, "", `jpcrp_cor:${tag}`)).join(""), context(), '<xbrli:unit id="money"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit>');
const metadata = { secCode: "1001", docID: "SYNTHETIC1", scope: "NonConsolidated" as const, accountingStandard: "J-GAAP" as const, currency: "JPY" as const, period: { instant: "2025-03-31" } };
describe("人的資本比率は定義・労働者区分ごとに直接取得", () => {
    it.each(mappings)("%sは直接タグ%s、1=100%の値を保持", (id, tag) => {
        const result = createWorkforceSnapshot(xml(), metadata, [id]);
        expect(result.selections[id]).toMatchObject({ status: "selected", raw: "0.25", safeNumber: 0.25, source: { key: `jpcrp_cor:${tag}`, unit: "xbrli:pure" } });
        expect(WORKFORCE_REGISTRY[id].valueUnit).toBe("ratio");
    });
    it("給与の既定返値を増やさず、未使用給与の欠損で比率を除外しない", () => {
        expect(Object.keys(createWorkforceSnapshot(xml(), metadata).selections)).toEqual(["averageAnnualSalary"]);
        expect(screenWorkforceDocuments([{ xml: xml(), metadata }], { metricIds: [M.FemaleManagerRatio], conditions: [{ metric: M.FemaleManagerRatio, operator: "gte", value: 0.25 }] })).toMatchObject({ total: 1, excludedRows: 0 });
    });
    it("別法令・別労働者区分・子会社タグで穴埋めしない", () => {
        const tag = mappings[1][1];
        const input = instance(fact("0.5", "", `jpcrp_cor:${tag}`), context(), '<xbrli:unit id="money"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit>');
        const result = createWorkforceSnapshot(input, metadata, ids);
        expect(result.selections.maleChildcareLeaveOrdinanceItem1AllRatio!.status).toBe("selected");
        expect(result.selections.maleChildcareLeaveOrdinanceItem1RegularRatio!.status).toBe("missing");
        expect(result.selections.maleChildcareLeaveOrdinanceItem2AllRatio!.status).toBe("missing");
        expect(result.selections.maleChildcareLeaveWomensActAllRatio!.status).toBe("missing");
    });
    it.each(["0", "1.2", "9007199254740993"])("raw%sを倍率変換せず保持", raw => {
        const result = createWorkforceSnapshot(xml(raw), metadata, [M.GenderWageAllRatio]);
        expect(result.selections.genderWageAllRatio).toMatchObject({ status: "selected", raw });
    });
    it.each(["-0.1", "25%", "－"])("%sを有効な比率へ変換しない", raw => {
        expect(createWorkforceSnapshot(xml(raw), metadata, [M.GenderWageAllRatio]).selections.genderWageAllRatio!.status).not.toBe("selected");
    });
    it("余分な会社行次元を提出会社全体へ混ぜない", () => {
        const input = xml().replace('</xbrli:scenario>', '<xbrldi:explicitMember dimension="extension:RowAxis">extension:Row1Member</xbrldi:explicitMember></xbrli:scenario>');
        expect(createWorkforceSnapshot(input, metadata, [M.FemaleManagerRatio]).selections.femaleManagerRatio!.status).not.toBe("selected");
    });
    it("ラクーンの会社行だけの比率を単体全体へ推測採用しない", () => {
        const input = readFileSync(new URL("./test_data/3031_raccoon.xbrl", import.meta.url), "utf8");
        const result = createWorkforceSnapshot(input, { ...metadata, period: { instant: "2024-04-30" } }, [M.FemaleManagerRatio]);
        expect(result.selections.femaleManagerRatio!.status).not.toBe("selected");
    });
});
