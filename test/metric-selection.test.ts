import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EdinetXbrlParser } from "../src/edinet-xbrl-parser";
import { METRIC_REGISTRY } from "../src/metric-registry";
import { MetricSelectionOptions, toSafeMetricNumber } from "../src/metric-selection";
import { context, fact, instance, period, standalone } from "./fixtures/metric-boundaries";
const options: MetricSelectionOptions = { accountingStandard: "J-GAAP", scope: "Consolidated", period };
const parse = (xml: string) => new EdinetXbrlParser().parse(xml);
const select = (xml = instance(), opts = options) => parse(xml).selectMetric("netSales", opts);

describe("指標辞書と厳密選択", () => {
    it("18個の安定ID・候補・型・単位・fallbackを固定する", () => {
        expect(Object.keys(METRIC_REGISTRY)).toHaveLength(18);
        for (const [id, definition] of Object.entries(METRIC_REGISTRY)) {
            expect(definition.id).toBe(id);
            expect(definition.valueType).toBe("decimal");
            expect(definition.candidates.length).toBeGreaterThan(0);
            expect(Object.isFrozen(definition.candidates)).toBe(true);
            expect(definition.fallback).toContain("no-scope-period-currency-fallback");
        }
    });
    it("原decimal・INF・namespace・period・scopeと採用理由を保持する", () => {
        expect(select()).toMatchObject({ status: "selected", raw: "123.4500", safeNumber: 123.45,
            source: { namespace: "jppfs_cor", contextRef: "current", period, dimensions: [], unit: "iso4217:JPY", decimals: "INF", nil: false }, reason: "selected" });
    });
    it.each(["9007199254740993", "123456789012345678901234567890", "0.10000000000000001", "1.000000000000000000000000000000001"])("精度を失う%sは原値だけ返す", raw => {
        expect(select(instance(fact(raw)))).toMatchObject({ status: "selected", raw, safeNumber: undefined, reason: "selected-raw-only" });
    });
    it.each(["0", "-0", "-12.5", "+00012.500", "9007199254740991", "0.0000001"])("往復が一致する%sはnumberを返す", raw => expect(toSafeMetricNumber(raw)).toBe(Number(raw)));
    it.each(["NaN", "Infinity", "1e3", "1,000", "12円", "", "1 2"])("decimalでない%sは拒否する", raw => {
        const result = select(instance(fact(raw)));
        expect(result.status).toBe("unsupported");
        expect(result.safeNumber).toBeUndefined();
    });
    it("nilをゼロや別候補で置き換えない", () => {
        expect(select(instance(fact("", 'xsi:nil="true"') + fact("99", "", "jpcrp_cor:NetSales")))).toMatchObject({ status: "missing", reason: "nil" });
    });
    it("実際のゼロを保持する", () => expect(select(instance(fact("0")))).toMatchObject({ status: "selected", safeNumber: 0 }));
    it("採用factのentity identifierとschemeを来歴に残す", () => {
        expect(select()).toMatchObject({ status: "selected", source: { entity: { identifier: "TEST", scheme: "synthetic" } } });
    });
    it.each([
        context("other").replace(">TEST<", ">OTHER<"),
        context("other").replace('scheme="synthetic"', 'scheme="other-scheme"'),
        context("other").replace(/<xbrli:entity>.*?<\/xbrli:entity>/, "")
    ])("別entityまたは不明entityのcontextがある文書は推測採用しない", other => {
        const result = select(instance(fact("999", "", "jppfs_cor:NetSales", "other"), context() + other));
        expect(result).toMatchObject({ status: "unsupported", reason: "unsupported-entity" });
        expect(result.safeNumber).toBeUndefined();
    });
    it.each([
        context().replace(/<xbrli:entity>.*?<\/xbrli:entity>/, ""),
        context().replace('scheme="synthetic"', 'scheme=""'),
        context().replace(">TEST<", "><"),
        context().replace('</xbrli:identifier>', '</xbrli:identifier><xbrli:identifier scheme="synthetic">TEST</xbrli:identifier>')
    ])("不明・重複entity identifierを厳密選択へ使わない", ctx => {
        expect(select(instance(fact(), ctx))).toMatchObject({ status: "unsupported", reason: "unsupported-entity" });
    });
    it.each([
        context().replace('</xbrli:period>', '<xbrli:instant>2025-03-31</xbrli:instant></xbrli:period>'),
        context().replace('</xbrli:startDate>', '</xbrli:startDate><xbrli:startDate>2024-04-01</xbrli:startDate>')
    ])("元contextのInstant/Duration混在や日付重複を拒否する", ctx => {
        expect(select(instance(fact(), ctx))).toMatchObject({ status: "unsupported", reason: "unsupported-context" });
    });
    it("タグ不在と期間不一致を分ける", () => {
        expect(select(instance(""))).toMatchObject({ status: "missing", reason: "tag-absent" });
        expect(select(instance(), { ...options, period: { startDate: "2023-04-01", endDate: "2024-03-31" } })).toMatchObject({ status: "missing", reason: "context-mismatch" });
    });
    it("未定義contextは推測しない", () => expect(select(instance(fact(), ""))).toMatchObject({ status: "unsupported", reason: "unknown-context" }));
    it("重複context IDを上書き値で確定しない", () => expect(select(instance(fact(), context() + context()))).toMatchObject({ status: "ambiguous", reason: "duplicate-context" }));
    it("同一contextの重複factを順序で確定しない", () => expect(select(instance(fact() + fact("5")))).toMatchObject({ status: "ambiguous", reason: "multiple-facts" }));
    it("同じperiodの別context IDも曖昧とする", () => expect(select(instance(fact() + fact("5", "", "jppfs_cor:NetSales", "copy"), context() + context("copy")))).toMatchObject({ status: "ambiguous", reason: "multiple-facts" }));
    it("外貨・不明・複合単位をJPYへ推測しない", () => {
        for (const measure of ["iso4217:USD", "extension:JPY", "xbrli:pure"]) {
            expect(select(instance(fact(), context(), `<xbrli:unit id="money"><xbrli:measure>${measure}</xbrli:measure></xbrli:unit>`))).toMatchObject({ status: "unsupported", reason: "unsupported-unit" });
        }
    });
    it("単体を明示した場合だけ単体値を採用する", () => {
        const xml = instance(fact(), context("current", standalone));
        expect(select(xml)).toMatchObject({ status: "missing", reason: "context-mismatch" });
        expect(select(xml, { ...options, scope: "NonConsolidated" })).toMatchObject({ status: "selected", safeNumber: 123.45 });
    });
    it.each(['<xbrldi:explicitMember dimension="extension:SegmentAxis">extension:SegmentMember</xbrldi:explicitMember>', '<xbrldi:typedMember dimension="extension:Axis"><extension:value>test</extension:value></xbrldi:typedMember>'])("明細次元は全社値の代わりにしない", dimensions => {
        expect(select(instance(fact(), context("current", dimensions)))).toMatchObject({ status: "unsupported", reason: "unsupported-dimensions" });
    });
    it("企業拡張local nameを標準タグの代わりにしない", () => expect(select(instance(fact("3", "", "extension:NetSales")))).toMatchObject({ status: "unsupported", reason: "unknown-namespace" }));
    it("標準prefixのURI偽装を拒否する", () => expect(select(instance().replace('http://disclosure.edinet-fsa.go.jp/taxonomy/jppfs/2024-11-01/jppfs_cor', 'https://example.test/fake'))).toMatchObject({ status: "unsupported", reason: "unknown-namespace" }));
    it("US基準は未対応としJ-GAAPへfallbackしない", () => expect(select(instance(), { ...options, accountingStandard: "US-GAAP" })).toMatchObject({ status: "unsupported", reason: "unsupported-standard" }));
    it("IFRSタグを明示基準のもとで選択する", () => {
        expect(select(instance(fact("55", "", "jpcrp_cor:RevenueIFRSSummaryOfBusinessResults")), { ...options, accountingStandard: "IFRS" })).toMatchObject({ status: "selected", safeNumber: 55 });
    });
    it("IFRS親会社持分を純資産の代用にしない", () => {
        const xml = instance(fact("5", "", "jpcrp_cor:EquityAttributableToOwnersOfParentIFRSSummaryOfBusinessResults"), '<xbrli:context id="current"><xbrli:entity><xbrli:identifier scheme="synthetic">TEST</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2025-03-31</xbrli:instant></xbrli:period></xbrli:context>');
        expect(parse(xml).selectMetric("netAssets", { ...options, accountingStandard: "IFRS", period: { instant: "2025-03-31" } })).toMatchObject({ status: "unsupported", reason: "unsupported-semantics" });
    });
    it.each([{ instant: "2025-03-31" }, { startDate: "2025-04-01", endDate: "2025-03-31" }, { startDate: "2025-02-30", endDate: "2025-03-31" }])("期間型/日付の不整合を拒否する", period => expect(select(instance(), { ...options, period })).toMatchObject({ status: "unsupported", reason: "invalid-period" }));
    it("同梱実書類の既存売上と厳密選択値が一致する", () => {
        const object = parse(readFileSync(new URL("./test_data/CJ_2371_kakakucom.xbrl", import.meta.url), "utf8"));
        expect(object.selectMetric("netSales", { ...options, period: { startDate: "2016-04-01", endDate: "2017-03-31" } })).toMatchObject({ status: "selected", safeNumber: object.getKeyMetrics().netSales });
    });
    it.each(Object.values(METRIC_REGISTRY))("$idの単位・期間型の契約を検証する", definition => {
        const unit = definition.unit === "JPY" ? "iso4217:JPY" : definition.unit === "shares" ? "xbrli:shares" : "xbrli:pure";
        const units = definition.unit === "JPY/share" ? '<xbrli:unit id="money"><xbrli:divide><xbrli:unitNumerator><xbrli:measure>iso4217:JPY</xbrli:measure></xbrli:unitNumerator><xbrli:unitDenominator><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unitDenominator></xbrli:divide></xbrli:unit>' : `<xbrli:unit id="money"><xbrli:measure>${unit}</xbrli:measure></xbrli:unit>`;
        const instant = '<xbrli:context id="current"><xbrli:entity><xbrli:identifier scheme="synthetic">TEST</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2025-03-31</xbrli:instant></xbrli:period></xbrli:context>';
        const xml = instance(fact("12.5", "", definition.candidates.find(c => c.standard === "J-GAAP")!.key), definition.periodType === "instant" ? instant : context(), units);
        expect(parse(xml).selectMetric(definition.id, { ...options, period: definition.periodType === "instant" ? { instant: "2025-03-31" } : period })).toMatchObject({ status: "selected", safeNumber: 12.5 });
    });
    it("同じ終了日の半期と通年を混ぜない", () => {
        const half = { startDate: "2024-10-01", endDate: "2025-03-31" };
        const xml = instance(fact("100") + fact("50", "", "jppfs_cor:NetSales", "half"), context() + context("half", "", half));
        expect(select(xml)).toMatchObject({ status: "selected", safeNumber: 100 });
        expect(select(xml, { ...options, period: half })).toMatchObject({ status: "selected", safeNumber: 50 });
    });
    it("採用対象外のセグメントfactも理由を保持する", () => {
        const xml = instance(fact("999", "", "jppfs_cor:NetSales", "segment") + fact("100"), context("segment", '<xbrldi:explicitMember dimension="extension:Axis">extension:Member</xbrldi:explicitMember>') + context());
        const result = select(xml);
        expect(result).toMatchObject({ status: "selected", safeNumber: 100 });
        expect(result.evidence.some(e => e.reason === "unsupported-dimensions")).toBe(true);
    });
    it("nilの別prefixと1表記を解決する", () => {
        expect(select(instance(fact("", 'xmlns:n="http://www.w3.org/2001/XMLSchema-instance" n:nil="1"')))).toMatchObject({ status: "missing", reason: "nil" });
    });
    it("単位名の局所的なnamespace偽装を拒否する", () => {
        expect(select(instance(fact(), context(), '<xbrli:unit id="money"><xbrli:measure xmlns:iso4217="https://example.test/fake">iso4217:JPY</xbrli:measure></xbrli:unit>'))).toMatchObject({ status: "unsupported", reason: "unsupported-unit" });
    });
    it("重複unit IDを上書き通貨で確定しない", () => {
        expect(select(instance(fact(), context(), '<xbrli:unit id="money"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit><xbrli:unit id="money"><xbrli:measure>iso4217:JPY</xbrli:measure></xbrli:unit>'))).toMatchObject({ status: "unsupported", reason: "unsupported-unit" });
    });
    it("contextの名前空間不明はunsupportedとする", () => {
        expect(select(instance().replace('http://www.xbrl.org/2003/instance', 'https://example.test/fake'))).toMatchObject({ status: "unsupported", reason: "unsupported-context" });
    });
    it("不明scenarioは次元なし全社値と判定しない", () => {
        expect(select(instance(fact(), context("current", '<extension:unknown>test</extension:unknown>')))).toMatchObject({ status: "unsupported", reason: "unsupported-dimensions" });
    });
    it("decimalsの原表記を保持し不正な精度を拒否する", () => {
        expect(select(instance(fact().replace('decimals="INF"', 'decimals="-6"')))).toMatchObject({ status: "selected", source: { decimals: "-6" } });
        expect(select(instance(fact().replace('decimals="INF"', 'decimals="NaN"')))).toMatchObject({ status: "unsupported", reason: "invalid-decimals" });
    });
    it("clearで重複判定も消去する", () => {
        const object = parse(instance(fact(), context() + context()));
        object.clear();
        expect(object.selectMetric("netSales", options)).toMatchObject({ status: "missing", reason: "tag-absent" });
    });

    it.each([
        '<xbrldi:explicitMember dimension="extension:OtherAxis">extension:NonConsolidatedMember</xbrldi:explicitMember>',
        '<xbrldi:explicitMember dimension="jppfs_cor:OtherAxis">jppfs_cor:NonConsolidatedMember</xbrldi:explicitMember>',
        '<xbrldi:explicitMember dimension="jppfs_cor:ConsolidatedOrNonConsolidatedAxis">extension:NonConsolidatedMember</xbrldi:explicitMember>'
    ])("未知axis/memberを単体contextへ昇格しない", member => {
        const xml = instance(fact(), context("current", member));
        expect(select(xml, { ...options, scope: "NonConsolidated" })).toMatchObject({ status: "unsupported", reason: "unsupported-dimensions" });
        // 既存APIのscope判定との互換性は維持し、新APIだけを厳密にします。
        expect(parse(xml).getKeyMetrics().netSales).toBe(123.45);
    });

    it.each(["", "https://example.test/unknown"])("unitの局所xbrli namespace変更をstrict採用しない", uri => {
        for (const units of [
            `<xbrli:unit id="money" xmlns:xbrli="${uri}"><xbrli:measure>iso4217:JPY</xbrli:measure></xbrli:unit>`,
            `<xbrli:unit id="money"><xbrli:measure xmlns:xbrli="${uri}">iso4217:JPY</xbrli:measure></xbrli:unit>`
        ]) expect(select(instance(fact(), context(), units))).toMatchObject({ status: "unsupported", reason: "unsupported-unit" });
    });

});
