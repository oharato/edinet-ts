import { describe, it, expect } from "vitest";
import { WorkforceMetricId as M, WORKFORCE_REGISTRY, WORKFORCE_REGISTRY_VERSION, createWorkforceSnapshot, screenWorkforceDocuments,
    type WorkforceMetadata, EdinetXbrlParser } from "../src/index";
import { instance, fact, standalone } from "./fixtures/metric-boundaries";
const id = M.NumberOfEmployees, tag = "jpcrp_cor:NumberOfEmployees";
const meta = (code = "1001"): WorkforceMetadata => ({ secCode: code, docID: `SYNTHETIC${code}`, scope: "NonConsolidated", accountingStandard: "J-GAAP", currency: "JPY", period: { instant: "2025-03-31" } });
type Options = { entity?: string; members?: string; instant?: string; period?: string; unit?: string; key?: string; attrs?: string; extra?: string; contextExtra?: string; decimals?: string; absent?: boolean };
function xml(raw = "120", options: Options = {}) {
    const context = `<xbrli:context id="current"><xbrli:entity><xbrli:identifier scheme="synthetic">${options.entity ?? "A"}</xbrli:identifier></xbrli:entity><xbrli:period>${options.period ?? `<xbrli:instant>${options.instant ?? "2025-03-31"}</xbrli:instant>`}</xbrli:period><xbrli:scenario>${options.members ?? standalone}</xbrli:scenario></xbrli:context>`;
    const value = fact(raw, options.attrs ?? "", options.key ?? tag).replace('decimals="INF"', `decimals="${options.decimals ?? "0"}"`);
    return instance((options.absent ? "" : value) + (options.extra ?? ""), context + (options.contextExtra ?? ""), `<xbrli:unit id="money"><xbrli:measure>${options.unit ?? "xbrli:pure"}</xbrli:measure></xbrli:unit>`);
}
const select = (raw = "120", options: Options = {}) => createWorkforceSnapshot(xml(raw, options), meta(), [id]).selections.numberOfEmployees!;
const doc = (code: string, raw = "120", options: Options = {}) => ({ xml: xml(raw, { entity: code, ...options }), metadata: meta(code) });

