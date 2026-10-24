import { describe, it, expect } from "vitest";
import { createWorkforceSnapshot, screenWorkforceDocuments, WorkforceMetricId, WORKFORCE_REGISTRY,
    EdinetXbrlParser, type WorkforceMetadata, type WorkforceDocument } from "../src/index";
import { instance, fact, standalone } from "./fixtures/metric-boundaries";
const id = WorkforceMetricId.AverageAnnualSalary;
const tag = "jpcrp_cor:AverageAnnualSalaryInformationAboutReportingCompanyInformationAboutEmployees";
const meta = (code = "1001"): WorkforceMetadata => ({ secCode: code, docID: `SYNTHETIC${code}`, scope: "NonConsolidated", accountingStandard: "J-GAAP", currency: "JPY", period: { instant: "2025-03-31" } });
type XmlOptions = { entity?: string; scope?: string; members?: string; period?: string; unit?: string; attrs?: string; extra?: string; absent?: boolean; contextExtra?: string; decimals?: string; key?: string };
function xml(raw = "120", options: XmlOptions = {}) {
    const context = `<xbrli:context id="current"><xbrli:entity><xbrli:identifier scheme="synthetic">${options.entity ?? "A"}</xbrli:identifier></xbrli:entity><xbrli:period>${options.period ?? "<xbrli:instant>2025-03-31</xbrli:instant>"}</xbrli:period>${options.scope === "Consolidated" ? "" : `<xbrli:scenario>${options.members ?? standalone}</xbrli:scenario>`}</xbrli:context>`;
    const value = fact(raw, options.attrs ?? "", options.key ?? tag).replace('decimals="INF"', `decimals="${options.decimals ?? "0"}"`);
    return instance((options.absent ? "" : value) + (options.extra ?? ""), context + (options.contextExtra ?? ""), `<xbrli:unit id="money"><xbrli:measure>${options.unit ?? "iso4217:JPY"}</xbrli:measure></xbrli:unit>`);
}
const doc = (code: string, raw = "120", options: XmlOptions = {}): WorkforceDocument => ({ xml: xml(raw, { entity: code, ...options }), metadata: meta(code) });
const select = (raw: string, options: XmlOptions = {}) => createWorkforceSnapshot(xml(raw, options), meta()).selections.averageAnnualSalary;

