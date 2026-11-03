import { decimalFraction, reduceFraction } from "./decimal-fraction";
import { parseDocumentTimestamp } from "./document-timestamp";

export interface ShareSplitSource { name: string; sha256: string; observedAt: string; }
export interface ShareSplitEvent {
    eventId: string; effectiveDate: string; oldShares: number; newShares: number; source: ShareSplitSource;
}
export type ShareSplitLedger = { state: "unknown" } | { state: "confirmed-complete"; secCode: string; shareClass: "ordinary";
    basisConvention: "effective-date-inclusive"; reviewedFrom: string; reviewedThrough: string; source: ShareSplitSource; events: readonly ShareSplitEvent[]; };
/** 完全性・基準日の意味は出典を確認した呼出元の宣言。basisDateはその日までの効力発生を織込み済み。価格の権利落日には適用しません。 */
export interface ShareSplitAdjustmentOptions {
    asOf: string; knownAt: string; targetBasisDate: string; sourceObservedAt: readonly string[];
    ledger: ShareSplitLedger;
}
export type ShareSplitUnavailableReason = "split-source-after-cutoff" | "split-basis-after-as-of" | "incomplete-split-history" |
    "conflicting-split-events" | "unsafe-split-adjustment" | "split-source-before-reference" | "split-financial-period-after-as-of" | "unverified-split-history";
