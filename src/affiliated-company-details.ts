import { createHash } from "node:crypto";
import { EdinetXbrlParser } from "./edinet-xbrl-parser";
import { DisclosureTableKind, type DisclosureTableDocument, type DisclosureTableExtraction, type DisclosureTable } from "./disclosure-tables";
import { AccountingStandard } from "./metric-registry";
import { parseReportedTableNumber } from "./reported-table-number";
import { decimalFraction, compareFractions } from "./decimal-fraction";
import type { CompanyProfileSelection } from "./company-profile";
import type { ComparisonOperator } from "./financial-options";
export const AFFILIATED_COMPANY_DETAILS_VERSION = "1";
export const AffiliatedRelationship = Object.freeze({ Parent: "parent", ConsolidatedSubsidiary: "consolidated-subsidiary", NonConsolidatedSubsidiary: "non-consolidated-subsidiary", EquityMethodSubsidiary: "equity-method-subsidiary", EquityMethodAffiliate: "equity-method-affiliate", EquityMethodAffiliatesAndOthers: "equity-method-affiliates-and-others", Affiliate: "affiliate", OtherRelatedCompany: "other-related-company" } as const);
export type AffiliatedRelationship = typeof AffiliatedRelationship[keyof typeof AffiliatedRelationship];
export type CapitalCurrency = "JPY" | "SGD" | "USD" | "GBP" | "AUD" | "MYR" | "IDR" | "PHP" | "VND" | "HKD" | "CNY" | "TWD" | "THB";
export interface AffiliatedCompanyDocument extends DisclosureTableDocument {
    reportingPeriodEnd: string; accountingStandard: typeof AccountingStandard.JGAAP;
    proof: { rawSha256: string; indirectIncluded: boolean };
    tables: readonly { tableIndex: number; continuationOf?: number }[];
}
type TableNumber = ReturnType<typeof parseReportedTableNumber>;
export type AffiliatedCapital = { raw: string; cellIndex: number } & (
    { currency: CapitalCurrency; multiplier: 1000 | 10000 | 1000000; amount: TableNumber } |
    { currency: null; status: "unavailable"; reason: "unsupported-currency-or-amount" }
);
export type AffiliatedPercent = TableNumber | { status: "missing"; reason: "not-reported" } |
    { status: "unavailable"; reason: "definition-unconfirmed" | "unsupported-components" | "out-of-range" };
