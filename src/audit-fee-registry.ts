import type { MetricDefinition } from "./metric-registry";

/** 本体/ネットワーク、監査/非監査、提出会社/連結子会社/計を合算せず分離します。 */
export const AuditFeeMetricId = Object.freeze({
    AuditReportingCompany: "auditFeesReportingCompany", NonAuditReportingCompany: "nonAuditFeesReportingCompany",
    AuditConsolidatedSubsidiaries: "auditFeesConsolidatedSubsidiaries", NonAuditConsolidatedSubsidiaries: "nonAuditFeesConsolidatedSubsidiaries",
    AuditTotal: "auditFeesTotal", NonAuditTotal: "nonAuditFeesTotal",
    AuditReportingCompanyNetwork: "auditFeesReportingCompanyNetworkFirms", NonAuditReportingCompanyNetwork: "nonAuditFeesReportingCompanyNetworkFirms",
    AuditConsolidatedSubsidiariesNetwork: "auditFeesConsolidatedSubsidiariesNetworkFirms", NonAuditConsolidatedSubsidiariesNetwork: "nonAuditFeesConsolidatedSubsidiariesNetworkFirms",
    AuditTotalNetwork: "auditFeesTotalNetworkFirms", NonAuditTotalNetwork: "nonAuditFeesTotalNetworkFirms"
} as const);
export type AuditFeeMetricId = typeof AuditFeeMetricId[keyof typeof AuditFeeMetricId];
export const AUDIT_FEE_REGISTRY: Readonly<Record<AuditFeeMetricId, MetricDefinition<AuditFeeMetricId>>> = Object.freeze(
    Object.fromEntries(Object.values(AuditFeeMetricId).map(id => [id, Object.freeze({ id, valueType: "decimal" as const,
        unit: "JPY" as const, periodType: "duration" as const,
        candidates: Object.freeze([Object.freeze({ key: "jpcrp_cor:" + id[0].toUpperCase() + id.slice(1), standard: "J-GAAP" as const, supported: true })]),
        fallback: "ordered-tags-only-no-scope-period-currency-fallback" as const })])) as Record<AuditFeeMetricId, MetricDefinition<AuditFeeMetricId>>);
export const AUDIT_FEE_REGISTRY_VERSION = "1";
