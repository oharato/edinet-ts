import { BALANCE_SHEET_REGISTRY, type BalanceSheetMetricId } from "./balance-sheet-registry";
import { calculateCurrentRatio, type CurrentRatioResult, type BalanceSheetSnapshotMetadata } from "./balance-sheet-screening";
import { compareFractions } from "./decimal-fraction";
import { BalanceSheetSqliteStore, type StoredBalanceSheetSnapshot, type BalanceSheetProvenance } from "./db/balance-sheet-store";
import type { FactSelectionEvidence, FactSelectionResult } from "./metric-selection";

export const BalanceSheetDiffStatus = Object.freeze({ Changed: "changed", Unchanged: "unchanged", Incomparable: "incomparable" } as const);
export type BalanceSheetDiffStatus = typeof BalanceSheetDiffStatus[keyof typeof BalanceSheetDiffStatus];
export const BalanceSheetValueComparison = Object.freeze({ Equal: "equal", Changed: "changed", Unavailable: "unavailable", NotComparable: "not-comparable" } as const);
export type BalanceSheetValueComparison = typeof BalanceSheetValueComparison[keyof typeof BalanceSheetValueComparison];
export interface BalanceSheetComparisonIssue {
    field: keyof BalanceSheetSnapshotMetadata | "sourceSha256" | "entity";
    reason: "different" | "unknown-entity";
    message: string;
}
export interface BalanceSheetMetricDiff {
    before: FactSelectionResult<BalanceSheetMetricId>;
    after: FactSelectionResult<BalanceSheetMetricId>;
    valueComparison: BalanceSheetValueComparison;
    changes: { raw: boolean; status: boolean; reason: boolean; source: boolean; evidence: boolean; numberAvailability: boolean; };
    summary: string;
}
type RatioDescription = Omit<Extract<CurrentRatioResult, { status: "calculated" }>, "inputs"> |
    Omit<Extract<CurrentRatioResult, { status: "unavailable" }>, "inputs">;
export interface BalanceSheetVersionDiff {
    /** 財務値/採用/出典/候補の変化。解析版だけの変更はここへ含めません。 */
    status: BalanceSheetDiffStatus;
    before: { id: string; metadata: BalanceSheetSnapshotMetadata; provenance: BalanceSheetProvenance; };
    after: { id: string; metadata: BalanceSheetSnapshotMetadata; provenance: BalanceSheetProvenance; };
    issues: BalanceSheetComparisonIssue[];
    provenanceChanges: (keyof BalanceSheetProvenance)[];
    metrics: Record<BalanceSheetMetricId, BalanceSheetMetricDiff>;
    currentRatio: { before: RatioDescription; after: RatioDescription; valueComparison: BalanceSheetValueComparison;
        statusChanged: boolean; reasonChanged: boolean; summary: string; };
    summary: string;
}
const ids = Object.keys(BALANCE_SHEET_REGISTRY) as BalanceSheetMetricId[];
function canonical(value: unknown): string {
    return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, item[key]])) : item) ?? "undefined";
}
/** 等値だけを十進文字列で判定。巨大整数をnumber/64bitへ変換せず、差額計算は行いません。 */
function decimalIdentity(raw: string): string {
    const negative = raw.startsWith("-");
    const [integer, fraction = ""] = raw.replace(/^[+-]/, "").split(".");
    const left = (integer || "0").replace(/^0+(?=\d)/, ""), right = fraction.replace(/0+$/, "");
    return `${negative && (left !== "0" || right) ? "-" : ""}${left}${right ? "." + right : ""}`;
}
function sourceIdentity(source: FactSelectionEvidence | undefined): string {
    if (!source) return "undefined";
    const { raw: _raw, reason: _reason, ...identity } = source;
    return canonical(identity);
}
function evidenceIdentity(evidence: readonly FactSelectionEvidence[]): string {
    return JSON.stringify(evidence.map(canonical).sort()); // 順序だけの差を変化としない。重複数は保持。
}
function entityOf(row: StoredBalanceSheetSnapshot): string | undefined {
    const entities = new Set(ids.flatMap(id => {
        const selected = row.snapshot.selections[id];
        return selected.status === "selected" && selected.source.entity
            ? [canonical(selected.source.entity)] : [];
    }));
    return entities.size === 1 ? [...entities][0] : undefined;
}
function describe(row: StoredBalanceSheetSnapshot): BalanceSheetVersionDiff["before"] {
    const { selections: _selections, ...metadata } = row.snapshot;
    return { id: row.id, metadata, provenance: row.provenance };
}
function ratioDescription(value: CurrentRatioResult): RatioDescription {
    const { inputs: _inputs, ...description } = value;
    return description;
}