describe("提出会社単体の平均年間給与", () => {
    it("別registry・元タグ・単位・期末・原値・出典を保持", () => {
        const selection = select("123000", { decimals: "-3" });
        expect(selection).toMatchObject({ metricId: id, status: "selected", raw: "123000", safeNumber: 123000,
            source: { key: tag, scope: "NonConsolidated", unit: "iso4217:JPY", decimals: "-3", period: { instant: "2025-03-31" }, entity: { scheme: "synthetic", identifier: "A" } } });
        expect(Object.isFrozen(WORKFORCE_REGISTRY)).toBe(true);
        expect(Object.isFrozen(WORKFORCE_REGISTRY[id].candidates)).toBe(true);
    });
    it.each(["0", "-0", "-0.000", "+0", "123.4500"])("%sを倍率変換や欠損化せず採用", raw => {
        const selection = select(raw); expect(selection.status).toBe("selected"); expect(selection.raw).toBe(raw); expect(selection.safeNumber).toBe(Number(raw));
    });
    it.each(["-1", "-0.00000000000000000000000000001", "-9007199254740993"])("負数%sはnumber丸め前に不採用、原値は残す", raw => {
        const selection = select(raw); expect(selection).toMatchObject({ status: "unsupported", reason: "unsupported-semantics" });
        expect(selection.raw).toBeUndefined(); expect(selection.safeNumber).toBeUndefined(); expect(selection.evidence[0]).toMatchObject({ raw, reason: "unsupported-semantics" });
    });
    it.each(["9007199254740993", "0.10000000000000001"])("不安全数値%sはrawのみ保持、検索から除外", raw => {
        expect(select(raw)).toMatchObject({ status: "selected", reason: "selected-raw-only", raw, safeNumber: undefined });
        expect(screenWorkforceDocuments([doc("1001", raw)])).toMatchObject({ total: 0, excludedRows: 1, reasonCounts: { "unsafe-number": 1 } });
    });
    it("nil/欠損を0扱いしない", () => {
        expect(select("", { attrs: 'xsi:nil="true"' })).toMatchObject({ status: "missing", reason: "nil" });
        expect(select("0", { absent: true })).toMatchObject({ status: "missing", reason: "tag-absent" });
    });
    it.each(["IFRS", "US-GAAP"] as const)("%sを給与タグから推測補完しない", accountingStandard => {
        expect(createWorkforceSnapshot(xml(), { ...meta(), accountingStandard }).selections[id]).toMatchObject({ status: "unsupported", reason: "unsupported-standard" });
    });
    it("連結要求を単体へfallbackしない、連結給与は採用しない", () => {
        expect(createWorkforceSnapshot(xml(), { ...meta(), scope: "Consolidated" }).selections[id]).toMatchObject({ status: "unsupported", reason: "unsupported-semantics" });
        expect(createWorkforceSnapshot(xml("120", { scope: "Consolidated" }), { ...meta(), scope: "Consolidated" }).selections[id].status).toBe("unsupported");
        expect(select("120", { scope: "Consolidated" }).status).toBe("missing");
    });
    it.each(["xbrli:pure", "iso4217:USD", "xbrli:shares"])("単位%sを円へ変換しない", unit => {
        expect(select("120", { unit })).toMatchObject({ status: "unsupported", reason: "unsupported-unit" });
    });
    it.each(["NaN", "1e3", "", "--1"])("不正decimal %sを拒否", raw => {
        expect(select(raw).status).toBe("unsupported");
    });
    it("不正decimals・偽namespace・企業拡張を拒否", () => {
        expect(select("120", { decimals: "1.5" })).toMatchObject({ status: "unsupported", reason: "invalid-decimals" });
        const fake = xml().replace('http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2024-11-01/jpcrp_cor', 'https://example.test/jpcrp');
        expect(createWorkforceSnapshot(fake, meta()).selections[id]).toMatchObject({ status: "unsupported", reason: "unknown-namespace" });
        expect(select("120", { key: tag.replace("jpcrp_cor", "extension") }).status).not.toBe("selected");
    });
    it("期末/単体軸/追加次元を厳守", () => {
        expect(select("120", { period: '<xbrli:instant>2024-03-31</xbrli:instant>' }).reason).toBe("context-mismatch");
        expect(select("120", { period: '<xbrli:startDate>2024-04-01</xbrli:startDate><xbrli:endDate>2025-03-31</xbrli:endDate>' }).status).not.toBe("selected");
        expect(select("120", { members: standalone + '<xbrldi:explicitMember dimension="extension:RegionAxis">extension:RegionMember</xbrldi:explicitMember>' }).reason).toBe("unsupported-dimensions");
        expect(select("120", { members: standalone.replaceAll("jppfs_cor:", "extension:") }).status).not.toBe("selected");
    });
    it("同値fact重複も採用規則を緩めず曖昧", () => {
        expect(select("120", { extra: fact("120", "", tag) })).toMatchObject({ status: "ambiguous", reason: "multiple-facts" });
        const duplicate = xml().replace('</xbrli:context>', '</xbrli:context>' + xml().match(/<xbrli:context.*?<\/xbrli:context>/)![0]);
        expect(createWorkforceSnapshot(duplicate, meta()).selections[id]).toMatchObject({ status: "ambiguous", reason: "duplicate-context" });
    });
    it("文書内の複数/不明entityを不採用", () => {
        const extra = '<xbrli:context id="other"><xbrli:entity><xbrli:identifier scheme="synthetic">OTHER</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2025-03-31</xbrli:instant></xbrli:period></xbrli:context>';
        expect(select("120", { contextExtra: extra }).reason).toBe("unsupported-entity");
        expect(createWorkforceSnapshot(xml().replace('<xbrli:identifier scheme="synthetic">A</xbrli:identifier>', ''), meta()).selections[id].status).toBe("unsupported");
    });
    it("不正XML/DOCTYPE/metadata/未知IDを拒否", () => {
        for (const input of ["<broken>", '<!DOCTYPE xbrli:xbrl>' + xml()]) expect(() => createWorkforceSnapshot(input, meta())).toThrow();
        for (const change of [{ period: { instant: "2025-02-30" } }, { period: { startDate: "2024-04-01", endDate: "2025-03-31" }, periodType: "annual" }, { currency: "USD" }]) expect(() => createWorkforceSnapshot(xml(), { ...meta(), ...change } as any)).toThrow();
        const object = new EdinetXbrlParser().parse(xml());
        expect(() => object.selectWorkforceMetric("__proto__" as any, { scope: "NonConsolidated", accountingStandard: "J-GAAP", period: meta().period })).toThrow();
    });
});

