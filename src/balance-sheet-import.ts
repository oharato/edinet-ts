import { createHash } from "node:crypto";
import { createBalanceSheetSnapshot, type BalanceSheetSnapshotMetadata } from "./balance-sheet-screening";
import { BalanceSheetSqliteStore, type BalanceSheetProvenance } from "./db/balance-sheet-store";

export interface BalanceSheetImportSource {
    metadata: BalanceSheetSnapshotMetadata;
    provenance: BalanceSheetProvenance;
}
export const BalanceSheetImportStatus = Object.freeze({ New: "new", Changed: "changed", Unchanged: "unchanged", Conflict: "conflict" } as const);
export type BalanceSheetImportStatus = typeof BalanceSheetImportStatus[keyof typeof BalanceSheetImportStatus];
export interface BalanceSheetImportItem extends BalanceSheetImportSource {
    status: BalanceSheetImportStatus;
    reason: "new-slot" | "extraction-version" | "identical" | "source-conflict";
    previousIds: string[];
    unchangedId?: string;
}
export interface BalanceSheetImportPlan {
    inventoryFingerprint: string;
    items: BalanceSheetImportItem[];
    counts: Record<BalanceSheetImportStatus, number>;
}
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" &&
    [Object.prototype, null].includes(Object.getPrototypeOf(v));
const exactKeys = (v: Record<string, unknown>, keys: string[]) => Reflect.ownKeys(v).every(k => typeof k === "string" && keys.includes(k)) &&
    Object.values(Object.getOwnPropertyDescriptors(v)).every(d => "value" in d && d.enumerable);
const version = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 256;
function copySource(value: BalanceSheetImportSource): BalanceSheetImportSource {
    if (!plain(value) || !exactKeys(value, ["metadata", "provenance"]) || !plain(value.metadata) || !plain(value.provenance)) throw new Error("不正な取込元です");
    const m = value.metadata, p = value.provenance;
    if (!exactKeys(m, ["secCode", "docID", "instant", "scope", "accountingStandard", "currency"]) ||
        typeof m.secCode !== "string" || !/^[0-9A-Z]{4}0?$/.test(m.secCode) || typeof m.docID !== "string" || !m.docID.trim() ||
        typeof m.instant !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(m.instant) || !Number.isFinite(Date.parse(m.instant)) || new Date(m.instant).toISOString().slice(0, 10) !== m.instant ||
        !["Consolidated", "NonConsolidated"].includes(m.scope as string) || m.accountingStandard !== "J-GAAP" || m.currency !== "JPY" ||
        !exactKeys(p, ["extractorVersion", "mappingVersion", "sourceSha256", "sourceCommit"]) || !version(p.extractorVersion) || !version(p.mappingVersion) ||
        typeof p.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(p.sourceSha256) ||
        p.sourceCommit !== undefined && (typeof p.sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(p.sourceCommit))) throw new Error("不正な書類識別/解析版です");
    return { metadata: { secCode: m.secCode.length === 4 ? `${m.secCode}0` : m.secCode, docID: m.docID, instant: m.instant,
        scope: m.scope as BalanceSheetSnapshotMetadata["scope"], accountingStandard: "J-GAAP", currency: "JPY" },
        provenance: { extractorVersion: p.extractorVersion, mappingVersion: p.mappingVersion, sourceSha256: p.sourceSha256,
            ...(p.sourceCommit === undefined ? {} : { sourceCommit: p.sourceCommit as string }) } };
}
const slot = (m: BalanceSheetSnapshotMetadata) => JSON.stringify([m.secCode, m.docID, m.instant, m.scope, m.accountingStandard, m.currency]);
const sameProvenance = (a: BalanceSheetProvenance, b: BalanceSheetProvenance) => a.sourceSha256 === b.sourceSha256 &&
    a.extractorVersion === b.extractorVersion && a.mappingVersion === b.mappingVersion && a.sourceCommit === b.sourceCommit;
const sourceConflict = (a: BalanceSheetImportSource, b: BalanceSheetImportSource) => a.metadata.docID === b.metadata.docID &&
    (a.metadata.secCode !== b.metadata.secCode || a.metadata.accountingStandard !== b.metadata.accountingStandard ||
        a.metadata.currency !== b.metadata.currency || a.provenance.sourceSha256 !== b.provenance.sourceSha256);