/** 指定した同一原本の2解析結果を読むだけで比較します。版の新旧・訂正後を自動判断しません。 */
export function compareBalanceSheetVersions(store: BalanceSheetSqliteStore, beforeId: string, afterId: string): BalanceSheetVersionDiff {
    const [before, after] = store.getMany([beforeId, afterId]);
    const issues: BalanceSheetComparisonIssue[] = [];
    const labels: Record<keyof BalanceSheetSnapshotMetadata, string> = { secCode: "会社", docID: "書類ID", instant: "対象日", scope: "連結/単体", accountingStandard: "会計基準", currency: "通貨" };
    for (const field of Object.keys(labels) as (keyof BalanceSheetSnapshotMetadata)[]) if (before.snapshot[field] !== after.snapshot[field]) issues.push({ field, reason: "different", message: `${labels[field]}が異なるため比較しません` });
    if (before.provenance.sourceSha256 !== after.provenance.sourceSha256) issues.push({ field: "sourceSha256", reason: "different", message: "原本が異なるため、同じ原本の再解析としては比較しません" });
    const aEntity = entityOf(before), bEntity = entityOf(after);
    if (!aEntity || !bEntity) issues.push({ field: "entity", reason: "unknown-entity", message: "採用値から対象企業を確認できないため比較しません" });
    else if (aEntity !== bEntity) issues.push({ field: "entity", reason: "different", message: "採用値の対象企業が異なるため比較しません" });
    const comparable = issues.length === 0;
    const provenanceChanges = (["sourceSha256", "extractorVersion", "mappingVersion", "sourceCommit"] as const).filter(key => before.provenance[key] !== after.provenance[key]);
    const metrics = {} as BalanceSheetVersionDiff["metrics"];
    for (const id of ids) {
        const a = before.snapshot.selections[id], b = after.snapshot.selections[id];
        const changes = { raw: a.raw !== b.raw, status: a.status !== b.status, reason: a.reason !== b.reason,
            source: sourceIdentity(a.source) !== sourceIdentity(b.source), evidence: evidenceIdentity(a.evidence) !== evidenceIdentity(b.evidence),
            numberAvailability: (a.safeNumber !== undefined) !== (b.safeNumber !== undefined) };
        const valueComparison: BalanceSheetValueComparison = !comparable ? "not-comparable" : a.status !== "selected" || b.status !== "selected" ? "unavailable"
            : decimalIdentity(a.raw) === decimalIdentity(b.raw) ? "equal" : "changed";
        const messages = !comparable ? ["対象が揃わないため数値を比較しません"] : valueComparison === "unavailable" ? ["両方に採用値が揃わず数値は比較できません"]
            : [valueComparison === "changed" ? "数値が変わりました" : "数値は同じです"];
        if (changes.status || changes.reason) messages.push("採用状態または理由に変化があります");
        if (changes.source) messages.push("採用元の情報に変化があります");
        if (changes.raw && valueComparison === "equal") messages.push("元の数値表記に変化があります");
        if (changes.evidence) messages.push("候補の記録に変化があります");
        metrics[id] = { before: a, after: b, changes, valueComparison, summary: messages.join("。") + "。" };
    }
    const aRatio = calculateCurrentRatio(before.snapshot), bRatio = calculateCurrentRatio(after.snapshot);
    const ratioValue: BalanceSheetValueComparison = !comparable ? "not-comparable" : aRatio.status !== "calculated" || bRatio.status !== "calculated" ? "unavailable"
        : compareFractions({ numerator: BigInt(aRatio.exact.numerator), denominator: BigInt(aRatio.exact.denominator) },
            { numerator: BigInt(bRatio.exact.numerator), denominator: BigInt(bRatio.exact.denominator) }) === 0 ? "equal" : "changed";
    const currentRatio = { before: ratioDescription(aRatio), after: ratioDescription(bRatio), valueComparison: ratioValue,
        statusChanged: aRatio.status !== bRatio.status, reasonChanged: aRatio.reason !== bRatio.reason,
        summary: ratioValue === "not-comparable" ? "対象が揃わないため流動比率を比較しません。" : ratioValue === "unavailable" ? "両方に計算できる流動比率が揃いません。欠損や分母0を0で補いません。"
            : ratioValue === "equal" ? "流動比率は厳密な分数で同じです。" : "流動比率が変わりました。" };
    const status: BalanceSheetDiffStatus = !comparable ? "incomparable" : ids.some(id => Object.values(metrics[id].changes).some(Boolean)) || ratioValue === "changed" || currentRatio.statusChanged || currentRatio.reasonChanged ? "changed" : "unchanged";
    const summary = status === "incomparable" ? "比較条件が揃いません。値の差を再解析による変化とは判断しません。" :
        (status === "unchanged" ? "財務3項目の原値・採用状態・出典・候補に変化はありません。" : "財務3項目または計算結果に変化があります。項目ごとの理由を確認してください。") +
        (provenanceChanges.length ? "解析版などの来歴情報には変化があります。" : "来歴情報も同じです。");
    return { status, before: describe(before), after: describe(after), issues, provenanceChanges, metrics, currentRatio, summary };
}
