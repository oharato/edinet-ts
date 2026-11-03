import { createHash } from "node:crypto";
import { AccountingStandard } from "./metric-registry";
import { extractDisclosureTables, DisclosureTableKind, type DisclosureTableDocument, type DisclosureTableExtraction, type DisclosureTable } from "./disclosure-tables";
import { parseReportedTableNumber } from "./reported-table-number";
import { decimalFraction, compareFractions } from "./decimal-fraction";
import type { ComparisonOperator } from "./financial-options";
export const SEGMENT_DETAILS_VERSION = "1";
export const SegmentMetric = Object.freeze({ ExternalRevenueJPY: "externalRevenueJPY", IntersegmentRevenueJPY: "intersegmentRevenueJPY", RevenueJPY: "revenueJPY", ProfitJPY: "profitJPY", AssetsJPY: "assetsJPY", DepreciationJPY: "depreciationJPY", AssetAdditionsJPY: "assetAdditionsJPY" } as const);
export type SegmentMetric = typeof SegmentMetric[keyof typeof SegmentMetric];
export type SegmentColumnRole = "reported-segment" | "reported-total" | "adjustment" | "financial-statement-total";
export interface SegmentPeriod { startDate: string; endDate: string; }
/** 同じ期間の横分割表を原本で確認した宣言。参照照合は期間の自動認定ではありません。 */
export interface SegmentTableDeclaration { period: SegmentPeriod; tableIndexes: readonly number[]; rawSha256: string; }
export interface SegmentDetailDocument extends DisclosureTableDocument { accountingStandard: typeof AccountingStandard.JGAAP; declarations: readonly SegmentTableDeclaration[]; }
export type SegmentValue = { unit: "JPY"; multiplier: 1000000; periodBasis: "duration" | "period-end" } & (
    ({ source: { tableIndex: number; cellIndex: number; raw: string } } & ReturnType<typeof parseReportedTableNumber>) |
    { status: "missing"; reason: "row-absent" } |
    { status: "unavailable"; reason: "ambiguous-row" | "merged-data-cell"; candidates: { tableIndex: number; cellIndex: number; raw: string }[] }
);
export interface SegmentColumn {
    columnKey: string; role: SegmentColumnRole; label: string; tableIndex: number; columnIndex: number; headerCellIndex: number;
    identity: "source-column-only"; values: Record<SegmentMetric, SegmentValue>;
}
export interface SegmentDetailExtraction {
    source: DisclosureTableExtraction; measurementDefinition: "reported-not-normalized"; declaredAccountingStandard: typeof AccountingStandard.JGAAP;
    groups: { period: SegmentPeriod; tableIndexes: number[]; referenceVerification: "declared-source-reference-matched"; columns: SegmentColumn[] }[];
    diagnostics: { reason: "not-reviewed" | "unsupported-context" | "unsupported-unit" | "unsupported-layout" | "duplicate-column" | "unrecognized-row"; tableIndex?: number; rowIndex?: number; period?: SegmentPeriod }[];
}
const roles: readonly SegmentColumnRole[] = ["reported-segment", "reported-total", "adjustment", "financial-statement-total"];
const metrics = Object.values(SegmentMetric);
const labels: Record<string, SegmentMetric> = { "外部顧客への売上高": "externalRevenueJPY", "セグメント間の内部売上高又は振替高": "intersegmentRevenueJPY", "計": "revenueJPY",
    "セグメント利益": "profitJPY", "セグメント利益又は損失(△)": "profitJPY", "セグメント資産": "assetsJPY", "減価償却費": "depreciationJPY", "有形固定資産及び無形固定資産の増加額": "assetAdditionsJPY" };
