import { toSafeMetricNumber } from "./metric-selection";
/** 本文表の非負の単独数値だけを換算します。元表示の精度や欠損理由は推測しません。 */
export function parseReportedTableNumber(raw: string, multiplier: 1 | 1000000):
    { status: "numeric"; decimal: string; safeNumber?: number } | { status: "unavailable"; reason: "blank" | "dash" | "compound-or-unsupported-number" } {
    if (!raw) return { status: "unavailable", reason: "blank" };
    if (["－", "−", "—", "―", "-", "–"].includes(raw)) return { status: "unavailable", reason: "dash" };
    if (raw.length > 100 || !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) return { status: "unavailable", reason: "compound-or-unsupported-number" };
    const [integer, fraction = ""] = raw.replaceAll(",", "").split("."), digits = integer + fraction + (multiplier === 1000000 ? "000000" : "");
    const decimal = fraction.length ? `${BigInt(digits.slice(0, -fraction.length) || "0")}.${digits.slice(-fraction.length)}` : String(BigInt(digits));
    return { status: "numeric", decimal, safeNumber: toSafeMetricNumber(decimal) };
}
