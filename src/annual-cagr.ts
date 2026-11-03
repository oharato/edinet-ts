import { captureShareBasis, assessShareBasis, type PerShareAnnualDocument, type ShareBasisAssessment } from "./share-basis";
import { createHash } from "node:crypto";
import { EdinetXbrlParser } from "./edinet-xbrl-parser";
import { normalizeFinancialDetailMetadata } from "./financial-detail-metadata";
import { MetricId } from "./metric-registry";
import { ComparisonOperator, SortOrder } from "./financial-options";
import { decimalFraction, compareFractions, reduceFraction } from "./decimal-fraction";
import type { AnnualCoreDocument, AnnualCorePoint } from "./annual-growth-core";
import { adjustPerShareValuesForSplits, type ShareSplitAdjustmentOptions, type ShareSplitAdjustmentResult, type ShareSplitUnavailableReason } from "./share-split-adjustment";
import { parseDocumentTimestamp } from "./document-timestamp";

export const CagrMetricId = Object.freeze({ NetSales: "netSalesCagr", OperatingIncome: "operatingIncomeCagr", NetIncome: "netIncomeCagr", EarningsPerShare: "earningsPerShareCagr", DividendPerShare: "dividendPerShareCagr" } as const);
export type CagrMetricId = typeof CagrMetricId[keyof typeof CagrMetricId];
export type BasicCagrMetricId = typeof CagrMetricId.NetSales | typeof CagrMetricId.OperatingIncome | typeof CagrMetricId.NetIncome;
export type PerShareCagrMetricId = typeof CagrMetricId.EarningsPerShare | typeof CagrMetricId.DividendPerShare;
const perShare = (id: CagrMetricId) => id === CagrMetricId.EarningsPerShare || id === CagrMetricId.DividendPerShare;
const sources = { netSalesCagr: MetricId.NetSales, operatingIncomeCagr: MetricId.OperatingIncome, netIncomeCagr: MetricId.NetIncome, earningsPerShareCagr: MetricId.EarningsPerShare, dividendPerShareCagr: MetricId.DividendPaidPerShare } as const;
export type CagrUnavailableReason = "unsupported-standard" | "incompatible-metadata" | "not-annual" | "unsupported-annual-period" |
    "non-consecutive-periods" | "unavailable-input" | "incompatible-entity" | "unsafe-input" | "zero-base" | "negative-input" | "unsafe-result" | "unverified-share-basis" | "invalid-share-basis-evidence" | "incompatible-share-basis" | "unverified-dividend-status" | "proposed-dividend" | "missing-split-adjustment" | ShareSplitUnavailableReason;
export interface CagrPoint extends AnnualCorePoint { shareBasis?: ShareBasisAssessment; }
type CagrBase = { metricId: CagrMetricId; unit: "ratio"; points: readonly CagrPoint[]; years: number; shareAdjustment?: ShareSplitAdjustmentResult; };
export type CagrResult = CagrBase & ({ status: "calculated"; reason: "calculated"; value: number;
    /** CAGR=(numerator/denominator)^(1/years)-1。無理数を近似分数として保存しません。 */
    exact: { numerator: string; denominator: string; root: number } } |
    { status: "unavailable"; reason: CagrUnavailableReason; value?: never; exact?: never });
export interface CagrCondition { operator: ComparisonOperator; value: number; }
export interface CagrScreeningOptions { conditions?: readonly CagrCondition[]; order?: SortOrder; offset?: number; limit?: number;
    /** 指定時は非分割社にもevents:[]の台帳を必須とし、欠落社を除外します。 */
    shareAdjustments?: Readonly<Record<string, ShareSplitAdjustmentOptions>>; }