const normalize = (s: string) => s.normalize("NFKC").replace(/\s/g, "");
const date = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const samePeriod = (a: SegmentPeriod, b: SegmentPeriod) => a.startDate === b.startDate && a.endDate === b.endDate;
function period(input: SegmentPeriod): SegmentPeriod {
    if (!input || Object.keys(input).some(k => !["startDate", "endDate"].includes(k))) throw new Error("セグメントの期間を明示してください");
    const { startDate, endDate } = input;
    if (!date(startDate) || !date(endDate) || startDate > endDate) throw new Error("セグメントの期間が不正です");
    return { startDate, endDate };
}
function capture(input: SegmentDetailDocument): SegmentDetailDocument {
    if (!input) throw new Error("セグメント原本が必要です");
    const { xml, selection, accountingStandard, declarations } = input;
    if (!selection || accountingStandard !== AccountingStandard.JGAAP || !Array.isArray(declarations) || !declarations.length || declarations.length > 100) throw new Error("J-GAAPと確認済みのセグメント表を明示してください");
    const { docID, kind, contextRef } = selection;
    if (kind !== DisclosureTableKind.Segments) throw new Error("連結セグメント本文を指定してください");
    const seenTables = new Set<number>(), seenPeriods = new Set<string>();
    const captured = Array.from(declarations as readonly SegmentTableDeclaration[], d => {
        if (!d || Object.keys(d).some(k => !["period", "tableIndexes", "rawSha256"].includes(k))) throw new Error("セグメント表宣言が不正です");
        const { period: p, tableIndexes, rawSha256 } = d, target = period(p), key = JSON.stringify(target);
        if (seenPeriods.has(key) || !Array.isArray(tableIndexes) || !tableIndexes.length || tableIndexes.length > 20 || typeof rawSha256 !== "string" || !/^[a-f0-9]{64}$/.test(rawSha256)) throw new Error("セグメント期間/表/hashの重複または不正があります");
        seenPeriods.add(key);
        const indexes = Array.from(tableIndexes as readonly number[], index => {
            if (!Number.isSafeInteger(index) || index < 0 || seenTables.has(index)) throw new Error("セグメントの物理表を二重に割り当てられません"); seenTables.add(index); return index;
        });
        return { period: target, tableIndexes: indexes.sort((a, b) => a - b), rawSha256 };
    });
    return { xml, selection: { docID, kind, contextRef }, accountingStandard, declarations: captured };
}
function tableLayout(table: DisclosureTable): { firstData: number; columns: { columnIndex: number; headerCellIndex: number; label: string; role: SegmentColumnRole }[] } | undefined {
    if (!table.grid.length || (table.grid[0]?.length ?? 0) < 2 || table.grid.some(row => row.some(i => i === null))) return;
    const firstData = table.grid.slice(0, 5).findIndex(row => normalize(table.cells[row[0]!].parsedText) === "売上高");
    if (firstData < 1) return;
    const columns: { columnIndex: number; headerCellIndex: number; label: string; role: SegmentColumnRole }[] = [];
    for (let columnIndex = 1; columnIndex < table.grid[0].length; columnIndex++) {
        const chain = [...new Set(table.grid.slice(0, firstData).map(row => row[columnIndex]!))].filter(i => {
            const value = normalize(table.cells[i].parsedText); return value && !/^\(単位:/.test(value);
        });
        const headerCellIndex = chain.at(-1); if (headerCellIndex === undefined) return;
        const cell = table.cells[headerCellIndex], raw = cell.parsedText, name = normalize(raw).replace(/\(注\)\d+$/, "");
        if (cell.columnSpan !== 1) return;
        let role: SegmentColumnRole;
        if (chain.some(i => normalize(table.cells[i].parsedText) === "報告セグメント") && name !== "報告セグメント" && !["計", "合計"].includes(name)) role = "reported-segment";
        else if (["計", "合計"].includes(name)) role = "reported-total";
        else if (name === "調整額") role = "adjustment";
        else if (name === "連結財務諸表計上額") role = "financial-statement-total";
        else return;
        columns.push({ columnIndex, headerCellIndex, label: raw, role });
    }
    return { firstData, columns };
}
export function extractSegmentDetails(input: SegmentDetailDocument): SegmentDetailExtraction {
    const captured = capture(input), { xml, selection, accountingStandard, declarations } = captured;
    const source = extractDisclosureTables(xml, selection), result: SegmentDetailExtraction = { source, measurementDefinition: "reported-not-normalized", declaredAccountingStandard: accountingStandard, groups: [], diagnostics: [] };
    if (source.status !== "selected") return result;
    const contextPeriod = source.source.period, trace = source.source.contextTrace;
    if (!date(contextPeriod?.startDate) || !date(contextPeriod?.endDate) || contextPeriod.startDate > contextPeriod.endDate || contextPeriod.instant !== undefined || trace.candidates.length !== 1 || trace.candidates[0].dimensions.length) {
        result.diagnostics.push({ reason: "unsupported-context" }); return result;
    }
    const text = normalize(source.parsedText), dateLiteral = (s: string) => { const [y, m, d] = s.split("-").map(Number); return `${y}年${m}月${d}日`; };
    for (const declaration of declarations) {
        if (declaration.rawSha256 !== source.source.rawSha256 || declaration.tableIndexes.some(index => !source.tables[index]) || declaration.period.endDate > contextPeriod.endDate ||
            !text.includes(dateLiteral(declaration.period.startDate)) || !text.includes(dateLiteral(declaration.period.endDate))) throw new Error("セグメント期間と表の原本内参照を確認できません");
    }
    const reviewed = new Set(declarations.flatMap(d => [...d.tableIndexes]));
    for (const table of source.tables) if (!reviewed.has(table.index)) result.diagnostics.push({ tableIndex: table.index, reason: "not-reviewed" });
    for (const declaration of declarations) {
        const tables = declaration.tableIndexes.map(index => source.tables[index]), layouts = tables.map(tableLayout), target = declaration.period;
        if (layouts.some(layout => !layout)) { result.diagnostics.push({ reason: "unsupported-layout", period: target }); continue; }
        const units = tables.flatMap(table => [...normalize(table.cells.map(c => c.parsedText).join("\n")).matchAll(/単位:([^()]+)/g)].map(match => match[1]));
        if (!units.length || units.some(unit => unit !== "百万円")) { result.diagnostics.push({ reason: "unsupported-unit", period: target }); continue; }
        const names = new Set<string>(); let duplicate = false;
        for (const layout of layouts) for (const col of layout!.columns) {
            const key = col.role === "reported-segment" ? JSON.stringify([col.role, normalize(col.label)]) : col.role;
            if (names.has(key)) duplicate = true; names.add(key);
        }
        if (duplicate) { result.diagnostics.push({ reason: "duplicate-column", period: target }); continue; }
        const columns: SegmentColumn[] = [];
        tables.forEach((table, index) => {
            const layout = layouts[index]!, metricRows = new Map<SegmentMetric, number[]>(); let revenueSection = false;
            for (let row = layout.firstData; row < table.grid.length; row++) {
                const label = normalize(table.cells[table.grid[row][0]!].parsedText);
                if (label === "売上高" || label === "その他の項目") {
                    if (table.grid[row].slice(1).some(i => table.cells[i!].parsedText.trim())) result.diagnostics.push({ reason: "unrecognized-row", tableIndex: table.index, rowIndex: row });
                    revenueSection = label === "売上高"; continue;
                }
                const id = Object.hasOwn(labels, label) ? labels[label] : undefined;
                if (!id || id === "revenueJPY" && !revenueSection) { result.diagnostics.push({ reason: "unrecognized-row", tableIndex: table.index, rowIndex: row }); continue; }
                if (!["externalRevenueJPY", "intersegmentRevenueJPY", "revenueJPY"].includes(id)) revenueSection = false;
                const existing = metricRows.get(id) ?? []; existing.push(row); metricRows.set(id, existing);
            }
            for (const col of layout.columns) {
                const values = Object.fromEntries(metrics.map(id => {
                    const base = { unit: "JPY" as const, multiplier: 1000000 as const, periodBasis: id === "assetsJPY" ? "period-end" as const : "duration" as const }, rows = metricRows.get(id) ?? [];
                    if (!rows.length) return [id, { ...base, status: "missing" as const, reason: "row-absent" as const }];
                    const candidates = rows.map(row => { const cellIndex = table.grid[row][col.columnIndex]!; return { tableIndex: table.index, cellIndex, raw: table.cells[cellIndex].parsedText }; });
                    if (rows.length !== 1) return [id, { ...base, status: "unavailable" as const, reason: "ambiguous-row" as const, candidates }];
                    const cell = table.cells[candidates[0].cellIndex];
                    if (cell.rowSpan !== 1 || cell.columnSpan !== 1 || cell.row !== rows[0] || cell.column !== col.columnIndex) return [id, { ...base, status: "unavailable" as const, reason: "merged-data-cell" as const, candidates }];
                    return [id, { ...base, source: candidates[0], ...parseReportedTableNumber(candidates[0].raw, 1000000, true) }];
                })) as Record<SegmentMetric, SegmentValue>;
                const columnKey = createHash("sha256").update(JSON.stringify([selection.docID, source.inputXmlSha256, selection.contextRef, target, table.index, col.columnIndex])).digest("hex");
                columns.push({ columnKey, ...col, tableIndex: table.index, identity: "source-column-only", values });
            }
        });
        result.groups.push({ period: target, tableIndexes: [...declaration.tableIndexes], referenceVerification: "declared-source-reference-matched", columns });
    }
    return result;
}
export interface SegmentSearchOptions {
    period: SegmentPeriod; role: SegmentColumnRole; labelContains?: string;
    conditions?: readonly { metric: SegmentMetric; operator: ComparisonOperator; value: number }[];
    sort?: { metric: SegmentMetric; order: "asc" | "desc" }; offset?: number; limit?: number;
}
const fraction = (raw: string) => { const [i, f = ""] = raw.split("."); return { numerator: BigInt(i + f), denominator: 10n ** BigInt(f.length) }; };
export function searchSegmentDetails(documents: readonly SegmentDetailDocument[], options: SegmentSearchOptions): {
    extractions: SegmentDetailExtraction[]; rows: { sourceIndex: number; period: SegmentPeriod; column: SegmentColumn }[]; matched: number; filtered: number;
    excluded: { sourceIndex: number; columnKey: string; metrics: SegmentMetric[] }[];
} {
    if (!Array.isArray(documents) || documents.length > 100 || !options) throw new Error("セグメント検索は100原本以下です");
    const { period: p, role, labelContains, conditions: requested = [], sort, offset = 0, limit = 100 } = options, target = period(p);
    if (!roles.includes(role) || labelContains !== undefined && (typeof labelContains !== "string" || !labelContains.trim() || labelContains.length > 1000) || !Array.isArray(requested) || requested.length > 100 ||
        !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("セグメント検索の条件が不正です");
    const conditions = Array.from(requested as NonNullable<SegmentSearchOptions["conditions"]>, c => { if (!c) throw new Error("条件が不正です"); const { metric, operator, value } = c;
        if (!metrics.includes(metric) || !["gt", "gte", "lt", "lte", "eq"].includes(operator) || !Number.isFinite(value)) throw new Error("セグメント数値条件が不正です"); return { metric, operator, value }; });
    if (sort !== undefined && (!sort || typeof sort !== "object" || Array.isArray(sort))) throw new Error("セグメントの順序が不正です");
    const sorting = sort ? { metric: sort.metric, order: sort.order } : undefined;
    if (sorting && (!metrics.includes(sorting.metric) || !["asc", "desc"].includes(sorting.order))) throw new Error("セグメントの順序が不正です");
    const inputs = Array.from(documents as readonly SegmentDetailDocument[], capture);
    if (inputs.some(d => typeof d.xml !== "string" || !d.declarations.some(d => samePeriod(d.period, target))) || inputs.reduce((n, d) => n + Buffer.byteLength(d.xml), 0) > 256 * 1024 * 1024 ||
        new Set(inputs.map(d => JSON.stringify([d.selection.docID, d.selection.contextRef]))).size !== inputs.length) throw new Error("セグメント原本の重複/対象期間/上限を確認してください");
    inputs.sort((a, b) => a.selection.docID < b.selection.docID ? -1 : a.selection.docID > b.selection.docID ? 1 : a.selection.contextRef < b.selection.contextRef ? -1 : a.selection.contextRef > b.selection.contextRef ? 1 : 0);
    const extractions: SegmentDetailExtraction[] = [], rows: { sourceIndex: number; period: SegmentPeriod; column: SegmentColumn }[] = [], excluded: { sourceIndex: number; columnKey: string; metrics: SegmentMetric[] }[] = [], issuers = new Set<string>();
    const required = [...new Set([...conditions.map(c => c.metric), ...(sorting ? [sorting.metric] : [])])]; let cells = 0, columnCount = 0, filtered = 0;
    for (const input of inputs) {
        const extraction = extractSegmentDetails(input), sourceIndex = extractions.length, entity = extraction.source.source.entity;
        if (entity) { const key = JSON.stringify([entity.scheme, entity.identifier]); if (issuers.has(key)) throw new Error("同じ提出者の原本が重複しています。訂正系列を先に選んでください"); issuers.add(key); }
        cells += extraction.source.tables.reduce((n, t) => n + t.cells.length, 0); columnCount += extraction.groups.reduce((n, g) => n + g.columns.length, 0);
        if (cells > 100000 || columnCount > 10000) throw new Error("セグメント検索は100000物理セル/10000列以下です");
        extractions.push(extraction);
        for (const group of extraction.groups) if (samePeriod(group.period, target)) for (const column of group.columns) {
            if (column.role !== role) { filtered++; continue; }
            const unavailable = required.filter(id => column.values[id].status !== "numeric");
            if (unavailable.length) { excluded.push({ sourceIndex, columnKey: column.columnKey, metrics: unavailable }); continue; }
            const matches = conditions.every(c => { const selected = column.values[c.metric]; if (selected.status !== "numeric") return false;
                const compare = compareFractions(fraction(selected.decimal), decimalFraction(c.value));
                return c.operator === "gt" ? compare > 0 : c.operator === "gte" ? compare >= 0 : c.operator === "lt" ? compare < 0 : c.operator === "lte" ? compare <= 0 : compare === 0; });
            if (!matches || labelContains && !column.label.includes(labelContains)) { filtered++; continue; }
            rows.push({ sourceIndex, period: group.period, column });
        }
    }
    if (sorting) rows.sort((a, b) => { const av = a.column.values[sorting.metric], bv = b.column.values[sorting.metric]; return av.status === "numeric" && bv.status === "numeric" ? compareFractions(fraction(av.decimal), fraction(bv.decimal)) * (sorting.order === "asc" ? 1 : -1) : 0; });
    return { extractions, rows: rows.slice(offset, offset + limit), matched: rows.length, filtered, excluded };
}
