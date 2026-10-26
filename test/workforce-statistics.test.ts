import { describe, it, expect } from "vitest";
import { WorkforceMetricId as M, WORKFORCE_REGISTRY, WORKFORCE_REGISTRY_VERSION, createWorkforceSnapshot, screenWorkforceDocuments,
    EdinetXbrlParser, type WorkforceMetadata, type WorkforceMetricId } from "../src/index";
import { instance, fact, standalone } from "./fixtures/metric-boundaries";
const ids = [M.AverageAgeYears, M.AverageLengthOfServiceYears];
const metadata = (code = "1001"): WorkforceMetadata => ({ secCode: code, docID: `SYNTHETIC${code}`, scope: "NonConsolidated", accountingStandard: "J-GAAP", currency: "JPY", period: { instant: "2025-03-31" } });
function xml(values: Partial<Record<WorkforceMetricId, string>> = {}, options: { entity?: string; members?: string; period?: string; unit?: string; attrs?: string; duplicate?: WorkforceMetricId; contextExtra?: string } = {}) {
    const contexts = `<xbrli:context id="current"><xbrli:entity><xbrli:identifier scheme="synthetic">${options.entity ?? "A"}</xbrli:identifier></xbrli:entity><xbrli:period>${options.period ?? '<xbrli:instant>2025-03-31</xbrli:instant>'}</xbrli:period><xbrli:scenario>${options.members ?? standalone}</xbrli:scenario></xbrli:context>`;
    const facts = Object.entries(values).map(([key, raw]) => fact(raw, options.attrs ?? "", WORKFORCE_REGISTRY[key as WorkforceMetricId].candidates[0].key)).join("");
    const duplicate = options.duplicate ? fact(values[options.duplicate], "", WORKFORCE_REGISTRY[options.duplicate].candidates[0].key) : "";
    return instance(facts + duplicate, contexts + (options.contextExtra ?? ""), `<xbrli:unit id="money"><xbrli:measure>${options.unit ?? "xbrli:pure"}</xbrli:measure></xbrli:unit>`);
}
const doc = (code: string, values: Partial<Record<WorkforceMetricId, string>>, options: Parameters<typeof xml>[1] = {}) => ({ xml: xml(values, { entity: code, ...options }), metadata: metadata(code) });

