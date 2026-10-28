const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
/** APIのtimezoneなし提出日時は日本時間。呼出元のcutoff/観測時刻にはtimezoneを必須にします。 */
export function parseDocumentTimestamp(value: unknown, requireZone: boolean): number | undefined {
    if (typeof value !== "string") return;
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
    if (!m || !validDate(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[4] ?? 0) > 59 || requireZone && !m[5]) return;
    const result = Date.parse(value.replace(" ", "T") + (m[5] ? "" : "+09:00"));
    return Number.isFinite(result) ? result : undefined;
}
