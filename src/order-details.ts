import { createHash } from "node:crypto";
import type { CompanyProfile } from "./company-profile";
import { EdinetXbrlParser } from "./edinet-xbrl-parser";
import { DisclosureTableKind, type DisclosureTableDocument, type DisclosureTableExtraction } from "./disclosure-tables";
import { AccountingStandard } from "./metric-registry";
import { ConsolidationScope, type ComparisonOperator } from "./financial-options";
import { parseReportedTableNumber } from "./reported-table-number";
import { decimalFraction, compareFractions } from "./decimal-fraction";
export const ORDER_DETAILS_VERSION = "1";
export const OrderMetric = Object.freeze({ OrdersReceivedJPY: "ordersReceivedJPY", CompletedConstructionJPY: "completedConstructionJPY", SalesJPY: "salesJPY", OpeningBacklogJPY: "openingBacklogJPY", ClosingBacklogJPY: "closingBacklogJPY" } as const);
export type OrderMetric = typeof OrderMetric[keyof typeof OrderMetric];
export interface OrderPeriod { startDate: string; endDate: string; }
export interface OrderTableDeclaration { tableIndex: number; period: OrderPeriod; scope: ConsolidationScope; rawSha256: string; }
export interface OrderDetailDocument extends DisclosureTableDocument { accountingStandard: typeof AccountingStandard.JGAAP; declarations: readonly OrderTableDeclaration[]; }
export type OrderValue = { unit: "JPY"; multiplier: 1000000; periodBasis: "duration" | "period-start-opening" | "period-end" } & (
    ({ cellIndex: number; raw: string } & ReturnType<typeof parseReportedTableNumber>) | { status: "missing"; reason: "not-in-table" }
);
export interface OrderDetailRow {
    rowKey: string; tableIndex: number; rowIndex: number; label: { cellIndex: number; raw: string };
    identity: "source-label-only"; role: "detail" | "subtotal" | "reported-total"; scope: ConsolidationScope; period: OrderPeriod;
    periodEvidence: { basis: "source-period-cell"; cellIndex: number; raw: string } | { basis: "reviewed-declaration-and-profile" };
    values: Record<OrderMetric, OrderValue>;
}
export interface OrderDetailExtraction {
    source: DisclosureTableExtraction; profile: Pick<CompanyProfile["fields"], "accountingStandard" | "fiscalYearStartDate" | "fiscalYearEndDate">; declarations: OrderTableDeclaration[]; measurementDefinition: "reported-not-normalized"; rows: OrderDetailRow[];
    diagnostics: { reason: "unsupported-profile" | "unsupported-context" | "unsupported-layout" | "unsupported-scope" | "period-not-found" | "ambiguous-row" | "empty-category-row"; tableIndex?: number; rowIndex?: number }[];
}
const normalize = (s: string) => s.normalize("NFKC").replace(/\s/g, "");
const validDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const samePeriod = (a: OrderPeriod, b: OrderPeriod) => a.startDate === b.startDate && a.endDate === b.endDate;
const metrics = Object.values(OrderMetric), scopes = Object.values(ConsolidationScope);
function period(p: OrderPeriod): OrderPeriod {
    if (!p || Object.keys(p).some(k => !["startDate", "endDate"].includes(k)) || !validDate(p.startDate) || !validDate(p.endDate) || p.startDate > p.endDate) throw new Error("受注の開始日/終了日を確認してください");
    return { startDate: p.startDate, endDate: p.endDate };
}
function capture(input: OrderDetailDocument): OrderDetailDocument {
    if (!input?.selection || input.accountingStandard !== AccountingStandard.JGAAP || input.selection.kind !== DisclosureTableKind.ManagementAnalysis || !Array.isArray(input.declarations) || !input.declarations.length || input.declarations.length > 100) throw new Error("確認済みの受注原本と表宣言が必要です");
    const { xml, selection: { docID, kind, contextRef }, accountingStandard } = input;
    const seen = new Set<string>();
    const declarations = Array.from(input.declarations as readonly OrderTableDeclaration[], d => {
        if (!d || Object.keys(d).some(k => !["tableIndex", "period", "scope", "rawSha256"].includes(k)) || !Number.isSafeInteger(d.tableIndex) || d.tableIndex < 0 || !scopes.includes(d.scope) || typeof d.rawSha256 !== "string" || !/^[a-f0-9]{64}$/.test(d.rawSha256)) throw new Error("受注表の位置/範囲/本文参照が不正です");
        const p = period(d.period), key = JSON.stringify([d.tableIndex, p]);
        if (seen.has(key)) throw new Error("受注表の期間宣言が重複しています"); seen.add(key);
        return { tableIndex: d.tableIndex, period: p, scope: d.scope, rawSha256: d.rawSha256 };
    });
    return { xml, selection: { docID, kind, contextRef }, accountingStandard, declarations };
}
function sourcePeriod(raw: string): OrderPeriod | undefined {
    if (!/^(?:前事業年度|当事業年度|第\d+期)\(自\d{4}年\d{1,2}月\d{1,2}日至\d{4}年\d{1,2}月\d{1,2}日\)$/.test(normalize(raw))) return;
    const matches = [...normalize(raw).matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/g)];
    if (matches.length !== 2 || !normalize(raw).includes("自") || !normalize(raw).includes("至")) return;
    const dates = matches.map(m => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
    if (dates.some(d => !validDate(d)) || dates[0] > dates[1]) return;
    return { startDate: dates[0], endDate: dates[1] };
}
const basis = (metric: OrderMetric): OrderValue["periodBasis"] => metric === "openingBacklogJPY" ? "period-start-opening" : metric === "closingBacklogJPY" ? "period-end" : "duration";
const role = (label: string): OrderDetailRow["role"] => ["合計", "計", "総計"].includes(normalize(label)) ? "reported-total" : ["工事計", "兼業計", "小計"].includes(normalize(label)) ? "subtotal" : "detail";
export function extractOrderDetails(input: OrderDetailDocument): OrderDetailExtraction {
    const d = capture(input), object = new EdinetXbrlParser().parse(d.xml, d.selection.docID), profile = object.getCompanyProfile();
    const source = { ...object.selectDisclosureTables(d.selection.kind, d.selection.contextRef), inputXmlSha256: createHash("sha256").update(d.xml).digest("hex") };
    const result: OrderDetailExtraction = { source, profile: { accountingStandard: profile.fields.accountingStandard, fiscalYearStartDate: profile.fields.fiscalYearStartDate, fiscalYearEndDate: profile.fields.fiscalYearEndDate }, declarations: structuredClone(d.declarations) as OrderTableDeclaration[], measurementDefinition: "reported-not-normalized", rows: [], diagnostics: [] };
    const diag = (reason: OrderDetailExtraction["diagnostics"][number]["reason"], tableIndex?: number, rowIndex?: number) => result.diagnostics.push({ reason, tableIndex, rowIndex });
    if (source.status !== "selected") return result;
    if (d.declarations.some(v => v.rawSha256 !== source.source.rawSha256)) throw new Error("受注表の本文参照が一致しません");
    const standard = profile.fields.accountingStandard, start = profile.fields.fiscalYearStartDate, end = profile.fields.fiscalYearEndDate;
    if (standard.status !== "selected" || standard.raw !== "Japan GAAP" || start.status !== "selected" || end.status !== "selected" || profile.consistency.diagnostics.length !== 0) { diag("unsupported-profile"); return result; }
    const instant = source.source.period?.instant;
    if (!validDate(instant) || instant < end.raw || source.source.contextTrace.candidates[0]?.dimensions.length !== 0) { diag("unsupported-context"); return result; }
    for (const declaration of d.declarations) {
        const { tableIndex, scope, period: p } = declaration, table = source.tables[tableIndex];
        if (p.endDate > end.raw) { diag("period-not-found", tableIndex); continue; }
        if (!table) { diag("unsupported-layout", tableIndex); continue; }
        const text = (r: number, c: number) => { const i = table.grid[r]?.[c]; return i === undefined || i === null ? "" : normalize(table.cells[i].parsedText); };
        const add = (r: number, labelIndex: number, columns: Partial<Record<OrderMetric, number>>, evidence: OrderDetailRow["periodEvidence"]) => {
            const label = table.cells[labelIndex];
            if (!label.parsedText || label.columnSpan !== 1 || label.rowSpan !== 1) { diag("ambiguous-row", tableIndex, r); return; }
            const values = {} as Record<OrderMetric, OrderValue>;
            for (const metric of metrics) {
                const i = columns[metric], cell = i === undefined ? undefined : table.cells[i];
                if (cell && (cell.columnSpan !== 1 || cell.rowSpan !== 1 || cell.row !== r)) { diag("ambiguous-row", tableIndex, r); return; }
                values[metric] = { unit: "JPY", multiplier: 1000000, periodBasis: basis(metric), ...(cell ? { cellIndex: i!, raw: cell.parsedText, ...parseReportedTableNumber(cell.parsedText, 1000000, true) } : { status: "missing", reason: "not-in-table" }) };
            }
            result.rows.push({ rowKey: createHash("sha256").update(JSON.stringify([source.inputXmlSha256, d.selection.docID, d.selection.contextRef, tableIndex, r, p])).digest("hex"), tableIndex, rowIndex: r,
                label: { cellIndex: labelIndex, raw: label.parsedText }, identity: "source-label-only", role: role(label.parsedText), scope, period: { ...p }, periodEvidence: evidence, values });
        };
        const width = table.grid[0]?.length, construction = text(0, 0) === "期別";
        if (construction) {
            if (scope !== ConsolidationScope.NonConsolidated) { diag("unsupported-scope", tableIndex); continue; }
            const completed = text(0, 5) === "当期完成工事高(百万円)", sales = text(0, 5) === "当期売上高(百万円)";
            const basic = width === 7 && ["区分", "種類別", "工事別"].includes(text(0, 1)) && text(0, 2) === "前期繰越工事高(百万円)" && text(0, 3) === "当期受注工事高(百万円)" && text(0, 4) === "計(百万円)" && completed && text(0, 6) === "次期繰越工事高(百万円)";
            const extended = width === 10 && ["種類別", "工事別"].includes(text(0, 1)) && ["前期繰越工事高(百万円)", "前期繰越高(百万円)"].includes(text(0, 2)) && ["当期受注工事高(百万円)", "当期受注高(百万円)"].includes(text(0, 3)) && text(0, 4) === "計(百万円)" && (completed || sales) && ["次期繰越工事高", "次期繰越高"].includes(text(0, 6)) && text(1, 6) === "手持高(百万円)" && text(1, 7) === "うち施工高(百万円)" && text(0, 9) === "当期施工高(百万円)";
            if (!basic && !extended) { diag("unsupported-layout", tableIndex); continue; }
            let found = false;
            for (let r = extended ? 2 : 1; r < table.grid.length; r++) {
                const indexes = table.grid[r]; if (indexes.length !== width || indexes.some(i => i === null)) { diag("ambiguous-row", tableIndex, r); continue; }
                const periodIndex = indexes[0]!, periodCell = table.cells[periodIndex], fromSource = sourcePeriod(periodCell.parsedText);
                if (!fromSource || !samePeriod(fromSource, p)) continue;
                found = true;
                const numericColumns = [2, 3, 5, 6];
                if (numericColumns.every(c => !table.cells[indexes[c]!].parsedText)) { diag("empty-category-row", tableIndex, r); continue; }
                add(r, indexes[1]!, { openingBacklogJPY: indexes[2]!, ordersReceivedJPY: indexes[3]!, [completed ? "completedConstructionJPY" : "salesJPY"]: indexes[5]!, closingBacklogJPY: indexes[6]! }, { basis: "source-period-cell", cellIndex: periodIndex, raw: periodCell.parsedText });
            }
            if (!found) diag("period-not-found", tableIndex);
            continue;
        }
        if (scope !== ConsolidationScope.Consolidated) { diag("unsupported-scope", tableIndex); continue; }
        if (start.raw !== p.startDate || end.raw !== p.endDate) { diag("period-not-found", tableIndex); continue; }
        if (width === 3 && text(0, 0) === "セグメントの名称" && text(0, 1) === "受注高(百万円)" && text(0, 2) === "前年同期比(%)") {
            for (let r = 1; r < table.grid.length; r++) {
                const cells = table.grid[r]; if (cells.some(i => i === null)) { diag("ambiguous-row", tableIndex, r); continue; }
                add(r, cells[0]!, { ordersReceivedJPY: cells[1]! }, { basis: "reviewed-declaration-and-profile" });
            }
        } else if (width === 7 && text(0, 0) === "報告セグメント" && [1, 3, 5].every(c => text(1, c) === "金額" && text(1, c + 1) === "増減率") && normalize(source.parsedText).includes("単位:百万円")) {
            const rows = table.grid.map((_, i) => i).filter(i => /^受注高(?:\(注\)\d+)?$/.test(text(i, 0)));
            if (rows.length !== 1) { diag("unsupported-layout", tableIndex); continue; }
            const r = rows[0];
            for (const c of [1, 3, 5]) {
                const labelIndex = table.grid[0][c], amountIndex = table.grid[r][c];
                if (labelIndex === null || amountIndex === null || table.cells[labelIndex].columnSpan !== 2 || table.cells[labelIndex].rowSpan !== 1 || table.cells[amountIndex].rowSpan !== 1 || table.cells[amountIndex].columnSpan !== 1 || !table.cells[labelIndex].parsedText) { diag("ambiguous-row", tableIndex, r); continue; }
                // 横並びの見出し結合は原セル参照を保持し、通常行の検査と区別します。
                const values = Object.fromEntries(metrics.map(metric => [metric, { unit: "JPY", multiplier: 1000000, periodBasis: basis(metric), ...(metric === "ordersReceivedJPY" ? { cellIndex: amountIndex, raw: table.cells[amountIndex].parsedText, ...parseReportedTableNumber(table.cells[amountIndex].parsedText, 1000000, true) } : { status: "missing", reason: "not-in-table" }) }])) as Record<OrderMetric, OrderValue>;
                result.rows.push({ rowKey: createHash("sha256").update(JSON.stringify([source.inputXmlSha256, d.selection.docID, d.selection.contextRef, tableIndex, r, c, p])).digest("hex"), tableIndex, rowIndex: r, label: { cellIndex: labelIndex, raw: table.cells[labelIndex].parsedText }, identity: "source-label-only", role: "detail", scope, period: { ...p }, periodEvidence: { basis: "reviewed-declaration-and-profile" }, values });
            }
        } else diag("unsupported-layout", tableIndex);
    }
    return result;
}
export interface OrderSearchOptions { period: OrderPeriod; scope: ConsolidationScope; role: OrderDetailRow["role"]; metric: OrderMetric; labelContains?: string; condition?: { operator: ComparisonOperator; value: number }; sort?: "value-asc" | "value-desc"; offset?: number; limit?: number; }
const fraction = (s: string) => { const [i, f = ""] = s.split("."); return { numerator: BigInt(i + f), denominator: 10n ** BigInt(f.length) }; };
export function searchOrderDetails(documents: readonly OrderDetailDocument[], options: OrderSearchOptions): { extractions: OrderDetailExtraction[]; rows: { sourceIndex: number; row: OrderDetailRow }[]; matched: number; filtered: number; excluded: { sourceIndex: number; rowKey: string; reason: string }[] } {
    if (!Array.isArray(documents) || documents.length > 100 || !options) throw new Error("受注検索は100原本以下です");
    const p = period(options.period), { scope, role: requestedRole, metric, labelContains, condition, sort, offset = 0, limit = 100 } = options;
    if (!scopes.includes(scope) || !["detail", "subtotal", "reported-total"].includes(requestedRole) || !metrics.includes(metric) || labelContains !== undefined && (typeof labelContains !== "string" || !labelContains.trim() || labelContains.length > 1000) ||
        condition !== undefined && (!condition || typeof condition !== "object" || Array.isArray(condition) || !["gt", "gte", "lt", "lte", "eq"].includes(condition.operator) || !Number.isFinite(condition.value)) || sort !== undefined && !["value-asc", "value-desc"].includes(sort) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("受注検索の条件が不正です");
    const inputs = Array.from(documents, capture).sort((a, b) => a.selection.docID < b.selection.docID ? -1 : a.selection.docID > b.selection.docID ? 1 : 0);
    if (inputs.some(d => typeof d.xml !== "string") || inputs.reduce((sum, d) => sum + Buffer.byteLength(d.xml), 0) > 256 * 1024 * 1024 || new Set(inputs.map(d => d.selection.docID)).size !== inputs.length) throw new Error("受注原本の重複/合計上限を確認してください");
    const extractions: OrderDetailExtraction[] = [], rows: { sourceIndex: number; row: OrderDetailRow }[] = [], excluded: { sourceIndex: number; rowKey: string; reason: string }[] = [], issuers = new Set<string>();
    let filtered = 0, cells = 0, count = 0;
    for (const input of inputs) {
        const extraction = extractOrderDetails(input), sourceIndex = extractions.length, entity = extraction.source.source.entity;
        if (entity) { const id = JSON.stringify([entity.scheme, entity.identifier]); if (issuers.has(id)) throw new Error("同じ提出者は訂正系列を先に選んでください"); issuers.add(id); }
        cells += extraction.source.tables.reduce((n, t) => n + t.cells.length, 0); count += extraction.rows.length;
        if (cells > 100000 || count > 10000) throw new Error("受注検索は100000セル/10000行以下です");
        extractions.push(extraction);
        for (const row of extraction.rows) {
            if (!samePeriod(row.period, p) || row.scope !== scope || row.role !== requestedRole || labelContains && !row.label.raw.includes(labelContains)) { filtered++; continue; }
            const value = row.values[metric];
            if (value.status !== "numeric") { excluded.push({ sourceIndex, rowKey: row.rowKey, reason: value.reason }); continue; }
            if (condition) { const n = compareFractions(fraction(value.decimal), decimalFraction(condition.value)); if (!(condition.operator === "gt" ? n > 0 : condition.operator === "gte" ? n >= 0 : condition.operator === "lt" ? n < 0 : condition.operator === "lte" ? n <= 0 : n === 0)) { filtered++; continue; } }
            rows.push({ sourceIndex, row });
        }
    }
    if (sort) rows.sort((a, b) => { const x = a.row.values[metric], y = b.row.values[metric]; return x.status === "numeric" && y.status === "numeric" ? compareFractions(fraction(x.decimal), fraction(y.decimal)) * (sort === "value-asc" ? 1 : -1) : 0; });
    return { extractions, rows: rows.slice(offset, offset + limit), matched: rows.length, filtered, excluded };
}