const nextDay = (date: string) => new Date(Date.parse(date + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
function annual(start: string, end: string): boolean {
    const date = new Date(start + "T00:00:00Z");
    if (date.getUTCDate() !== 1) return false;
    date.setUTCFullYear(date.getUTCFullYear() + 1); date.setUTCDate(0);
    return date.toISOString().slice(0, 10) === end;
}
/** 3年CAGRには4つの連続した12暦月原本/列を明示。1株当たり値には注記で確認した共通株式基準を必須にします。 */
export function calculateCagr(documents: readonly AnnualCoreDocument[], metricId: BasicCagrMetricId): CagrResult;
export function calculateCagr(documents: readonly PerShareAnnualDocument[], metricId: PerShareCagrMetricId, adjustment?: ShareSplitAdjustmentOptions): CagrResult;
export function calculateCagr(documents: readonly AnnualCoreDocument[], metricId: CagrMetricId, adjustment?: ShareSplitAdjustmentOptions): CagrResult {
    return calculateCagrInternal(documents, metricId, false, adjustment);
}
function calculateCagrInternal(documents: readonly AnnualCoreDocument[], metricId: CagrMetricId, annualGrowth = false, adjustment?: ShareSplitAdjustmentOptions): CagrResult {
    if (!Object.hasOwn(sources, metricId) || !Array.isArray(documents) || documents.length < 2 || documents.length > 21)
        throw new Error("既知のCAGR項目と2〜21件の明示年次原本が必要です");
    if (adjustment !== undefined && !perShare(metricId)) throw new Error("分割換算は1株当たり指標だけに指定してください");
    const captured = Array.from(documents, document => {
        if (!document || typeof document !== "object" || Object.keys(document).some(key => !(perShare(metricId) ? ["xml", "metadata", "shareBasis"] : ["xml", "metadata"]).includes(key))) throw new Error("xml/metadataが必要です");
        const metadata = normalizeFinancialDetailMetadata(document.metadata), xml = document.xml;
        if (typeof xml !== "string") throw new Error("XML文字列が必要です");
        return { metadata, xml, shareBasis: perShare(metricId) ? captureShareBasis((document as Partial<PerShareAnnualDocument>).shareBasis) : undefined };
    });
    const referenceDates: (string | undefined)[] = [];
    const points = captured.map(({ xml, metadata, shareBasis }): CagrPoint => {
        const object = new EdinetXbrlParser().parse(xml, metadata.docID);
        const selection = object.selectMetric(sources[metricId], { accountingStandard: metadata.accountingStandard, scope: metadata.scope, period: metadata.period },
            { collapseIdenticalDuplicates: perShare(metricId) });
        if (adjustment !== undefined) referenceDates.push(shareBasis?.state === "confirmed" ? [...object.findContexts({ type: "Instant", scope: "Consolidated" }), ...object.findContexts({ type: "Instant", scope: "NonConsolidated" })].find(context => context.id === shareBasis.proof.contextRef)?.period.instant : undefined);
        return { metadata, selection, inputXmlSha256: createHash("sha256").update(xml).digest("hex"),
            ...(perShare(metricId) ? { shareBasis: assessShareBasis(object, shareBasis, selection.source?.entity) } : {}) };
    });
    const base: CagrBase = { metricId, unit: "ratio", points, years: points.length - 1 };
    const unavailable = (reason: CagrUnavailableReason): CagrResult => ({ ...base, status: "unavailable", reason });
    const first = points[0].metadata;
    for (let i = 0; i < points.length; i++) {
        const { metadata, selection } = points[i];
        if (metadata.accountingStandard !== "J-GAAP") return unavailable("unsupported-standard");
        if (metadata.secCode !== first.secCode || metadata.scope !== first.scope || metadata.currency !== first.currency) return unavailable("incompatible-metadata");
        if (metadata.periodType !== "annual" || !metadata.period.startDate || !metadata.period.endDate) return unavailable("not-annual");
        if (!annual(metadata.period.startDate, metadata.period.endDate)) return unavailable("unsupported-annual-period");
        if (i && nextDay(points[i - 1].metadata.period.endDate!) !== metadata.period.startDate) return unavailable("non-consecutive-periods");
        if (selection.status !== "selected") return unavailable("unavailable-input");
        const original = points[0].selection.source?.entity, entity = selection.source.entity;
        if (!original || !entity || entity.scheme !== original.scheme || entity.identifier !== original.identifier) return unavailable("incompatible-entity");
        if (selection.safeNumber === undefined) return unavailable("unsafe-input");
        if (selection.safeNumber < 0 && !(annualGrowth && points.length === 2 && i === 1 && metricId === CagrMetricId.EarningsPerShare)) return unavailable("negative-input");
        if (perShare(metricId)) {
            const basis = points[i].shareBasis, initial = points[0].shareBasis;
            if (!basis || basis.status !== "reference-matched") return unavailable(basis?.reason ?? "unverified-share-basis");
            if (metricId === CagrMetricId.DividendPerShare) {
                if (basis.dividendStatus === "proposed") return unavailable("proposed-dividend");
                if (basis.dividendStatus !== "paid") return unavailable("unverified-dividend-status");
            }
            if (!initial || initial.status !== "reference-matched" || basis.shareClass !== initial.shareClass || adjustment === undefined && basis.basisDate !== initial.basisDate) return unavailable("incompatible-share-basis");
        }
    }
    let adjusted: Extract<ShareSplitAdjustmentResult, { status: "adjusted" }> | undefined;
    if (adjustment !== undefined) {
        const result = adjustPerShareValuesForSplits(points.map(point => ({ value: point.selection.safeNumber!, basisDate: (point.shareBasis as Extract<ShareBasisAssessment, { status: "reference-matched" }>).basisDate })), first.secCode, adjustment);
        base.shareAdjustment = result;
        if (result.status !== "adjusted") return unavailable(result.reason);
        const cutoffDate = new Date(parseDocumentTimestamp(result.knownAt, true)! + 9 * 3600000).toISOString().slice(0, 10);
        const timeReason = referenceDates.some(date => date! > cutoffDate) ? "split-source-after-cutoff" :
            referenceDates.some((date, index) => date! > new Date(parseDocumentTimestamp(result.sourceObservedAt[index], true)! + 9 * 3600000).toISOString().slice(0, 10)) ? "split-source-before-reference" :
            points.some(point => point.metadata.period.endDate! > result.asOf) ? "split-financial-period-after-as-of" : undefined;
        if (timeReason) {
            const { points: _adjustedPoints, ...evidence } = result;
            base.shareAdjustment = { ...evidence, status: "unavailable", reason: timeReason };
            return unavailable(timeReason);
        }
        adjusted = result;
    }
    const start = adjusted?.points[0].value ?? points[0].selection.safeNumber!, end = adjusted?.points.at(-1)!.value ?? points.at(-1)!.selection.safeNumber!;
    if (start === 0) return unavailable("zero-base");
    const a = adjusted ? { numerator: BigInt(adjusted.points[0].exact.numerator), denominator: BigInt(adjusted.points[0].exact.denominator) } : decimalFraction(start);
    const last = adjusted?.points.at(-1), b = last ? { numerator: BigInt(last.exact.numerator), denominator: BigInt(last.exact.denominator) } : decimalFraction(end);
    const exact = reduceFraction(b.numerator * a.denominator, b.denominator * a.numerator);
    const difference = exact.numerator - exact.denominator;
    const change = adjusted ? Number(difference) / Number(exact.denominator) : (end - start) / start;
    if (adjusted && (!Number.isFinite(change) || change === 0 && difference !== 0n)) return unavailable("unsafe-result");
    const logRatio = Number.isFinite(change) && change > -1 ? Math.log1p(change) : Math.log(end) - Math.log(start);
    const value = annualGrowth && points.length === 2 ? change : end === 0 ? -1 : Math.expm1(logRatio / base.years);
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) return unavailable("unsafe-result");
    return { ...base, status: "calculated", reason: "calculated", value,
        exact: { numerator: String(exact.numerator), denominator: String(exact.denominator), root: base.years } };
}
function factor(result: Extract<CagrResult, { status: "calculated" }>) {
    return { numerator: BigInt(result.exact.numerator), denominator: BigInt(result.exact.denominator) };
}
function compareThreshold(result: Extract<CagrResult, { status: "calculated" }>, value: number): number {
    if (result.years > 1 && value < -1) return 1;
    const threshold = decimalFraction(value), numerator = threshold.numerator + threshold.denominator;
    return compareFractions(factor(result), { numerator: numerator ** BigInt(result.years), denominator: threshold.denominator ** BigInt(result.years) });
}
/** 同じ全期間を持つ明示企業集合。表示近似値でCAGRの条件・並びを決めません。 */
export function screenCagr(series: readonly (readonly AnnualCoreDocument[])[], metricId: BasicCagrMetricId, options?: CagrScreeningOptions): ReturnType<typeof screenCagrInternal>;
export function screenCagr(series: readonly (readonly PerShareAnnualDocument[])[], metricId: PerShareCagrMetricId, options?: CagrScreeningOptions): ReturnType<typeof screenCagrInternal>;
export function screenCagr(series: readonly (readonly AnnualCoreDocument[])[], metricId: CagrMetricId, options: CagrScreeningOptions = {}) {
    return screenCagrInternal(series, metricId, options);
}
function screenCagrInternal(series: readonly (readonly AnnualCoreDocument[])[], metricId: CagrMetricId, options: CagrScreeningOptions = {}, annualGrowth = false) {
    if (!Object.hasOwn(sources, metricId) || !Array.isArray(series) || !options || typeof options !== "object" || Object.keys(options).some(key => !["conditions", "order", "offset", "limit", "shareAdjustments"].includes(key))) throw new Error("不正なCAGR検索条件です");
    const { conditions: inputConditions = [], order = "desc", offset = 0, limit, shareAdjustments } = options;
    const adjustments = new Map<string, ShareSplitAdjustmentOptions>();
    if (shareAdjustments !== undefined) {
        if (!perShare(metricId) || !shareAdjustments || typeof shareAdjustments !== "object" || Array.isArray(shareAdjustments)) throw Error("1株当たり検索の企業別分割台帳が必要です");
        for (const [code, adjustment] of Object.entries(shareAdjustments)) {
            if (!/^[0-9A-Z]{4}0?$/.test(code) || adjustments.has(code.slice(0, 4) + "0") || !adjustment || typeof adjustment !== "object" || Array.isArray(adjustment)) throw Error("企業別分割台帳のキーが不正/重複しています");
            adjustments.set(code.slice(0, 4) + "0", adjustment);
        }
    }
    if (!Array.isArray(inputConditions)) throw new Error("有限のCAGR条件が必要です");
    const conditions = Array.from(inputConditions, condition => {
        if (!condition || typeof condition !== "object" || Object.keys(condition).some(key => !["operator", "value"].includes(key))) throw new Error("不正なCAGR条件です");
        const { operator, value } = condition;
        if (!Object.values(ComparisonOperator).includes(operator) || !Number.isFinite(value)) throw new Error("有限のCAGR条件が必要です");
        return { operator, value };
    });
    if (!Object.values(SortOrder).includes(order) || [offset, limit].some(v => v !== undefined && (!Number.isSafeInteger(v) || v < 0))) throw new Error("不正なCAGRの順序/ページです");
    const results = Array.from(series, (documents): CagrResult => {
        const code = documents?.[0]?.metadata?.secCode, adjustment = typeof code === "string" ? adjustments.get(code.slice(0, 4) + "0") : undefined;
        const result = calculateCagrInternal(documents, metricId, annualGrowth, adjustment);
        if (shareAdjustments !== undefined && adjustment === undefined) {
            const { value: _value, exact: _exact, ...base } = result;
            return { ...base, status: "unavailable", reason: "missing-split-adjustment" };
        }
        return result;
    }), codes = new Set<string>(), docs = new Map<string, string>();
    const cohort = (r: CagrResult) => JSON.stringify(r.points.map(p => [p.metadata.period, p.metadata.periodType, p.metadata.scope, p.metadata.accountingStandard, p.metadata.currency]));
    let comparisonClock: string | undefined;
    for (const result of results) {
        const code = result.points[0].metadata.secCode;
        if (codes.has(code) || cohort(result) !== cohort(results[0])) throw new Error("同一企業または企業間の期間/範囲/基準/通貨が混在しています");
        codes.add(code);
        if (result.shareAdjustment) {
            const clock = JSON.stringify([result.shareAdjustment.asOf, parseDocumentTimestamp(result.shareAdjustment.knownAt, true)]);
            if (comparisonClock !== undefined && comparisonClock !== clock) throw Error("分割換算の比較日/観測cutoffが企業間で異なります");
            comparisonClock = clock;
        }
        for (const point of result.points) {
            if (docs.has(point.metadata.docID) && docs.get(point.metadata.docID) !== code) throw new Error("別企業で同じ書類IDは使えません");
            docs.set(point.metadata.docID, code);
        }
    }
    if ([...adjustments.keys()].some(code => !codes.has(code))) throw Error("対象企業のない分割台帳は使えません");
    const excluded = results.filter((r): r is Extract<CagrResult, { status: "unavailable" }> => r.status === "unavailable");
    const selected = results.filter((r): r is Extract<CagrResult, { status: "calculated" }> => r.status === "calculated");
    const rows = selected.filter(r => conditions.every(c => {
        const d = compareThreshold(r, c.value);
        return c.operator === "gte" ? d >= 0 : c.operator === "lte" ? d <= 0 : c.operator === "gt" ? d > 0 : c.operator === "lt" ? d < 0 : d === 0;
    }));
    rows.sort((a, b) => compareFractions(factor(a), factor(b)) * (order === "asc" ? 1 : -1) ||
        (a.points[0].metadata.secCode < b.points[0].metadata.secCode ? -1 : a.points[0].metadata.secCode > b.points[0].metadata.secCode ? 1 : 0));
    return { rows: rows.slice(offset, limit === undefined ? undefined : offset + limit), excluded, total: rows.length, excludedRows: excluded.length, filteredRows: selected.length - rows.length };
}


export const PerShareGrowthMetricId = Object.freeze({ EarningsPerShare: "earningsPerShareGrowth", DividendPerShare: "dividendPerShareGrowth" } as const);
export type PerShareGrowthMetricId = typeof PerShareGrowthMetricId[keyof typeof PerShareGrowthMetricId];
export interface PerShareAnnualPair { previous: PerShareAnnualDocument; current: PerShareAnnualDocument; }
const growthSources = { earningsPerShareGrowth: CagrMetricId.EarningsPerShare, dividendPerShareGrowth: CagrMetricId.DividendPerShare } as const;
function pairDocuments(pair: PerShareAnnualPair): PerShareAnnualDocument[] {
    if (!pair || typeof pair !== "object" || Object.keys(pair).some(k => !["previous", "current"].includes(k))) throw new Error("previous/currentを明示してください");
    return [pair.previous, pair.current];
}
const growthBase = (result: CagrResult, metricId: PerShareGrowthMetricId) => ({ metricId, unit: "ratio" as const, previous: result.points[0], current: result.points[1], ...(result.shareAdjustment ? { shareAdjustment: result.shareAdjustment } : {}) });
function growthCalculated(result: Extract<CagrResult, { status: "calculated" }>, metricId: PerShareGrowthMetricId) {
    const exact = reduceFraction(BigInt(result.exact.numerator) - BigInt(result.exact.denominator), BigInt(result.exact.denominator));
    return { ...growthBase(result, metricId), status: "calculated" as const, reason: "calculated" as const, value: result.value, exact: { numerator: String(exact.numerator), denominator: String(exact.denominator) } };
}
function growthUnavailable(result: Extract<CagrResult, { status: "unavailable" }>, metricId: PerShareGrowthMetricId) {
    return { ...growthBase(result, metricId), status: "unavailable" as const, reason: result.reason };
}
export type PerShareGrowthResult = ReturnType<typeof growthCalculated> | ReturnType<typeof growthUnavailable>;
function growthResult(result: CagrResult, metricId: PerShareGrowthMetricId): PerShareGrowthResult {
    return result.status === "calculated" ? growthCalculated(result, metricId) : growthUnavailable(result, metricId);
}
/** 共通の確認済み株式基準だけで比較。EPSは前年正なら当年損失も扱います。 */
export function calculatePerShareGrowth(pair: PerShareAnnualPair, metricId: PerShareGrowthMetricId, adjustment?: ShareSplitAdjustmentOptions): PerShareGrowthResult {
    if (!Object.hasOwn(growthSources, metricId)) throw new Error("既知の1株当たり前年比を指定してください");
    return growthResult(calculateCagrInternal(pairDocuments(pair), growthSources[metricId], true, adjustment), metricId);
}
export function screenPerShareGrowth(pairs: readonly PerShareAnnualPair[], metricId: PerShareGrowthMetricId, options: CagrScreeningOptions = {}) {
    if (!Array.isArray(pairs) || !Object.hasOwn(growthSources, metricId)) throw new Error("1株当たり前年比の明示pairが必要です");
    const result = screenCagrInternal(Array.from(pairs, pairDocuments), growthSources[metricId], options, true);
    return { ...result, rows: result.rows.map(r => growthCalculated(r, metricId)), excluded: result.excluded.map(r => growthUnavailable(r, metricId)) };
}
