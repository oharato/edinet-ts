import { describe, it, expect } from "vitest";
import { calculateCagr, screenCagr, CagrMetricId as C, calculatePerShareGrowth, screenPerShareGrowth, PerShareGrowthMetricId as G } from "../src/index";
import { fact } from "./fixtures/metric-boundaries";
import { point, pair, proofKey } from "./fixtures/per-share";
describe("確認された株式基準のEPS/実績配当", () => {
    it.each([["eps", G.EarningsPerShare, C.EarningsPerShare], ["dividend", G.DividendPerShare, C.DividendPerShare]] as const)("%sの前年比とCAGRを別のexactで返す", (kind, growth, cagr) => {
        expect(calculatePerShareGrowth(pair(kind), growth)).toMatchObject({ status: "calculated", value: 0.2, exact: { numerator: "1", denominator: "5" }, current: { shareBasis: { status: "reference-matched", declaration: "source-reviewed-by-caller" } } });
        expect(calculateCagr([point(2023, "10", kind), point(2024, "11", kind), point(2025, "12.1", kind)], cagr)).toMatchObject({ status: "calculated", exact: { numerator: "121", denominator: "100", root: 2 } });
    });
    it("EPS前年比は前年正なら損失も扱い、CAGRの負終値と区別する", () => {
        const data = pair(); data.current = point(2025, "-10");
        expect(calculatePerShareGrowth(data, G.EarningsPerShare)).toMatchObject({ status: "calculated", value: -2, exact: { numerator: "-2", denominator: "1" } });
        expect(calculateCagr([data.previous, data.current], C.EarningsPerShare)).toMatchObject({ status: "unavailable", reason: "negative-input" });
        expect(screenPerShareGrowth([data], G.EarningsPerShare, { conditions: [{ operator: "lt", value: -1.5 }] }).total).toBe(1);
        expect(screenPerShareGrowth([data], G.EarningsPerShare, { conditions: [{ operator: "gte", value: -1.5 }] }).total).toBe(0);
    });
    it("0配当への減配は-1、負配当・前年0/負EPSは計算不可", () => {
        expect(calculatePerShareGrowth({ previous: point(2024, "10", "dividend"), current: point(2025, "0", "dividend") }, G.DividendPerShare)).toMatchObject({ value: -1 });
        expect(calculatePerShareGrowth({ previous: point(2024, "10", "dividend"), current: point(2025, "-1", "dividend") }, G.DividendPerShare).status).toBe("unavailable");
        for (const raw of ["0", "-10"]) expect(calculatePerShareGrowth({ previous: point(2024, raw), current: point(2025) }, G.EarningsPerShare).status).toBe("unavailable");
    });
    it.each(["missing", "unknown", "basis-date", "hash", "namespace", "nil-proof", "future-basis", "wrong-context"])("%sの根拠を推測しない", kind => {
        const data: any = pair();
        if (kind === "missing") delete data.current.shareBasis;
        if (kind === "unknown") data.current.shareBasis = { state: "unknown" };
        if (kind === "basis-date") data.current.shareBasis.basisDate = "2025-04-01";
        if (kind === "hash") data.current.shareBasis.proof.rawSha256 = "a".repeat(64);
        if (kind === "namespace") data.current.xml = data.current.xml.replace(`<${proofKey} contextRef="filing">`, `<${proofKey} xmlns:jpcrp_cor="https://example.test/extension" contextRef="filing">`);
        if (kind === "nil-proof") data.current.xml = data.current.xml.replace(`<${proofKey} contextRef="filing">`, `<${proofKey} contextRef="filing" xsi:nil="true">`);
        if (kind === "future-basis") data.current.shareBasis.basisDate = "2027-04-01";
        if (kind === "wrong-context") data.current.shareBasis.proof.contextRef = "MISSING";
        expect(calculatePerShareGrowth(data, G.EarningsPerShare).status).toBe("unavailable");
    });
    it.each(["proposed", "unknown", undefined])("配当状態%sを支払済み実績へ昇格しない", state => {
        const data = pair("dividend"); if (data.current.shareBasis.state === "confirmed") data.current.shareBasis.dividendStatus = state;
        expect(calculatePerShareGrowth(data, G.DividendPerShare)).toMatchObject({ status: "unavailable", reason: state === "proposed" ? "proposed-dividend" : "unverified-dividend-status" });
    });
    it("一致重複は採用するが、異値・精度違い・nil混在は採用しない", () => {
        const data = pair(), tag = "jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults";
        const extra = fact("12", "", tag, "annual"); data.current.xml = data.current.xml.replace('</xbrli:xbrl>', extra + '</xbrli:xbrl>');
        expect(calculatePerShareGrowth(data, G.EarningsPerShare)).toMatchObject({ status: "calculated", current: { selection: { reason: "selected-identical-duplicates" } } });
        data.current.xml = data.current.xml.replace(extra, extra.replace('decimals="INF"', 'decimals="0"'));
        expect(calculatePerShareGrowth(data, G.EarningsPerShare).status).toBe("unavailable");
    });
    it("3年には4期間を要求し、中間期の未確認basisも落とさない", () => {
        const values = [point(2022, "10"), point(2023, "11"), point(2024, "12"), point(2025, "13")];
        expect(calculateCagr(values, C.EarningsPerShare)).toMatchObject({ years: 3, exact: { numerator: "13", denominator: "10", root: 3 } });
        values[1].shareBasis = { state: "unknown" }; expect(calculateCagr(values, C.EarningsPerShare)).toMatchObject({ status: "unavailable", reason: "unverified-share-basis" });
    });
    it("検索の除外/条件不一致/順序/ページを区別する", () => {
        const a = pair(), b = pair("eps", "1002"), c = pair("eps", "1003"); b.current = point(2025, "15", "eps", "1002"); c.current.shareBasis = { state: "unknown" };
        expect(screenPerShareGrowth([a, b, c], G.EarningsPerShare, { conditions: [{ operator: "gte", value: 0.3 }], limit: 1 })).toMatchObject({ total: 1, excludedRows: 1, filteredRows: 1, rows: [{ metricId: G.EarningsPerShare, current: { metadata: { secCode: "10020" } } }] });
        expect(screenCagr([[a.previous, a.current], [b.previous, b.current]], C.EarningsPerShare, { order: "asc", offset: 1, limit: 1 }).rows[0].points[0].metadata.secCode).toBe("10020");
    });
    it("空集合の不正設定と、条件で隠れる重複会社を拒否", () => {
        expect(() => screenPerShareGrowth([], G.EarningsPerShare, { conditions: [{ operator: "eq", value: NaN }] })).toThrow();
        expect(() => screenPerShareGrowth([pair(), pair()], G.EarningsPerShare, { conditions: [{ operator: "gt", value: 999 }] })).toThrow();
    });
});
