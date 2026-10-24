import type { EdinetContext } from "./edinet-context";
import type { EdinetData } from "./edinet-xbrl-object";
import { AccountingStandard, METRIC_REGISTRY, MetricDefinition, MetricId } from "./metric-registry";

/** 会計基準は呼出元が元書類で確認した宣言。自動判定や年次推測はしません。 */
export interface MetricSelectionOptions {
    accountingStandard: AccountingStandard;
    scope: EdinetContext["scope"];
    period: { startDate: string; endDate: string; instant?: never } | { instant: string; startDate?: never; endDate?: never };
}
export type SelectionReason = "selected" | "selected-raw-only" | "tag-absent" | "context-mismatch" |
    "nil" | "unsupported-standard" | "unsupported-semantics" | "unknown-namespace" | "unknown-context" |
    "unsupported-dimensions" | "unsupported-context" | "unsupported-entity" | "unsupported-unit" | "invalid-decimal" | "invalid-decimals" |
    "raw-unavailable" | "duplicate-context" | "multiple-facts" | "invalid-period";
export interface FactSelectionEvidence {
    key: string;
    namespace: string;
    namespaceURI?: string;
    contextRef: string;
    period?: EdinetContext["period"];
    scope?: EdinetContext["scope"];
    entity?: EdinetContext["entity"];
    dimensions?: readonly string[];
    rawDimensions?: unknown;
    unitRef: string;
    unit?: string;
    raw?: string;
    decimals?: string;
    nil: boolean;
    reason: SelectionReason;
}
/** numberはdecimal文字列への往復が一致し、安全整数範囲内の場合だけ付与します。 */
export type FactSelectionResult<Id extends string = MetricId> = {
    metricId: Id;
    reason: SelectionReason;
    evidence: readonly FactSelectionEvidence[];
} & ({ status: "selected"; raw: string; safeNumber?: number; source: FactSelectionEvidence } |
    { status: "missing" | "unsupported" | "ambiguous"; raw?: never; safeNumber?: never; source?: never });

