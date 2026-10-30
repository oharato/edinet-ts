import { createHash } from "node:crypto";
import { extractDisclosureTables, DisclosureTableKind, type DisclosureTableDocument, type DisclosureTableExtraction, type DisclosureTable } from "./disclosure-tables";
import { AccountingStandard } from "./metric-registry";
import { parseReportedTableNumber } from "./reported-table-number";
import { decimalFraction, compareFractions } from "./decimal-fraction";
import type { ComparisonOperator } from "./financial-options";
export type FacilityOrganization = "reporting-company" | "domestic-subsidiaries" | "overseas-subsidiaries";
/** 表と日付/対象組織の対応は元書類を確認した宣言。hashの照合は意味の自動判定ではありません。 */
export interface FacilityTableDeclaration { tableIndex: number; asOfDate: string; organization: FacilityOrganization; rawSha256: string; }
export const FACILITY_DETAILS_VERSION = "2";
export const FacilityField = Object.freeze({ TotalBookValueJPY: "totalBookValueJPY", LandBookValueJPY: "landBookValueJPY", BuildingsBookValueJPY: "buildingsBookValueJPY", LandAreaM2: "landAreaM2" } as const);
export type FacilityField = typeof FacilityField[keyof typeof FacilityField];
export type FacilityValue = { cellIndex: number; raw: string; unit: "JPY" | "m2"; multiplier: 1 | 1000000 } & (
    { status: "numeric"; decimal: string; safeNumber?: number } | { status: "unavailable"; reason: "dash" | "blank" | "compound-or-unsupported-number" | "merged-data-cell" }
);
export interface FacilityDetailRow {
    rowKey: string; tableIndex: number; rowIndex: number; asOfDate: string; organization: FacilityOrganization;
    siteAndLocation: { cellIndex: number; raw: string }; companyLabel?: { cellIndex: number; raw: string }; segment: { cellIndex: number; raw: string };
    rights: "unconfirmed"; propertyIdentity: "not-established"; organizationVerification: "declared-source-reference-matched";
    values: Record<FacilityField, FacilityValue>;
}
export interface FacilityDetailsExtraction { declaredAccountingStandard: typeof AccountingStandard.JGAAP; source: DisclosureTableExtraction; rows: FacilityDetailRow[];
    diagnostics: { tableIndex: number; rowIndex?: number; reason: "not-reviewed" | "unsupported-layout" | "site-unavailable" | "merged-site-cell" }[]; }
