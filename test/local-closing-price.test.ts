import { it, expect } from "vitest";
import { selectLocalClosingPrice, type LocalPriceRequest } from "../src/index";
const request: LocalPriceRequest = { secCode: "14170", asOf: "2026-10-19", knownAt: "2026-10-28T00:00:00Z", source: { name: "local-cache", sha256: "a".repeat(64), observedAt: "2026-10-27T00:00:00Z" } };
const row = { date: "2026-10-19", ticker: "1417.T", close: 3360, volume: 195700, adj_close: 1000 };
it("日付・原価格・出典を残し、調整後終値を使わない", () => {
    const result = selectLocalClosingPrice([row], request);
    expect(result).toMatchObject({ status: "available", close: 3360, adjustment: "unadjusted", ageDays: 0, secCode: "14170" });
    expect(selectLocalClosingPrice([row], { ...request, secCode: "1417" })).toEqual(result);
});
it("観測前の過去検証で現在キャッシュを使わない", () => {
    expect(selectLocalClosingPrice([row], { ...request, knownAt: "2026-10-19T23:59:59+09:00" })).toMatchObject({ status: "unavailable", reason: "source-after-cutoff" });
});
it("未来価格と出来高0を除外し、最終価格の古さを返す", () => {
    expect(selectLocalClosingPrice([{ ...row, date: "2026-10-16" }, { ...row, volume: 0 }, { ...row, date: "2026-10-20" }], request)).toMatchObject({ status: "available", date: "2026-10-16", ageDays: 3 });
    expect(selectLocalClosingPrice([{ ...row, volume: 0 }], request)).toMatchObject({ reason: "no-eligible-price" });
});
it("同日の競合を順序で解消せず、一致重複は同じ値を返す", () => {
    expect(selectLocalClosingPrice([row, row], request)).toMatchObject({ status: "available" });
    for (const rows of [[row, { ...row, close: 3500 }], [{ ...row, close: 3500 }, row]]) expect(selectLocalClosingPrice(rows, request)).toMatchObject({ reason: "conflicting-prices" });
});
it.each([{ close: 0 }, { close: NaN }, { close: Number.MAX_SAFE_INTEGER + 1 }, { volume: -1 }, { volume: 0.5 }, { ticker: "1951.T" }, { date: "2026-02-30" }])("不正な価格行を拒否 %j", patch => {
    expect(() => selectLocalClosingPrice([{ ...row, ...patch }], request)).toThrow();
});
it("不正なcutoff・将来比較日・hashを拒否", () => {
    expect(() => selectLocalClosingPrice([], { ...request, knownAt: "2026-10-28" })).toThrow();
    expect(() => selectLocalClosingPrice([], { ...request, asOf: "2027-01-01" })).toThrow();
    expect(() => selectLocalClosingPrice([], { ...request, source: { ...request.source, sha256: "bad" } })).toThrow();
});

it("取得したとする日より未来の行を受け付けない", () => {
    expect(() => selectLocalClosingPrice([row], { ...request, source: { ...request.source, observedAt: "2026-10-18T12:00:00Z" } })).toThrow();
});
