import { createHash } from "node:crypto";
import { EdinetXbrlParser } from "./edinet-xbrl-parser";
import { normalizeFinancialDetailMetadata, type FinancialDetailMetadata } from "./financial-detail-metadata";
import { AUDIT_FEE_REGISTRY, type AuditFeeMetricId } from "./audit-fee-registry";
import type { FactSelectionResult, SelectionReason } from "./metric-selection";
import { ComparisonOperator, SortOrder } from "./financial-options";
export interface AuditFeeDocument { xml: string; metadata: Extract<FinancialDetailMetadata, { period: { startDate: string } }>; }
export interface AuditFeeSnapshot { metadata: AuditFeeDocument["metadata"]; selection: FactSelectionResult<AuditFeeMetricId>; inputXmlSha256: string; }
export interface AuditFeeScreeningOptions { conditions?: readonly { operator: ComparisonOperator; value: number }[]; order?: SortOrder; offset?: number; limit?: number; }
export interface AuditFeeScreeningResult {
    rows: AuditFeeSnapshot[]; total: number; excludedRows: number; filteredRows: number;
    diagnostics: { metadata: AuditFeeDocument["metadata"]; reason: "missing" | "unsupported" | "ambiguous" | "unsafe-number"; selectionReason: SelectionReason }[];
}
export function createAuditFeeSnapshot(document: AuditFeeDocument, metric: AuditFeeMetricId): AuditFeeSnapshot {
    if (!document || !Object.hasOwn(AUDIT_FEE_REGISTRY, metric)) throw new Error("原本と既知の監査報酬項目が必要です");
    const metadata = normalizeFinancialDetailMetadata(document.metadata), xml = document.xml;
    if (metadata.period.instant !== undefined || typeof xml !== "string") throw new Error("期間明細のmetadataとXMLが必要です");
    return { metadata: metadata as AuditFeeDocument["metadata"], selection: new EdinetXbrlParser().parse(xml, metadata.docID).selectAuditFeeMetric(metric, metadata),
        inputXmlSha256: createHash("sha256").update(xml).digest("hex") };
}
/** 同じ期間・scope・基準の明示集合を1項目で検索。監査人や対象会社の同定はしません。 */
export function screenAuditFeeDocuments(documents: readonly AuditFeeDocument[], metric: AuditFeeMetricId, options: AuditFeeScreeningOptions = {}): AuditFeeScreeningResult {
    if (!Object.hasOwn(AUDIT_FEE_REGISTRY, metric) || !Array.isArray(documents) || !options || typeof options !== "object" ||
        Object.keys(options).some(key => !["conditions", "order", "offset", "limit"].includes(key))) throw new Error("監査報酬の検索入力が不正です");
    const { conditions: given = [], order = "desc", offset = 0, limit } = options;
    if (!Array.isArray(given) || !Object.values(SortOrder).includes(order) || [offset, limit].some(n => n !== undefined && (!Number.isSafeInteger(n) || n < 0))) throw new Error("条件/順序/ページが不正です");
    const conditions = Array.from(given, condition => {
        if (!condition || Object.keys(condition).some(key => !["operator", "value"].includes(key))) throw new Error("条件が不正です");
        const { operator, value } = condition;
        if (!Object.values(ComparisonOperator).includes(operator) || !Number.isFinite(value)) throw new Error("有限値の比較条件が必要です");
        return { operator, value };
    });
    const snapshots = Array.from(documents, document => createAuditFeeSnapshot(document, metric)), codes = new Set<string>(), docIDs = new Set<string>();
    let cohort: string | undefined;
    for (const { metadata: m } of snapshots) {
        const key = JSON.stringify([m.period.startDate, m.period.endDate, m.periodType, m.scope, m.accountingStandard, m.currency]);
        if (cohort !== undefined && cohort !== key || codes.has(m.secCode) || docIDs.has(m.docID)) throw new Error("比較範囲混在/会社・書類の重複は使えません");
        cohort = key; codes.add(m.secCode); docIDs.add(m.docID);
    }
    const unavailable = snapshots.filter(s => s.selection.status !== "selected" || s.selection.safeNumber === undefined);
    const available = snapshots.filter(s => s.selection.status === "selected" && s.selection.safeNumber !== undefined);
    const matched = available.filter(s => conditions.every(c => {
        const v = s.selection.safeNumber!;
        switch (c.operator) { case "gt": return v > c.value; case "gte": return v >= c.value; case "lt": return v < c.value; case "lte": return v <= c.value; case "eq": return v === c.value; }
    }));
    matched.sort((a, b) => (a.selection.safeNumber! - b.selection.safeNumber!) * (order === "asc" ? 1 : -1) ||
        (a.metadata.secCode < b.metadata.secCode ? -1 : a.metadata.secCode > b.metadata.secCode ? 1 : 0));
    return { rows: matched.slice(offset, limit === undefined ? undefined : offset + limit), total: matched.length,
        excludedRows: unavailable.length, filteredRows: available.length - matched.length,
        diagnostics: unavailable.map(s => ({ metadata: s.metadata, reason: s.selection.status === "selected" ? "unsafe-number" : s.selection.status, selectionReason: s.selection.reason })) };
}
