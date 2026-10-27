import { describe, it, expect } from "vitest";
import { EdinetXbrlParser } from "../src/edinet-xbrl-parser";
import { IFRS_BALANCE_SHEET_REGISTRY, IFRS_BALANCE_SHEET_REGISTRY_VERSION, IfrsBalanceSheetMetricId } from "../src/ifrs-balance-sheet-registry";
import { BALANCE_SHEET_REGISTRY, BALANCE_SHEET_REGISTRY_VERSION } from "../src/balance-sheet-registry";
import { METRIC_REGISTRY } from "../src/metric-registry";
import type { MetricSelectionOptions } from "../src/metric-selection";
import { instance, fact, standalone } from "./fixtures/metric-boundaries";
const instant = "2026-03-31";
const options: MetricSelectionOptions = { accountingStandard: "IFRS", scope: "Consolidated", period: { instant } };
const context = (id = "current", members = "", date = instant, entity = "SYNTHETIC") => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="synthetic">${entity}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>${date}</xbrli:instant></xbrli:period>${members ? `<xbrli:scenario>${members}</xbrli:scenario>` : ""}</xbrli:context>`;
const namespace = (date = "2025-11-01") => `http://disclosure.edinet-fsa.go.jp/taxonomy/jpigp/${date}/jpigp_cor`;
function xml(facts: string, contexts = context(), uri = namespace(), units?: string) {
    return instance(facts, contexts, units).replace('<xbrli:xbrl ', `<xbrli:xbrl xmlns:jpigp_cor="${uri}" xmlns:ifrs-full="https://xbrl.ifrs.org/taxonomy/2017-03-09/ifrs-full" `);
}
const parse = (text: string) => new EdinetXbrlParser().parse(text);
const definitions = Object.values(IFRS_BALANCE_SHEET_REGISTRY);
const segment = '<xbrldi:explicitMember dimension="extension:SegmentAxis">extension:SegmentMember</xbrldi:explicitMember>';

