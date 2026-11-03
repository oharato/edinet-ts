import { createHash } from "node:crypto";
import { extractDisclosureTables, DisclosureTableKind, type DisclosureTableDocument, type DisclosureTableExtraction } from "./disclosure-tables";
import { parseReportedTableNumber } from "./reported-table-number";
import { decimalFraction, compareFractions } from "./decimal-fraction";
import type { ComparisonOperator } from "./financial-options";
export const MAJOR_SHAREHOLDER_DETAILS_VERSION = "1";
export const MajorShareholderTableKind = Object.freeze({ MajorShareholders: "major-shareholders-table", LargeHoldingReference: "large-holding-reference" } as const);
export type MajorShareholderTableKind = typeof MajorShareholderTableKind[keyof typeof MajorShareholderTableKind];
export interface MajorShareholderDocument extends DisclosureTableDocument { tables: readonly { tableIndex: number; rawSha256: string }[]; }
export type MajorShareholderValue = { cellIndex: number; raw: string } & (ReturnType<typeof parseReportedTableNumber> | { status: "unavailable"; reason: "non-integer-count" | "out-of-range-percent" });
export interface MajorShareholderRow {
    rowKey: string; rowIndex: number; role: "named" | "reported-total"; identity: "unresolved";
    holder: { cellIndex: number; raw: string }; address: { cellIndex: number; raw: string } | { status: "missing"; reason: "merged-summary-cell" };
    reportedCount: MajorShareholderValue & { unit: "shares" | "reported-holding-equivalents"; multiplier: 1 | 1000 };
    holdingPercent: MajorShareholderValue & { unit: "percent" };
}
export interface MajorShareholderGroup {
    tableIndex: number; kind: MajorShareholderTableKind;
    holdingAsOf: { status: "selected"; date: string; normalizedDateText: string; basis: "table-date-cell" | "preceding-text"; cellIndex?: number } | { status: "unavailable"; reason: "holding-date-not-established" } | { status: "unavailable"; reason: "conflicting-reference-chronology"; reportedDate: string; normalizedDateText: string };
    publicInspectionDates: { date: string; normalizedDateText: string }[];
    ownershipConfirmation: "reported-in-major-table" | "reference-only-not-confirmed-by-filer";
    denominator: { basis: "issued-shares-excluding-treasury" | "large-holding-definition-unconfirmed"; cellIndex: number; rawHeader: string };
    countDefinition: { cellIndex: number; rawHeader: string };
    precedingText: string; rows: MajorShareholderRow[];
}
export interface MajorShareholderExtraction {
    source: DisclosureTableExtraction; disclosureKind: "major-shareholders-text-block"; groups: MajorShareholderGroup[];
    diagnostics: { reason: "unsupported-context" | "unsupported-layout" | "unsupported-date" | "unconfirmed-reference" | "ambiguous-row" | "holder-unavailable"; tableIndex?: number; rowIndex?: number }[];
}
const normalize = (s: string) => s.normalize("NFKC").replace(/\s/g, "");
// 注番号と年、途中で分かれた数字を空白除去で連結しません。
const dateText = (s: string) => s.normalize("NFKC").replace(/\s+/g, (space, offset: number, full: string) =>
    /[0-9]/.test(full[offset - 1] ?? "") && /[0-9]/.test(full[offset + space.length] ?? "") ? " " : "");
const validDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const dateDisplay = (s: string): { date: string; normalizedDateText: string } | undefined => {
    const match = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(s); if (!match) return;
    const date = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    return validDate(date) ? { date, normalizedDateText: s } : undefined;
};
const datePattern = "(?<!\\d)\\d{4}年\\d{1,2}月\\d{1,2}日";
const currentDates = (s: string) => [...dateText(s).matchAll(new RegExp(`(${datePattern})現在`, "g"))].map(m => dateDisplay(m[1]));
const fraction = (s: string) => { const [i, f = ""] = s.split("."); return { numerator: BigInt(i + f), denominator: 10n ** BigInt(f.length) }; };
function capture(input: MajorShareholderDocument): MajorShareholderDocument {
    if (!input?.selection || input.selection.kind !== DisclosureTableKind.MajorShareholders || !Array.isArray(input.tables) || !input.tables.length || input.tables.length > 200) throw new Error("大株主本文と確認済み表を指定してください");
    const { xml, selection: { docID, kind, contextRef } } = input, seen = new Set<number>();
    const tables = Array.from(input.tables as MajorShareholderDocument["tables"], t => {
        if (!t || Object.keys(t).some(k => !["tableIndex", "rawSha256"].includes(k)) || !Number.isSafeInteger(t.tableIndex) || t.tableIndex < 0 || seen.has(t.tableIndex) || typeof t.rawSha256 !== "string" || !/^[a-f0-9]{64}$/.test(t.rawSha256)) throw new Error("大株主表の位置/本文参照/重複を確認してください");
        seen.add(t.tableIndex); return { tableIndex: t.tableIndex, rawSha256: t.rawSha256 };
    }).sort((a, b) => a.tableIndex - b.tableIndex);
    return { xml, selection: { docID, kind, contextRef }, tables };
}
export function extractMajorShareholderDetails(input: MajorShareholderDocument): MajorShareholderExtraction {
    const d = capture(input), source = extractDisclosureTables(d.xml, d.selection);
    const result: MajorShareholderExtraction = { source, disclosureKind: "major-shareholders-text-block", groups: [], diagnostics: [] };
    const diag = (reason: MajorShareholderExtraction["diagnostics"][number]["reason"], tableIndex?: number, rowIndex?: number) => result.diagnostics.push({ reason, tableIndex, rowIndex });
    if (source.status !== "selected") return result;
    if (d.tables.some(t => t.rawSha256 !== source.source.rawSha256)) throw new Error("大株主表の本文参照が一致しません");
    const instant = source.source.period?.instant;
    if (!validDate(instant) || source.source.contextTrace.candidates[0]?.dimensions.length !== 0) { diag("unsupported-context"); return result; }
    for (const declared of d.tables) {
        const index = declared.tableIndex, table = source.tables[index];
        if (!table) { diag("unsupported-layout", index); continue; }
        const text = (r: number, c: number) => { const i = table.grid[r]?.[c]; return i === undefined || i === null ? "" : normalize(table.cells[i].parsedText); };
        const header = table.grid.findIndex((_, r) => text(r, 0) === "氏名又は名称" && text(r, 1) === "住所");
        const countHeader = text(header, 2), ratioHeader = text(header, 3);
        const major = /^所有株式数\((千)?株\)$/.exec(countHeader), reference = /^保有(?:株券|株式)等の数\((千)?株\)$/.exec(countHeader);
        const knownRatio = major ? "発行済株式(自己株式を除く。)の総数に対する所有株式数の割合(%)" : "株券等保有割合(%)";
        if (header < 0 || !major && !reference || ratioHeader !== knownRatio || table.grid.some(r => r.length !== 4) ||
            table.grid[header].some(i => i === null || table.cells[i].rowSpan !== 1 || table.cells[i].columnSpan !== 1) ||
            table.grid.slice(0, header).some(r => r.some(i => i !== null && table.cells[i].parsedText && !new RegExp(`^${datePattern}現在$`).test(normalize(table.cells[i].parsedText))))) { diag("unsupported-layout", index); continue; }
        const prefix = table.precedingText ?? "", plain = normalize(prefix);
        let holdingAsOf: MajorShareholderGroup["holdingAsOf"] = { status: "unavailable", reason: "holding-date-not-established" };
        let publicInspectionDates: MajorShareholderGroup["publicInspectionDates"] = [];
        if (major) {
            const local = table.cells.flatMap((cell, cellIndex) => cell.row < header ? currentDates(cell.parsedText).map(date => ({ value: date, cellIndex })) : []);
            const dates = local.length ? local : currentDates(prefix).map(date => ({ value: date }));
            if (!dates.length || dates.some(v => !v.value || v.value.date > instant || v.value.date !== dates[0].value?.date)) { diag("unsupported-date", index); continue; }
            const chosen = dates[0]; holdingAsOf = { status: "selected", ...chosen.value!, basis: "cellIndex" in chosen ? "table-date-cell" : "preceding-text", ...("cellIndex" in chosen ? { cellIndex: chosen.cellIndex as number } : {}) };
        } else {
            const references = [...dateText(prefix).matchAll(new RegExp(`((?:${datePattern}付(?:(?:および|及び|、))?)+)で公衆の縦覧に供され`, "g"))];
            if (references.length !== 1 || !plain.includes("大量保有報告書") || !/実質所有株式数(?:の|が)?確認(?:が)?でき(?:ません|ない)/.test(plain)) { diag("unconfirmed-reference", index); continue; }
            const dates = [...references[0][1].matchAll(new RegExp(datePattern, "g"))].map(m => dateDisplay(m[0]));
            if (!dates.length || dates.some(v => !v || v.date > instant)) { diag("unsupported-date", index); continue; }
            publicInspectionDates = dates as MajorShareholderGroup["publicInspectionDates"];
            const holdingDates = [...dateText(prefix).matchAll(new RegExp(`が、?(${datePattern})付?現在で`, "g"))].map(m => dateDisplay(m[1]));
            if (holdingDates.length === 1 && holdingDates[0] && holdingDates[0].date <= instant) {
                const date = holdingDates[0];
                holdingAsOf = publicInspectionDates.every(v => date.date <= v.date) ? { status: "selected", ...date, basis: "preceding-text" } :
                    { status: "unavailable", reason: "conflicting-reference-chronology", reportedDate: date.date, normalizedDateText: date.normalizedDateText };
            }
        }
        const multiplier = (major ?? reference)![1] ? 1000 : 1, denominatorIndex = table.grid[header][3]!;
        const group: MajorShareholderGroup = { tableIndex: index, kind: major ? "major-shareholders-table" : "large-holding-reference", holdingAsOf, publicInspectionDates,
            ownershipConfirmation: major ? "reported-in-major-table" : "reference-only-not-confirmed-by-filer", denominator: { basis: major ? "issued-shares-excluding-treasury" : "large-holding-definition-unconfirmed", cellIndex: denominatorIndex, rawHeader: table.cells[denominatorIndex].parsedText }, countDefinition: { cellIndex: table.grid[header][2]!, rawHeader: table.cells[table.grid[header][2]!].parsedText }, precedingText: prefix, rows: [] };
        for (let r = header + 1; r < table.grid.length; r++) {
            const indexes = table.grid[r]; if (indexes.some(i => i === null)) { diag("ambiguous-row", index, r); continue; }
            const [nameIndex, addressIndex, countIndex, percentIndex] = indexes as number[], name = table.cells[nameIndex], address = table.cells[addressIndex], count = table.cells[countIndex], percent = table.cells[percentIndex];
            const summary = ["計", "合計", "総計"].includes(normalize(name.parsedText)), mergedSummary = summary && nameIndex === addressIndex && name.columnSpan === 2;
            if ([name, address, count, percent].some(c => c.row !== r || c.rowSpan !== 1) || !mergedSummary && (name.columnSpan !== 1 || address.columnSpan !== 1) || count.columnSpan !== 1 || percent.columnSpan !== 1) { diag("ambiguous-row", index, r); continue; }
            if (!name.parsedText) { diag("holder-unavailable", index, r); continue; }
            let countValue: ReturnType<typeof parseReportedTableNumber> | { status: "unavailable"; reason: "non-integer-count" } = parseReportedTableNumber(count.parsedText, multiplier);
            if (countValue.status === "numeric" && fraction(countValue.decimal).numerator % fraction(countValue.decimal).denominator !== 0n) countValue = { status: "unavailable", reason: "non-integer-count" };
            let percentValue: ReturnType<typeof parseReportedTableNumber> | { status: "unavailable"; reason: "out-of-range-percent" } = parseReportedTableNumber(percent.parsedText, 1);
            if (percentValue.status === "numeric" && compareFractions(fraction(percentValue.decimal), { numerator: 100n, denominator: 1n }) > 0) percentValue = { status: "unavailable", reason: "out-of-range-percent" };
            group.rows.push({ rowKey: createHash("sha256").update(JSON.stringify([source.inputXmlSha256, d.selection.docID, d.selection.contextRef, index, r])).digest("hex"), rowIndex: r, role: summary ? "reported-total" : "named", identity: "unresolved",
                holder: { cellIndex: nameIndex, raw: name.parsedText }, address: mergedSummary ? { status: "missing", reason: "merged-summary-cell" } : { cellIndex: addressIndex, raw: address.parsedText },
                reportedCount: { cellIndex: countIndex, raw: count.parsedText, unit: major ? "shares" : "reported-holding-equivalents", multiplier, ...countValue }, holdingPercent: { cellIndex: percentIndex, raw: percent.parsedText, unit: "percent", ...percentValue } });
        }
        result.groups.push(group);
    }
    return result;
}
export interface MajorShareholderSearchOptions { kind: MajorShareholderTableKind; date: { basis: "holding-as-of" | "public-inspection-date"; value: string }; role: MajorShareholderRow["role"]; metric: "reportedCount" | "holdingPercent"; holderContains?: string; addressContains?: string; condition?: { operator: ComparisonOperator; value: number }; sort?: "value-asc" | "value-desc"; offset?: number; limit?: number; }
export function searchMajorShareholderDetails(documents: readonly MajorShareholderDocument[], options: MajorShareholderSearchOptions): { extractions: MajorShareholderExtraction[]; rows: { sourceIndex: number; tableIndex: number; row: MajorShareholderRow }[]; matched: number; filtered: number; excluded: { sourceIndex: number; rowKey: string; reason: string }[] } {
    if (!Array.isArray(documents) || documents.length > 100 || !options?.date) throw new Error("大株主検索は100原本以下で日付の種類/値を指定してください");
    const { kind, date, role, metric, holderContains, addressContains, condition, sort, offset = 0, limit = 100 } = options;
    if (!Object.values(MajorShareholderTableKind).includes(kind) || !["holding-as-of", "public-inspection-date"].includes(date.basis) || !validDate(date.value) || kind === "major-shareholders-table" && date.basis !== "holding-as-of" || !["named", "reported-total"].includes(role) || !["reportedCount", "holdingPercent"].includes(metric) ||
        [holderContains, addressContains].some(s => s !== undefined && (typeof s !== "string" || !s.trim() || s.length > 1000)) || condition !== undefined && (!condition || typeof condition !== "object" || Array.isArray(condition) || !["gt", "gte", "lt", "lte", "eq"].includes(condition.operator) || !Number.isFinite(condition.value)) || sort !== undefined && !["value-asc", "value-desc"].includes(sort) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("大株主検索の種類/日付/指標/条件を確認してください");
    const inputs = Array.from(documents, capture).sort((a, b) => a.selection.docID < b.selection.docID ? -1 : a.selection.docID > b.selection.docID ? 1 : 0);
    if (inputs.some(d => typeof d.xml !== "string") || inputs.reduce((n, d) => n + Buffer.byteLength(d.xml), 0) > 256 * 1024 * 1024 || new Set(inputs.map(d => d.selection.docID)).size !== inputs.length) throw new Error("大株主原本の重複/上限を確認してください");
    const extractions: MajorShareholderExtraction[] = [], rows: { sourceIndex: number; tableIndex: number; row: MajorShareholderRow }[] = [], excluded: { sourceIndex: number; rowKey: string; reason: string }[] = [], issuers = new Set<string>();
    let filtered = 0, cells = 0, count = 0;
    for (const input of inputs) {
        const extraction = extractMajorShareholderDetails(input), sourceIndex = extractions.length, entity = extraction.source.source.entity;
        if (entity) { const id = JSON.stringify([entity.scheme, entity.identifier]); if (issuers.has(id)) throw new Error("同じ提出者は訂正系列を先に選んでください"); issuers.add(id); }
        cells += extraction.source.tables.reduce((n, t) => n + t.cells.length, 0); count += extraction.groups.reduce((n, g) => n + g.rows.length, 0);
        if (cells > 100000 || count > 10000) throw new Error("大株主検索は100000セル/10000記載以下です");
        extractions.push(extraction);
        for (const group of extraction.groups) for (const row of group.rows) {
            if (group.kind !== kind || row.role !== role) { filtered++; continue; }
            if (date.basis === "holding-as-of" && group.holdingAsOf.status !== "selected") { excluded.push({ sourceIndex, rowKey: row.rowKey, reason: group.holdingAsOf.reason }); continue; }
            const matchesDate = date.basis === "holding-as-of" ? group.holdingAsOf.status === "selected" && group.holdingAsOf.date === date.value : group.publicInspectionDates.some(d => d.date === date.value);
            if (!matchesDate || holderContains && !row.holder.raw.includes(holderContains) || addressContains && (!("raw" in row.address) || !row.address.raw.includes(addressContains))) { filtered++; continue; }
            const value = row[metric]; if (value.status !== "numeric") { excluded.push({ sourceIndex, rowKey: row.rowKey, reason: value.reason }); continue; }
            if (condition) { const n = compareFractions(fraction(value.decimal), decimalFraction(condition.value)); if (!(condition.operator === "gt" ? n > 0 : condition.operator === "gte" ? n >= 0 : condition.operator === "lt" ? n < 0 : condition.operator === "lte" ? n <= 0 : n === 0)) { filtered++; continue; } }
            rows.push({ sourceIndex, tableIndex: group.tableIndex, row });
        }
    }
    if (sort) rows.sort((a, b) => { const x = a.row[metric], y = b.row[metric]; return x.status === "numeric" && y.status === "numeric" ? compareFractions(fraction(x.decimal), fraction(y.decimal)) * (sort === "value-asc" ? 1 : -1) : 0; });
    return { extractions, rows: rows.slice(offset, offset + limit), matched: rows.length, filtered, excluded };
}