describe("給与の明示複数社検索", () => {
    const documents = [doc("1003", "200"), doc("1002", "120"), doc("1001", "120"), doc("1004", "0")];
    it.each([["gte", 3], ["lte", 3], ["gt", 1], ["lt", 1], ["eq", 2]] as const)("%sの閾値境界", (operator, expected) => {
        expect(screenWorkforceDocuments(documents, { conditions: [{ metric: id, operator, value: 120 }] }).total).toBe(expected);
    });
    it("AND/安定順序/昇降順/ページ/件数を維持", () => {
        expect(screenWorkforceDocuments(documents).rows.map(r => r.metadata.secCode)).toEqual(["10010", "10020", "10030", "10040"]);
        expect(screenWorkforceDocuments(documents, { sortBy: id }).rows.map(r => r.metadata.secCode)).toEqual(["10030", "10010", "10020", "10040"]);
        expect(screenWorkforceDocuments(documents, { sortBy: id, order: "asc", offset: 1, limit: 2 })).toMatchObject({ total: 4, rows: [{ metadata: { secCode: "10010" } }, { metadata: { secCode: "10020" } }] });
        expect(screenWorkforceDocuments(documents, { limit: 0 })).toMatchObject({ total: 4, rows: [] });
        expect(screenWorkforceDocuments(documents, { conditions: [{ metric: id, operator: "gte", value: 120 }, { metric: id, operator: "lt", value: 200 }] })).toMatchObject({ total: 2, filteredRows: 2 });
    });
    it("小数の正確な原値と閾値、丸め不可値を区別", () => {
        expect(screenWorkforceDocuments([doc("1001", "0.1"), doc("1002", "0.10000000000000001"), doc("1003", "0.0000001")], { conditions: [{ metric: id, operator: "eq", value: 0.1 }] })).toMatchObject({ total: 1, excludedRows: 1, filteredRows: 1 });
        expect(screenWorkforceDocuments([doc("1001", "0.0000001")], { conditions: [{ metric: id, operator: "eq", value: 0.0000001 }] }).total).toBe(1);
    });
    it("理由別件数、条件で落ちた行と欠損行を区別", () => {
        const result = screenWorkforceDocuments([doc("1001", "0"), doc("1002", "-1"), doc("1003", "", { attrs: 'xsi:nil="true"' }), doc("1004", "9007199254740993"), doc("1005", "5", { extra: fact("5", "", tag) })], { conditions: [{ metric: id, operator: "gt", value: 0 }] });
        expect(result).toMatchObject({ total: 0, excludedRows: 4, filteredRows: 1, reasonCounts: { unsupported: 1, missing: 1, "unsafe-number": 1, ambiguous: 1 } });
        expect(result.diagnostics.every(d => d.required)).toBe(true);
    });
    it.each(["period", "scope", "accountingStandard"])("%sの混在を検索前に拒否", key => {
        const other = doc("1002"); (other.metadata as any)[key] = key === "period" ? { instant: "2024-03-31" } : key === "scope" ? "Consolidated" : "IFRS";
        expect(() => screenWorkforceDocuments([doc("1001"), other])).toThrow(/混在/);
    });
    it("code/docID/entityの重複を条件除外の前に拒否", () => {
        expect(() => screenWorkforceDocuments([doc("1001"), doc("1001")])).toThrow();
        const sameDoc = doc("1002"); sameDoc.metadata.docID = meta().docID;
        expect(() => screenWorkforceDocuments([doc("1001"), sameDoc])).toThrow();
        expect(() => screenWorkforceDocuments([doc("1001"), doc("1002", "-1", { entity: "1001" })], { conditions: [{ metric: id, operator: "gt", value: 100000 }] })).toThrow(/entity/);
        expect(() => screenWorkforceDocuments([doc("1001"), doc("1002")])).not.toThrow();
    });
    it("候補なしは理由付き除外、未知条件/順序/ページを拒否", () => {
        expect(screenWorkforceDocuments([doc("1001", "0", { absent: true })])).toMatchObject({ total: 0, excludedRows: 1, reasonCounts: { missing: 1 } });
        for (const options of [{ conditions: [{ metric: id, operator: "gte", value: NaN }] }, { conditions: [{ metric: id, operator: "gte", value: Number.MAX_SAFE_INTEGER + 1 }] }, { conditions: [{ metric: "__proto__", operator: "eq", value: 0 }] }, { sortBy: "unknown" }, { order: "down" }, { offset: -1 }, { limit: 1.5 }, { unknown: true }]) expect(() => screenWorkforceDocuments([], options as any)).toThrow();
        expect(screenWorkforceDocuments([])).toMatchObject({ total: 0, rows: [], excludedRows: 0 });
    });
});