describe("IFRS連結の貸借対照表3項目（公式定義を基にした合成fixture）", () => {
    it("別辞書をfreezeし、J-GAAP版1/18指標/候補を変更しない", () => {
        expect(IFRS_BALANCE_SHEET_REGISTRY_VERSION).toBe("1"); expect(BALANCE_SHEET_REGISTRY_VERSION).toBe("1");
        expect(Object.keys(METRIC_REGISTRY)).toHaveLength(18); expect(Object.isFrozen(IfrsBalanceSheetMetricId)).toBe(true); expect(Object.isFrozen(IFRS_BALANCE_SHEET_REGISTRY)).toBe(true);
        expect(definitions.map(d => d.candidates[0].key)).toEqual(["jpigp_cor:CurrentAssetsIFRS", "jpigp_cor:TotalCurrentLiabilitiesIFRS", "jpigp_cor:LiabilitiesIFRS"]);
        for (const definition of definitions) {
            expect(definition).toMatchObject({ unit: "JPY", periodType: "instant", valueType: "decimal" });
            expect(Object.isFrozen(definition)).toBe(true); expect(Object.isFrozen(definition.candidates)).toBe(true); expect(Object.isFrozen(definition.candidates[0])).toBe(true);
        }
        expect(Object.values(BALANCE_SHEET_REGISTRY).every(d => d.candidates.length === 1 && d.candidates[0].key.startsWith("jppfs_cor:"))).toBe(true);
    });
    describe.each(definitions)("$id", definition => {
        const key = definition.candidates[0].key;
        const f = (raw = "120.00", attrs = "", ctx = "current", tag = key) => fact(raw, attrs, tag, ctx);
        const select = (facts = f(), contexts = context(), opts = options, uri = namespace(), units?: string) => parse(xml(facts, contexts, uri, units)).selectIfrsBalanceSheetMetric(definition.id, opts);
        it.each([["2018-03-31", "2019-03-31"], ["2025-11-01", instant]])("公式namespace版%sで直接値と来歴を保持する", (date, fiscalEnd) => {
            const result = select(f(), context("current", "", fiscalEnd), { ...options, period: { instant: fiscalEnd } }, namespace(date));
            expect(result).toMatchObject({ metricId: definition.id, status: "selected", raw: "120.00", safeNumber: 120, reason: "selected", source: {
                key, namespace: "jpigp_cor", namespaceURI: namespace(date), contextRef: "current", scope: "Consolidated", period: { instant: fiscalEnd },
                entity: { scheme: "synthetic", identifier: "SYNTHETIC" }, unit: "iso4217:JPY", unitRef: "money", decimals: "INF", nil: false, dimensions: []
            } });
        });
        it.each(["0", "-10", "0.1250"])("報告値%sを0補完・絶対値化しない", raw => {
            expect(select(f(raw))).toMatchObject({ status: "selected", raw, safeNumber: Number(raw) });
        });
        it.each(["9007199254740993", "0.10000000000000001"])("数値往復できない%sは原値だけを返す", raw => {
            expect(select(f(raw))).toMatchObject({ status: "selected", raw, reason: "selected-raw-only", safeNumber: undefined });
        });
        it("欠損・nil・空を0にしない", () => {
            expect(select("")).toMatchObject({ status: "missing", reason: "tag-absent" });
            expect(select(f("", 'xsi:nil="true"'))).toMatchObject({ status: "missing", reason: "nil" });
            expect(select(f(""))).toMatchObject({ status: "unsupported", reason: "raw-unavailable" });
        });
        it.each(["1e2", "not-a-number", "1,000"])("不正decimal%sを拒否する", raw => {
            expect(select(f(raw))).toMatchObject({ status: "unsupported", reason: "invalid-decimal" });
        });
        it("不正decimalsを拒否する", () => {
            expect(select(f().replace('decimals="INF"', 'decimals="1.5"'))).toMatchObject({ status: "unsupported", reason: "invalid-decimals" });
        });
        it.each(["J-GAAP", "US-GAAP"] as const)("%s宣言は未対応とする", accountingStandard => {
            expect(select(f(), context(), { ...options, accountingStandard })).toMatchObject({ status: "unsupported", reason: "unsupported-standard", evidence: [] });
        });
        it("単体を明示しても採用せず、単体contextを連結へ流用しない", () => {
            expect(select(f(), context("current", standalone), { ...options, scope: "NonConsolidated" })).toMatchObject({ status: "unsupported", reason: "unsupported-semantics" });
            expect(select(f(), context("current", standalone))).toMatchObject({ status: "missing", reason: "context-mismatch" });
        });
        it("別期末/duration/不正日付を採用しない", () => {
            expect(select(f(), context("current", "", "2025-03-31"))).toMatchObject({ status: "missing", reason: "context-mismatch" });
            expect(select(f(), context(), { ...options, period: { startDate: "2025-04-01", endDate: instant } })).toMatchObject({ status: "unsupported", reason: "invalid-period" });
            expect(select(f(), context(), { ...options, period: { instant: "2026-02-30" } })).toMatchObject({ status: "unsupported", reason: "invalid-period" });
        });
        it("明細を全社値として合算しない", () => {
            expect(select(f(), context("current", segment))).toMatchObject({ status: "unsupported", reason: "unsupported-dimensions" });
            expect(select(f() + f("30", "", "segment"), context() + context("segment", segment))).toMatchObject({ status: "selected", safeNumber: 120 });
        });
        it.each(["iso4217:USD", "xbrli:pure", "extension:JPY"])("単位%sをJPYへ換算・推測しない", measure => {
            expect(select(f(), context(), options, namespace(), `<xbrli:unit id="money"><xbrli:measure>${measure}</xbrli:measure></xbrli:unit>`)).toMatchObject({ status: "unsupported", reason: "unsupported-unit" });
        });
        it("未定義unit/contextを推測しない", () => {
            expect(select(f(), context(), options, namespace(), "")).toMatchObject({ status: "unsupported", reason: "unsupported-unit" });
            expect(select(f(), "")).toMatchObject({ status: "unsupported", reason: "unknown-context" });
        });
        it.each(["https://example.test/fake", namespace("2017-03-31"), namespace("2018-03-30"), namespace("2025-02-30"), "http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2025-11-01/jpigp_cor"])("偽/導入前/不正namespace%sを拒否する", uri => {
            expect(select(f(), context(), options, uri)).toMatchObject({ status: "unsupported", reason: "unknown-namespace" });
        });
        it("同名企業拡張を標準タグの代わりにしない", () => {
            expect(select(f("1", "", "current", key.replace("jpigp_cor:", "extension:")))).toMatchObject({ status: "unsupported", reason: "unknown-namespace" });
        });
        it("entity不明/混在を拒否する", () => {
            const unknown = context().replace('<xbrli:entity><xbrli:identifier scheme="synthetic">SYNTHETIC</xbrli:identifier></xbrli:entity>', "");
            expect(select(f(), unknown)).toMatchObject({ status: "unsupported", reason: "unsupported-entity" });
            expect(select(f(), context() + context("other", "", instant, "OTHER"))).toMatchObject({ status: "unsupported", reason: "unsupported-entity" });
        });
        it("完全に同一の重複factは同一重複として採用する", () => {
            expect(select(f() + f("120.00"))).toMatchObject({ status: "selected", reason: "selected-identical-duplicates", raw: "120.00" });
        });
        it("値の違う重複fact%sを曖昧とする", () => {
            expect(select(f() + f("99"))).toMatchObject({ status: "ambiguous", reason: "multiple-facts" });
        });
        it("重複context ID/同一期末別contextも曖昧とする", () => {
            expect(select(f(), context() + context())).toMatchObject({ status: "ambiguous", reason: "duplicate-context" });
            expect(select(f() + f("99", "", "copy"), context() + context("copy"))).toMatchObject({ status: "ambiguous", reason: "multiple-facts" });
        });
        it("scope getterの再読で単体を採用しない", () => {
            let reads = 0;
            const changing = { ...options, get scope() { return ++reads === 1 ? "Consolidated" as const : "NonConsolidated" as const; } };
            const result = select(f(), context("current", standalone), changing);
            expect(result).toMatchObject({ status: "missing", reason: "context-mismatch" }); expect(reads).toBe(1);
        });
        it("会計基準と期間3項目のgetterを各1回だけ読み固定する", () => {
            const reads = { standard: 0, period: 0, instant: 0, startDate: 0, endDate: 0 };
            const capturedPeriod = {
                get instant() { return ++reads.instant === 1 ? instant : "2025-03-31"; },
                get startDate() { return ++reads.startDate === 1 ? undefined : "2025-04-01"; },
                get endDate() { return ++reads.endDate === 1 ? undefined : instant; }
            };
            const changing = {
                get accountingStandard() { return ++reads.standard === 1 ? "IFRS" as const : "J-GAAP" as const; },
                scope: "Consolidated" as const,
                get period() { ++reads.period; return capturedPeriod as MetricSelectionOptions["period"]; }
            };
            expect(select(f(), context(), changing)).toMatchObject({ status: "selected", safeNumber: 120 });
            expect(reads).toEqual({ standard: 1, period: 1, instant: 1, startDate: 1, endDate: 1 });
        });
        it("snapshot時に不正なinstant/duration混在を捨てない", () => {
            expect(select(f(), context(), { ...options, period: { instant, startDate: "2025-04-01", endDate: instant } } as unknown as MetricSelectionOptions)).toMatchObject({ status: "unsupported", reason: "invalid-period" });
        });
        it("既存J-GAAP選択はIFRSタグを採用しない", () => {
            const object = parse(xml(f(), context()));
            expect(object.selectBalanceSheetMetric(definition.id, { ...options, accountingStandard: "J-GAAP" })).toMatchObject({ status: "missing", reason: "tag-absent" });
        });
    });
    it("内訳・非流動・負債資本合計から不足値を計算しない", () => {
        const facts = ["jpigp_cor:NonCurrentAssetsIFRS", "jpigp_cor:EquityAndLiabilitiesIFRS", "jpigp_cor:OtherCurrentLiabilitiesCLIFRS"].map(key => fact("123", "", key)).join("");
        const object = parse(xml(facts));
        for (const id of Object.values(IfrsBalanceSheetMetricId)) expect(object.selectIfrsBalanceSheetMetric(id, options)).toMatchObject({ status: "missing", reason: "tag-absent" });
    });
    it("旧ifrs-fullタグを代用しない", () => {
        const object = parse(xml(["CurrentAssets", "CurrentLiabilities", "Liabilities"].map(name => fact("120", "", `ifrs-full:${name}`)).join("")));
        for (const id of Object.values(IfrsBalanceSheetMetricId)) expect(object.selectIfrsBalanceSheetMetric(id, options)).toMatchObject({ status: "missing", reason: "tag-absent" });
    });
    it("型を迂回した不正IDを拒否する", () => {
        const object = parse(xml("")); expect(() => object.selectIfrsBalanceSheetMetric("__proto__" as any, options)).toThrow("不正なIFRS");
    });
});