describe("提出会社単体の従業員数（直接値のみ）", () => {
    it("元タグ・raw・pure・人向けpeople・期末・単体・出典を保持", () => {
        expect(select()).toMatchObject({ status: "selected", metricId: id, raw: "120", safeNumber: 120,
            source: { key: tag, namespaceURI: "http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2024-11-01/jpcrp_cor", unit: "xbrli:pure", decimals: "0", scope: "NonConsolidated", dimensions: ["NonConsolidatedMember"], period: { instant: "2025-03-31" }, entity: { scheme: "synthetic", identifier: "A" } } });
        expect(WORKFORCE_REGISTRY[id]).toMatchObject({ id, valueType: "decimal", valueUnit: "people", unit: "pure", periodType: "instant", candidates: [{ key: tag, standard: "J-GAAP", supported: true }] });
        expect(WORKFORCE_REGISTRY_VERSION).toBe("3"); expect(Object.isFrozen(WORKFORCE_REGISTRY[id].candidates)).toBe(true);
    });
    it.each(["0", "-0", "-0.000", "+0", "120.50", "0.0000001"])("%sを丸め/整数化/FTE推定せず保持", raw => {
        expect(select(raw)).toMatchObject({ status: "selected", raw, safeNumber: Number(raw) });
    });
    it("decimalsを値へ掛けず、原値と精度を分離", () => {
        expect(select("120", { decimals: "-3" })).toMatchObject({ status: "selected", raw: "120", safeNumber: 120, source: { decimals: "-3" } });
    });
    it.each(["-1", "-0.0000000000000000000001", "-9007199254740993"])("負数%sは丸め前に拒否しevidenceへ原値保持", raw => {
        expect(select(raw)).toMatchObject({ status: "unsupported", reason: "unsupported-semantics", evidence: [expect.objectContaining({ raw, reason: "unsupported-semantics" })] });
        expect(select(raw).raw).toBeUndefined();
    });
    it.each(["9007199254740993", "0.10000000000000001"])("不安全値%sをrawのみ保持、検索から除外", raw => {
        expect(select(raw)).toMatchObject({ status: "selected", reason: "selected-raw-only", raw, safeNumber: undefined });
        expect(screenWorkforceDocuments([doc("1001", raw)], { metricIds: [id] })).toMatchObject({ total: 0, excludedRows: 1, reasonCounts: { "unsafe-number": 1 } });
    });
    it("nil/不在を0扱いしない", () => {
        expect(select("", { attrs: 'xsi:nil="true"' })).toMatchObject({ status: "missing", reason: "nil" });
        expect(select("0", { absent: true })).toMatchObject({ status: "missing", reason: "tag-absent" });
    });
    it.each(["NumberOfEmployeesInformationAboutReportingCompanyInformationAboutEmployees", "NumberOfEmployeesSummaryOfBusinessResults", "NumberOfEmployeesOfReportingCompanyTable", "NumberOfEmployeesOfReportingCompanyLineItems", "AverageNumberOfTemporaryWorkers"])("%sで代用しない", local => {
        expect(select("120", { key: `jpcrp_cor:${local}` })).toMatchObject({ status: "missing", reason: "tag-absent" });
    });
    it("同値の複数factもambiguousのまま、合算・重複除去しない", () => {
        expect(select("120", { extra: fact("120", "", tag) })).toMatchObject({ status: "ambiguous", reason: "multiple-facts" });
        expect(select("120", { extra: fact("120", "", tag) + fact("120", "", tag) })).toMatchObject({ status: "ambiguous", reason: "multiple-facts" });
        expect(screenWorkforceDocuments([doc("1001", "120", { extra: fact("120", "", tag) })], { metricIds: [id] })).toMatchObject({ total: 0, excludedRows: 1, reasonCounts: { ambiguous: 1 } });
    });
    it("context自体の同値重複も曖昧", () => {
        const input = xml().replace('</xbrli:context>', '</xbrli:context>' + xml().match(/<xbrli:context.*?<\/xbrli:context>/)![0]);
        expect(createWorkforceSnapshot(input, meta(), [id]).selections[id]).toMatchObject({ status: "ambiguous", reason: "duplicate-context" });
    });
    it.each(["iso4217:JPY", "xbrli:shares", "iso4217:USD"])("measure%sを人数へ変換しない", unit => {
        expect(select("120", { unit })).toMatchObject({ status: "unsupported", reason: "unsupported-unit" });
    });
    it("正規namespace・正規単体軸・全社だけを採用", () => {
        const fakeNamespace = xml().replace('http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2024-11-01/jpcrp_cor', 'https://example.test/fake');
        expect(createWorkforceSnapshot(fakeNamespace, meta(), [id]).selections[id]?.reason).toBe("unknown-namespace");
        expect(select("120", { key: "extension:NumberOfEmployees" }).reason).toBe("unknown-namespace");
        expect(select("120", { members: standalone.replaceAll("jppfs_cor:", "extension:") }).status).not.toBe("selected");
        expect(select("120", { members: standalone + '<xbrldi:explicitMember dimension="extension:SegmentsAxis">extension:SegmentMember</xbrldi:explicitMember>' }).reason).toBe("unsupported-dimensions");
        expect(select("120", { members: "" }).status).not.toBe("selected");
    });
    it.each(["IFRS", "US-GAAP"] as const)("%sへ範囲拡張しない", accountingStandard => {
        expect(createWorkforceSnapshot(xml(), { ...meta(), accountingStandard }, [id]).selections[id]?.reason).toBe("unsupported-standard");
    });
    it("期末・範囲のfallbackなし、通貨制約を維持", () => {
        expect(select("120", { instant: "2024-03-31" }).reason).toBe("context-mismatch");
        expect(select("120", { period: '<xbrli:startDate>2024-04-01</xbrli:startDate><xbrli:endDate>2025-03-31</xbrli:endDate>' }).status).not.toBe("selected");
        expect(createWorkforceSnapshot(xml(), { ...meta(), scope: "Consolidated" }, [id]).selections[id]?.reason).toBe("unsupported-semantics");
        expect(() => createWorkforceSnapshot(xml(), { ...meta(), currency: "USD" } as any, [id])).toThrow();
    });
});