describe.each(ids)("人的資本の年値 %s", id => {
    const select = (value = "12.3", options: Parameters<typeof xml>[1] = {}) => createWorkforceSnapshot(xml({ [id]: value }, options), metadata(), [id]).selections[id]!;
    it("正確な元タグ・pure・年・単体・期末・原値を保持", () => {
        expect(select()).toMatchObject({ status: "selected", metricId: id, raw: "12.3", safeNumber: 12.3,
            source: { key: WORKFORCE_REGISTRY[id].candidates[0].key, unit: "xbrli:pure", scope: "NonConsolidated", period: { instant: "2025-03-31" } } });
        expect(WORKFORCE_REGISTRY[id]).toMatchObject({ valueType: "decimal", unit: "pure", valueUnit: "years", periodType: "instant" });
        expect(WORKFORCE_REGISTRY_VERSION).toBe("4");
        expect(Object.isFrozen(WORKFORCE_REGISTRY[id])).toBe(true);
    });
    it.each(["0", "-0", "-0.000", "0.0000001"])("%sは有効、年のまま保持", value => {
        expect(select(value)).toMatchObject({ status: "selected", raw: value, safeNumber: Number(value) });
    });
    it.each(["-0.00000000000000000000001", "-9007199254740993"])("負数%sは原値を残して不採用", value => {
        expect(select(value)).toMatchObject({ status: "unsupported", reason: "unsupported-semantics", evidence: [expect.objectContaining({ raw: value, reason: "unsupported-semantics" })] });
    });
    it("nil/同値重複/不安全値を0にしない", () => {
        expect(select("", { attrs: 'xsi:nil="true"' })).toMatchObject({ status: "missing", reason: "nil" });
        expect(select("12.3", { duplicate: id })).toMatchObject({ status: "ambiguous", reason: "multiple-facts" });
        expect(select("0.10000000000000001")).toMatchObject({ status: "selected", reason: "selected-raw-only", safeNumber: undefined });
    });
    it.each(["iso4217:JPY", "xbrli:shares"])("単位%sから年への換算をしない", unit => {
        expect(select("12.3", { unit })).toMatchObject({ status: "unsupported", reason: "unsupported-unit" });
    });
    it("月タグから補完せず、月値へ換算しない", () => {
        const yearsXml = xml({ [id]: "12.3" });
        const monthsXml = yearsXml.replace(id === M.AverageAgeYears ? /AverageAgeYears/g : /AverageLengthOfServiceYears/g,
            id === M.AverageAgeYears ? "AverageAgeMonths" : "AverageLengthOfServiceMonths");
        expect(createWorkforceSnapshot(monthsXml, metadata(), [id]).selections[id]).toMatchObject({ status: "missing", reason: "tag-absent" });
        expect(select("12.3").raw).toBe("12.3");
    });
    it("連結・IFRS・期間値・追加次元・偽namespaceは採用しない", () => {
        expect(createWorkforceSnapshot(xml({ [id]: "12.3" }), { ...metadata(), scope: "Consolidated" }, [id]).selections[id]?.reason).toBe("unsupported-semantics");
        expect(createWorkforceSnapshot(xml({ [id]: "12.3" }), { ...metadata(), accountingStandard: "IFRS" }, [id]).selections[id]?.reason).toBe("unsupported-standard");
        expect(select("12.3", { period: '<xbrli:startDate>2024-04-01</xbrli:startDate><xbrli:endDate>2025-03-31</xbrli:endDate>' }).status).not.toBe("selected");
        expect(select("12.3", { members: standalone + '<xbrldi:explicitMember dimension="extension:SegmentAxis">extension:SegmentMember</xbrldi:explicitMember>' }).reason).toBe("unsupported-dimensions");
        expect(createWorkforceSnapshot(xml({ [id]: "12.3" }).replace('http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2024-11-01/jpcrp_cor', 'https://example.test/fake'), metadata(), [id]).selections[id]?.reason).toBe("unknown-namespace");
    });
    it.each([["gte", 2], ["lte", 2], ["gt", 1], ["lt", 1], ["eq", 1]] as const)("%s閾値と給与欠損の任意診断", (operator, count) => {
        const result = screenWorkforceDocuments([doc("1001", { [id]: "12.2" }), doc("1002", { [id]: "12.3" }), doc("1003", { [id]: "12.4" })], {
            metricIds: [id], conditions: [{ metric: id, operator, value: 12.3 }]
        });
        expect(result).toMatchObject({ total: count, excludedRows: 0, filteredRows: 3 - count, reasonCounts: { missing: 3 } });
        expect(result.diagnostics.every(d => d.metric === M.AverageAnnualSalary && !d.required)).toBe(true);
    });
    it("小さい小数閾値・不安全値除外・安定順/ページ", () => {
        const documents = [doc("1003", { [id]: "20.1" }), doc("1002", { [id]: "12.3" }), doc("1001", { [id]: "12.3" }), doc("1004", { [id]: "0.10000000000000001" })];
        const result = screenWorkforceDocuments(documents, { metricIds: [id], sortBy: id, order: "asc", offset: 1, limit: 1 });
        expect(result).toMatchObject({ total: 3, excludedRows: 1, rows: [{ metadata: { secCode: "10020" } }] });
        expect(screenWorkforceDocuments([doc("1001", { [id]: "0.0000001" })], { metricIds: [id], conditions: [{ metric: id, operator: "eq", value: 0.0000001 }] }).total).toBe(1);
    });
});

