import { describe, it, expect } from "vitest";
import { EdinetXbrlParser, AuditFeeMetricId, AUDIT_FEE_REGISTRY, createAuditFeeSnapshot, screenAuditFeeDocuments, type AuditFeeDocument } from "../src/index";
import { instance, fact, context, standalone, period } from "./fixtures/metric-boundaries";
const metric = AuditFeeMetricId.AuditReportingCompany;
const tag = (id: AuditFeeMetricId) => AUDIT_FEE_REGISTRY[id].candidates[0].key;
const metadata: AuditFeeDocument["metadata"] = { secCode: "1001", docID: "DOC1", scope: "Consolidated", accountingStandard: "J-GAAP", currency: "JPY", periodType: "annual", period };
const document = (raw = "89000000", id = metric): AuditFeeDocument => ({ xml: instance(fact(raw, "", tag(id))), metadata });
const select = (xml: string, id = metric) => new EdinetXbrlParser().parse(xml, "synthetic").selectAuditFeeMetric(id, metadata);
describe("監査/非監査報酬の区分別取得", () => {
    it.each(Object.values(AuditFeeMetricId))("%sを直接タグだけから選び、既存指標へ混ぜない", id => {
        const result = createAuditFeeSnapshot(document("12000000", id), id);
        expect(result.selection).toMatchObject({ metricId: id, status: "selected", raw: "12000000", safeNumber: 12000000, source: { key: tag(id), unit: "iso4217:JPY" } });
        expect(result.inputXmlSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(new EdinetXbrlParser().parse(document().xml, "synthetic").getKeyMetrics()).not.toHaveProperty(id);
    });
    it("提出会社・子会社・ネットワークを相互補完しない", () => {
        expect(select(instance(fact("5", "", tag(AuditFeeMetricId.AuditTotal))))).toMatchObject({ status: "missing", reason: "tag-absent" });
        expect(select(instance(fact("5", "", tag(AuditFeeMetricId.AuditReportingCompanyNetwork))))).toMatchObject({ status: "missing" });
    });
    it("完全一致重複も監査報酬では曖昧のまま", () => {
        const f = fact("10", "", tag(metric)); expect(select(instance(f + f))).toMatchObject({ status: "ambiguous", reason: "multiple-facts" });
    });
    it("nil・ダッシュ・負値を0へ置換せず、0自体は保持", () => {
        expect(select(instance(fact("", 'xsi:nil="true"', tag(metric))))).toMatchObject({ status: "missing", reason: "nil" });
        expect(createAuditFeeSnapshot(document("−"), metric).selection.status).not.toBe("selected");
        expect(createAuditFeeSnapshot(document("-5"), metric).selection).toMatchObject({ status: "unsupported", reason: "unsupported-semantics" });
        expect(createAuditFeeSnapshot(document("0"), metric).selection).toMatchObject({ status: "selected", safeNumber: 0 });
        expect(createAuditFeeSnapshot(document("-0"), metric).selection).toMatchObject({ status: "selected", safeNumber: -0 });
    });
    it("安全範囲外の原値を保持し、検索には使わない", () => {
        const d = document("9007199254740993"); expect(createAuditFeeSnapshot(d, metric).selection).toMatchObject({ status: "selected", raw: "9007199254740993", safeNumber: undefined });
        expect(screenAuditFeeDocuments([d], metric)).toMatchObject({ total: 0, excludedRows: 1, diagnostics: [{ reason: "unsafe-number" }] });
    });
    it("期間・scope・次元・通貨・namespaceを推測しない", () => {
        const f = fact("5", "", tag(metric));
        expect(select(instance(f, context("current", standalone)))).toMatchObject({ status: "missing", reason: "context-mismatch" });
        expect(select(instance(f, context("current", '<xbrldi:explicitMember dimension="extension:RowsAxis">extension:Row1Member</xbrldi:explicitMember>'))).status).not.toBe("selected");
        expect(select(instance(f).replace('iso4217:JPY</', 'iso4217:USD</')).status).not.toBe("selected");
        expect(select(instance(f).replace('taxonomy/jpcrp/2024-11-01', 'taxonomy/other/2024-11-01')).status).not.toBe("selected");
        const d = document(); d.metadata = { ...metadata, accountingStandard: "IFRS" }; expect(createAuditFeeSnapshot(d, metric).selection.reason).toBe("unsupported-standard");
    });
    it("辞書の候補を書き換えられない", () => {
        expect(Object.isFrozen(AUDIT_FEE_REGISTRY)).toBe(true); expect(Object.isFrozen(AUDIT_FEE_REGISTRY[metric].candidates[0])).toBe(true);
    });
});
describe("同じ期間・区分の監査報酬検索", () => {
    const docs = [document("5"), { ...document("10"), metadata: { ...metadata, secCode: "1002", docID: "DOC2" } }, { ...document("0"), metadata: { ...metadata, secCode: "1003", docID: "DOC3" } }];
    it.each([["gt", ["10020"]], ["gte", ["10020", "10010"]], ["lt", ["10030"]], ["lte", ["10010", "10030"]], ["eq", ["10010"]]] as const)("%sで比較し、順序とページを保つ", (operator, codes) => {
        const result = screenAuditFeeDocuments(docs, metric, { conditions: [{ operator, value: 5 }] });
        expect(result.rows.map(r => r.metadata.secCode)).toEqual(codes);
        expect(screenAuditFeeDocuments(docs, metric, { order: "asc", offset: 1, limit: 1 }).rows[0].metadata.secCode).toBe("10010");
    });
    it("比較範囲混在と重複会社を条件で隠さない", () => {
        expect(() => screenAuditFeeDocuments([docs[0], { ...docs[1], metadata: { ...docs[1].metadata, periodType: "quarter" } }], metric)).toThrow();
        expect(() => screenAuditFeeDocuments([docs[0], docs[0]], metric, { conditions: [{ operator: "gt", value: 999 }] })).toThrow();
    });
    it("空集合でも不正設定を拒否", () => {
        expect(() => screenAuditFeeDocuments([], metric, { limit: -1 })).toThrow();
        expect(() => screenAuditFeeDocuments([], metric, { conditions: [{ operator: "eq", value: NaN }] })).toThrow();
    });
});
