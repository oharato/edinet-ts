import { toSafeMetricNumber } from "./metric-selection";
/** 本文表の単独数値だけを換算します。負数は明示した呼出元だけが採用します。元表示の精度や欠損理由は推測しません。 */
export function parseReportedTableNumber(raw: string, multiplier: 1 | 1000 | 10000 | 1000000, allowNegative = false):
    { status: "numeric"; decimal: string; safeNumber?: number } | { status: "unavailable"; reason: "blank" | "dash" | "compound-or-unsupported-number" } {
    if (!raw) return { status: "unavailable", reason: "blank" };
    if (["－", "−", "—", "―", "-", "–"].includes(raw)) return { status: "unavailable", reason: "dash" };
    const negative = allowNegative && /^[△−-]/.test(raw), unsigned = negative ? raw.slice(1) : raw;
    if (raw.length > 100 || !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(unsigned)) return { status: "unavailable", reason: "compound-or-unsupported-number" };
    const [integer, fraction = ""] = unsigned.replaceAll(",", "").split("."), digits = integer + fraction + (multiplier === 1 ? "" : String(multiplier).slice(1));
    const absolute = fraction.length ? `${BigInt(digits.slice(0, -fraction.length) || "0")}.${digits.slice(-fraction.length)}` : String(BigInt(digits));
    const decimal = (negative ? "-" : "") + absolute;
    return { status: "numeric", decimal, safeNumber: toSafeMetricNumber(decimal) };
}
