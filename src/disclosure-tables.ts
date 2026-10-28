import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { assertXmlInput } from "./xml-input";
import { EdinetXbrlParser } from "./edinet-xbrl-parser";
import type { EdinetData } from "./edinet-xbrl-object";
import type { EdinetContext } from "./edinet-context";
import type { ContextDimensionsTraceResult } from "./context-dimension-traces";

/** 数値の意味は表別に確定します。この辞書は本文の所属だけを指定します。 */
export const DisclosureTableKind = Object.freeze({ Facilities: "facilities", AffiliatedEntities: "affiliatedEntities", MainCustomers: "mainCustomers",
    ManagementAnalysis: "managementAnalysis", Segments: "segments", Officers: "officers", OfficerRemuneration: "officerRemuneration" } as const);
export type DisclosureTableKind = typeof DisclosureTableKind[keyof typeof DisclosureTableKind];
const tags: Record<DisclosureTableKind, string> = { facilities: "MajorFacilitiesTextBlock", affiliatedEntities: "OverviewOfAffiliatedEntitiesTextBlock",
    mainCustomers: "InformationForEachOfMainCustomersTextBlock", segments: "NotesSegmentInformationEtcConsolidatedFinancialStatementsTextBlock",
    managementAnalysis: "ManagementAnalysisOfFinancialPositionOperatingResultsAndCashFlowsTextBlock", officers: "InformationAboutOfficersTextBlock", officerRemuneration: "RemunerationForDirectorsAndOtherOfficersTextBlock" };