export interface AffiliatedVotingDisplay { raw: string; cellIndex: number; direction: "owned" | "owned-by" | "unconfirmed"; directionBasis: "header" | "explicit-prefix" | "section-and-combined-header" | "conflicting-prefix"; unit: "percent"; reportedTotal: AffiliatedPercent; indirectIncluded: AffiliatedPercent; }
export interface AffiliatedCompanyRow {
    rowKey: string; tableIndex: number; rowIndex: number; relationship: AffiliatedRelationship;
    entryKind: "named" | "aggregate"; aggregateCount?: number; identity: "unresolved"; relationAsOf: "not-established";
    company: { cellIndex: number; raw: string }; companyAndAddressCombined: boolean; address: { cellIndex: number; raw: string } | { status: "unavailable"; reason: "not-separated" }; business: { cellIndex: number; raw: string };
    capital: AffiliatedCapital;
    voting: AffiliatedVotingDisplay; counterVoting?: AffiliatedVotingDisplay;
    officerRelationship?: { cellIndex: number; raw: string }; fundingRelationship?: { cellIndex: number; raw: string }; relationshipDescription?: { cellIndex: number; raw: string };
}
export interface AffiliatedCompanyExtraction {
    source: DisclosureTableExtraction; reportingPeriodEnd: string; relationAsOf: "not-established";
    profile: { fiscalYearEnd: CompanyProfileSelection; accountingStandard: CompanyProfileSelection };
    definitionVerification: "declared-source-reference-matched" | "not-confirmed";
    rows: AffiliatedCompanyRow[]; diagnostics: { reason: "unsupported-profile" | "unsupported-context" | "not-reviewed" | "unsupported-layout" | "continuation-unavailable" | "unknown-section" | "relationship-unconfirmed" | "merged-data-row" | "company-unavailable" | "summary-row"; tableIndex?: number; rowIndex?: number }[];
}
const relationships = Object.values(AffiliatedRelationship);
const currencies: Record<string, CapitalCurrency> = { "円": "JPY", "US$": "USD", "USドル": "USD", "シンガポールドル": "SGD", "アメリカ・ドル": "USD", "米ドル": "USD", "アメリカドル": "USD", "英ポンド": "GBP", "豪州ドル": "AUD", "リンギット": "MYR", "インドネシアルピア": "IDR", "ルピア": "IDR", "フィリピンペソ": "PHP", "フィリピン・ペソ": "PHP", "ベトナムドン": "VND", "ドン": "VND", "香港ドル": "HKD", "人民元": "CNY", "台湾元": "TWD", "バーツ": "THB" };
const sections: Record<string, AffiliatedRelationship> = { "親会社": "parent", "連結子会社": "consolidated-subsidiary", "非連結子会社": "non-consolidated-subsidiary", "持分法適用非連結子会社": "equity-method-subsidiary", "持分法適用関連会社": "equity-method-affiliate", "持分法適用関連会社等": "equity-method-affiliates-and-others", "関連会社": "affiliate", "その他の関係会社": "other-related-company" };
const normalize = (s: string) => s.normalize("NFKC").replace(/\s/g, "");
const whitespace = (s: string) => s.replace(/\s/g, "");
const date = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const fraction = (raw: string) => { const [i, f = ""] = raw.split("."); return { numerator: BigInt(i + f), denominator: 10n ** BigInt(f.length) }; };
function capture(input: AffiliatedCompanyDocument): AffiliatedCompanyDocument {
    if (!input) throw new Error("関係会社原本を指定してください");
    const { xml, selection, reportingPeriodEnd, accountingStandard, proof, tables } = input;
    if (!selection || !date(reportingPeriodEnd) || accountingStandard !== AccountingStandard.JGAAP || !proof || !Array.isArray(tables) || !tables.length || tables.length > 200) throw new Error("関係会社の表/報告期末/基準/注記を指定してください");
    const { docID, kind, contextRef } = selection, { rawSha256, indirectIncluded } = proof;
    if (kind !== DisclosureTableKind.AffiliatedEntities || typeof rawSha256 !== "string" || !/^[a-f0-9]{64}$/.test(rawSha256) || typeof indirectIncluded !== "boolean") throw new Error("関係会社本文と注記宣言が不正です");
    const seen = new Set<number>(), captured = Array.from(tables as AffiliatedCompanyDocument["tables"], entry => {
        if (!entry || Object.keys(entry).some(k => !["tableIndex", "continuationOf"].includes(k))) throw new Error("関係会社の継続表宣言が不正です");
        const { tableIndex, continuationOf } = entry;
        if (!Number.isSafeInteger(tableIndex) || tableIndex < 0 || seen.has(tableIndex) || continuationOf !== undefined && (!Number.isSafeInteger(continuationOf) || continuationOf !== tableIndex - 1)) throw new Error("関係会社の表位置/重複/継続元を確認してください");
        seen.add(tableIndex); return { tableIndex, continuationOf };
    }).sort((a, b) => a.tableIndex - b.tableIndex);
    if (captured.some(t => t.continuationOf !== undefined && !seen.has(t.continuationOf))) throw new Error("継続元の物理表も指定してください");
    return { xml, selection: { docID, kind, contextRef }, reportingPeriodEnd, accountingStandard, proof: { rawSha256, indirectIncluded }, tables: captured };
}
type VotingMode = "owned" | "owned-by" | "either";
interface AffiliatedLayout { headerRows: number; capitalColumn: number; businessColumn: number; addressColumn?: number; votingColumns: { column: number; mode: VotingMode }[]; officerColumn?: number; fundingColumn?: number; relationshipColumn?: number; fingerprint: string; }
function layout(table: DisclosureTable): AffiliatedLayout | undefined {
    const width = table.grid[0]?.length;
    if (![5, 6, 7].includes(width) || table.grid.some(row => row.length !== width || row.some(i => i === null))) return;
    const clean = (s: string) => normalize(s).replace(/\(注\)\d+/g, "");
    const paths = (height: number) => Array.from({ length: width }, (_, col) => [...new Set(table.grid.slice(0, height).map(row => row[col]!))].map(i => clean(table.cells[i].parsedText)).join("/"));
    const single = paths(1), names = ["会社名", "会社の名称", "名称"], capitals = ["資本金(百万円)", "資本金又は出資金(百万円)"];
    const votingMode = (s: string): VotingMode | undefined => s === "議決権の所有割合(%)" ? "owned" : s === "議決権の被所有割合(%)" ? "owned-by" : ["議決権の所有(又は被所有)割合(%)", "議決権の所有割合又は被所有割合(%)", "議決権の所有又は被所有割合(%)"].includes(s) ? "either" : undefined;
    let result: Omit<AffiliatedLayout, "fingerprint"> | undefined;
    if (width === 7 && table.grid.length >= 2) {
        const p = paths(2);
        if (!names.includes(p[0]) || p[1] !== "住所" || !capitals.includes(p[2]) || p[3] !== "主要な事業の内容") return;
        const mode = votingMode(p[4]);
        if (mode && ["関係内容/役員の兼任", "関係内容/役員の兼任(名)"].includes(p[5]) && ["関係内容/資金融通", "関係内容/資金援助"].includes(p[6])) result = { headerRows: 2, addressColumn: 1, capitalColumn: 2, businessColumn: 3, votingColumns: [{ column: 4, mode }], officerColumn: 5, fundingColumn: 6 };
        else if (p[4] === "議決権の所有(被所有)割合/所有割合(%)" && p[5] === "議決権の所有(被所有)割合/被所有割合(%)" && p[6] === "関係内容") result = { headerRows: 2, addressColumn: 1, capitalColumn: 2, businessColumn: 3, votingColumns: [{ column: 4, mode: "owned" }, { column: 5, mode: "owned-by" }], relationshipColumn: 6 };
    } else if (width === 6 && names.includes(single[0]) && single[1] === "住所" && capitals.includes(single[2]) && single[3] === "主要な事業の内容" && single[5] === "関係内容") {
        const mode = votingMode(single[4]); if (mode) result = { headerRows: 1, addressColumn: 1, capitalColumn: 2, businessColumn: 3, votingColumns: [{ column: 4, mode }], relationshipColumn: 5 };
    } else if (width === 5 && single[0] === "会社名(住所)" && capitals.includes(single[1]) && single[2] === "主要な事業の内容" && single[4] === "関係内容") {
        const mode = votingMode(single[3]); if (mode) result = { headerRows: 1, capitalColumn: 1, businessColumn: 2, votingColumns: [{ column: 3, mode }], relationshipColumn: 4 };
    }
    return result ? { ...result, fingerprint: JSON.stringify(result) } : undefined;
}
function capital(raw: string, cellIndex: number): AffiliatedCapital {
    const text = raw.trim(), scale = (unit: string): 1000 | 10000 | 1000000 => unit === "百万" ? 1000000 : unit === "万" ? 10000 : 1000;
    const amountFirst = /^([\s\S]*?)(百万|万|千)([\s\S]+)$/.exec(text), unitFirst = /^(百万|万|千)\s*([\s\S]*?)\s*([0-9][0-9,.]*)$/.exec(text);
    const candidates = [...(amountFirst ? [{ number: amountFirst[1].trim(), unit: amountFirst[2], label: amountFirst[3] }] : []), ...(unitFirst ? [{ number: unitFirst[3], unit: unitFirst[1], label: unitFirst[2] }] : [])];
    for (const candidate of candidates) {
        const label = normalize(candidate.label);
        if (Object.hasOwn(currencies, label)) { const multiplier = scale(candidate.unit); return { raw, cellIndex, currency: currencies[label], multiplier, amount: parseReportedTableNumber(candidate.number, multiplier) }; }
    }
    if (/^[0-9,.+\-−△()（）\s－—―–]*$/.test(text)) return { raw, cellIndex, currency: "JPY", multiplier: 1000000, amount: parseReportedTableNumber(text, 1000000) };
    return { raw, cellIndex, currency: null, status: "unavailable", reason: "unsupported-currency-or-amount" };
}
function percents(raw: string, confirmed: boolean): { reportedTotal: AffiliatedPercent; indirectIncluded: AffiliatedPercent } {
    const text = raw.trim().replaceAll("（", "(").replaceAll("）", ")").replace(/(?:\s*\(注\)\s*[0-9０-９]+(?:[、,]\s*[0-9０-９]+)*)+$/, "").trim();
    const plain = /^[0-9]+(?:\.[0-9]+)?$/.test(text), pair = /^([0-9]+(?:\.[0-9]+)?)\s*\(\s*([0-9]+(?:\.[0-9]+)?)\s*\)$/.exec(text);
    const unsupported = (reason: "definition-unconfirmed" | "unsupported-components" | "out-of-range") => ({ reportedTotal: { status: "unavailable" as const, reason }, indirectIncluded: { status: "unavailable" as const, reason } });
    if (pair && !confirmed) return unsupported("definition-unconfirmed");
    if (!plain && !pair) return { reportedTotal: ["", "－", "−", "—", "―", "-", "–"].includes(text) ? parseReportedTableNumber(text, 1) : { status: "unavailable", reason: "unsupported-components" }, indirectIncluded: { status: "missing", reason: "not-reported" } };
    const total = parseReportedTableNumber(pair ? pair[1] : text, 1), indirect = pair ? parseReportedTableNumber(pair[2], 1) : undefined;
    if (total.status !== "numeric" || indirect && indirect.status !== "numeric") return unsupported("unsupported-components");
    if (compareFractions(fraction(total.decimal), decimalFraction(100)) > 0 || indirect?.status === "numeric" && compareFractions(fraction(indirect.decimal), fraction(total.decimal)) > 0) return unsupported("out-of-range");
    return { reportedTotal: total, indirectIncluded: indirect ?? { status: "missing", reason: "not-reported" } };
}
function votingDisplay(ref: { raw: string; cellIndex: number }, mode: VotingMode, relationship: AffiliatedRelationship, confirmed: boolean): AffiliatedVotingDisplay {
    const parent = relationship === "parent" || relationship === "other-related-company", normalized = ref.raw.trim().replaceAll("（", "(").replaceAll("）", ")");
    const prefix = /^(?:\((被所有|所有)\)|(被所有|所有)(?=\s|[0-9]))\s*/.exec(normalized), explicit = prefix ? (prefix[1] ?? prefix[2]) === "被所有" ? "owned-by" : "owned" : undefined;
    const direction = explicit ? mode === "either" || mode === explicit ? explicit : "unconfirmed" : mode === "either" ? parent ? "owned-by" : "owned" : mode;
    return { ...ref, direction, directionBasis: explicit ? direction === "unconfirmed" ? "conflicting-prefix" : "explicit-prefix" : mode === "either" ? "section-and-combined-header" : "header", unit: "percent", ...percents(prefix ? normalized.slice(prefix[0].length) : ref.raw, confirmed) };
}
export function extractAffiliatedCompanies(input: AffiliatedCompanyDocument): AffiliatedCompanyExtraction {
    const c = capture(input), object = new EdinetXbrlParser().parse(c.xml, c.selection.docID), profile = object.getCompanyProfile();
    const source = { ...object.selectDisclosureTables(c.selection.kind, c.selection.contextRef), inputXmlSha256: createHash("sha256").update(c.xml).digest("hex") } as DisclosureTableExtraction;
    const result: AffiliatedCompanyExtraction = { source, reportingPeriodEnd: c.reportingPeriodEnd, relationAsOf: "not-established", profile: { fiscalYearEnd: profile.fields.fiscalYearEndDate, accountingStandard: profile.fields.accountingStandard }, definitionVerification: "not-confirmed", rows: [], diagnostics: [] };
    if (source.status !== "selected") return result;
    const end = profile.fields.fiscalYearEndDate, standard = profile.fields.accountingStandard, instant = source.source.period?.instant;
    if (end.status !== "selected" || end.raw !== c.reportingPeriodEnd || standard.status !== "selected" || standard.raw !== "Japan GAAP") { result.diagnostics.push({ reason: "unsupported-profile" }); return result; }
    if (!date(instant) || instant < c.reportingPeriodEnd || source.source.period?.startDate !== undefined || source.source.period?.endDate !== undefined || source.source.contextTrace.candidates[0]?.dimensions.length !== 0) { result.diagnostics.push({ reason: "unsupported-context" }); return result; }
    if (source.source.rawSha256 !== c.proof.rawSha256 || c.tables.some(t => !source.tables[t.tableIndex]) || c.proof.indirectIncluded && !(source.parsedText.includes("間接所有") && source.parsedText.includes("内数"))) throw new Error("関係会社の原本内参照/間接所有の注記を確認できません");
    result.definitionVerification = c.proof.indirectIncluded ? "declared-source-reference-matched" : "not-confirmed";
    const selected = new Set(c.tables.map(t => t.tableIndex)), states = new Map<number, { relationship?: AffiliatedRelationship; fingerprint: string }>();
    for (const t of source.tables) if (!selected.has(t.index)) result.diagnostics.push({ tableIndex: t.index, reason: "not-reviewed" });
    for (const declaration of c.tables) {
        const table = source.tables[declaration.tableIndex], format = layout(table);
        if (!format) { result.diagnostics.push({ tableIndex: table.index, reason: "unsupported-layout" }); continue; }
        let relationship: AffiliatedRelationship | undefined;
        if (declaration.continuationOf !== undefined) {
            const prior = states.get(declaration.continuationOf);
            if (!prior || prior.fingerprint !== format.fingerprint || !prior.relationship) { result.diagnostics.push({ tableIndex: table.index, reason: "continuation-unavailable" }); continue; }
            relationship = prior.relationship;
        }
        for (let row = format.headerRows; row < table.grid.length; row++) {
            const ref = (col: number) => { const cellIndex = table.grid[row][col]!; return { cellIndex, raw: table.cells[cellIndex].parsedText }; }, name = ref(0), normalized = normalize(name.raw);
            if (table.grid[row].every(i => !table.cells[i!].parsedText.trim())) continue;
            if (["会社名", "会社の名称"].includes(normalized) && format.addressColumn !== undefined && normalize(ref(format.addressColumn).raw) === "住所") {
                const repeated = layout({ ...table, grid: table.grid.slice(row, row + format.headerRows) });
                if (!repeated || repeated.fingerprint !== format.fingerprint) { relationship = undefined; result.diagnostics.push({ tableIndex: table.index, rowIndex: row, reason: "unsupported-layout" }); break; }
                row += format.headerRows - 1; continue;
            }
            const title = normalized.replace(/^\(/, "").replace(/\)$/, "");
            if (new Set(table.grid[row]).size === 1 || table.grid[row].slice(1).every(i => !table.cells[i!].parsedText.trim()) && (Object.hasOwn(sections, title) || /^\(.+\)$/.test(normalized))) {
                relationship = Object.hasOwn(sections, title) ? sections[title] : undefined;
                if (!relationship) result.diagnostics.push({ tableIndex: table.index, rowIndex: row, reason: "unknown-section" });
                continue;
            }
            if (!name.raw) { result.diagnostics.push({ tableIndex: table.index, rowIndex: row, reason: "company-unavailable" }); continue; }
            if (["合計", "計", "総計", "小計"].includes(normalized)) { result.diagnostics.push({ tableIndex: table.index, rowIndex: row, reason: "summary-row" }); continue; }
            if (!relationship) { result.diagnostics.push({ tableIndex: table.index, rowIndex: row, reason: "relationship-unconfirmed" }); continue; }
            if (table.grid[row].some(i => { const cell = table.cells[i!]; return cell.row !== row || cell.rowSpan !== 1 || cell.columnSpan !== 1; })) { result.diagnostics.push({ tableIndex: table.index, rowIndex: row, reason: "merged-data-row" }); continue; }
            const aggregateLabel = normalized.replace(/\(注\)[0-9]+(?:[、,][0-9]+)*$/, "").replace(/^\((.*)\)$/, "$1"), aggregate = /^その他([0-9]{1,9})社$/.exec(aggregateLabel), aggregateEntry = !!aggregate || aggregateLabel === "その他" || /^その他.*[0-9]+社/.test(aggregateLabel);
            const displays = format.votingColumns.map(col => votingDisplay(ref(col.column), col.mode, relationship!, c.proof.indirectIncluded)), parent = relationship === "parent" || relationship === "other-related-company";
            const primary = displays.find(v => v.direction === (parent ? "owned-by" : "owned")) ?? displays[0], counter = displays.find(v => v !== primary);
            const rowKey = createHash("sha256").update(JSON.stringify([c.selection.docID, source.inputXmlSha256, table.index, row])).digest("hex");
            result.rows.push({ rowKey, tableIndex: table.index, rowIndex: row, relationship, entryKind: aggregateEntry ? "aggregate" : "named", ...(aggregate ? { aggregateCount: Number(aggregate[1]) } : {}), identity: "unresolved", relationAsOf: "not-established", company: name, companyAndAddressCombined: format.addressColumn === undefined, address: format.addressColumn === undefined ? { status: "unavailable", reason: "not-separated" } : ref(format.addressColumn), business: ref(format.businessColumn), capital: capital(ref(format.capitalColumn).raw, ref(format.capitalColumn).cellIndex), voting: primary, ...(counter ? { counterVoting: counter } : {}), ...(format.officerColumn === undefined ? {} : { officerRelationship: ref(format.officerColumn) }), ...(format.fundingColumn === undefined ? {} : { fundingRelationship: ref(format.fundingColumn) }), ...(format.relationshipColumn === undefined ? {} : { relationshipDescription: ref(format.relationshipColumn) }) });
        }
        states.set(table.index, { relationship, fingerprint: format.fingerprint });
    }
    return result;
}
export interface AffiliatedCompanySearchOptions {
    reportingPeriodEnd: string; relationship: AffiliatedRelationship; entryKind: "named" | "aggregate";
    nameContains?: string; addressContains?: string; businessContains?: string;
    capital?: { currency: CapitalCurrency; operator: ComparisonOperator; value: number };
    voting?: { direction: "owned" | "owned-by"; component: "reportedTotal" | "indirectIncluded"; operator: ComparisonOperator; value: number };
    sort?: "name-asc" | "name-desc"; offset?: number; limit?: number;
}
export function searchAffiliatedCompanies(documents: readonly AffiliatedCompanyDocument[], options: AffiliatedCompanySearchOptions): {
    extractions: AffiliatedCompanyExtraction[]; rows: { sourceIndex: number; row: AffiliatedCompanyRow }[]; matched: number; filtered: number; excluded: { sourceIndex: number; rowKey: string; reason: "capital-unavailable" | "capital-currency-mismatch" | "voting-unavailable" | "voting-direction-unconfirmed" | "address-unavailable" }[];
} {
    if (!Array.isArray(documents) || documents.length > 100 || !options) throw new Error("関係会社検索は100原本以下です");
    const { reportingPeriodEnd, relationship, entryKind, nameContains, addressContains, businessContains, capital: amount, voting: vote, sort, offset = 0, limit = 100 } = options;
    const capitalCondition = amount === undefined ? undefined : amount && { currency: amount.currency, operator: amount.operator, value: amount.value }, votingCondition = vote === undefined ? undefined : vote && { direction: vote.direction, component: vote.component, operator: vote.operator, value: vote.value };
    const condition = (c: {operator: ComparisonOperator; value: number} | undefined | null) => c && ["gt", "gte", "lt", "lte", "eq"].includes(c.operator) && Number.isFinite(c.value);
    if (!date(reportingPeriodEnd) || !relationships.includes(relationship) || !["named", "aggregate"].includes(entryKind) || [nameContains, addressContains, businessContains].some(s => s !== undefined && (typeof s !== "string" || !s.trim() || s.length > 1000)) ||
        amount !== undefined && (!condition(capitalCondition) || !["JPY", ...Object.values(currencies)].includes(capitalCondition!.currency)) || vote !== undefined && (!condition(votingCondition) || !["owned", "owned-by"].includes(votingCondition!.direction) || !["reportedTotal", "indirectIncluded"].includes(votingCondition!.component)) ||
        sort !== undefined && !["name-asc", "name-desc"].includes(sort) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("関係会社検索の条件を確認してください");
    const inputs = Array.from(documents as readonly AffiliatedCompanyDocument[], capture);
    if (inputs.some(d => typeof d.xml !== "string" || d.reportingPeriodEnd !== reportingPeriodEnd) || inputs.reduce((n,d)=>n+Buffer.byteLength(d.xml),0)>256*1024*1024 || new Set(inputs.map(d=>JSON.stringify([d.selection.docID,d.selection.contextRef]))).size!==inputs.length) throw new Error("関係会社の原本重複/報告期末/上限を確認してください");
    inputs.sort((a,b)=>a.selection.docID<b.selection.docID?-1:a.selection.docID>b.selection.docID?1:a.selection.contextRef<b.selection.contextRef?-1:a.selection.contextRef>b.selection.contextRef?1:0);
    const extractions: AffiliatedCompanyExtraction[]=[],rows:{sourceIndex:number;row:AffiliatedCompanyRow}[]=[],excluded:{sourceIndex:number;rowKey:string;reason:"capital-unavailable"|"capital-currency-mismatch"|"voting-unavailable"|"voting-direction-unconfirmed"|"address-unavailable"}[]=[],issuers=new Set<string>();let cells=0,count=0,filtered=0;
    const passes=(raw:string,c:{operator:ComparisonOperator;value:number})=>{const n=compareFractions(fraction(raw),decimalFraction(c.value));return c.operator==='gt'?n>0:c.operator==='gte'?n>=0:c.operator==='lt'?n<0:c.operator==='lte'?n<=0:n===0;};
    for(const input of inputs){
        const extraction=extractAffiliatedCompanies(input),sourceIndex=extractions.length,entity=extraction.source.source.entity;
        if(entity){const key=JSON.stringify([entity.scheme,entity.identifier]);if(issuers.has(key))throw new Error("同じ提出者の原本が重複しています。訂正系列を先に選んでください");issuers.add(key);}
        cells+=extraction.source.tables.reduce((n,t)=>n+t.cells.length,0);count+=extraction.rows.length;if(cells>100000||count>10000)throw new Error("関係会社検索は100000物理セル/10000記載以下です");extractions.push(extraction);
        for(const row of extraction.rows){
            if(row.relationship!==relationship||row.entryKind!==entryKind){filtered++;continue;}
            if(capitalCondition){if(row.capital.currency!==null&&row.capital.currency!==capitalCondition.currency){excluded.push({sourceIndex,rowKey:row.rowKey,reason:"capital-currency-mismatch"});continue;}if(row.capital.currency===null||row.capital.amount.status!=="numeric"){excluded.push({sourceIndex,rowKey:row.rowKey,reason:"capital-unavailable"});continue;}if(!passes(row.capital.amount.decimal,capitalCondition)){filtered++;continue;}}
            if(votingCondition){const displays=[row.voting,...(row.counterVoting?[row.counterVoting]:[])],display=displays.find(v=>v.direction===votingCondition.direction);if(!display){if(displays.some(v=>v.direction==="unconfirmed"))excluded.push({sourceIndex,rowKey:row.rowKey,reason:"voting-direction-unconfirmed"});else filtered++;continue;}const value=display[votingCondition.component];if(value.status!=="numeric"){excluded.push({sourceIndex,rowKey:row.rowKey,reason:"voting-unavailable"});continue;}if(!passes(value.decimal,votingCondition)){filtered++;continue;}}
            if(addressContains&&!("raw" in row.address)){excluded.push({sourceIndex,rowKey:row.rowKey,reason:"address-unavailable"});continue;}
            if(nameContains&&!row.company.raw.includes(nameContains)||addressContains&&("raw" in row.address)&&!row.address.raw.includes(addressContains)||businessContains&&!row.business.raw.includes(businessContains)){filtered++;continue;}
            rows.push({sourceIndex,row});
        }
    }
    if(sort)rows.sort((a,b)=>(a.row.company.raw<b.row.company.raw?-1:a.row.company.raw>b.row.company.raw?1:0)*(sort==="name-asc"?1:-1));
    return {extractions,rows:rows.slice(offset,offset+limit),matched:rows.length,filtered,excluded};
}
