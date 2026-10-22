import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EdinetXbrlParser } from "../src/edinet-xbrl-parser";
import { BALANCE_SHEET_REGISTRY } from "../src/balance-sheet-registry";
import { METRIC_REGISTRY } from "../src/metric-registry";
import type { MetricSelectionOptions } from "../src/metric-selection";
import { fact, instance, standalone } from "./fixtures/metric-boundaries";
const instant = "2025-03-31";
const options: MetricSelectionOptions = { accountingStandard: "J-GAAP", scope: "Consolidated", period: { instant } };
const context = (id = "current", members = "", date = instant) => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="synthetic">TEST</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>${date}</xbrli:instant></xbrli:period>${members ? `<xbrli:scenario>${members}</xbrli:scenario>` : ""}</xbrli:context>`;
const parse = (xml: string) => new EdinetXbrlParser().parse(xml);
const definitions = Object.values(BALANCE_SHEET_REGISTRY);
const segment = '<xbrldi:explicitMember dimension="extension:SegmentAxis">extension:SegmentMember</xbrldi:explicitMember>';

describe("J-GAAP BS直接factの正規化", () => {
    it("BS3科目の辞書を主要18指標から分離しfreezeする", () => {
        expect(Object.keys(METRIC_REGISTRY)).toHaveLength(18);
        expect(Object.keys(BALANCE_SHEET_REGISTRY)).toEqual(["currentAssets", "currentLiabilities", "totalLiabilities"]);
        expect(Object.isFrozen(BALANCE_SHEET_REGISTRY)).toBe(true);
        for (const d of definitions) {
            expect(d).toMatchObject({ valueType: "decimal", unit: "JPY", periodType: "instant" });
            expect(Object.isFrozen(d)).toBe(true);
            expect(Object.isFrozen(d.candidates)).toBe(true);
            expect(Object.isFrozen(d.candidates[0])).toBe(true);
        }
    });
    it("3科目を独立した直接factとして返し合算しない", () => {
        const object = parse(instance(definitions.map((d, i) => fact(["120", "40", "80"][i], "", d.candidates[0].key)).join(""), context()));
        expect(definitions.map(d => object.selectBalanceSheetMetric(d.id, options).safeNumber)).toEqual([120, 40, 80]);
        expect(object.getKeyMetrics()).not.toHaveProperty("currentAssets");
    });
    describe.each(definitions)("$id", definition => {
        const key = definition.candidates[0].key;
        const f = (raw = "120.00", attrs = "", ctx = "current") => fact(raw, attrs, key, ctx);
        const select = (facts = f(), contexts = context(), opts = options, units?: string) => parse(instance(facts, contexts, units)).selectBalanceSheetMetric(definition.id, opts);
        it("原値と完全な来歴を返す", () => {
            expect(select()).toMatchObject({ metricId: definition.id, status: "selected", raw: "120.00", safeNumber: 120,
                source: { entity: { identifier: "TEST", scheme: "synthetic" }, key, namespace: "jppfs_cor", contextRef: "current", period: { instant }, scope: "Consolidated", dimensions: [], unit: "iso4217:JPY", decimals: "INF", nil: false } });
        });
        it.each(["0", "-10"])("有効な%sを保持する", raw => expect(select(f(raw))).toMatchObject({ status: "selected", raw, safeNumber: Number(raw) }));
        it("巨大整数はrawのみ返す", () => expect(select(f("9007199254740993"))).toMatchObject({ status: "selected", raw: "9007199254740993", safeNumber: undefined, reason: "selected-raw-only" }));
        it("nil・空・不在を0に変換しない", () => {
            expect(select(f("", 'xsi:nil="true"'))).toMatchObject({ status: "missing", reason: "nil" });
            expect(select(f(""))).toMatchObject({ status: "unsupported", reason: "raw-unavailable" });
            expect(select("")).toMatchObject({ status: "missing", reason: "tag-absent" });
        });
        it("連結と単体を混ぜない", () => {
            const facts = f("50", "", "solo");
            const contexts = context() + context("solo", standalone);
            expect(select(facts, contexts)).toMatchObject({ status: "missing", reason: "context-mismatch" });
            expect(select(facts, contexts, { ...options, scope: "NonConsolidated" })).toMatchObject({ status: "selected", safeNumber: 50 });
        });
        it("前期だけのfactは当期へfallbackしない", () => {
            expect(select(f("80", "", "prior"), context() + context("prior", "", "2024-03-31"))).toMatchObject({ status: "missing", reason: "context-mismatch" });
        });
        it("全社値だけ採用し明細/調整項目を合算しない", () => {
            const result = select(f("80") + f("30", "", "segment"), context() + context("segment", segment));
            expect(result).toMatchObject({ status: "selected", safeNumber: 80 });
            expect(result.evidence.some(e => e.reason === "unsupported-dimensions")).toBe(true);
            expect(select(f(), context("current", segment))).toMatchObject({ status: "unsupported", reason: "unsupported-dimensions" });
        });
        it("単体に追加明細次元があれば拒否する", () => expect(select(f(), context("current", standalone + segment), { ...options, scope: "NonConsolidated" })).toMatchObject({ status: "unsupported", reason: "unsupported-dimensions" }));
        it.each(["IFRS", "US-GAAP"] as const)("%s宣言ならJ-GAAPタグでも未対応", accountingStandard => expect(select(f(), context(), { ...options, accountingStandard })).toMatchObject({ status: "unsupported", reason: "unsupported-standard" }));
        it("entity不明・別entityの同居は拒否する", () => {
            expect(select(f(), context().replace('<xbrli:entity><xbrli:identifier scheme="synthetic">TEST</xbrli:identifier></xbrli:entity>', ''))).toMatchObject({ status: "unsupported", reason: "unsupported-entity" });
            expect(select(f(), context() + context("other").replace('>TEST<', '>OTHER<'))).toMatchObject({ status: "unsupported", reason: "unsupported-entity" });
        });
        it("instantとdurationが併存するcontextは拒否する", () => {
            const invalid = context().replace('</xbrli:period>', '<xbrli:startDate>2024-04-01</xbrli:startDate><xbrli:endDate>2025-03-31</xbrli:endDate></xbrli:period>');
            expect(select(f(), invalid)).toMatchObject({ status: "unsupported", reason: "unsupported-context" });
        });
        it("Duration/不正時点は拒否する", () => {
            expect(select(f(), context(), { ...options, period: { startDate: "2024-04-01", endDate: instant } })).toMatchObject({ status: "unsupported", reason: "invalid-period" });
            expect(select(f(), context(), { ...options, period: { instant: "2025-02-30" } })).toMatchObject({ status: "unsupported", reason: "invalid-period" });
            const duration = '<xbrli:context id="current"><xbrli:period><xbrli:startDate>2024-04-01</xbrli:startDate><xbrli:endDate>2025-03-31</xbrli:endDate></xbrli:period></xbrli:context>';
            expect(select(f(), duration)).toMatchObject({ status: "missing", reason: "context-mismatch" });
        });
        it.each(["iso4217:USD", "xbrli:pure", "extension:JPY"])("%sをJPYへ推測しない", unit => expect(select(f(), context(), options, `<xbrli:unit id="money"><xbrli:measure>${unit}</xbrli:measure></xbrli:unit>`)).toMatchObject({ status: "unsupported", reason: "unsupported-unit" }));
        it("未定義unit/contextを推測しない", () => {
            expect(select(f(), context(), options, "")).toMatchObject({ status: "unsupported", reason: "unsupported-unit" });
            expect(select(f(), "")).toMatchObject({ status: "unsupported", reason: "unknown-context" });
        });
        it("未知namespaceとURI偽装を採用しない", () => {
            expect(select(fact("1", "", key.replace("jppfs_cor:", "extension:")))).toMatchObject({ status: "unsupported", reason: "unknown-namespace" });
            expect(parse(instance(f(), context()).replace("http://disclosure.edinet-fsa.go.jp/taxonomy/jppfs/2024-11-01/jppfs_cor", "https://example.test/fake")).selectBalanceSheetMetric(definition.id, options)).toMatchObject({ status: "unsupported", reason: "unknown-namespace" });
        });
        it.each(["120.00", "99"])("重複factは同値/異値とも曖昧: %s", raw => expect(select(f() + f(raw))).toMatchObject({ status: "ambiguous", reason: "multiple-facts" }));
        it("別contextの同一期末も曖昧、重複context IDも曖昧", () => {
            expect(select(f() + f("99", "", "copy"), context() + context("copy"))).toMatchObject({ status: "ambiguous", reason: "multiple-facts" });
            expect(select(f(), context() + context())).toMatchObject({ status: "ambiguous", reason: "duplicate-context" });
        });
    });
    it("負債純資産合計や小計を負債総額に代用しない", () => {
        const object = parse(instance(fact("200", "", "jppfs_cor:LiabilitiesAndNetAssets") + fact("70", "", "extension:LiabilitiesOtherThanLiabilitiesDirectlyAssociatedWithAssetsHeldForSaleIFRS"), context()));
        expect(object.selectBalanceSheetMetric("totalLiabilities", options)).toMatchObject({ status: "missing", reason: "tag-absent" });
    });
    it.each(["CJ_2371_kakakucom.xbrl", "S100TMMG/XBRL/PublicDoc/jpcrp030000-asr-001_E02367-000_2024-03-31_01_2024-06-28.xbrl"])("保存原本%sの3項目と連結/単体の来歴を突合する", name => {
        const object = parse(readFileSync(new URL(`./test_data/${name}`, import.meta.url), "utf8"));
        for (const scope of ["Consolidated", "NonConsolidated"] as const) {
            const id = scope === "Consolidated" ? "CurrentYearInstant" : "CurrentYearInstant_NonConsolidatedMember";
            const ctx = object.findContexts({ type: "Instant", scope }).find(c => c.id === id)!;
            expect(ctx).toBeDefined();
            for (const d of definitions) {
                const original = object.getDataByContextRef(d.candidates[0].key, id)!;
                expect(original).not.toBeNull();
                const selected = object.selectBalanceSheetMetric(d.id, { accountingStandard: "J-GAAP", scope, period: { instant: ctx.period.instant! } });
                expect(selected).toMatchObject({ status: "selected", raw: original.rawValue, source: { key: original.key, contextRef: id, namespaceURI: original.namespaceURI, period: ctx.period, entity: ctx.entity, scope, unitRef: original.unitRef, unit: "iso4217:JPY", decimals: original.rawDecimals } });
                expect(selected.safeNumber).toBe(Number(original.rawValue));
            }
        }
    });
    it("保存原本の同一context負債総額の重複も曖昧として来歴を残す", () => {
        const object = parse(readFileSync(new URL("./test_data/3031_raccoon.xbrl", import.meta.url), "utf8"));
        const ctx = object.findContexts({ type: "Instant", scope: "Consolidated" }).find(c => c.id === "CurrentYearInstant")!;
        const originals = object.getDataList("jppfs_cor:Liabilities").filter(f => f.contextRef === ctx.id);
        expect(originals.length).toBeGreaterThan(1);
        const result = object.selectBalanceSheetMetric("totalLiabilities", { ...options, period: { instant: ctx.period.instant! } });
        expect(result).toMatchObject({ status: "ambiguous", reason: "multiple-facts" });
        expect(result.evidence.filter(e => e.contextRef === ctx.id).map(e => e.raw)).toEqual(originals.map(f => f.rawValue));
        expect(result.evidence.some(e => e.reason === "unsupported-dimensions")).toBe(true);
    });
    it("IFRS書類の単体jppfsを連結IFRSとして採用しない", () => {
        const object = parse(readFileSync(new URL("./test_data/CI_4689_yahoo.xbrl", import.meta.url), "utf8"));
        const ctx = object.findContexts({ type: "Instant", scope: "NonConsolidated" }).find(c => c.id === "CurrentYearInstant_NonConsolidatedMember")!;
        for (const d of definitions) expect(object.selectBalanceSheetMetric(d.id, { accountingStandard: "IFRS", scope: "Consolidated", period: { instant: ctx.period.instant! } })).toMatchObject({ status: "unsupported", reason: "unsupported-standard" });
    });
});
