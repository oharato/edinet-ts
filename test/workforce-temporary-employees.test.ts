import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { WorkforceMetricId as M, WORKFORCE_REGISTRY, WORKFORCE_REGISTRY_VERSION, createWorkforceSnapshot, screenWorkforceDocuments,
    type WorkforceMetadata } from "../src/index";
import { instance, fact, standalone } from "./fixtures/metric-boundaries";
const id = M.AverageNumberOfTemporaryEmployees, tag = "jpcrp_cor:AverageNumberOfTemporaryWorkers";
const meta = (code = "1001"): WorkforceMetadata => ({ secCode: code, docID: `SYNTHETIC${code}`, scope: "NonConsolidated", accountingStandard: "J-GAAP", currency: "JPY", period: { instant: "2025-03-31" } });
type Options = { entity?: string; members?: string; instant?: string; period?: string; unit?: string; key?: string; attrs?: string; extra?: string; decimals?: string; absent?: boolean };
function xml(raw = "6", options: Options = {}) {
    const context = `<xbrli:context id="current"><xbrli:entity><xbrli:identifier scheme="synthetic">${options.entity ?? "A"}</xbrli:identifier></xbrli:entity><xbrli:period>${options.period ?? `<xbrli:instant>${options.instant ?? "2025-03-31"}</xbrli:instant>`}</xbrli:period><xbrli:scenario>${options.members ?? standalone}</xbrli:scenario></xbrli:context>`;
    const value = fact(raw, options.attrs ?? "", options.key ?? tag).replace('decimals="INF"', `decimals="${options.decimals ?? "0"}"`);
    return instance((options.absent ? "" : value) + (options.extra ?? ""), context, `<xbrli:unit id="money"><xbrli:measure>${options.unit ?? "xbrli:pure"}</xbrli:measure></xbrli:unit>`);
}
const select = (raw = "6", options: Options = {}) => createWorkforceSnapshot(xml(raw, options), meta(), [id]).selections.averageNumberOfTemporaryEmployees!;
const doc = (code: string, raw = "6", options: Options = {}) => ({ xml: xml(raw, { entity: code, ...options }), metadata: meta(code) });

describe("提出会社単体の平均臨時雇用人員（直接値のみ）", () => {
    it("元タグ・raw・pure・people・期末・単体・出典を保持し、registry版は4", () => {
        expect(select()).toMatchObject({ status: "selected", metricId: id, raw: "6", safeNumber: 6,
            source: { key: tag, unit: "xbrli:pure", decimals: "0", scope: "NonConsolidated", dimensions: ["NonConsolidatedMember"], period: { instant: "2025-03-31" } } });
        expect(WORKFORCE_REGISTRY[id]).toMatchObject({ id, valueType: "decimal", valueUnit: "people", unit: "pure", periodType: "instant", candidates: [{ key: tag, standard: "J-GAAP", supported: true }] });
        expect(WORKFORCE_REGISTRY_VERSION).toBe("4");
    });
    it.each(["0", "6.5", "0.0000001"])("平均値%sを整数化・FTE換算せず保持", raw => {
        expect(select(raw)).toMatchObject({ status: "selected", raw, safeNumber: Number(raw) });
    });
    it("負数・nil/不在・代替タグ・同値重複は従業員数と同じ規則", () => {
        expect(select("-1")).toMatchObject({ status: "unsupported", reason: "unsupported-semantics" });
        expect(select("", { attrs: 'xsi:nil="true"' })).toMatchObject({ status: "missing", reason: "nil" });
        expect(select("6", { absent: true })).toMatchObject({ status: "missing", reason: "tag-absent" });
        expect(select("6", { key: "jpcrp_cor:NumberOfEmployees" })).toMatchObject({ status: "missing", reason: "tag-absent" });
        expect(select("6", { extra: fact("6", "", tag).replace('decimals="INF"', 'decimals="0"') })).toMatchObject({ status: "selected", reason: "selected-identical-duplicates", raw: "6" });
        expect(select("6", { extra: fact("7", "", tag) })).toMatchObject({ status: "ambiguous", reason: "multiple-facts" });
        expect(select("6", { unit: "iso4217:JPY" })).toMatchObject({ status: "unsupported", reason: "unsupported-unit" });
        expect(select("6", { members: "" }).status).not.toBe("selected");
    });
    it("既定は給与のみで、新項目は明示時のみ返す", () => {
        expect(createWorkforceSnapshot(xml(), meta()).selections.averageNumberOfTemporaryEmployees).toBeUndefined();
        const selected = createWorkforceSnapshot(xml(), meta(), [id]);
        expect(Object.keys(selected.selections)).toEqual(["averageAnnualSalary", "averageNumberOfTemporaryEmployees"]);
        expect(() => screenWorkforceDocuments([doc("1001")], { sortBy: id })).toThrow(/metricIds/);
    });
    it("明示複数社検索の条件・並び・ページ", () => {
        const documents = [doc("1003", "9"), doc("1002", "6.5"), doc("1001", "6.5"), doc("1004", "0")];
        expect(screenWorkforceDocuments(documents, { metricIds: [id], conditions: [{ metric: id, operator: "gte", value: 6.5 }] })).toMatchObject({ total: 3, excludedRows: 0, filteredRows: 1 });
        expect(screenWorkforceDocuments(documents, { metricIds: [id], sortBy: id, order: "asc", offset: 1, limit: 1 })).toMatchObject({ total: 4, rows: [{ metadata: { secCode: "10010" } }] });
    });
});

describe("実原本fixture（3031ラクーン有報）での平均臨時雇用人員", () => {
    it("単体・当期末の同値3人が2か所に現れるため、同一重複として採用する", () => {
        // 実原本では、提出会社単体・当期末の平均臨時雇用人員「3」が文書内の2か所に同値で現れます。
        // 人的資本の方針により、完全に同一の重複は理由を付けて1件として採用します。
        // 全社文脈の6人やセグメント別内訳（1人・2人）は候補に混ざりません。
        const xmlText = readFileSync(new URL("./test_data/3031_raccoon.xbrl", import.meta.url), "utf8");
        const metadata: WorkforceMetadata = { secCode: "3031", docID: "SYNTHETIC-RACCOON", scope: "NonConsolidated", accountingStandard: "J-GAAP", currency: "JPY", period: { instant: "2024-04-30" } };
        const snapshot = createWorkforceSnapshot(xmlText, metadata, [id, M.NumberOfEmployees]);
        const temp = snapshot.selections.averageNumberOfTemporaryEmployees!;
        expect(temp).toMatchObject({ status: "selected", reason: "selected-identical-duplicates", raw: "3", safeNumber: 3 });
        expect(temp.evidence.filter(e => e.raw === "3").length).toBeGreaterThanOrEqual(2);
        // 従業員数100人も同じ表の繰り返しで2か所に現れ、同じ規則で採用します。
        const employees = snapshot.selections.numberOfEmployees!;
        expect(employees).toMatchObject({ status: "selected", reason: "selected-identical-duplicates", raw: "100", safeNumber: 100 });
        expect(employees.evidence.filter(e => e.raw === "100").length).toBeGreaterThanOrEqual(2);
    });
});
