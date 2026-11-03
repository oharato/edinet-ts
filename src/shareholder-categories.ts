import { createHash } from "node:crypto";
import { extractDisclosureTables, DisclosureTableKind, type DisclosureTableDocument, type DisclosureTableExtraction } from "./disclosure-tables";
import { parseReportedTableNumber } from "./reported-table-number";
import { toSafeMetricNumber } from "./metric-selection";
import { decimalFraction, compareFractions } from "./decimal-fraction";
import type { ComparisonOperator } from "./financial-options";
export const SHAREHOLDER_CATEGORIES_VERSION = "1";
export const ShareholderCategory = Object.freeze({ Government: "government", FinancialInstitutions: "financial-institutions", FinancialInstrumentsFirms: "financial-instruments-firms", OtherCorporations: "other-corporations", ForeignNonIndividuals: "foreign-non-individuals", ForeignIndividuals: "foreign-individuals", IndividualsAndOthers: "individuals-and-others", ReportedTotal: "reported-total", OddLots: "odd-lots" } as const);
export type ShareholderCategory = typeof ShareholderCategory[keyof typeof ShareholderCategory];
export const ShareholderCategoryMetric = Object.freeze({ ShareholderCount: "shareholderCount", OwnedLots: "ownedLots", OwnedShares: "ownedShares", OwnershipPercent: "ownershipPercent" } as const);
export type ShareholderCategoryMetric = typeof ShareholderCategoryMetric[keyof typeof ShareholderCategoryMetric];
export interface ShareholderCategoryDeclaration { tableIndex: number; asOf: string; rawSha256: string; }
export interface ShareholderCategoryDocument extends DisclosureTableDocument { declarations: readonly ShareholderCategoryDeclaration[]; }
type Numeric = ReturnType<typeof parseReportedTableNumber> | { status: "unavailable"; reason: "non-integer-count" | "out-of-range-percent" };
export type ShareholderCategoryValue = { unit: "persons" | "lots" | "shares" | "percent" } & (
    ({ source: { cellIndex: number; raw: string } } & Numeric) |
    { status: "missing"; reason: "not-applicable-to-odd-lots" } |
    { status: "numeric"; decimal: string; safeNumber?: number; calculation: { formula: "ownedLots*sharesPerLot"; lotsCellIndex: number; lotSizeCellIndex: number } } |
    { status: "unavailable"; reason: "owned-lots-unavailable"; lotsCellIndex: number }
);
export interface ShareholderCategoryEntry {
    entryKey: string; category: ShareholderCategory; role: "category" | "reported-total" | "odd-lots";
    headers: { cellIndex: number; raw: string }[]; values: Record<ShareholderCategoryMetric, ShareholderCategoryValue>;
}
export interface ShareholderCategoryGroup {
    tableIndex: number; asOf: string; shareClassIdentification: "not-established";
    asOfEvidence: { normalizedDateText: string; rawCell?: string; basis: "table-date-cell" | "single-table-text"; cellIndex?: number };
    sharesPerLot: { decimal: string; cellIndex: number; raw: string };
    percentageDenominator: { basis: "reported-whole-lot-total"; cellIndex: number; raw: string };
    entries: ShareholderCategoryEntry[];
}
export interface ShareholderCategoryExtraction {
    source: DisclosureTableExtraction; disclosureKind: "shareholder-category-text-block"; declarations: ShareholderCategoryDeclaration[]; groups: ShareholderCategoryGroup[];
    diagnostics: { reason: "unsupported-context" | "unsupported-as-of" | "unsupported-layout" | "unsupported-lot-size" | "ambiguous-data-cell"; tableIndex?: number }[];
}
const categories = Object.values(ShareholderCategory), metrics = Object.values(ShareholderCategoryMetric);
const normalize = (s: string) => s.normalize("NFKC").replace(/\s/g, "");
const validDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
function capture(input: ShareholderCategoryDocument): ShareholderCategoryDocument {
    if (!input?.selection || input.selection.kind !== DisclosureTableKind.ShareholderCategories || !Array.isArray(input.declarations) || !input.declarations.length || input.declarations.length > 100) throw new Error("株主分類の原本・確認済み表を指定してください");
    const { xml, selection: { docID, kind, contextRef } } = input, seen = new Set<number>();
    const declarations = Array.from(input.declarations as readonly ShareholderCategoryDeclaration[], d => {
        if (!d || Object.keys(d).some(k => !["tableIndex", "asOf", "rawSha256"].includes(k)) || !Number.isSafeInteger(d.tableIndex) || d.tableIndex < 0 || seen.has(d.tableIndex) || !validDate(d.asOf) || typeof d.rawSha256 !== "string" || !/^[a-f0-9]{64}$/.test(d.rawSha256)) throw new Error("株主分類の表位置/基準日/本文参照/重複を確認してください");
        seen.add(d.tableIndex); return { tableIndex: d.tableIndex, asOf: d.asOf, rawSha256: d.rawSha256 };
    }).sort((a, b) => a.tableIndex - b.tableIndex);
    return { xml, selection: { docID, kind, contextRef }, declarations };
}
function dates(raw: string): { date: string; raw: string }[] {
    return [...normalize(raw).matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日現在/g)].map(m => ({ date: `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`, raw: m[0] }));
}
function number(raw: string, percent = false): Numeric {
    const n = parseReportedTableNumber(raw, 1);
    if (n.status !== "numeric") return n;
    if (!percent && !/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(raw)) return { status: "unavailable", reason: "non-integer-count" };
    if (percent && compareFractions(decimal(n.decimal), { numerator: 100n, denominator: 1n }) > 0) return { status: "unavailable", reason: "out-of-range-percent" };
    return n;
}
const decimal = (s: string) => { const [i, f = ""] = s.split("."); return { numerator: BigInt(i + f), denominator: 10n ** BigInt(f.length) }; };
export function extractShareholderCategories(input: ShareholderCategoryDocument): ShareholderCategoryExtraction {
    const d = capture(input), source = extractDisclosureTables(d.xml, d.selection);
    const result: ShareholderCategoryExtraction = { source, disclosureKind: "shareholder-category-text-block", declarations: structuredClone(d.declarations) as ShareholderCategoryDeclaration[], groups: [], diagnostics: [] };
    const diag = (reason: ShareholderCategoryExtraction["diagnostics"][number]["reason"], tableIndex?: number) => result.diagnostics.push({ reason, tableIndex });
    if (source.status !== "selected") return result;
    if (d.declarations.some(v => v.rawSha256 !== source.source.rawSha256)) throw new Error("株主分類の本文参照が一致しません");
    const instant = source.source.period?.instant;
    if (!validDate(instant) || source.source.contextTrace.candidates[0]?.dimensions.length !== 0) { diag("unsupported-context"); return result; }
    for (const declaration of d.declarations) {
        const { tableIndex, asOf } = declaration, table = source.tables[tableIndex];
        if (!table) { diag("unsupported-layout", tableIndex); continue; }
        const text = (r: number, c: number) => { const i = table.grid[r]?.[c]; return i === undefined || i === null ? "" : normalize(table.cells[i].parsedText); };
        const header = table.grid.findIndex((_, i) => text(i, 0) === "区分");
        const localDates = table.cells.flatMap((c, cellIndex) => c.row < header ? dates(c.parsedText).map(date => ({ ...date, cellIndex })) : []);
        const evidence = localDates.length ? localDates : source.tables.length === 1 ? dates(source.outsideTableText ?? "") : [];
        if (!evidence.length || evidence.some(v => v.date !== asOf || !validDate(v.date)) || instant < asOf) { diag("unsupported-as-of", tableIndex); continue; }
        const expected = ["政府及び地方公共団体", "金融機関", "金融商品取引業者", "その他の法人", "外国法人等", "外国法人等", "個人その他", "計"];
        const lot = /^株式の状況\(1単元の株式数([1-9]\d{0,8})株\)$/.exec(text(header, 1));
        if (header < 0 || table.grid.length !== header + 6 || table.grid.some(r => r.length !== 10) ||
            !["単元未満株式の状況(株)"].includes(text(header, 9)) || expected.some((v, i) => text(header + 1, i + 1) !== v) || text(header + 2, 5) !== "個人以外" || text(header + 2, 6) !== "個人" ||
            ["株主数(人)", "所有株式数(単元)", "所有株式数の割合(%)"].some((v, i) => text(header + 3 + i, 0) !== v) ||
            table.grid.slice(0, header).some(r => r.some(i => i !== null && table.cells[i].parsedText && !/^\d{4}年\d{1,2}月\d{1,2}日現在$/.test(normalize(table.cells[i].parsedText))))) { diag("unsupported-layout", tableIndex); continue; }
        if (!lot) { diag("unsupported-lot-size", tableIndex); continue; }
        const h = table.grid[header], lotIndex = h[1]!, totalIndex = table.grid[header + 4][8];
        if (h.some(i => i === null) || new Set(h.slice(1, 9)).size !== 1 || table.cells[lotIndex].columnSpan !== 8 || table.cells[lotIndex].rowSpan !== 1 || totalIndex === null ||
            table.grid.slice(header + 3).some(r => r.some(i => i === null || table.cells[i].rowSpan !== 1 || table.cells[i].columnSpan !== 1))) { diag("ambiguous-data-cell", tableIndex); continue; }
        const headerCell = (r: number, c: number, rows: number, columns: number) => {
            const i = table.grid[r]?.[c]; if (i === undefined || i === null) return false;
            const cell = table.cells[i]; return cell.row === r && cell.column === c && cell.rowSpan === rows && cell.columnSpan === columns;
        };
        if (!headerCell(header, 0, 3, 1) || !headerCell(header, 9, 3, 1) || ![1, 2, 3, 4, 7, 8].every(c => headerCell(header + 1, c, 2, 1)) ||
            !headerCell(header + 1, 5, 1, 2) || !headerCell(header + 2, 5, 1, 1) || !headerCell(header + 2, 6, 1, 1)) { diag("unsupported-layout", tableIndex); continue; }
        const chosen = evidence[0], group: ShareholderCategoryGroup = { tableIndex, asOf, shareClassIdentification: "not-established", asOfEvidence: { normalizedDateText: chosen.raw, basis: "cellIndex" in chosen ? "table-date-cell" : "single-table-text", ...("cellIndex" in chosen ? { cellIndex: chosen.cellIndex as number, rawCell: table.cells[chosen.cellIndex as number].parsedText } : {}) },
            sharesPerLot: { decimal: lot[1], cellIndex: lotIndex, raw: table.cells[lotIndex].parsedText }, percentageDenominator: { basis: "reported-whole-lot-total", cellIndex: totalIndex, raw: table.cells[totalIndex].parsedText }, entries: [] };
        for (let c = 1; c < 10; c++) {
            const category = categories[c - 1], odd = c === 9, headerIndexes = [...new Set([table.grid[header + 1][c], table.grid[header + 2][c]])].filter((i): i is number => i !== null);
            const value = (r: number, unit: ShareholderCategoryValue["unit"], percent = false): ShareholderCategoryValue => { const i = table.grid[r][c]!; return { unit, source: { cellIndex: i, raw: table.cells[i].parsedText }, ...number(table.cells[i].parsedText, percent) }; };
            const missing = (unit: ShareholderCategoryValue["unit"]): ShareholderCategoryValue => ({ unit, status: "missing", reason: "not-applicable-to-odd-lots" });
            const lots = odd ? missing("lots") : value(header + 4, "lots");
            let shares: ShareholderCategoryValue;
            if (odd) shares = value(header + 4, "shares");
            else if (lots.status === "numeric" && "source" in lots) { const n = String(BigInt(lots.decimal) * BigInt(lot[1])); shares = { unit: "shares", status: "numeric", decimal: n, safeNumber: toSafeMetricNumber(n), calculation: { formula: "ownedLots*sharesPerLot", lotsCellIndex: lots.source.cellIndex, lotSizeCellIndex: lotIndex } }; }
            else shares = { unit: "shares", status: "unavailable", reason: "owned-lots-unavailable", lotsCellIndex: table.grid[header + 4][c]! };
            group.entries.push({ entryKey: createHash("sha256").update(JSON.stringify([source.inputXmlSha256, d.selection.docID, d.selection.contextRef, tableIndex, asOf, c])).digest("hex"), category, role: odd ? "odd-lots" : c === 8 ? "reported-total" : "category",
                headers: headerIndexes.map(cellIndex => ({ cellIndex, raw: table.cells[cellIndex].parsedText })), values: { shareholderCount: odd ? missing("persons") : value(header + 3, "persons"), ownedLots: lots, ownedShares: shares, ownershipPercent: odd ? missing("percent") : value(header + 5, "percent", true) } });
        }
        result.groups.push(group);
    }
    return result;
}
export interface ShareholderCategorySearchOptions { asOf: string; category: ShareholderCategory; metric: ShareholderCategoryMetric; condition?: { operator: ComparisonOperator; value: number }; sort?: "value-asc" | "value-desc"; offset?: number; limit?: number; }
export function searchShareholderCategories(documents: readonly ShareholderCategoryDocument[], options: ShareholderCategorySearchOptions): { extractions: ShareholderCategoryExtraction[]; rows: { sourceIndex: number; tableIndex: number; entry: ShareholderCategoryEntry }[]; matched: number; filtered: number; excluded: { sourceIndex: number; entryKey: string; reason: string }[] } {
    if (!Array.isArray(documents) || documents.length > 100 || !options) throw new Error("株主分類検索は100原本以下です");
    const { asOf, category, metric, condition, sort, offset = 0, limit = 100 } = options;
    if (!validDate(asOf) || !categories.includes(category) || !metrics.includes(metric) || condition !== undefined && (!condition || typeof condition !== "object" || Array.isArray(condition) || !["gt", "gte", "lt", "lte", "eq"].includes(condition.operator) || !Number.isFinite(condition.value)) || sort !== undefined && !["value-asc", "value-desc"].includes(sort) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("株主分類の基準日/分類/指標/条件を確認してください");
    const inputs = Array.from(documents, capture).sort((a, b) => a.selection.docID < b.selection.docID ? -1 : a.selection.docID > b.selection.docID ? 1 : 0);
    if (inputs.some(d => typeof d.xml !== "string") || inputs.reduce((n, d) => n + Buffer.byteLength(d.xml), 0) > 256 * 1024 * 1024 || new Set(inputs.map(d => d.selection.docID)).size !== inputs.length) throw new Error("株主分類原本の重複/上限を確認してください");
    const extractions: ShareholderCategoryExtraction[] = [], rows: { sourceIndex: number; tableIndex: number; entry: ShareholderCategoryEntry }[] = [], excluded: { sourceIndex: number; entryKey: string; reason: string }[] = [], issuers = new Set<string>();
    let filtered = 0, cells = 0, count = 0;
    for (const input of inputs) {
        const extraction = extractShareholderCategories(input), sourceIndex = extractions.length, entity = extraction.source.source.entity;
        if (entity) { const key = JSON.stringify([entity.scheme, entity.identifier]); if (issuers.has(key)) throw new Error("同一提出者は訂正系列を先に選んでください"); issuers.add(key); }
        cells += extraction.source.tables.reduce((n, t) => n + t.cells.length, 0); count += extraction.groups.reduce((n, g) => n + g.entries.length, 0);
        if (cells > 100000 || count > 10000) throw new Error("株主分類検索は100000セル/10000記載以下です");
        extractions.push(extraction);
        for (const group of extraction.groups) for (const entry of group.entries) {
            if (group.asOf !== asOf || entry.category !== category) { filtered++; continue; }
            const v = entry.values[metric]; if (v.status !== "numeric") { excluded.push({ sourceIndex, entryKey: entry.entryKey, reason: v.reason }); continue; }
            if (condition) { const n = compareFractions(decimal(v.decimal), decimalFraction(condition.value)); if (!(condition.operator === "gt" ? n > 0 : condition.operator === "gte" ? n >= 0 : condition.operator === "lt" ? n < 0 : condition.operator === "lte" ? n <= 0 : n === 0)) { filtered++; continue; } }
            rows.push({ sourceIndex, tableIndex: group.tableIndex, entry });
        }
    }
    if (sort) rows.sort((a, b) => { const x = a.entry.values[metric], y = b.entry.values[metric]; return x.status === "numeric" && y.status === "numeric" ? compareFractions(decimal(x.decimal), decimal(y.decimal)) * (sort === "value-asc" ? 1 : -1) : 0; });
    return { extractions, rows: rows.slice(offset, offset + limit), matched: rows.length, filtered, excluded };
}