export interface FacilityDetailDocument extends DisclosureTableDocument { accountingStandard: typeof AccountingStandard.JGAAP; declarations: readonly FacilityTableDeclaration[]; }
const organizations: readonly FacilityOrganization[] = ["reporting-company", "domestic-subsidiaries", "overseas-subsidiaries"];
const fields = Object.values(FacilityField);
const canonicalHeader = (s: string) => s.normalize("NFKC").replace(/\s/g, "");
const validDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
function captureArray<T>(input: readonly T[], maximum: number): T[] {
    if (!Array.isArray(input)) throw new Error("設備入力には配列が必要です");
    const count = input.length;
    if (!Number.isSafeInteger(count) || count < 0 || count > maximum) throw new Error("設備入力の配列上限を確認してください");
    return Array.from({ length: count }, (_, index) => {
        if (!Object.hasOwn(input, index)) throw new Error("設備入力の配列要素が欠落しています");
        return input[index];
    });
}
function layout(table: DisclosureTable): { site: number; segment: number; company?: number; columns: Record<FacilityField, number> } | undefined {
    const width = table.grid[0]?.length;
    if (![9, 11, 12].includes(width) || table.grid.length < 4) return;
    const paths = Array.from({ length: width }, (_, column) => [...new Set(table.grid.slice(0, 3).map(row => row[column]))].map(index => index === null || index === undefined ? "" : canonicalHeader(table.cells[index].parsedText)).join("/"));
    const shift = width === 12 ? 1 : 0, extra = width >= 11 ? 1 : 0;
    if (shift && paths[0] !== "会社名" || paths[shift] !== "事業所名(所在地)" || paths[shift + 1] !== "セグメントの名称" || extra && paths[shift + 2] !== "設備の内容" || !/^従業員数\(人\)$/.test(paths[width - 1])) return;
    const start = shift + 2 + extra, area = start + 2, land = start + 3, total = width - 2;
    const money = (path: string, term: RegExp) => /^帳簿価額(?:\(百万円\))?\//.test(path) && path.includes("(百万円)") && term.test(path);
    if (!money(paths[start], /\/建物(?:・|及び)構築物(?:\(百万円\))?$/) || !money(paths[start + 1], /\/(?:機械・運搬具・工具器具備品|機械装置及び運搬具)(?:\(百万円\))?$/) ||
        !/^帳簿価額(?:\(百万円\))?\/土地\/面積\(m2\)$/.test(paths[area]) || !money(paths[land], /\/土地\/金額(?:\(百万円\))?$/) ||
        !money(paths[land + 1], /\/リース資産(?:\(百万円\))?$/) || !money(paths[total], /\/合計(?:\(百万円\))?$/) ||
        extra && !money(paths[total - 1], /\/その他$/)) return;
    return { site: shift, segment: shift + 1, ...(shift ? { company: 0 } : {}), columns: { totalBookValueJPY: total, landBookValueJPY: land, buildingsBookValueJPY: start, landAreaM2: area } };
}
function value(table: DisclosureTable, row: number, column: number, field: FacilityField): FacilityValue {
    const cellIndex = table.grid[row][column]!, cell = table.cells[cellIndex], raw = cell.parsedText;
    const base = { cellIndex, raw, unit: field === "landAreaM2" ? "m2" as const : "JPY" as const, multiplier: field === "landAreaM2" ? 1 as const : 1000000 as const };
    if (cell.row < 3 || cell.rowSpan !== 1 || cell.columnSpan !== 1) return { ...base, status: "unavailable", reason: "merged-data-cell" };
    return { ...base, ...parseReportedTableNumber(raw, base.multiplier) };
}
export function extractFacilityDetails(input: FacilityDetailDocument): FacilityDetailsExtraction {
    if (!input) throw new Error("設備原本が必要です");
    const { xml, selection, declarations: declared, accountingStandard } = input;
    if (accountingStandard !== AccountingStandard.JGAAP) throw new Error("設備明細は確認済みのJ-GAAPだけを指定してください");
    if (!selection) throw new Error("設備本文の指定が必要です");
    const { docID, contextRef, kind } = selection;
    if (kind !== DisclosureTableKind.Facilities) throw new Error("設備本文と1〜200件の確認済み表宣言が必要です");
    const captured = captureArray(declared, 200);
    if (!captured.length) throw new Error("1〜200件の確認済み表宣言が必要です");
    const declarations = captured.map(d => { if (!d || Object.keys(d).some(k => !["tableIndex", "asOfDate", "organization", "rawSha256"].includes(k))) throw new Error("設備表宣言が不正です");
        const { tableIndex, asOfDate, organization, rawSha256 } = d;
        if (!Number.isSafeInteger(tableIndex) || tableIndex < 0 || !validDate(asOfDate) || !organizations.includes(organization) || typeof rawSha256 !== "string" || !/^[a-f0-9]{64}$/.test(rawSha256)) throw new Error("設備表の位置/日付/対象組織/hashが不正です");
        return { tableIndex, asOfDate, organization, rawSha256 }; });
    if (new Set(declarations.map(d => d.tableIndex)).size !== declarations.length) throw new Error("設備表宣言が重複しています");
    const source = extractDisclosureTables(xml, { docID, kind: DisclosureTableKind.Facilities, contextRef });
    return projectFacilityDetails(source, { selection: { docID, contextRef, kind }, accountingStandard, declarations });
}
/** 内部共有: 検査済み本文表から同じ設備明細を再構成します。 */
export function projectFacilityDetails(source: DisclosureTableExtraction, input: Omit<FacilityDetailDocument, "xml">): FacilityDetailsExtraction {
    const { accountingStandard, declarations, selection: { docID, contextRef } } = input;
    const rows: FacilityDetailRow[] = [], diagnostics: FacilityDetailsExtraction["diagnostics"] = [];
    if (source.status !== "selected") return { declaredAccountingStandard: accountingStandard, source, rows, diagnostics };
    const plain = canonicalHeader(source.parsedText);
    for (const d of declarations) {
        const [year, month, day] = d.asOfDate.split("-").map(Number);
        const table = source.tables[d.tableIndex], previous = source.tables[d.tableIndex - 1];
        const nearby = canonicalHeader((table?.precedingText ?? "") + (previous?.cells.length === 1 && previous.grid.every(row => row.length === 1) ? previous.cells[0].parsedText : ""));
        const nearbyDates = [...new Set([...nearby.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日現在/g)].map(m => `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`))];
        if (nearbyDates.length && (nearbyDates.length !== 1 || nearbyDates[0] !== d.asOfDate)) throw new Error("設備表の直前の日付と宣言が一致しません");
        if (d.rawSha256 !== source.source.rawSha256 || !source.tables[d.tableIndex] || !plain.includes(`${year}年${month}月${day}日`) || !validDate(source.source.period?.instant) || d.asOfDate > source.source.period!.instant!) throw new Error("設備表宣言の原本内参照を確認できません");
    }
    for (const table of source.tables) {
        const declaration = declarations.find(d => d.tableIndex === table.index);
        if (!declaration) { diagnostics.push({ tableIndex: table.index, reason: "not-reviewed" }); continue; }
        const mapping = layout(table);
        if (!mapping || table.grid.some(row => row.some(index => index === null))) { diagnostics.push({ tableIndex: table.index, reason: "unsupported-layout" }); continue; }
        for (let rowIndex = 3; rowIndex < table.grid.length; rowIndex++) {
            const ref = (col: number) => { const cellIndex = table.grid[rowIndex][col]!; return { cellIndex, raw: table.cells[cellIndex].parsedText }; }, site = ref(mapping.site), cell = table.cells[site.cellIndex];
            if (!site.raw || cell.row < 3) { diagnostics.push({ tableIndex: table.index, rowIndex, reason: "site-unavailable" }); continue; }
            if (cell.rowSpan !== 1 || cell.columnSpan !== 1) { diagnostics.push({ tableIndex: table.index, rowIndex, reason: "merged-site-cell" }); continue; }
            const rowKey = createHash("sha256").update(JSON.stringify([docID, source.inputXmlSha256, source.source.rawSha256, contextRef, table.index, rowIndex])).digest("hex");
            rows.push({ rowKey, tableIndex: table.index, rowIndex, asOfDate: declaration.asOfDate, organization: declaration.organization,
                siteAndLocation: site, ...(mapping.company === undefined ? {} : { companyLabel: ref(mapping.company) }), segment: ref(mapping.segment),
                rights: "unconfirmed", propertyIdentity: "not-established", organizationVerification: "declared-source-reference-matched",
                values: Object.fromEntries(fields.map(field => [field, value(table, rowIndex, mapping.columns[field], field)])) as Record<FacilityField, FacilityValue> });
        }
    }
    return { declaredAccountingStandard: accountingStandard, source, rows, diagnostics };
}
export interface FacilityScreeningOptions { asOfDate: string; conditions?: readonly { field: FacilityField; operator: ComparisonOperator; value: number }[];
    contains?: string; organization?: FacilityOrganization; sort?: { field: FacilityField; order: "asc" | "desc" }; offset?: number; limit?: number; }
