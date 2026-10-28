import { createHash } from "node:crypto";
import { EdinetXbrlParser } from "./edinet-xbrl-parser";
import type { EdinetData } from "./edinet-xbrl-object";
import type { EdinetContext } from "./edinet-context";
import type { ContextDimensionsTraceResult } from "./context-dimension-traces";
import { parseReportedTableNumber } from "./reported-table-number";
import { parseDocumentTimestamp } from "./document-timestamp";
import { compareFractions, decimalFraction } from "./decimal-fraction";
import type { ComparisonOperator } from "./financial-options";
export const LARGE_HOLDING_REPORT_VERSION = "1";
const ns = "http://disclosure.edinet-fsa.go.jp/taxonomy/jplvh/2014-07-31/jplvh_cor", dei = "http://disclosure.edinet-fsa.go.jp/taxonomy/jpdei/2013-08-31/jpdei_cor";
export interface LargeHoldingMetadata {
    docID: string; docTypeCode: "350" | "360"; formCode: string; edinetCode: string; issuerEdinetCode: string;
    parentDocID?: string; submitDateTime: string; knownAt: string; coverContextRef: string;
    withdrawalStatus: string; disclosureStatus: string; docInfoEditStatus: string;
}
export interface LargeHoldingDocument { xml: string; metadata: LargeHoldingMetadata; }
export interface LargeHoldingEvidence { key: string; namespaceURI?: string; contextRef: string; raw?: string; unitRef: string; unit?: string; decimals?: string; nil: boolean; reason: string; }
export type LargeHoldingSelection = { evidence: LargeHoldingEvidence[] } & (
    { status: "selected"; reason: "selected" | "selected-identical-duplicates"; raw: string; decimal?: string; safeNumber?: number; valueUnit?: "percent" | "count" | "share-or-unit-equivalents"; multiplier?: 1 | 100; source: LargeHoldingEvidence } |
    { status: "missing" | "unsupported" | "ambiguous"; reason: string }
);
export const LargeHoldingMetric = Object.freeze({ HeldEquivalents: "heldEquivalents", PotentialEquivalents: "potentialEquivalents", OutstandingEquivalents: "outstandingEquivalents", HoldingPercent: "holdingPercent", PreviousHoldingPercent: "previousHoldingPercent" } as const);
export type LargeHoldingMetric = typeof LargeHoldingMetric[keyof typeof LargeHoldingMetric];
export interface LargeHoldingRow {
    rowKey: string; contextRef: string; role: "filer" | "joint-holder" | "reported-aggregate"; identity: "not-established";
    member?: { namespaceURI: string; localName: string }; name: LargeHoldingSelection;
    /** BaseDateは発行済株式等総数の基準日。保有日や義務発生日に置換しません。 */
    outstandingAsOf: LargeHoldingSelection;
    values: Record<LargeHoldingMetric, LargeHoldingSelection>;
    denominatorDefinition: "reported-T-over-U-plus-V";
}
export interface LargeHoldingReport {
    metadata: LargeHoldingMetadata; inputXmlSha256?: string; version: typeof LARGE_HOLDING_REPORT_VERSION;
    reportKind: "initial" | "change" | "correction"; reconstruction: "not-performed";
    status: "selected" | "unsupported";
    cover: Record<"title" | "filerName" | "dutyDate" | "filingDate" | "filerCount" | "amendmentFlag" | "documentForm" | "arrangement", LargeHoldingSelection>;
    issuer: { name: LargeHoldingSelection; securityCode: LargeHoldingSelection; declaredEdinetCode: string; identity: "not-established" };
    rows: LargeHoldingRow[];
    reportTotal: { status: "selected"; rowKey: string; basis: "explicit-aggregate" | "single-holder-report" } | { status: "unavailable"; reason: string };
    traces: { contextRef: string; context?: EdinetContext; trace: ContextDimensionsTraceResult }[];
    diagnostics: { reason: string; contextRef?: string }[];
}
const validDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const fraction = (s: string) => { const [i, f = ""] = s.split("."); return { numerator: BigInt(i + f), denominator: 10n ** BigInt(f.length) }; };
const dateJST = (ms: number) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
function captureMetadata(input: LargeHoldingMetadata): LargeHoldingMetadata {
    if (!input || Object.keys(input).some(k => !["docID", "docTypeCode", "formCode", "edinetCode", "issuerEdinetCode", "parentDocID", "submitDateTime", "knownAt", "coverContextRef", "withdrawalStatus", "disclosureStatus", "docInfoEditStatus"].includes(k))) throw new Error("大量保有の一覧メタデータを指定してください");
    const { docID, docTypeCode, formCode, edinetCode, issuerEdinetCode, parentDocID, submitDateTime, knownAt, coverContextRef, withdrawalStatus, disclosureStatus, docInfoEditStatus } = input;
    const submitted = parseDocumentTimestamp(submitDateTime, false), known = parseDocumentTimestamp(knownAt, true);
    if (typeof docID !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(docID) || !["350", "360"].includes(docTypeCode) || typeof formCode !== "string" || !/^\d{6}$/.test(formCode) || !/^E\d{5}$/.test(edinetCode) || !/^E\d{5}$/.test(issuerEdinetCode) ||
        parentDocID !== undefined && (typeof parentDocID !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(parentDocID) || parentDocID === docID) || docTypeCode === "360" && !parentDocID || submitted === undefined || known === undefined || known < submitted || typeof coverContextRef !== "string" || !coverContextRef.trim() || coverContextRef.length > 1000 || [withdrawalStatus, disclosureStatus, docInfoEditStatus].some(v => typeof v !== "string" || v.length > 20)) throw new Error("大量保有の書類ID/種別/親/提出日時/観測日時を確認してください");
    return { docID, docTypeCode, formCode, edinetCode, issuerEdinetCode, parentDocID, submitDateTime, knownAt, coverContextRef, withdrawalStatus, disclosureStatus, docInfoEditStatus };
}
type Kind = "text" | "date" | "boolean" | "count" | "ratio";
/** @internal parserが収集したfact/context/unitとQName証跡を照合します。DTSの認証ではありません。 */
export function selectLargeHoldingReport(input: LargeHoldingMetadata, facts: ReadonlyMap<string, readonly EdinetData[]>, contexts: ReadonlyMap<string, EdinetContext>, units: ReadonlyMap<string, string>, duplicates: ReadonlySet<string>, trace: (ref: string) => ContextDimensionsTraceResult): LargeHoldingReport {
    const m = captureMetadata(input), ref = m.coverContextRef, coverContext = contexts.get(ref), traces = new Map<string, LargeHoldingReport["traces"][number]>();
    const traceFor = (id: string) => { let item = traces.get(id); if (!item) { item = { contextRef: id, context: contexts.get(id), trace: trace(id) }; traces.set(id, item); } return item.trace; };
    const commonContext = (id: string) => { const c = contexts.get(id); return !!c?.namespaceVerified && !!c.periodValid && validDate(c.period.instant) && c.period.startDate === undefined && c.period.endDate === undefined && !duplicates.has(id) && traceFor(id).status === "resolved" && c.entity?.scheme === "http://disclosure.edinet-fsa.go.jp" && c.entity.identifier === m.edinetCode + "-000" && c.period.instant === coverContext?.period.instant; };
    let candidates = 0;
    function field(tag: string, contextRef: string, kind: Kind, unit?: string, namespace = ns): LargeHoldingSelection {
        const evidence: LargeHoldingEvidence[] = [];
        for (const [key, list] of facts) if (key.split(":").length === 2 && key.split(":")[1] === tag) for (const f of list) if (f.contextRef === contextRef) {
            if (++candidates > 10000) throw new Error("大量保有の候補は10000件以下です");
            let reason = "selected";
            if (f.namespaceURI !== namespace) reason = "unknown-namespace";
            else if (!commonContext(contextRef)) reason = "unsupported-context";
            else if (unit ? units.get(f.unitRef) !== unit : !!f.unitRef) reason = "unsupported-unit";
            else if (f.nil) reason = "nil";
            else if (f.rawValue === undefined) reason = "raw-unavailable";
            else if (!f.rawValue.trim()) reason = "blank";
            else if (kind === "date" && !validDate(f.rawValue)) reason = "invalid-date";
            else if (kind === "boolean" && !["true", "false", "1", "0"].includes(f.rawValue)) reason = "invalid-boolean";
            else if (["count", "ratio"].includes(kind) && (!/^\+?(?:\d+(?:\.\d*)?|\.\d+)$/.test(f.rawValue) || f.rawValue.length > 100)) reason = "invalid-number";
            evidence.push({ key, namespaceURI: f.namespaceURI, contextRef, raw: f.rawValue, unitRef: f.unitRef, unit: units.get(f.unitRef), decimals: f.rawDecimals, nil: f.nil, reason });
        }
        if (!evidence.length) return { status: "missing", reason: "tag-absent", evidence };
        const first = evidence[0], signature = (e: LargeHoldingEvidence) => JSON.stringify([e.namespaceURI, e.contextRef, e.raw, e.unitRef, e.unit, e.decimals, e.nil, e.reason]);
        if (evidence.some(e => signature(e) !== signature(first))) return { status: "ambiguous", reason: "conflicting-facts", evidence };
        if (first.reason !== "selected") return { status: first.reason === "nil" || first.reason === "blank" ? "missing" : "unsupported", reason: first.reason, evidence };
        let numeric: { decimal: string; safeNumber?: number; valueUnit: "percent" | "count" | "share-or-unit-equivalents"; multiplier: 1 | 100 } | undefined;
        if (kind === "count" || kind === "ratio") {
            let raw = first.raw!.replace(/^\+/, ""); if (raw.startsWith(".")) raw = "0" + raw; if (raw.endsWith(".")) raw += "0";
            const n = parseReportedTableNumber(raw, kind === "ratio" ? 100 : 1);
            if (n.status !== "numeric") { for (const e of evidence) e.reason = "invalid-number"; return { status: "unsupported", reason: "invalid-number", evidence }; }
            const f = fraction(n.decimal);
            if (kind === "count" && f.numerator % f.denominator !== 0n || kind === "ratio" && f.numerator > 100n * f.denominator) {
                const reason = kind === "count" ? "non-integer-count" : "out-of-range-ratio";
                for (const e of evidence) e.reason = reason;
                return { status: "unsupported", reason, evidence };
            }
            numeric = { decimal: n.decimal, safeNumber: n.safeNumber, valueUnit: kind === "ratio" ? "percent" : unit === "xbrli:pure" ? "count" : "share-or-unit-equivalents", multiplier: kind === "ratio" ? 100 : 1 };
        }
        return { status: "selected", reason: evidence.length > 1 ? "selected-identical-duplicates" : "selected", raw: first.raw!, source: first, evidence, ...numeric };
    }
    const cover: LargeHoldingReport["cover"] = { title: field("DocumentTitleCoverPage", ref, "text"), filerName: field("NameCoverPage", ref, "text"), dutyDate: field("DateWhenFilingRequirementAroseCoverPage", ref, "date"), filingDate: field("FilingDateCoverPage", ref, "date"), filerCount: field("TotalNumberOfFilersAndJointHoldersCoverPage", ref, "count", "xbrli:pure"), amendmentFlag: field("AmendmentFlagDEI", ref, "boolean", undefined, dei), documentForm: field("DocumentTypeDEI", ref, "text", undefined, dei), arrangement: field("ArrangementOfFilingCoverPage", ref, "text") };
    const issuer = { name: field("NameOfIssuer", ref, "text"), securityCode: field("SecurityCodeOfIssuer", ref, "text"), declaredEdinetCode: m.issuerEdinetCode, identity: "not-established" as const };
    const reportKind = m.docTypeCode === "360" ? "correction" : m.formCode.endsWith("002") ? "change" : "initial";
    const result: LargeHoldingReport = { metadata: m, version: LARGE_HOLDING_REPORT_VERSION, reportKind, reconstruction: "not-performed", status: "selected", cover, issuer, rows: [], reportTotal: { status: "unavailable", reason: "report-total-not-established" }, traces: [], diagnostics: [] };
    const stop = (reason: string) => { result.status = "unsupported"; result.diagnostics.push({ reason }); result.traces = [...traces.values()]; return structuredClone(result); };
    const ok = (s: LargeHoldingSelection): s is Extract<LargeHoldingSelection, { status: "selected" }> => s.status === "selected";
    if ([m.withdrawalStatus, m.disclosureStatus, m.docInfoEditStatus].some(v => v !== "0")) return stop("unavailable-document-status");
    if (!commonContext(ref) || traceFor(ref).candidates[0]?.dimensions.length !== 0) return stop("unsupported-cover-context");
    if (!Object.values(cover).every(ok) || !ok(issuer.name) || !ok(issuer.securityCode)) return stop("cover-unavailable");
    const selectedCover = cover as Record<keyof typeof cover, Extract<LargeHoldingSelection, { status: "selected" }>>;
    if (selectedCover.filerCount.safeNumber === 0) return stop("unsupported-filer-count");
    const amended = ["true", "1"].includes(selectedCover.amendmentFlag.raw), submittedDate = dateJST(parseDocumentTimestamp(m.submitDateTime, false)!);
    if (m.docTypeCode === "360" ? m.formCode !== "090001" || !amended : !["010000", "010002", "020000", "020002"].includes(m.formCode) || amended) return stop("metadata-form-mismatch");
    if (!["第一号様式", "第一号及び第二号様式"].includes(selectedCover.documentForm.raw) || selectedCover.filingDate.raw !== coverContext!.period.instant || selectedCover.filingDate.raw > submittedDate || m.docTypeCode === "350" && selectedCover.filingDate.raw !== submittedDate || selectedCover.dutyDate.raw > selectedCover.filingDate.raw ||
        reportKind === "initial" && !selectedCover.title.raw.startsWith("大量保有報告書") || reportKind === "change" && !selectedCover.title.raw.startsWith("変更報告書")) return stop("metadata-cover-mismatch");
    const tags: Record<LargeHoldingMetric, string> = { heldEquivalents: "TotalNumberOfStocksEtcHeld", potentialEquivalents: "NumberOfResidualStocksHeld", outstandingEquivalents: "TotalNumberOfOutstandingStocksEtc", holdingPercent: "HoldingRatioOfShareCertificatesEtc", previousHoldingPercent: "HoldingRatioOfShareCertificatesEtcPerLastReport" };
    if (contexts.size > 1000) throw new Error("大量保有のcontextは1000件以下です");
    for (const [contextRef, context] of contexts) {
        if (!commonContext(contextRef)) { result.diagnostics.push({ reason: "unsupported-holder-context", contextRef }); continue; }
        const dims = traceFor(contextRef).candidates[0]?.dimensions, dim = dims?.[0]; let role: LargeHoldingRow["role"], member: LargeHoldingRow["member"];
        if (dims?.length === 0 && contextRef === ref) role = "reported-aggregate";
        else {
            const binding = dim?.kind === "explicit" ? dim.member.namespaceURI?.match(/^http:\/\/disclosure\.edinet-fsa\.go\.jp\/jplvh0[12]0000\/lvh\/\d{3}\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/\d{2}\/(\d{4}-\d{2}-\d{2})$/) : undefined;
            const local = dim?.kind === "explicit" ? dim.member.localName : undefined;
            if (dims?.length !== 1 || dim?.kind !== "explicit" || dim.location !== "scenario" || dim.axis.status !== "resolved" || dim.axis.namespaceURI !== ns || dim.axis.localName !== "FilersLargeVolumeHoldersAndJointHoldersAxis" || dim.member.status !== "resolved" || !binding || binding[1] !== context.entity!.identifier || !validDate(binding[2]) || !validDate(binding[3]) || !/^(?:FilerLargeVolumeHolder|JointHolder)[1-9]\d{0,3}Member$/.test(local ?? "")) { result.diagnostics.push({ reason: "unsupported-holder-dimension", contextRef }); continue; }
            role = local!.startsWith("Filer") ? "filer" : "joint-holder"; member = { namespaceURI: dim.member.namespaceURI!, localName: local! };
        }
        const values = Object.fromEntries(Object.entries(tags).map(([id, tag]) => [id, field(tag, contextRef, id.endsWith("Percent") ? "ratio" : "count", id.endsWith("Percent") ? "xbrli:pure" : "xbrli:shares")])) as Record<LargeHoldingMetric, LargeHoldingSelection>;
        if (role === "reported-aggregate" && Object.values(values).every(v => v.status === "missing" && v.reason === "tag-absent")) continue;
        result.rows.push({ rowKey: createHash("sha256").update(JSON.stringify([m.docID, contextRef, member])).digest("hex"), contextRef, role, member, identity: "not-established", name: field("Name", contextRef, "text"), outstandingAsOf: field("BaseDate", contextRef, "date"), values, denominatorDefinition: "reported-T-over-U-plus-V" });
    }
    result.rows.sort((a, b) => a.contextRef < b.contextRef ? -1 : a.contextRef > b.contextRef ? 1 : 0);
    const aggregates = result.rows.filter(r => r.role === "reported-aggregate"), holders = result.rows.filter(r => r.role !== "reported-aggregate");
    if (aggregates.length === 1) result.reportTotal = { status: "selected", rowKey: aggregates[0].rowKey, basis: "explicit-aggregate" };
    else if (aggregates.length === 0 && holders.length === 1 && selectedCover.filerCount.safeNumber === 1) result.reportTotal = { status: "selected", rowKey: holders[0].rowKey, basis: "single-holder-report" };
    if (selectedCover.filerCount.safeNumber !== holders.length) result.diagnostics.push({ reason: "holder-count-mismatch" });
    result.traces = [...traces.values()]; return structuredClone(result);
}
export function extractLargeHoldingReport(document: LargeHoldingDocument): LargeHoldingReport {
    if (!document) throw new Error("大量保有の原本が必要です"); const metadata = captureMetadata(document.metadata), xml = document.xml;
    const result = new EdinetXbrlParser().parse(xml, metadata.docID).selectLargeHoldingReport(metadata);
    return { ...result, inputXmlSha256: createHash("sha256").update(xml).digest("hex") };
}
export interface LargeHoldingSearchOptions { cutoff: string; dutyDate: string; scope: "report" | "holder"; metric: LargeHoldingMetric; holderContains?: string; issuerEdinetCode?: string; condition?: { operator: ComparisonOperator; value: number }; sort?: "value-asc" | "value-desc"; offset?: number; limit?: number; }
export function searchLargeHoldingReports(documents: readonly LargeHoldingDocument[], options: LargeHoldingSearchOptions): { reports: LargeHoldingReport[]; rows: { sourceIndex: number; row: LargeHoldingRow }[]; matched: number; filtered: number; excluded: { docID: string; rowKey?: string; reason: string }[] } {
    if (!Array.isArray(documents) || documents.length > 100 || !options) throw new Error("大量保有検索は100原本以下です");
    const { cutoff, dutyDate, scope, metric, holderContains, issuerEdinetCode, condition, sort, offset = 0, limit = 100 } = options, cut = parseDocumentTimestamp(cutoff, true);
    if (cut === undefined || !validDate(dutyDate) || !["report", "holder"].includes(scope) || !Object.values(LargeHoldingMetric).includes(metric) || holderContains !== undefined && (typeof holderContains !== "string" || !holderContains.trim() || holderContains.length > 1000) || issuerEdinetCode !== undefined && !/^E\d{5}$/.test(issuerEdinetCode) || condition !== undefined && (!condition || typeof condition !== "object" || Array.isArray(condition) || !["gt", "gte", "lt", "lte", "eq"].includes(condition.operator) || !Number.isFinite(condition.value)) || sort !== undefined && !["value-asc", "value-desc"].includes(sort) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("大量保有検索のcutoff/義務発生日/範囲/条件を確認してください");
    const all = Array.from(documents, d => { if (!d) throw new Error("原本が必要です"); return { xml: d.xml, metadata: captureMetadata(d.metadata) }; }).sort((a, b) => a.metadata.docID < b.metadata.docID ? -1 : a.metadata.docID > b.metadata.docID ? 1 : 0);
    if (all.some(d => typeof d.xml !== "string") || all.reduce((n, d) => n + Buffer.byteLength(d.xml), 0) > 256 * 1024 * 1024 || new Set(all.map(d => d.metadata.docID)).size !== all.length) throw new Error("大量保有の原本重複/上限を確認してください");
    const excluded: { docID: string; rowKey?: string; reason: string }[] = [], inputs = all.filter(d => { const known = parseDocumentTimestamp(d.metadata.knownAt, true)!, submitted = parseDocumentTimestamp(d.metadata.submitDateTime, false)!; if (known > cut || submitted > cut) { excluded.push({ docID: d.metadata.docID, reason: "not-known-at-cutoff" }); return false; } return true; });
    const ids = new Set(inputs.map(d => d.metadata.docID)), parents = new Set<string>();
    for (const d of inputs) if (d.metadata.docTypeCode === "360" && d.metadata.parentDocID) { if (ids.has(d.metadata.parentDocID) || parents.has(d.metadata.parentDocID)) throw new Error("訂正系列を先に選んでください。親子/競合する訂正を同時に検索できません"); parents.add(d.metadata.parentDocID); }
    const reports: LargeHoldingReport[] = [], rows: { sourceIndex: number; row: LargeHoldingRow }[] = []; let filtered = 0, count = 0;
    for (const input of inputs) {
        const report = extractLargeHoldingReport(input), sourceIndex = reports.length; reports.push(report); count += report.rows.length; if (count > 10000) throw new Error("大量保有検索は10000保有者行以下です");
        if (report.status !== "selected") { excluded.push({ docID: input.metadata.docID, reason: report.diagnostics[0]?.reason ?? "unsupported" }); continue; }
        if (report.cover.dutyDate.status !== "selected" || report.cover.dutyDate.raw !== dutyDate || issuerEdinetCode && report.metadata.issuerEdinetCode !== issuerEdinetCode) { filtered++; continue; }
        const totalRowKey = report.reportTotal.status === "selected" ? report.reportTotal.rowKey : undefined;
        const selected = scope === "report" ? report.rows.filter(r => r.rowKey === totalRowKey) : report.rows.filter(r => r.role !== "reported-aggregate");
        if (scope === "report" && !selected.length) excluded.push({ docID: input.metadata.docID, reason: "report-total-not-established" });
        for (const row of selected) {
            if (holderContains && (row.name.status !== "selected" || !row.name.raw.includes(holderContains))) { filtered++; continue; }
            const v = row.values[metric]; if (v.status !== "selected" || v.decimal === undefined) { excluded.push({ docID: input.metadata.docID, rowKey: row.rowKey, reason: v.status === "selected" ? "non-numeric" : v.reason }); continue; }
            if (condition) { const n = compareFractions(fraction(v.decimal), decimalFraction(condition.value)); if (!(condition.operator === "gt" ? n > 0 : condition.operator === "gte" ? n >= 0 : condition.operator === "lt" ? n < 0 : condition.operator === "lte" ? n <= 0 : n === 0)) { filtered++; continue; } }
            rows.push({ sourceIndex, row });
        }
    }
    if (sort) rows.sort((a, b) => { const x = a.row.values[metric], y = b.row.values[metric]; return x.status === "selected" && y.status === "selected" && x.decimal !== undefined && y.decimal !== undefined ? compareFractions(fraction(x.decimal), fraction(y.decimal)) * (sort === "value-asc" ? 1 : -1) : 0; });
    return { reports, rows: rows.slice(offset, offset + limit), matched: rows.length, filtered, excluded };
}