const canonical = (value: string): string => {
    const [mantissa, exponent = "0"] = value.toLowerCase().split("e");
    const [integer, fraction = ""] = mantissa.replace(/^[+-]/, "").split(".");
    let digits = (integer + fraction).replace(/^0+/, "");
    let scale = fraction.length - Number(exponent);
    while (digits.endsWith("0")) { digits = digits.slice(0, -1); scale--; }
    return digits ? `${mantissa.startsWith("-") ? "-" : ""}${digits}:${scale}` : "0";
};
export function toSafeMetricNumber(raw: string): number | undefined {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return undefined;
    const number = Number(raw);
    if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER) return undefined;
    return canonical(raw) === canonical(String(number)) ? number : undefined;
}
const validDate = (date: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;

/** 内部の収集済みfactだけを読む純粋選択器。外部取得・変換・単位推測は行いません。 */
export function selectMetricFact(id: MetricId, options: MetricSelectionOptions,
    facts: ReadonlyMap<string, readonly EdinetData[]>, contexts: ReadonlyMap<string, EdinetContext>,
    units: ReadonlyMap<string, string>, duplicateContexts: ReadonlySet<string> = new Set()): FactSelectionResult {
    return selectDefinedMetricFact(METRIC_REGISTRY[id], options, facts, contexts, units, duplicateContexts);
}

/** 辞書間で共用する選択器。既存18項目のID集合を拡張せず定義を受け取ります。 */
export function selectDefinedMetricFact<Id extends string>(definition: MetricDefinition<Id>, options: MetricSelectionOptions,
    facts: ReadonlyMap<string, readonly EdinetData[]>, contexts: ReadonlyMap<string, EdinetContext>,
    units: ReadonlyMap<string, string>, duplicateContexts: ReadonlySet<string> = new Set()): FactSelectionResult<Id> {
    const id = definition.id;
    const evidence: FactSelectionEvidence[] = [];
    const finish = (status: "missing" | "unsupported" | "ambiguous", reason: SelectionReason): FactSelectionResult<Id> =>
        ({ metricId: id, status, reason, evidence });
    const period = options.period;
    if (definition.periodType === "instant" ? !period.instant || !validDate(period.instant) || !!period.startDate || !!period.endDate :
        !period.startDate || !period.endDate || !!period.instant || !validDate(period.startDate) || !validDate(period.endDate) || period.startDate > period.endDate) {
        return finish("unsupported", "invalid-period");
    }
    const candidates = definition.candidates.filter(c => c.standard === options.accountingStandard);
    if (!candidates.length) return finish("unsupported", "unsupported-standard");
    const expectedUnit = definition.unit === "JPY" ? "iso4217:JPY" : definition.unit === "shares" ? "xbrli:shares" : definition.unit === "pure" ? "xbrli:pure" : "iso4217:JPY/xbrli:shares";
    // 主提出者を推測しない。文書内に複数/不明entityがあれば採用を止めます。
    const documentEntities = new Set(Array.from(contexts.values(), context => context.entity
        ? JSON.stringify([context.entity.scheme, context.entity.identifier]) : ""));
    const singleKnownEntity = documentEntities.size === 1 && !documentEntities.has("");
    for (const candidate of candidates) {
        const matches: FactSelectionEvidence[] = [];
        // 同じlocal nameの企業拡張も記録しますが、標準namespaceの代用にはしません。
        const local = candidate.key.split(":")[1];
        for (const [key, list] of facts) {
            if (key.split(":")[1] !== local) continue;
            for (const fact of list) {
                const context = contexts.get(fact.contextRef);
                const item: FactSelectionEvidence = {
                    key, namespace: key.split(":")[0], namespaceURI: fact.namespaceURI,
                    contextRef: fact.contextRef, period: context ? { ...context.period } : undefined,
                    scope: context?.scope, dimensions: context ? [...context.dimensions] : undefined,
                    entity: context?.entity ? { ...context.entity } : undefined,
                    rawDimensions: context?.rawDimensions, unitRef: fact.unitRef, unit: units.get(fact.unitRef),
                    raw: fact.rawValue, decimals: fact.rawDecimals, nil: fact.nil, reason: "context-mismatch"
                };
                evidence.push(item);
                if (!context) { item.reason = "unknown-context"; continue; }
                if (!context.periodValid) { item.reason = "unsupported-context"; matches.push(item); continue; }
                if (context.scope !== options.scope || context.period.instant !== period.instant ||
                    context.period.startDate !== period.startDate || context.period.endDate !== period.endDate) continue;
                if (!context.namespaceVerified) { item.reason = "unsupported-context"; matches.push(item); continue; }
                if (!singleKnownEntity) { item.reason = "unsupported-entity"; matches.push(item); continue; }
                if (context.unsupportedDimensions || (options.scope === "Consolidated" ? context.dimensions.length !== 0 : context.dimensions.length !== 1 || context.dimensions[0] !== "NonConsolidatedMember")) {
                    item.reason = "unsupported-dimensions";
                    continue;
                }
                matches.push(item);
                const [prefix] = candidate.key.split(":");
                const taxonomy = prefix === "jppfs_cor" ? "jppfs" : prefix === "jpcrp_cor" ? "jpcrp" : prefix === "jpigp_cor" ? "jpigp" : undefined;
                const namespaceDate = taxonomy ? new RegExp(`^http://disclosure\\.edinet-fsa\\.go\\.jp/taxonomy/${taxonomy}/(\\d{4}-\\d{2}-\\d{2})/${prefix}$`).exec(fact.namespaceURI ?? "")?.[1] : undefined;
                // jpigpは詳細タグ付け導入版以降だけを対象にし、旧IFRSタクソノミを代用しません。
                const namespaceSupported = namespaceDate !== undefined && (prefix !== "jpigp_cor" || validDate(namespaceDate) && namespaceDate >= "2018-03-31");
                if (key !== candidate.key || !namespaceSupported) item.reason = "unknown-namespace";
                else if (duplicateContexts.has(context.id)) item.reason = "duplicate-context";
                else if (!candidate.supported) item.reason = "unsupported-semantics";
                else if (fact.nil) item.reason = "nil";
                else if (!expectedUnit || item.unit !== expectedUnit) item.reason = "unsupported-unit";
                else if (item.raw === undefined) item.reason = "raw-unavailable";
                else if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(item.raw)) item.reason = "invalid-decimal";
                else if (item.decimals !== undefined && !/^(?:INF|[+-]?\d+)$/.test(item.decimals)) item.reason = "invalid-decimals";
                else item.reason = toSafeMetricNumber(item.raw) === undefined ? "selected-raw-only" : "selected";
            }
        }
        const standardMatches = matches.filter(m => m.key === candidate.key);
        if (!standardMatches.length) continue;
        if (standardMatches.some(m => m.reason === "duplicate-context")) return finish("ambiguous", "duplicate-context");
        if (standardMatches.length > 1) return finish("ambiguous", "multiple-facts");
        const source = standardMatches[0];
        if (source.reason === "nil") return finish("missing", "nil");
        if (source.reason !== "selected" && source.reason !== "selected-raw-only") return finish("unsupported", source.reason);
        return { metricId: id, status: "selected", raw: source.raw!, safeNumber: toSafeMetricNumber(source.raw!), source, reason: source.reason, evidence };
    }
    const unknown = evidence.find(e => e.reason === "unknown-namespace" || e.reason === "unknown-context" || e.reason === "unsupported-dimensions");
    if (unknown) return finish("unsupported", unknown.reason);
    return finish("missing", evidence.length ? "context-mismatch" : "tag-absent");
}