export const DISCLOSURE_TABLE_LIMITS = Object.freeze({ fragmentBytes: 2 * 1024 * 1024, tables: 200, rows: 5000, cells: 50000, columns: 100, expandedCells: 200000, depth: 64 });
export interface DisclosureTableCell { row: number; column: number; rowSpan: number; columnSpan: number; kind: "td" | "th"; parsedText: string; }
export interface DisclosureTable { index: number; cells: DisclosureTableCell[]; grid: (number | null)[][]; }
export interface DisclosureTableSource {
    docID: string; kind: DisclosureTableKind; key: string; contextRef: string; namespaceURI?: string;
    period?: EdinetContext["period"]; entity?: EdinetContext["entity"]; contextTrace: ContextDimensionsTraceResult;
    rawFragment?: string; rawSha256?: string;
    candidates: { key: string; namespaceURI?: string; contextRef: string; nil: boolean; unitRef: string; rawSha256?: string }[];
}
export type DisclosureTableExtraction = { source: DisclosureTableSource; inputXmlSha256?: string; tables: DisclosureTable[];
    /** 表外の文章・注記を含む解析済み本文。HTMLとして描画しません。 */
    parsedText: string; semanticValidation: "not-performed" } & (
    { status: "selected"; reason: "parsed-tables" | "no-tables" } |
    { status: "missing" | "ambiguous" | "unsupported"; reason: "tag-absent" | "multiple-facts" | "unknown-namespace" | "invalid-context" | "nil" | "raw-unavailable" | "unsupported-fragment" }
);
type OrderedNode = { [name: string]: OrderedNode[] | string | Record<string, string> };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const fail = (): never => { throw new Error("本文表の構造または上限が非対応です"); };
const element = (node: OrderedNode) => Object.keys(node).find(k => k !== ":@" && !k.startsWith("#") && !k.startsWith("?"));
const children = (node: OrderedNode, key: string) => node[key] as OrderedNode[];
const block = new Set(["p", "div", "tr", "td", "th", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table"]);
function text(nodes: OrderedNode[]): string {
    return nodes.map(node => {
        if (typeof node["#text"] === "string") return node["#text"];
        const key = element(node); if (!key) return "";
        if (key === "br") return "\n";
        return text(children(node, key)) + (block.has(key) ? "\n" : "");
    }).join("");
}
function parseFragment(raw: string): { tables: DisclosureTable[]; parsedText: string } {
    if (Buffer.byteLength(raw) > DISCLOSURE_TABLE_LIMITS.fragmentBytes) fail();
    const wrapped = `<fragment>${raw}</fragment>`;
    assertXmlInput(wrapped);
    const nodes = new XMLParser({ preserveOrder: true, ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false,
        trimValues: false, maxNestedTags: DISCLOSURE_TABLE_LIMITS.depth }).parse(wrapped)[0].fragment as OrderedNode[];
    const found: OrderedNode[] = []; let count = 0;
    function inspect(list: OrderedNode[], insideTable = false): void {
        for (const node of list) {
            if (++count > 200000) fail();
            const key = element(node); if (!key) continue;
            if (key.includes(":") || ["script", "style", "iframe", "object", "embed", "svg", "math", "template"].includes(key.toLowerCase())) fail();
            const attrs = node[":@"] as Record<string, string> | undefined;
            if (attrs && Object.keys(attrs).some(k => k.startsWith("@_xmlns") && (k !== "@_xmlns" || attrs[k] !== "http://www.w3.org/1999/xhtml"))) fail();
            if (key === "table") { if (insideTable || found.length >= DISCLOSURE_TABLE_LIMITS.tables) fail(); found.push(node); }
            inspect(children(node, key), insideTable || key === "table");
        }
    }
    inspect(nodes);
    let totalRows = 0, totalCells = 0, expanded = 0, gridSlots = 0;
    const tables = found.map((node, index) => {
        const rows: { node: OrderedNode; group: number }[] = []; let group = 0;
        for (const child of children(node, "table")) {
            const key = element(child);
            if (key === "tr") rows.push({ node: child, group: 0 });
            else if (["thead", "tbody", "tfoot"].includes(key ?? "")) {
                group++;
                for (const row of children(child, key!)) {
                    const tag = element(row); if (tag === "tr") rows.push({ node: row, group }); else if (tag || typeof row["#text"] === "string" && row["#text"].trim()) fail();
                }
            } else if (key && !["caption", "colgroup", "col"].includes(key)) fail();
            else if (!key && typeof child["#text"] === "string" && child["#text"].trim()) fail();
        }
        totalRows += rows.length; if (totalRows > DISCLOSURE_TABLE_LIMITS.rows) fail();
        const grid: (number | null)[][] = rows.map(() => []), cells: DisclosureTableCell[] = [];
        for (let row = 0; row < rows.length; row++) {
            let column = 0;
            for (const cell of children(rows[row].node, "tr")) {
                const tag = element(cell);
                if (!tag) { if (typeof cell["#text"] === "string" && cell["#text"].trim()) fail(); continue; }
                if (tag !== "td" && tag !== "th") fail();
                if (++totalCells > DISCLOSURE_TABLE_LIMITS.cells) fail();
                while (grid[row][column] !== undefined) column++;
                const attrs = cell[":@"] as Record<string, string> | undefined;
                const span = (name: string) => { const value = attrs?.[`@_${name}`] ?? "1"; if (!/^[1-9]\d{0,3}$/.test(value)) fail(); return Number(value); };
                const rowSpan = span("rowspan"), columnSpan = span("colspan");
                if (row + rowSpan > rows.length || column + columnSpan > DISCLOSURE_TABLE_LIMITS.columns ||
                    rows.slice(row, row + rowSpan).some(r => r.group !== rows[row].group)) fail();
                expanded += rowSpan * columnSpan; if (expanded > DISCLOSURE_TABLE_LIMITS.expandedCells) fail();
                const cellIndex = cells.length;
                for (let r = row; r < row + rowSpan; r++) for (let c = column; c < column + columnSpan; c++) {
                    if (grid[r][c] !== undefined) fail(); grid[r][c] = cellIndex;
                }
                cells.push({ row, column, rowSpan, columnSpan, kind: tag as "td" | "th", parsedText: text(children(cell, tag)).trim() });
                column += columnSpan;
            }
        }
        const width = Math.max(0, ...grid.map(row => row.length));
        gridSlots += width * rows.length; if (gridSlots > DISCLOSURE_TABLE_LIMITS.expandedCells) fail();
        // 欠けた枠はnull。同じ結合セルの値を複製して合計しません。
        return { index, cells, grid: grid.map(row => Array.from({ length: width }, (_, col) => row[col] ?? null)) };
    });
    return { tables, parsedText: text(nodes).trim() };
}
/** @internal contextとfactの検査は既存parserの結果に限定します。 */
export function selectDisclosureTables(docID: string, kind: DisclosureTableKind, contextRef: string, facts: ReadonlyMap<string, readonly EdinetData[]>,
    contexts: ReadonlyMap<string, EdinetContext>, duplicates: ReadonlySet<string>, trace: (ref: string) => ContextDimensionsTraceResult): DisclosureTableExtraction {
    if (typeof docID !== "string" || !docID.trim() || !Object.hasOwn(tags, kind) || typeof contextRef !== "string" || !contextRef.trim()) throw new Error("書類ID・表の種類・contextRefを明示してください");
    const candidates = [...facts].filter(([key]) => key.split(":").length === 2 && key.split(":")[1] === tags[kind]).flatMap(([, list]) => list.filter(f => f.contextRef === contextRef));
    const context = contexts.get(contextRef), contextTrace = trace(contextRef);
    const source: DisclosureTableSource = { docID, kind, key: candidates[0]?.key ?? `jpcrp_cor:${tags[kind]}`, contextRef, namespaceURI: candidates[0]?.namespaceURI,
        period: context?.period, entity: context?.entity, contextTrace,
        candidates: candidates.map(f => ({ key: f.key, namespaceURI: f.namespaceURI, contextRef: f.contextRef, nil: f.nil, unitRef: f.unitRef, rawSha256: f.rawValue === undefined ? undefined : hash(f.rawValue) })) };
    const base = { source, tables: [] as DisclosureTable[], parsedText: "", semanticValidation: "not-performed" as const };
    if (!candidates.length) return structuredClone({ ...base, status: "missing", reason: "tag-absent" });
    if (candidates.length !== 1) return structuredClone({ ...base, status: "ambiguous", reason: "multiple-facts" });
    const fact = candidates[0];
    source.rawFragment = fact.rawValue; if (fact.rawValue !== undefined) source.rawSha256 = hash(fact.rawValue);
    const unsupported = (reason: Extract<DisclosureTableExtraction, { status: "missing" | "ambiguous" | "unsupported" }>["reason"]): DisclosureTableExtraction => structuredClone({ ...base, status: "unsupported", reason });
    if (!/^http:\/\/disclosure\.edinet-fsa\.go\.jp\/taxonomy\/jpcrp\/(?:2018-03-31|2024-11-01|2025-11-01)\/jpcrp_cor$/.test(fact.namespaceURI ?? "")) return unsupported("unknown-namespace");
    if (!context?.namespaceVerified || !context.periodValid || !context.entity || duplicates.has(contextRef) || contextTrace.status !== "resolved" || fact.unitRef) return unsupported("invalid-context");
    if (fact.nil) return structuredClone({ ...base, status: "missing", reason: "nil" });
    if (fact.rawValue === undefined) return unsupported("raw-unavailable");
    try { const parsed = parseFragment(fact.rawValue); return structuredClone({ ...base, ...parsed, status: "selected", reason: parsed.tables.length ? "parsed-tables" : "no-tables" }); }
    catch { return unsupported("unsupported-fragment"); }
}
export function extractDisclosureTables(xml: string, selection: { docID: string; kind: DisclosureTableKind; contextRef: string }): DisclosureTableExtraction {
    if (!selection) throw new Error("本文表の指定が必要です");
    const { docID, kind, contextRef } = selection;
    const object = new EdinetXbrlParser().parse(xml, docID);
    return { ...object.selectDisclosureTables(kind, contextRef), inputXmlSha256: hash(xml) };
}

export interface DisclosureTableDocument { xml: string; selection: { docID: string; kind: DisclosureTableKind; contextRef: string }; }
export interface DisclosureTableCellMatch { sourceIndex: number; tableIndex: number; cellIndex: number; row: number; column: number; parsedText: string; semanticRole: "unclassified"; }
/** 本文セルの文字列逆引き。法人同定・数値条件・見出し/合計行の自動除外は行いません。 */
export function searchDisclosureTableCells(documents: readonly DisclosureTableDocument[], options: { contains: string; offset?: number; limit?: number }): {
    sources: Omit<DisclosureTableSource, "rawFragment" | "candidates">[]; rows: DisclosureTableCellMatch[]; matched: number;
    excluded: { docID: string; kind: DisclosureTableKind; contextRef: string; status: string; reason: string }[];
} {
    if (!Array.isArray(documents) || documents.length > 100 || !options) throw new Error("本文表検索は100原本以下です");
    const { contains, offset = 0, limit = 100 } = options;
    if (typeof contains !== "string" || !contains.trim() || contains.length > 1000 || !Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("文字列とページ指定が不正です");
    const inputs = Array.from(documents, document => { if (!document?.selection) throw new Error("本文表の原本指定が必要です");
        const xml = document.xml, { docID, kind, contextRef } = document.selection; return { xml, selection: { docID, kind, contextRef } }; });
    if (inputs.some(d => typeof d.xml !== "string") || inputs.reduce((sum, d) => sum + Buffer.byteLength(d.xml), 0) > 256 * 1024 * 1024) throw new Error("原本合計は256MiB以下です");
    const identifiers = inputs.map(d => JSON.stringify([d.selection.docID, d.selection.kind, d.selection.contextRef]));
    if (new Set(identifiers).size !== identifiers.length) throw new Error("同じ本文表の指定が重複しています");
    const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
    inputs.sort((a, b) => order(a.selection.docID, b.selection.docID) || order(a.selection.kind, b.selection.kind) || order(a.selection.contextRef, b.selection.contextRef));
    const sources: Omit<DisclosureTableSource, "rawFragment" | "candidates">[] = [], rows: DisclosureTableCellMatch[] = [];
    const excluded: { docID: string; kind: DisclosureTableKind; contextRef: string; status: string; reason: string }[] = []; let candidates = 0, matched = 0;
    for (const input of inputs) {
        const result = extractDisclosureTables(input.xml, input.selection);
        if (result.status !== "selected") { excluded.push({ ...input.selection, status: result.status, reason: result.reason }); continue; }
        const { rawFragment: _raw, candidates: _candidates, ...source } = result.source, sourceIndex = sources.length; sources.push(source);
        for (const table of result.tables) for (const [cellIndex, cell] of table.cells.entries()) {
            if (++candidates > 100000) throw new Error("本文表検索の物理セル合計は100000件以下です");
            if (!cell.parsedText.includes(contains)) continue;
            if (matched >= offset && rows.length < limit) rows.push({ sourceIndex, tableIndex: table.index, cellIndex, row: cell.row, column: cell.column, parsedText: cell.parsedText, semanticRole: "unclassified" });
            matched++;
        }
    }
    return { sources, rows, matched, excluded };
}