export interface AdjustedPerSharePoint {
    sourceBasisDate: string; originalValue: number; value: number;
    multiplier: { numerator: string; denominator: string }; exact: { numerator: string; denominator: string }; eventIds: string[];
}
export type ShareSplitAdjustmentResult = { declaration: "source-reviewed-by-caller"; asOf: string; knownAt: string;
    targetBasisDate: string; sourceObservedAt: string[]; ledger: ShareSplitAdjustmentOptions["ledger"]; } &
    ({ status: "adjusted"; points: AdjustedPerSharePoint[]; } | { status: "unavailable"; reason: ShareSplitUnavailableReason; });
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const date = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function fields(value: unknown, keys: string[]): asserts value is Record<string, any> {
    if (!record(value) || Object.keys(value).some(key => !keys.includes(key))) throw Error("分割換算の入力属性が不正です");
}
function captureArray<T>(value: unknown, maximum: number, minimum = 0): T[] {
    if (!Array.isArray(value)) throw Error("分割換算には明示配列が必要です");
    const length = value.length;
    if (!Number.isSafeInteger(length) || length < minimum || length > maximum) throw Error("分割換算の配列上限が不正です");
    return Array.from({ length }, (_, index) => {
        if (!Object.hasOwn(value, index)) throw Error("分割換算に疎配列は使えません");
        return value[index] as T;
    });
}
function captureSource(value: unknown): ShareSplitSource {
    fields(value, ["name", "sha256", "observedAt"]);
    const { name, sha256, observedAt } = value;
    if (typeof name !== "string" || !name.trim() || name.length > 2048 || typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256) ||
        parseDocumentTimestamp(observedAt, true) === undefined) throw Error("分割の出典/観測時刻が不正です");
    return { name, sha256, observedAt };
}
/** 既に遡及調整済みの値は、その宣言された基準日以後だけを換算し、原値を保持します。 */
export function adjustPerShareValuesForSplits(values: readonly { value: number; basisDate: string; }[], secCode: string,
    options: ShareSplitAdjustmentOptions): ShareSplitAdjustmentResult {
    fields(options, ["asOf", "knownAt", "targetBasisDate", "sourceObservedAt", "ledger"]);
    const { asOf, knownAt, targetBasisDate, sourceObservedAt, ledger: rawLedger } = options, cutoff = parseDocumentTimestamp(knownAt, true);
    const pointInputs = captureArray<{ value: number; basisDate: string }>(values, 21, 1), observationInputs = captureArray<string>(sourceObservedAt, 21);
    if (!date(asOf) || !date(targetBasisDate) || cutoff === undefined || asOf > new Date(cutoff + 9 * 3600000).toISOString().slice(0, 10) || observationInputs.length !== pointInputs.length)
        throw Error("分割換算の対象日/観測時刻/原値が不正です");
    const captured = pointInputs.map(point => {
        fields(point, ["value", "basisDate"]);
        const { value, basisDate } = point;
        if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER || !date(basisDate)) throw Error("分割換算の原値/基準日が不正です");
        return { value, basisDate };
    });
    const observed = observationInputs.map(value => {
        const time = parseDocumentTimestamp(value, true); if (time === undefined) throw Error("原本観測時刻が不正です"); return time;
    });
    fields(rawLedger, ["state", "secCode", "shareClass", "basisConvention", "reviewedFrom", "reviewedThrough", "source", "events"]);
    const { state } = rawLedger;
    if (state === "unknown") {
        fields(rawLedger, ["state"]);
        return { declaration: "source-reviewed-by-caller", asOf, knownAt, targetBasisDate, sourceObservedAt: observed.map(time => new Date(time).toISOString()),
            ledger: { state }, status: "unavailable", reason: "unverified-split-history" };
    }
    const { secCode: ledgerCode, shareClass, basisConvention, reviewedFrom, reviewedThrough, source: ledgerSource, events: rawEvents } = rawLedger;
    const eventInputs = captureArray<ShareSplitEvent>(rawEvents, 256);
    if (state !== "confirmed-complete" || typeof secCode !== "string" || !/^[0-9A-Z]{4}0?$/.test(secCode) || typeof ledgerCode !== "string" || !/^[0-9A-Z]{4}0?$/.test(ledgerCode) || ledgerCode.slice(0, 4) !== secCode.slice(0, 4) || shareClass !== "ordinary" ||
        basisConvention !== "effective-date-inclusive" || !date(reviewedFrom) || !date(reviewedThrough) || reviewedFrom > reviewedThrough) throw Error("分割台帳の銘柄/株式基準/確認範囲が不正です");
    const ledger: Extract<ShareSplitLedger, { state: "confirmed-complete" }> = { state, secCode: secCode.slice(0, 4) + "0", shareClass: "ordinary", basisConvention: "effective-date-inclusive",
        reviewedFrom, reviewedThrough, source: captureSource(ledgerSource), events: eventInputs.map(event => {
            fields(event, ["eventId", "effectiveDate", "oldShares", "newShares", "source"]);
            const { eventId, effectiveDate, oldShares, newShares, source } = event;
            if (typeof eventId !== "string" || !eventId.trim() || eventId.length > 256 || !date(effectiveDate) ||
                !Number.isSafeInteger(oldShares) || oldShares <= 0 || !Number.isSafeInteger(newShares) || newShares <= 0 || oldShares === newShares)
                throw Error("分割イベントのID/効力日/比率が不正です");
            return { eventId, effectiveDate, oldShares, newShares, source: captureSource(source) };
        }) };
    const base = { declaration: "source-reviewed-by-caller" as const, asOf, knownAt, targetBasisDate, sourceObservedAt: observed.map(time => new Date(time).toISOString()), ledger };
    const unavailable = (reason: ShareSplitUnavailableReason): ShareSplitAdjustmentResult => ({ ...base, status: "unavailable", reason });
    if (observed.some(time => time > cutoff) || parseDocumentTimestamp(ledger.source.observedAt, true)! > cutoff || ledger.events.some(event => parseDocumentTimestamp(event.source.observedAt, true)! > cutoff)) return unavailable("split-source-after-cutoff");
    if (targetBasisDate > asOf || captured.some(point => point.basisDate > asOf)) return unavailable("split-basis-after-as-of");
    const bounds = [targetBasisDate, ...captured.map(point => point.basisDate)].sort(), lower = bounds[0], upper = bounds.at(-1)!;
    if (ledger.reviewedFrom > lower || ledger.reviewedThrough < upper || ledger.reviewedThrough > asOf) return unavailable("incomplete-split-history");
    const unique = new Map<string, ShareSplitEvent>();
    for (const event of ledger.events) {
        const old = unique.get(event.eventId);
        if (old) {
            if (JSON.stringify(old) !== JSON.stringify(event)) return unavailable("conflicting-split-events");
            continue;
        }
        unique.set(event.eventId, event);
    }
    const sorted = [...unique.values()].filter(event => event.effectiveDate > lower && event.effectiveDate <= upper).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    const dates = new Set<string>();
    for (const event of sorted) {
        if (dates.has(event.effectiveDate)) return unavailable("conflicting-split-events");
        dates.add(event.effectiveDate);
    }
    const points: AdjustedPerSharePoint[] = [];
    for (const point of captured) {
        let multiplier = { numerator: 1n, denominator: 1n }; const eventIds: string[] = [];
        for (const event of sorted) {
            if (event.effectiveDate <= (point.basisDate < targetBasisDate ? point.basisDate : targetBasisDate) || event.effectiveDate > (point.basisDate > targetBasisDate ? point.basisDate : targetBasisDate)) continue;
            const forward = point.basisDate < targetBasisDate;
            multiplier = reduceFraction(multiplier.numerator * BigInt(forward ? event.oldShares : event.newShares), multiplier.denominator * BigInt(forward ? event.newShares : event.oldShares));
            eventIds.push(event.eventId);
        }
        const original = decimalFraction(point.value), exact = reduceFraction(original.numerator * multiplier.numerator, original.denominator * multiplier.denominator);
        const value = Number(exact.numerator) / Number(exact.denominator);
        if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER || value === 0 && exact.numerator !== 0n) return unavailable("unsafe-split-adjustment");
        points.push({ sourceBasisDate: point.basisDate, originalValue: point.value, value, multiplier: { numerator: String(multiplier.numerator), denominator: String(multiplier.denominator) },
            exact: { numerator: String(exact.numerator), denominator: String(exact.denominator) }, eventIds });
    }
    return { ...base, status: "adjusted", points };
}
/** 配当の支払区分。原注記で確認した呼出元の宣言であり、金額から自動判定しません。 */
export type AnnualDividendPaymentStatus = "paid" | "proposed" | "unknown";
/** 一つの事業年度に属する1回分の1株当たり配当。basisDateはその金額が基づく株式基準日です。 */
export interface AnnualDividendPayment {
    paymentId: string; amountPerShare: number; basisDate: string; dividendStatus: AnnualDividendPaymentStatus; sourceObservedAt: string;
}
export interface AnnualDividendReconstructionOptions extends ShareSplitAdjustmentOptions {
    annualPeriod: { start: string; end: string; };
}
export type AnnualDividendUnavailableReason = ShareSplitUnavailableReason | "unverified-dividend-status" | "annual-period-after-as-of" |
    "unsafe-annual-dividend-total";