describe("給与の互換と明示projection", () => {
    it("既定は給与fieldのみ、年齢/勤続欠損の診断や採用条件を追加しない", () => {
        const input = xml({ averageAnnualSalary: "120" }, { unit: "iso4217:JPY" });
        const snapshot = createWorkforceSnapshot(input, metadata());
        expect(Object.keys(snapshot.selections)).toEqual(["averageAnnualSalary"]);
        expect(screenWorkforceDocuments([{ xml: input, metadata: metadata() }])).toMatchObject({ total: 1, excludedRows: 0, diagnostics: [], reasonCounts: { missing: 0 } });
        expect(WORKFORCE_REGISTRY.averageAnnualSalary.valueUnit).toBe("JPY");
    });
    it("給与は常に返却し、新項目の選択は明示したものだけ", () => {
        const snapshot = createWorkforceSnapshot(xml({ averageAgeYears: "12.3", averageLengthOfServiceYears: "4.5" }), metadata(), [M.AverageAgeYears]);
        expect(Object.keys(snapshot.selections)).toEqual(["averageAnnualSalary", "averageAgeYears"]);
        expect(snapshot.selections.averageAnnualSalary.status).toBe("missing");
        expect(snapshot.selections.averageAgeYears?.status).toBe("selected");
    });
    it("cond/sortなしではrequested全項目が必須、返却専用給与は任意", () => {
        const documents = [doc("1001", { averageAgeYears: "12.3" })];
        expect(screenWorkforceDocuments(documents, { metricIds: [M.AverageAgeYears] })).toMatchObject({ total: 1, excludedRows: 0 });
        expect(screenWorkforceDocuments(documents, { metricIds: ids })).toMatchObject({ total: 0, excludedRows: 1 });
        const result = screenWorkforceDocuments(documents, { metricIds: ids, sortBy: M.AverageAgeYears });
        expect(result).toMatchObject({ total: 1, excludedRows: 0 });
        expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ metric: M.AverageAnnualSalary, required: false }), expect.objectContaining({ metric: M.AverageLengthOfServiceYears, required: false })]));
    });
    it("条件/sortがあればその項目だけ必須、ただし明示projectionに含む", () => {
        const documents = [doc("1001", { averageAgeYears: "12.3" })];
        expect(screenWorkforceDocuments(documents, { metricIds: [M.AverageAnnualSalary, M.AverageAgeYears], conditions: [{ metric: M.AverageAgeYears, operator: "gte", value: 12 }] }).total).toBe(1);
        expect(() => screenWorkforceDocuments(documents, { sortBy: M.AverageAgeYears })).toThrow(/metricIds/);
        expect(() => screenWorkforceDocuments(documents, { metricIds: [M.AverageAgeYears], sortBy: M.AverageAnnualSalary })).toThrow(/metricIds/);
        expect(() => screenWorkforceDocuments(documents, { conditions: [{ metric: M.AverageAgeYears, operator: "eq", value: 12.3 }] })).toThrow(/metricIds/);
    });
    it("projectionの空/重複/未知/非配列を拒否、入力を変更しない", () => {
        for (const metricIds of [[], [M.AverageAgeYears, M.AverageAgeYears], ["unknown"], "averageAgeYears"]) {
            expect(() => createWorkforceSnapshot(xml(), metadata(), metricIds as any)).toThrow();
            expect(() => screenWorkforceDocuments([], { metricIds: metricIds as any })).toThrow();
        }
        const requested = Object.freeze([M.AverageAgeYears]); createWorkforceSnapshot(xml(), metadata(), requested); expect(requested).toEqual([M.AverageAgeYears]);
    });
    it("疎配列/undefined要素をsnapshotと空/非空検索で拒否", () => {
        for (const metricIds of [new Array(1), [undefined], [M.AverageAgeYears, undefined]]) {
            expect(() => createWorkforceSnapshot(xml(), metadata(), metricIds as any)).toThrow(/metricIds/);
            expect(() => screenWorkforceDocuments([], { metricIds: metricIds as any })).toThrow(/metricIds/);
            expect(() => screenWorkforceDocuments([doc("1001", { averageAgeYears: "12.3" })], { metricIds: metricIds as any })).toThrow(/metricIds/);
        }
    });
    it("給与欠損でも年齢候補の同一entity別code転用を拒否", () => {
        expect(() => screenWorkforceDocuments([doc("1001", { averageAgeYears: "12.3" }, { entity: "SAME" }), doc("1002", { averageAgeYears: "12.3" }, { entity: "SAME" })], { metricIds: [M.AverageAgeYears] })).toThrow(/entity/);
        const later = doc("1002", { averageAgeYears: "12.3" }); later.metadata.period.instant = "2024-03-31";
        expect(() => screenWorkforceDocuments([doc("1001", { averageAgeYears: "12.3" }), later], { metricIds: [M.AverageAgeYears] })).toThrow(/混在/);
    });
    it("複数条件のANDと新項目欠損の除外を区別", () => {
        const result = screenWorkforceDocuments([doc("1001", { averageAgeYears: "12.3", averageLengthOfServiceYears: "4.5" }), doc("1002", { averageAgeYears: "13.3", averageLengthOfServiceYears: "5.5" }), doc("1003", { averageAgeYears: "12.3" })], {
            metricIds: ids, conditions: [{ metric: M.AverageAgeYears, operator: "gte", value: 12 }, { metric: M.AverageLengthOfServiceYears, operator: "lte", value: 5 }]
        });
        expect(result).toMatchObject({ total: 1, excludedRows: 1, filteredRows: 1 });
    });
});