function makePlan(store: BalanceSheetSqliteStore, sources: readonly BalanceSheetImportSource[]): BalanceSheetImportPlan {
    const inventory = store.inventory(), seen = new Set<string>();
    for (const source of sources) {
        const key = slot(source.metadata);
        if (seen.has(key)) throw new Error("取込対象に同じ書類・期末・範囲が重複しています");
        seen.add(key);
    }
    const counts: BalanceSheetImportPlan["counts"] = { new: 0, changed: 0, unchanged: 0, conflict: 0 };
    const items = sources.map(source => {
        const prior = inventory.entries.filter(entry => slot(entry.metadata) === slot(source.metadata));
        const conflict = [...inventory.entries, ...sources].some(entry => sourceConflict(source, entry));
        const identical = prior.filter(entry => sameProvenance(source.provenance, entry.provenance));
        const status: BalanceSheetImportStatus = conflict || identical.length > 1 ? "conflict" : identical.length ? "unchanged" : prior.length ? "changed" : "new";
        counts[status]++;
        return { ...source, status, reason: ({ new: "new-slot", changed: "extraction-version", unchanged: "identical", conflict: "source-conflict" } as const)[status], previousIds: prior.map(entry => entry.id), ...(status === "unchanged" ? { unchangedId: identical[0].id } : {}) };
    });
    return { inventoryFingerprint: inventory.fingerprint, items, counts };
}
function copySources(sources: readonly BalanceSheetImportSource[]): BalanceSheetImportSource[] {
    if (!Array.isArray(sources)) throw new Error("取込対象は配列です");
    // 疎配列も省略せずエラーにします。呼出側や読取callbackの後続変更を参照しません。
    return Array.from(sources, copySource);
}
/** 原本を読まず、検証済みDB一覧と利用者の原本manifestから計画します。 */
export function planBalanceSheetImport(store: BalanceSheetSqliteStore, sources: readonly BalanceSheetImportSource[]): BalanceSheetImportPlan {
    return makePlan(store, copySources(sources));
}
export interface BalanceSheetImportResult {
    plan: BalanceSheetImportPlan;
    processed: number;
    inserted: number;
    unchanged: number;
    /** 入力順。再解析の旧版は削除せず、このID集合で検索対象を明示できます。 */
    snapshotIds: string[];
}
/** 同期・有限batch。原本読取/解析を完了してから、全変更を一度のtransactionで保存します。 */
export function importBalanceSheets(store: BalanceSheetSqliteStore, sources: readonly BalanceSheetImportSource[],
    readSource: (source: BalanceSheetImportSource) => Uint8Array): BalanceSheetImportResult {
    if (typeof readSource !== "function") throw new Error("原本の読取関数が必要です");
    const plan = makePlan(store, copySources(sources));
    if (plan.counts.conflict) throw new Error("同じ書類の原本/企業情報が衝突しています。上書きしません");
    const changed = plan.items.filter(item => item.status !== "unchanged");
    const inputs = changed.map(item => {
        const source = copySource({ metadata: item.metadata, provenance: item.provenance });
        const supplied = readSource(copySource(source));
        if (!(supplied instanceof Uint8Array)) throw new Error("原本はUTF-8のbyte列で返してください");
        const bytes = Uint8Array.from(supplied);
        if (createHash("sha256").update(bytes).digest("hex") !== source.provenance.sourceSha256) throw new Error("原本byte列のSHA256が計画と一致しません");
        const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (/<\?xml[^>]*encoding\s*=\s*["'](?!utf-8["'])[^"']+["']/i.test(xml)) throw new Error("UTF-8以外のXML宣言は未対応です");
        return { snapshot: createBalanceSheetSnapshot(xml, source.metadata), provenance: source.provenance };
    });
    // callback中の別接続更新も、変更0件の場合も、write lock下で一覧を再検査します。
    const saved = store.putMany(inputs, { expectedInventoryFingerprint: plan.inventoryFingerprint });
    let next = 0;
    const snapshotIds = plan.items.map(item => item.status === "unchanged" ? item.unchangedId! : saved.ids[next++]);
    return { plan, processed: inputs.length, inserted: saved.inserted, unchanged: plan.counts.unchanged, snapshotIds };
}