export interface ReconstructedAnnualDividendPayment extends AdjustedPerSharePoint {
    paymentId: string; originalAmountPerShare: number; dividendStatus: AnnualDividendPaymentStatus;
}
export type AnnualDividendReconstructionResult = { declaration: "source-reviewed-by-caller"; asOf: string; knownAt: string; targetBasisDate: string;
    annualPeriod: { start: string; end: string; }; sourceObservedAt: string[]; ledger: ShareSplitAdjustmentOptions["ledger"]; } &
    ({ status: "reconstructed"; dividendStatus: Exclude<AnnualDividendPaymentStatus, "unknown">; paid: boolean;
        totalPerShare: number; exact: { numerator: string; denominator: string; }; payments: ReconstructedAnnualDividendPayment[]; } |
     { status: "unavailable"; reason: AnnualDividendUnavailableReason; });
/**
 * 異なる株式基準で支払われた年額配当を、明示台帳で共通基準へ換算して合算します。
 * 期中の分割で単価の基準が変わる年でも、各回の原値と換算根拠を保持します。予定額を含む年はpaid=falseです。
 */
export function reconstructAnnualDividendPerShare(payments: readonly AnnualDividendPayment[], secCode: string,
    options: AnnualDividendReconstructionOptions): AnnualDividendReconstructionResult {
    fields(options, ["asOf", "knownAt", "targetBasisDate", "sourceObservedAt", "ledger", "annualPeriod"]);
    const { asOf, knownAt, targetBasisDate, sourceObservedAt, ledger: rawLedger, annualPeriod: rawPeriod } = options;
    fields(rawPeriod, ["start", "end"]);
    const { start, end } = rawPeriod;
    if (!date(start) || !date(end) || start > end) throw Error("年額配当の対象期間が不正です");
    const annualPeriod = { start, end };
    const captured = captureArray<AnnualDividendPayment>(payments, 20, 1).map(payment => {
        fields(payment, ["paymentId", "amountPerShare", "basisDate", "dividendStatus", "sourceObservedAt"]);
        const { paymentId, amountPerShare, basisDate, dividendStatus, sourceObservedAt: observedAt } = payment;
        if (typeof paymentId !== "string" || !paymentId.trim() || paymentId.length > 256 || !Number.isFinite(amountPerShare) || amountPerShare < 0 ||
            Math.abs(amountPerShare) > Number.MAX_SAFE_INTEGER || !date(basisDate) || basisDate < start || basisDate > end ||
            !["paid", "proposed", "unknown"].includes(dividendStatus) || parseDocumentTimestamp(observedAt, true) === undefined)
            throw Error("年額配当の支払ID/金額/基準日/区分/観測時刻が不正です");
        return { paymentId, amountPerShare, basisDate, dividendStatus, sourceObservedAt: observedAt };
    });
    if (new Set(captured.map(payment => payment.paymentId)).size !== captured.length) throw Error("年額配当の支払IDが重複しています");
    const adjustment = adjustPerShareValuesForSplits(captured.map(payment => ({ value: payment.amountPerShare, basisDate: payment.basisDate })),
        secCode, { asOf, knownAt, targetBasisDate, sourceObservedAt: captured.map(payment => payment.sourceObservedAt), ledger: rawLedger });
    const base = { declaration: "source-reviewed-by-caller" as const, asOf: adjustment.asOf, knownAt: adjustment.knownAt, targetBasisDate: adjustment.targetBasisDate,
        annualPeriod, sourceObservedAt: adjustment.sourceObservedAt, ledger: adjustment.ledger };
    if (adjustment.status === "unavailable") return { ...base, status: "unavailable", reason: adjustment.reason };
    if (end > asOf) return { ...base, status: "unavailable", reason: "annual-period-after-as-of" };
    if (captured.some(payment => payment.dividendStatus === "unknown")) return { ...base, status: "unavailable", reason: "unverified-dividend-status" };
    let sum = { numerator: 0n, denominator: 1n };
    for (const point of adjustment.points)
        sum = reduceFraction(sum.numerator * BigInt(point.exact.denominator) + BigInt(point.exact.numerator) * sum.denominator, sum.denominator * BigInt(point.exact.denominator));
    const totalPerShare = Number(sum.numerator) / Number(sum.denominator);
    if (!Number.isFinite(totalPerShare) || Math.abs(totalPerShare) > Number.MAX_SAFE_INTEGER || totalPerShare === 0 && sum.numerator !== 0n)
        return { ...base, status: "unavailable", reason: "unsafe-annual-dividend-total" };
    const dividendStatus = captured.every(payment => payment.dividendStatus === "paid") ? "paid" as const : "proposed" as const;
    return { ...base, status: "reconstructed", dividendStatus, paid: dividendStatus === "paid", totalPerShare,
        exact: { numerator: String(sum.numerator), denominator: String(sum.denominator) },
        payments: adjustment.points.map((point, index) => ({ ...point, paymentId: captured[index].paymentId,
            originalAmountPerShare: captured[index].amountPerShare, dividendStatus: captured[index].dividendStatus })) };
}