describe("従業員数の明示複数社検索と互換", () => {
    const documents = [doc("1003", "200"), doc("1002", "120.5"), doc("1001", "120.5"), doc("1004", "0")];
    it.each([["gte", 3], ["lte", 3], ["gt", 1], ["lt", 1], ["eq", 2]] as const)("%sの小数閾値、未使用給与欠損は任意", (operator, expected) => {
        const result = screenWorkforceDocuments(documents, { metricIds: [id], conditions: [{ metric: id, operator, value: 120.5 }] });
        expect(result).toMatchObject({ total: expected, excludedRows: 0, filteredRows: 4 - expected, reasonCounts: { missing: 4 } });
        expect(result.diagnostics.every(d => d.metric === M.AverageAnnualSalary && !d.required)).toBe(true);
    });
    it("条件AND/昇降順/tie/ページ/0limit/小額閾値", () => {
        expect(screenWorkforceDocuments(documents, { metricIds: [id] }).rows.map(r => r.metadata.secCode)).toEqual(["10010", "10020", "10030", "10040"]);
        expect(screenWorkforceDocuments(documents, { metricIds: [id], sortBy: id }).rows.map(r => r.metadata.secCode)).toEqual(["10030", "10010", "10020", "10040"]);
        expect(screenWorkforceDocuments(documents, { metricIds: [id], sortBy: id, order: "asc", offset: 1, limit: 1 })).toMatchObject({ total: 4, rows: [{ metadata: { secCode: "10010" } }] });
        expect(screenWorkforceDocuments(documents, { metricIds: [id], conditions: [{ metric: id, operator: "gte", value: 120 }, { metric: id, operator: "lt", value: 200 }] })).toMatchObject({ total: 2, filteredRows: 2 });
        expect(screenWorkforceDocuments(documents, { metricIds: [id], limit: 0 })).toMatchObject({ total: 4, rows: [] });
        expect(screenWorkforceDocuments([doc("1001", "0.0000001")], { metricIds: [id], conditions: [{ metric: id, operator: "eq", value: 0.0000001 }] }).total).toBe(1);
    });
    it("給与既定返値/採用条件とyearsの型・意味を変更しない", () => {
        const salary = xml("120", { key: WORKFORCE_REGISTRY.averageAnnualSalary.candidates[0].key, unit: "iso4217:JPY" });
        expect(Object.keys(createWorkforceSnapshot(salary, meta()).selections)).toEqual(["averageAnnualSalary"]);
        expect(screenWorkforceDocuments([{ xml: salary, metadata: meta() }])).toMatchObject({ total: 1, diagnostics: [] });
        const years = createWorkforceSnapshot(xml("12.5", { key: WORKFORCE_REGISTRY.averageAgeYears.candidates[0].key }), meta(), [M.AverageAgeYears]);
        expect(years.selections.averageAgeYears?.raw).toBe("12.5"); expect(years.selections.numberOfEmployees).toBeUndefined();
        expect(WORKFORCE_REGISTRY.averageAgeYears.valueUnit).toBe("years"); expect(WORKFORCE_REGISTRY.averageLengthOfServiceYears.valueUnit).toBe("years");
    });
    it("新項目は明示時のみ返し、cond/sortはprojection subset", () => {
        expect(createWorkforceSnapshot(xml(), meta()).selections.numberOfEmployees).toBeUndefined();
        const selected = createWorkforceSnapshot(xml(), meta(), [id]); expect(Object.keys(selected.selections)).toEqual(["averageAnnualSalary", "numberOfEmployees"]);
        expect(selected.selections.averageAnnualSalary.metricId).toBe("averageAnnualSalary");
        expect(() => screenWorkforceDocuments(documents, { sortBy: id })).toThrow(/metricIds/);
        expect(() => screenWorkforceDocuments(documents, { conditions: [{ metric: id, operator: "eq", value: 0 }] })).toThrow(/metricIds/);
        expect(() => screenWorkforceDocuments(documents, { metricIds: [id], sortBy: M.AverageAnnualSalary })).toThrow(/metricIds/);
    });
    it("requiredがないとrequestedを要求、条件等があれば使用項目だけ要求", () => {
        const options = { metricIds: [id, M.AverageAgeYears] };
        expect(screenWorkforceDocuments([doc("1001")], options)).toMatchObject({ total: 0, excludedRows: 1 });
        expect(screenWorkforceDocuments([doc("1001")], { ...options, sortBy: id })).toMatchObject({ total: 1, excludedRows: 0 });
    });
    it("企業/期間の混在と同一entity転用を検索前に拒否", () => {
        expect(() => screenWorkforceDocuments([doc("1001"), doc("1001")], { metricIds: [id] })).toThrow();
        expect(() => screenWorkforceDocuments([doc("1001", "1", { entity: "SAME" }), doc("1002", "1", { entity: "SAME" })], { metricIds: [id] })).toThrow(/entity/);
        const other = doc("1002"); other.metadata.period.instant = "2024-03-31";
        expect(() => screenWorkforceDocuments([doc("1001"), other], { metricIds: [id] })).toThrow(/混在/);
    });
    it("nil/負値/unsafe/重複と条件不一致の件数を区別", () => {
        const rows = [doc("1001", "0"), doc("1002", "", { attrs: 'xsi:nil="true"' }), doc("1003", "-1"), doc("1004", "9007199254740993"), doc("1005", "1", { extra: fact("1", "", tag) })];
        const result = screenWorkforceDocuments(rows, { metricIds: [id], conditions: [{ metric: id, operator: "gt", value: 0 }] });
        expect(result).toMatchObject({ total: 0, excludedRows: 4, filteredRows: 1 });
        expect(result.diagnostics.filter(d => d.metric === id).map(d => [d.reason, d.required])).toEqual([["missing", true], ["unsupported", true], ["unsafe-number", true], ["ambiguous", true]]);
    });
});
