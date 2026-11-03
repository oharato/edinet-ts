import { createHash } from "node:crypto";
import { extractDisclosureTables, DisclosureTableKind, type DisclosureTableDocument, type DisclosureTableExtraction } from "./disclosure-tables";
import { AccountingStandard } from "./metric-registry";
import { ConsolidationScope, type ComparisonOperator } from "./financial-options";
import { parseReportedTableNumber } from "./reported-table-number";
import { decimalFraction, compareFractions } from "./decimal-fraction";
export const MAIN_CUSTOMER_DETAILS_VERSION = "1";
export interface MainCustomerDocument extends DisclosureTableDocument {
    accountingStandard: typeof AccountingStandard.JGAAP; scope: ConsolidationScope;
    /** 元表の単位と対象範囲を確認した本文のhash。 */
    proof: { rawSha256: string };
}
export interface MainCustomerRow {
    rowKey: string; tableIndex: number; firstRow: number; rowSpan: number;
    customer: { cellIndex: number; raw: string }; identity: "unresolved";
    revenueJPY: { cellIndex: number; raw: string; unit: "JPY"; multiplier: 1000000 } & ReturnType<typeof parseReportedTableNumber>;
    segments: { cellIndex: number; raw: string }[];
}
export type MainCustomerDiagnosticReason = "unsupported-period" | "unsupported-scope" | "unsupported-unit" | "unsupported-layout" | "table-absent" | "ambiguous-row-association" | "customer-unavailable" | "summary-row";
export interface MainCustomerExtraction {
    source: DisclosureTableExtraction; declaredAccountingStandard: typeof AccountingStandard.JGAAP; declaredScope: ConsolidationScope;
    rows: MainCustomerRow[]; diagnostics: { reason: MainCustomerDiagnosticReason; tableIndex?: number; rowIndex?: number }[];
}
const normalize = (s: string) => s.normalize("NFKC").replace(/\s/g, "");
const date = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
function capture(input: MainCustomerDocument): MainCustomerDocument {
    if (!input) throw new Error("主要顧客の原本が必要です");
    const { xml, selection, accountingStandard, scope, proof } = input;
    if (!selection || !proof) throw new Error("主要顧客の表指定と確認済み本文hashが必要です");
    const { docID, kind, contextRef } = selection, rawSha256 = proof.rawSha256;
    if (accountingStandard !== AccountingStandard.JGAAP || ![ConsolidationScope.Consolidated, ConsolidationScope.NonConsolidated].includes(scope) || kind !== DisclosureTableKind.MainCustomers || typeof rawSha256 !== "string" || !/^[a-f0-9]{64}$/.test(rawSha256)) throw new Error("主要顧客の基準/範囲/本文参照が不正です");
    return { xml, selection: { docID, kind, contextRef }, accountingStandard, scope, proof: { rawSha256 } };
}
export function extractMainCustomerDetails(input: MainCustomerDocument): MainCustomerExtraction {
    const captured = capture(input), { xml, selection, accountingStandard, scope, proof } = captured;
    const source = extractDisclosureTables(xml, selection), result: MainCustomerExtraction = { source, declaredAccountingStandard: accountingStandard, declaredScope: scope, rows: [], diagnostics: [] };
    const unavailable = (reason: MainCustomerDiagnosticReason) => { result.diagnostics.push({ reason }); return result; };
    if (source.status !== "selected") return result;
    if (source.source.rawSha256 !== proof.rawSha256) throw new Error("主要顧客の原本内参照を確認できません");
    const period = source.source.period;
    if (!date(period?.startDate) || !date(period?.endDate) || period.startDate > period.endDate || period.instant !== undefined) return unavailable("unsupported-period");
    const dimensions = source.source.contextTrace.candidates[0]?.dimensions;
    const member = dimensions?.[0];
    const standalone = dimensions?.length === 1 && member?.kind === "explicit" && member.location === "scenario" && member.axis.status === "resolved" && member.member.status === "resolved" &&
        /^http:\/\/disclosure\.edinet-fsa\.go\.jp\/taxonomy\/jppfs\/(?:2018-03-31|2024-11-01|2025-11-01)\/jppfs_cor$/.test(member.axis.namespaceURI ?? "") && member.axis.namespaceURI === member.member.namespaceURI &&
        member.axis.localName === "ConsolidatedOrNonConsolidatedAxis" && member.member.localName === "NonConsolidatedMember";
    if (!(scope === ConsolidationScope.Consolidated ? dimensions?.length === 0 : standalone)) return unavailable("unsupported-scope");
    if (!source.tables.length) return unavailable("table-absent");
    const units = [...normalize(source.parsedText).matchAll(/単位:([^()]+)/g)].map(match => match[1]);
    if (!units.length || units.some(unit => unit !== "百万円")) return unavailable("unsupported-unit");
    if (source.tables.length !== 1) return unavailable("unsupported-layout");
    const table = source.tables[0], header = ["顧客の名称又は氏名", "売上高", "関連するセグメント名"];
    const rowText = (row: (number | null)[]) => row.map(index => index === null ? "" : normalize(table.cells[index].parsedText));
    const headerIndex = table.grid.slice(0, 2).findIndex(row => row.length === 3 && rowText(row).every((cell, col) => cell === header[col]));
    if (headerIndex < 0 || table.grid.some(row => row.length !== 3 || row.some(index => index === null)) ||
        table.grid.slice(0, headerIndex).some(row => rowText(row).some(text => text && text !== "(単位:百万円)")) ||
        table.grid[headerIndex].some(index => table.cells[index!].rowSpan !== 1 || table.cells[index!].columnSpan !== 1)) return unavailable("unsupported-layout");
    const seen = new Set<number>(), firstData = headerIndex + 1;
    for (let row = firstData; row < table.grid.length; row++) {
        const nameIndex = table.grid[row][0]!, amountIndex = table.grid[row][1]!;
        if (seen.has(nameIndex)) continue; seen.add(nameIndex);
        const name = table.cells[nameIndex], amount = table.cells[amountIndex], end = name.row + name.rowSpan;
        if (!name.parsedText || name.row < firstData) { result.diagnostics.push({ tableIndex: table.index, rowIndex: row, reason: "customer-unavailable" }); continue; }
        if (["合計", "計", "総計", "小計"].includes(normalize(name.parsedText))) { result.diagnostics.push({ tableIndex: table.index, rowIndex: row, reason: "summary-row" }); continue; }
        if (name.columnSpan !== 1 || amount.columnSpan !== 1 || name.row !== amount.row || name.rowSpan !== amount.rowSpan || end > table.grid.length ||
            table.grid.slice(name.row, end).some(r => r[0] !== nameIndex || r[1] !== amountIndex)) {
            result.diagnostics.push({ tableIndex: table.index, rowIndex: row, reason: "ambiguous-row-association" }); continue;
        }
        const segmentIndexes = [...new Set(table.grid.slice(name.row, end).map(r => r[2]!))];
        if (segmentIndexes.some(i => { const cell = table.cells[i]; return cell.columnSpan !== 1 || cell.row < name.row || cell.row + cell.rowSpan > end; })) {
            result.diagnostics.push({ tableIndex: table.index, rowIndex: row, reason: "ambiguous-row-association" }); continue;
        }
        const rowKey = createHash("sha256").update(JSON.stringify([selection.docID, source.inputXmlSha256, selection.contextRef, table.index, nameIndex, amountIndex])).digest("hex");
        result.rows.push({ rowKey, tableIndex: table.index, firstRow: name.row, rowSpan: name.rowSpan, customer: { cellIndex: nameIndex, raw: name.parsedText }, identity: "unresolved",
            revenueJPY: { cellIndex: amountIndex, raw: amount.parsedText, unit: "JPY", multiplier: 1000000, ...parseReportedTableNumber(amount.parsedText, 1000000) },
            segments: segmentIndexes.map(cellIndex => ({ cellIndex, raw: table.cells[cellIndex].parsedText })) });
    }
    return result;
}
export interface MainCustomerSearchOptions {
    period: { startDate: string; endDate: string }; scope: ConsolidationScope; customerContains?: string; segmentContains?: string;
    revenue?: { operator: ComparisonOperator; value: number }; sort?: "revenue-asc" | "revenue-desc"; offset?: number; limit?: number;
}
const fraction = (raw: string) => { const [i, f = ""] = raw.split("."); return { numerator: BigInt(i + f), denominator: 10n ** BigInt(f.length) }; };
export function searchMainCustomerDetails(documents: readonly MainCustomerDocument[], options: MainCustomerSearchOptions): {
    extractions: MainCustomerExtraction[]; rows: { sourceIndex: number; row: MainCustomerRow }[]; matched: number; filtered: number;
    excluded: { sourceIndex: number; rowKey: string; reason: string }[];
} {
    if (!Array.isArray(documents) || documents.length > 100 || !options) throw new Error("主要顧客検索は100原本以下です");
    const { period, scope, customerContains, segmentContains, revenue: requested, sort, offset = 0, limit = 100 } = options;
    if (!period) throw new Error("対象期間が必要です");
    if (requested !== undefined && (!requested || typeof requested !== "object" || Array.isArray(requested))) throw new Error("売上条件はoperator/valueの指定です");
    const { startDate, endDate } = period, revenue = requested ? { operator: requested.operator, value: requested.value } : undefined;
    if (!date(startDate) || !date(endDate) || startDate > endDate || ![ConsolidationScope.Consolidated, ConsolidationScope.NonConsolidated].includes(scope) ||
        [customerContains, segmentContains].some(s => s !== undefined && (typeof s !== "string" || !s.trim() || s.length > 1000)) ||
        revenue && (!["gt", "gte", "lt", "lte", "eq"].includes(revenue.operator) || !Number.isFinite(revenue.value)) ||
        sort !== undefined && !["revenue-asc", "revenue-desc"].includes(sort) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("主要顧客検索の条件が不正です");
    const inputs = Array.from(documents as readonly MainCustomerDocument[], capture);
    if (inputs.some(d => typeof d.xml !== "string" || d.scope !== scope) || inputs.reduce((n, d) => n + Buffer.byteLength(d.xml), 0) > 256 * 1024 * 1024 ||
        new Set(inputs.map(d => JSON.stringify([d.selection.docID, d.selection.contextRef]))).size !== inputs.length) throw new Error("主要顧客の原本重複/範囲混在/上限を確認してください");
    inputs.sort((a, b) => a.selection.docID < b.selection.docID ? -1 : a.selection.docID > b.selection.docID ? 1 : a.selection.contextRef < b.selection.contextRef ? -1 : a.selection.contextRef > b.selection.contextRef ? 1 : 0);
    const extractions: MainCustomerExtraction[] = [], rows: { sourceIndex: number; row: MainCustomerRow }[] = [], excluded: { sourceIndex: number; rowKey: string; reason: string }[] = [], issuers = new Set<string>();
    let filtered = 0, cells = 0, count = 0;
    for (const input of inputs) {
        const extraction = extractMainCustomerDetails(input), sourceIndex = extractions.length, source = extraction.source.source;
        if (source.period && (source.period.startDate !== startDate || source.period.endDate !== endDate || source.period.instant !== undefined)) throw new Error("主要顧客検索の期間が混在しています");
        if (source.entity) { const key = JSON.stringify([source.entity.scheme, source.entity.identifier]); if (issuers.has(key)) throw new Error("同じ提出者の原本が重複しています。訂正系列を先に選んでください"); issuers.add(key); }
        cells += extraction.source.tables.reduce((n, t) => n + t.cells.length, 0); count += extraction.rows.length;
        if (cells > 100000 || count > 10000) throw new Error("主要顧客検索は100000物理セル/10000記載以下です");
        extractions.push(extraction);
        for (const row of extraction.rows) {
            const amount = row.revenueJPY;
            if ((revenue || sort) && amount.status !== "numeric") { excluded.push({ sourceIndex, rowKey: row.rowKey, reason: amount.status === "unavailable" ? amount.reason : "unavailable" }); continue; }
            let passes = true;
            if (revenue && amount.status === "numeric") {
                const comparison = compareFractions(fraction(amount.decimal), decimalFraction(revenue.value));
                passes = revenue.operator === "gt" ? comparison > 0 : revenue.operator === "gte" ? comparison >= 0 : revenue.operator === "lt" ? comparison < 0 : revenue.operator === "lte" ? comparison <= 0 : comparison === 0;
            }
            if (!passes || customerContains && !row.customer.raw.includes(customerContains) || segmentContains && !row.segments.some(s => s.raw.includes(segmentContains))) { filtered++; continue; }
            rows.push({ sourceIndex, row });
        }
    }
    if (sort) rows.sort((a, b) => { const x = a.row.revenueJPY, y = b.row.revenueJPY; return x.status === "numeric" && y.status === "numeric" ? compareFractions(fraction(x.decimal), fraction(y.decimal)) * (sort === "revenue-asc" ? 1 : -1) : 0; });
    return { extractions, rows: rows.slice(offset, offset + limit), matched: rows.length, filtered, excluded };
}
