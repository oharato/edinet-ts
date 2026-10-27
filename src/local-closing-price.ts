/** ローカル価格キャッシュの必要列。adjusted closeは分割基準とみなさず読みません。 */
export interface LocalPriceRow { date: string; ticker: string; close: number; volume: number; }
export interface LocalPriceRequest {
    secCode: string; asOf: string; knownAt: string;
    source: { name: string; sha256: string; observedAt: string };
}
export type LocalClosingPriceResult = {
    secCode: string; asOf: string; knownAt: string; source: LocalPriceRequest["source"];
} & ({ status: "available"; date: string; close: number; currency: "JPY"; adjustment: "unadjusted"; volume: number; ageDays: number } |
    { status: "unavailable"; reason: "source-after-cutoff" | "no-eligible-price" | "conflicting-prices" });
const date = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
function time(s: unknown): number {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(s) || !date(s.slice(0, 10)) ||
        Number(s.slice(11, 13)) > 23 || Number(s.slice(14, 16)) > 59 || Number(s.slice(17, 19)) > 59 || !Number.isFinite(Date.parse(s))) throw new Error("timezone付きの正しい観測時刻が必要です");
    return Date.parse(s);
}
/** 日本株の日付付き未調整終値だけを選択。出来高0行は取引成立の根拠に使いません。 */
export function selectLocalClosingPrice(rows: readonly LocalPriceRow[], request: LocalPriceRequest): LocalClosingPriceResult {
    if (!request || !request.source) throw new Error("比較日と価格出典が必要です");
    const { secCode, asOf, knownAt } = request, source = { name: request.source.name, sha256: request.source.sha256, observedAt: request.source.observedAt };
    if (!/^[0-9A-Z]{4}0?$/.test(secCode) || !date(asOf) || typeof source.name !== "string" || !source.name.trim() ||
        typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256) || !Array.isArray(rows)) throw new Error("価格入力/出典が不正です");
    const cutoff = time(knownAt), observed = time(source.observedAt), code = secCode.slice(0, 4), base = { secCode: code + "0", asOf, knownAt, source };
    if (asOf > new Date(cutoff + 9 * 3600000).toISOString().slice(0, 10)) throw new Error("比較日を観測cutoffより先へ設定できません");
    if (observed > cutoff) return { ...base, status: "unavailable", reason: "source-after-cutoff" };
    const observedDate = new Date(observed + 9 * 3600000).toISOString().slice(0, 10);
    let latest: LocalPriceRow | undefined, conflict = false;
    for (const input of rows) {
        if (!input) throw new Error("価格行が不正です");
        const row = { date: input.date, ticker: input.ticker, close: input.close, volume: input.volume };
        if (!date(row.date) || row.date > observedDate || row.ticker !== code + ".T" || !Number.isFinite(row.close) || row.close <= 0 || row.close > Number.MAX_SAFE_INTEGER ||
            !Number.isSafeInteger(row.volume) || row.volume < 0) throw new Error("銘柄/日付/終値/出来高が不正です");
        if (row.date > asOf || row.volume === 0) continue;
        if (!latest || row.date > latest.date) { latest = row; conflict = false; }
        else if (row.date === latest.date && (row.close !== latest.close || row.volume !== latest.volume)) conflict = true;
    }
    if (!latest) return { ...base, status: "unavailable", reason: "no-eligible-price" };
    if (conflict) return { ...base, status: "unavailable", reason: "conflicting-prices" };
    return { ...base, status: "available", date: latest.date, close: latest.close, volume: latest.volume, currency: "JPY", adjustment: "unadjusted",
        ageDays: (Date.parse(asOf) - Date.parse(latest.date)) / 86400000 };
}