const fraction = (raw: string) => { const [i, f = ""] = raw.split("."); return { numerator: BigInt(i + f), denominator: 10n ** BigInt(f.length) }; };
export function screenFacilityDetails(documents: readonly FacilityDetailDocument[], options: FacilityScreeningOptions): {
    extractions: FacilityDetailsExtraction[]; rows: { sourceIndex: number; row: FacilityDetailRow }[]; matched: number; filtered: number;
    excluded: { sourceIndex: number; rowKey: string; fields: FacilityField[] }[];
} {
    if (!options) throw new Error("設備検索は100原本以下です");
    const query = normalizeFacilityOptions(options), { asOfDate } = query;
    const inputs = captureArray(documents, 100).map(d => { if (!d) throw new Error("設備原本が不正です");
        const { xml, declarations, selection, accountingStandard } = d; if (!selection || !Array.isArray(declarations)) throw new Error("設備原本が不正です");
        const { docID, contextRef, kind } = selection; return { xml, accountingStandard, selection: { docID, contextRef, kind }, declarations: captureArray(declarations, 200).map(item => ({ ...item })) }; });
    if (inputs.some(d => typeof d.xml !== "string") || inputs.reduce((n, d) => n + Buffer.byteLength(d.xml), 0) > 256 * 1024 * 1024 ||
        new Set(inputs.map(d => JSON.stringify([d.selection.docID, d.selection.contextRef]))).size !== inputs.length || inputs.some(d => d.declarations.some(p => p.asOfDate !== asOfDate))) throw new Error("設備検索の原本重複/混在/上限を確認してください");
    inputs.sort((a, b) => a.selection.docID < b.selection.docID ? -1 : a.selection.docID > b.selection.docID ? 1 : a.selection.contextRef < b.selection.contextRef ? -1 : a.selection.contextRef > b.selection.contextRef ? 1 : 0);
    return screenParsedFacilityDetails(inputs.map(extractFacilityDetails), query);
}
function normalizeFacilityOptions(options: FacilityScreeningOptions) {
    if (!options) throw new Error("設備検索の条件が必要です");
    const { asOfDate, contains, organization, sort, offset = 0, limit = 100, conditions: requested = [] } = options;
    if (!validDate(asOfDate) || contains !== undefined && (typeof contains !== "string" || !contains.trim() || contains.length > 1000) || organization !== undefined && !organizations.includes(organization) ||
        !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("設備検索の条件が不正です");
    const conditions = captureArray(requested, 100).map(c => { if (!c) throw new Error("設備条件が不正です"); const { field, operator, value } = c;
        if (!fields.includes(field) || !["gt", "gte", "lt", "lte", "eq"].includes(operator) || !Number.isFinite(value)) throw new Error("設備条件が不正です"); return { field, operator, value }; });
    const sorting = sort ? { field: sort.field, order: sort.order } : undefined;
    if (sorting && (!fields.includes(sorting.field) || !["asc", "desc"].includes(sorting.order))) throw new Error("設備順序が不正です");
    return { asOfDate, contains, organization, sort: sorting, offset, limit, conditions };
}
/** 内部共有: 保存済みの検査済み設備明細をXML検索と同じ規則で検索します。 */
export function screenParsedFacilityDetails(extractions: readonly FacilityDetailsExtraction[], options: FacilityScreeningOptions) {
    const { asOfDate, contains, organization, sort: sorting, offset, limit, conditions } = normalizeFacilityOptions(options);
    if (!Array.isArray(extractions) || extractions.length > 100 || new Set(extractions.map(e => JSON.stringify([e.source.source.docID,e.source.source.contextRef]))).size !== extractions.length) throw new Error("設備検索の原本重複/上限を確認してください");
    const issuers = new Set<string>(); let physicalCells = 0, projectedRows = 0;
    for (const extraction of extractions as readonly FacilityDetailsExtraction[]) {
        if (extraction.rows.some(row => row.asOfDate !== asOfDate)) throw new Error("設備明細の時点が混在しています");
        if (extraction.source.source.entity) {
            const issuer = JSON.stringify([extraction.source.source.entity.scheme, extraction.source.source.entity.identifier]);
            if (issuers.has(issuer)) throw new Error("同じ提出者の設備原本が重複しています。訂正系列を先に選択してください");
            issuers.add(issuer);
        }
        physicalCells += extraction.source.tables.reduce((n, table) => n + table.cells.length, 0); projectedRows += extraction.rows.length;
        if (physicalCells > 100000 || projectedRows > 10000) throw new Error("設備検索は100000物理セル/10000行以下です");
    }
    const rows: { sourceIndex: number; row: FacilityDetailRow }[] = [], excluded: { sourceIndex: number; rowKey: string; fields: FacilityField[] }[] = []; let filtered = 0, count = 0;
    const required = [...new Set([...conditions.map(c => c.field), ...(sorting ? [sorting.field] : [])])];
    (extractions as readonly FacilityDetailsExtraction[]).forEach((extraction, sourceIndex) => extraction.rows.forEach(row => {
        if (++count > 10000) throw new Error("設備検索は10000行以下です");
        const unavailable = required.filter(f => row.values[f].status !== "numeric");
        if (unavailable.length) { excluded.push({ sourceIndex, rowKey: row.rowKey, fields: unavailable }); return; }
        const passes = conditions.every(c => {
            const selected = row.values[c.field]; if (selected.status !== "numeric") return false;
            const compare = compareFractions(fraction(selected.decimal), decimalFraction(c.value));
            return c.operator === "gt" ? compare > 0 : c.operator === "gte" ? compare >= 0 : c.operator === "lt" ? compare < 0 : c.operator === "lte" ? compare <= 0 : compare === 0;
        });
        if (!passes || organization && row.organization !== organization || contains && ![row.siteAndLocation.raw, row.companyLabel?.raw ?? "", row.segment.raw].some(s => s.includes(contains))) { filtered++; return; }
        rows.push({ sourceIndex, row });
    }));
    if (sorting) rows.sort((a, b) => { const av = a.row.values[sorting.field], bv = b.row.values[sorting.field];
        return av.status === "numeric" && bv.status === "numeric" ? compareFractions(fraction(av.decimal), fraction(bv.decimal)) * (sorting.order === "asc" ? 1 : -1) : 0; });
    return { extractions: [...extractions], rows: rows.slice(offset, offset + limit), matched: rows.length, filtered, excluded };
}
