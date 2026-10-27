import { types } from "node:util";
import { ComparisonOperator, SortOrder } from "./financial-options";
import { DEFAULT_FINANCIAL_DETAIL_METRICS, FINANCIAL_DETAIL_REGISTRY, type FinancialDetailMetricId } from "./financial-detail-registry";
import { normalizeFinancialDetailMetadata, type FinancialDetailMetadata } from "./financial-detail-metadata";
import { identicalMetricFacts, toSafeMetricNumber, type FactSelectionEvidence, type FactSelectionResult, type SelectionReason } from "./metric-selection";
import type { FinancialDetailSnapshot, FinancialDetailScreeningOptions, FinancialDetailScreeningResult,
    FinancialDetailCondition, FinancialDetailDiagnostic } from "./financial-detail-screening";

const ids = Object.keys(FINANCIAL_DETAIL_REGISTRY) as FinancialDetailMetricId[];
const known = (value: unknown): value is FinancialDetailMetricId => typeof value === "string" && Object.hasOwn(FINANCIAL_DETAIL_REGISTRY, value);
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const decimal = (value: unknown): value is string => typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value);
const decimals = (value: unknown) => value === undefined || typeof value === "string" && /^(?:INF|[+-]?\d+)$/.test(value);
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => record(item)
    ? Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, item[key]])) : item) ?? "undefined";
const kinds = (metadata: FinancialDetailMetadata) => metadata.period.instant === undefined ? "duration" : "instant";
function exactKeys(value: unknown, allowed: readonly string[]): asserts value is Record<string, any> {
    if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error("未知または不正な保存snapshot項目です");
}
/** 属性を一度だけ読み取る。getter/Proxy/特殊objectを評価して別物へ変えることはしません。 */
function copyJson(value: unknown): any {
    const active = new Set<object>();
    function copy(item: unknown, optional = false): any {
        if (item === undefined && optional) return undefined;
        if (item === null || typeof item === "string" || typeof item === "boolean") return item;
        if (typeof item === "number" && Number.isFinite(item)) return item;
        if (!item || typeof item !== "object" || types.isProxy(item) || active.has(item)) throw new Error("plain JSONへ保持できない値または循環参照です");
        const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
        if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new Error("plain JSON objectが必要です");
        const descriptors = Object.getOwnPropertyDescriptors(item), keys = Reflect.ownKeys(descriptors);
        if (keys.some(key => typeof key !== "string" || !("value" in descriptors[key]) || !descriptors[key].enumerable && !(array && key === "length"))) throw new Error("getter/非JSON属性は保存snapshotへ使えません");
        active.add(item);
        let result: any;
        if (array) {
            const length = descriptors.length.value as number;
            if (keys.length !== length + 1 || keys.some(key => key !== "length" && (!/^(0|[1-9]\d*)$/.test(key as string) || Number(key) >= length))) throw new Error("疎配列または追加属性は保存snapshotへ使えません");
            result = Array.from({ length }, (_, index) => copy(descriptors[index].value));
        } else result = Object.fromEntries(keys.map(key => [key, copy(descriptors[key as string].value, true)]));
        active.delete(item); return result;
    }
    return copy(value);
}
const evidenceReasons = new Set<SelectionReason>(["context-mismatch", "nil", "unknown-namespace", "unknown-context", "unsupported-dimensions", "unsupported-context", "unsupported-entity", "unsupported-unit", "unsupported-semantics", "invalid-decimal", "invalid-decimals", "raw-unavailable", "duplicate-context", "selected", "selected-raw-only"]);
const official = /^http:\/\/disclosure\.edinet-fsa\.go\.jp\/taxonomy\/jppfs\/\d{4}-\d{2}-\d{2}\/jppfs_cor$/;
const samePeriod = (evidence: FactSelectionEvidence, metadata: FinancialDetailMetadata) => evidence.scope === metadata.scope &&
    evidence.period !== undefined && canonical(evidence.period) === canonical(metadata.period);
function rawDimensionJson(value: unknown): void {
    if (value === undefined) throw new Error("元次元の内部にundefinedは保持できません");
    if (Array.isArray(value)) value.forEach(rawDimensionJson);
    else if (record(value)) Object.values(value).forEach(rawDimensionJson);
}
/** 保存情報にはQNameの名前空間表がないためURIの再解決はしません。 */
function dimensionState(evidence: FactSelectionEvidence): { consistent: boolean; aggregate: boolean } {
    if (!record(evidence.rawDimensions) || !Array.isArray(evidence.dimensions)) return { consistent: false, aggregate: false };
    const members: { axis: string; member: string }[] = []; let known = true;
    for (const part of [evidence.rawDimensions.scenario, evidence.rawDimensions.segment]) {
        if (part === undefined || part === "") continue; // XMLの空scenarioは空文字になる。
        if (!record(part)) { known = false; continue; }
        if (Object.keys(part).some(key => key !== "xbrldi:explicitMember")) known = false;
        const list = part["xbrldi:explicitMember"];
        for (const member of list === undefined ? [] : Array.isArray(list) ? list : [list]) {
            if (!record(member) || typeof member["#text"] !== "string" || typeof member["@_dimension"] !== "string") { known = false; continue; }
            if (Object.keys(member).some(key => !["#text", "@_dimension"].includes(key))) known = false;
            const axis = member["@_dimension"].split(":"), value = member["#text"].split(":");
            if (axis.length !== 2 || value.length !== 2 || !axis.every(text) || !value.every(text)) known = false;
            members.push({ axis: axis.at(-1)!, member: value.at(-1)! });
        }
    }
    const consistent = canonical(members.map(member => member.member).sort()) === canonical([...evidence.dimensions].sort());
    return { consistent, aggregate: known && consistent && (evidence.scope === "Consolidated" ? members.length === 0 :
        members.length === 1 && members[0].axis === "ConsolidatedOrNonConsolidatedAxis" && members[0].member === "NonConsolidatedMember") };
}
function evidence(value: unknown, id: FinancialDetailMetricId, metadata: FinancialDetailMetadata): asserts value is FactSelectionEvidence {
    exactKeys(value, ["key", "namespace", "namespaceURI", "contextRef", "period", "scope", "entity", "dimensions", "rawDimensions", "unitRef", "unit", "raw", "decimals", "nil", "reason"]);
    const definition = FINANCIAL_DETAIL_REGISTRY[id], localNames = definition.candidates.map(candidate => candidate.key.split(":")[1]);
    if (typeof value.key !== "string" || value.key.split(":").length !== 2 || !text(value.namespace) || value.namespace !== value.key.split(":")[0] ||
        !localNames.includes(value.key.split(":")[1]) || typeof value.contextRef !== "string" || typeof value.unitRef !== "string" || typeof value.nil !== "boolean" || !evidenceReasons.has(value.reason)) throw new Error("不正な財務明細の証跡です");
    for (const key of ["namespaceURI", "unit", "raw", "decimals"]) if (value[key] !== undefined && typeof value[key] !== "string") throw new Error("証跡の任意文字列が不正です");
    if (value.period !== undefined) { exactKeys(value.period, ["instant", "startDate", "endDate"]); if (Object.values(value.period).some(date => date !== undefined && typeof date !== "string")) throw new Error("証跡の期間が不正です"); }
    if (value.scope !== undefined && !["Consolidated", "NonConsolidated"].includes(value.scope)) throw new Error("証跡のscopeが不正です");
    if (value.entity !== undefined) { exactKeys(value.entity, ["identifier", "scheme"]); if (!text(value.entity.identifier) || !text(value.entity.scheme)) throw new Error("証跡のentityが不正です"); }
    if (value.dimensions !== undefined && (!Array.isArray(value.dimensions) || value.dimensions.some((member: unknown) => !text(member)))) throw new Error("証跡のdimensionsが不正です");
    if (value.rawDimensions !== undefined) {
        exactKeys(value.rawDimensions, ["scenario", "segment"]);
        for (const part of Object.values(value.rawDimensions)) if (part !== undefined) rawDimensionJson(part);
    }
    if (value.reason === "unknown-context") {
        if (["period", "scope", "entity", "dimensions", "rawDimensions"].some(key => value[key] !== undefined)) throw new Error("未知contextの証跡に既知contextを混ぜられません");
        return;
    }
    if (!record(value.period) || value.scope === undefined || !Array.isArray(value.dimensions) || !record(value.rawDimensions)) throw new Error("既知contextの証跡が不足しています");
    if (value.reason === "unsupported-context") return; // namespaceVerified/periodValidの元flagはserialized証跡にない。
    if (value.reason === "context-mismatch") { if (samePeriod(value as FactSelectionEvidence, metadata)) throw new Error("対象期間/scopeと不一致理由が矛盾しています"); return; }
    if (!samePeriod(value as FactSelectionEvidence, metadata)) throw new Error("採用候補の対象期間/scopeが不整合です");
    if (value.reason === "unsupported-entity" || value.reason === "unsupported-dimensions") return;
    if (!dimensionState(value as FactSelectionEvidence).aggregate) throw new Error("採用候補の元次元が不整合です");
    const candidate = definition.candidates.find(candidate => candidate.standard === metadata.accountingStandard && candidate.key === value.key);
    const namespaceValid = !!candidate && official.test(value.namespaceURI ?? "");
    if (value.reason === "unknown-namespace") { if (namespaceValid) throw new Error("名前空間と非採用理由が矛盾しています"); return; }
    if (!namespaceValid) throw new Error("候補タグ/会計基準/公式名前空間が不整合です");
    if (value.reason === "duplicate-context") return;
    if (value.reason === "unsupported-semantics") { if (candidate!.supported) throw new Error("対応済み科目を非対応の意味へ変更できません"); return; }
    if (!candidate!.supported) throw new Error("非対応の科目を採用できません");
    if (value.reason === "nil") { if (!value.nil) throw new Error("nil理由と証跡が不整合です"); return; }
    if (value.nil) throw new Error("nil値を他の採用候補にできません");
    if (value.reason === "unsupported-unit") { if (value.unit === "iso4217:JPY") throw new Error("JPYと単位非対応理由が矛盾しています"); return; }
    if (!text(value.unitRef) || value.unit !== "iso4217:JPY") throw new Error("採用候補のJPY単位が不整合です");
    if (value.reason === "raw-unavailable") { if (value.raw !== undefined) throw new Error("原値不在の理由が矛盾しています"); return; }
    if (value.reason === "invalid-decimal") { if (value.raw === undefined || decimal(value.raw)) throw new Error("不正原値の理由が矛盾しています"); return; }
    if (!decimal(value.raw)) throw new Error("採用候補の原値が不正です");
    if (value.reason === "invalid-decimals") { if (decimals(value.decimals)) throw new Error("不正精度の理由が矛盾しています"); return; }
    if (!decimals(value.decimals) || value.reason !== (toSafeMetricNumber(value.raw) === undefined ? "selected-raw-only" : "selected") || !value.entity) throw new Error("採用理由/精度/entityと原値が不整合です");
}
function expectedSelection(items: FactSelectionEvidence[], id: FinancialDetailMetricId, metadata: FinancialDetailMetadata, collapseIdenticalDuplicates = false): { status: string; reason: SelectionReason; source?: FactSelectionEvidence } {
    const candidates = FINANCIAL_DETAIL_REGISTRY[id].candidates.filter(candidate => candidate.standard === metadata.accountingStandard);
    if (!candidates.length) {
        if (items.length) throw new Error("未対応基準の選択には候補を追加できません");
        return { status: "unsupported", reason: "unsupported-standard" };
    }
    for (const candidate of candidates) {
        const applicable = items.filter(item => item.key === candidate.key && (item.reason === "unsupported-context" ||
            samePeriod(item, metadata) && !["unknown-context", "unsupported-dimensions"].includes(item.reason)));
        if (!applicable.length) continue;
        if (applicable.some(item => item.reason === "duplicate-context")) return { status: "ambiguous", reason: "duplicate-context" };
        if (applicable.length > 1) {
            if (collapseIdenticalDuplicates && applicable.every(item => item.reason === "selected" || item.reason === "selected-raw-only") &&
                applicable.every(item => identicalMetricFacts(item, applicable[0])))
                return { status: "selected", reason: "selected-identical-duplicates", source: applicable[0] };
            return { status: "ambiguous", reason: "multiple-facts" };
        }
        const source = applicable[0];
        return source.reason === "nil" ? { status: "missing", reason: "nil" } : ["selected", "selected-raw-only"].includes(source.reason)
            ? { status: "selected", reason: source.reason, source } : { status: "unsupported", reason: source.reason };
    }
    const unknown = items.find(item => ["unknown-namespace", "unknown-context", "unsupported-dimensions"].includes(item.reason));
    return unknown ? { status: "unsupported", reason: unknown.reason } : { status: "missing", reason: items.length ? "context-mismatch" : "tag-absent" };
}
function normalizeCopied(value: unknown): FinancialDetailSnapshot {
    exactKeys(value, ["metadata", "selections"]);
    const metadata = normalizeFinancialDetailMetadata(value.metadata), selections = value.selections;
    exactKeys(selections, ids);
    const selectedIds = Object.keys(selections) as FinancialDetailMetricId[];
    if (!selectedIds.length || selectedIds.some(id => FINANCIAL_DETAIL_REGISTRY[id].periodType !== kinds(metadata))) throw new Error("保存項目は同一期間型の非空subsetが必要です");
    const contextSignatures = new Map<string, string>(), unitSignatures = new Map<string, string>(), entities = new Set<string>();
    let hasSelected = false, entityUnsupported = false;
    for (const id of selectedIds) {
        const result = selections[id];
        exactKeys(result, ["metricId", "status", "reason", "evidence", "raw", "safeNumber", "source"]);
        if (result.metricId !== id || !Array.isArray(result.evidence)) throw new Error("保存科目と選択記録が一致しません");
        for (const item of result.evidence) {
            evidence(item, id, metadata);
            const context = canonical([item.period, item.scope, item.entity, item.dimensions, item.rawDimensions]);
            if (contextSignatures.has(item.contextRef) && contextSignatures.get(item.contextRef) !== context) throw new Error("同一contextRefの保存証跡が矛盾しています");
            contextSignatures.set(item.contextRef, context);
            const unit = canonical(item.unit);
            if (unitSignatures.has(item.unitRef) && unitSignatures.get(item.unitRef) !== unit) throw new Error("同一unitRefの保存証跡が矛盾しています");
            unitSignatures.set(item.unitRef, unit);
            if (item.reason !== "unknown-context") entities.add(item.entity ? canonical(item.entity) : "unknown");
            if (item.reason === "unsupported-entity") entityUnsupported = true;
        }
        // 旧JSONの曖昧という判定は保持し、新しい採用札を持つ税引前だけ完全一致を検証します。
        const expected = expectedSelection(result.evidence, id, metadata, id === "incomeBeforeIncomeTaxes" && result.reason === "selected-identical-duplicates");
        if (result.status !== expected.status || result.reason !== expected.reason) throw new Error("採用状態/理由と候補の記録が矛盾しています");
        if (result.status === "selected") {
            hasSelected = true;
            evidence(result.source, id, metadata);
            if (!decimal(result.raw) || !expected.source || result.source.raw !== result.raw || canonical(result.source) !== canonical(expected.source)) throw new Error("原値と採用元の証跡が不一致です");
            const safe = toSafeMetricNumber(result.raw);
            if (!(Object.is(result.safeNumber, safe) || Object.is(safe, -0) && Object.is(result.safeNumber, 0))) throw new Error("原値とsafeNumberが不一致です");
            result.safeNumber = safe; // JSON往復で0になった-0だけ復元します。
        } else if (["raw", "safeNumber", "source"].some(key => Object.hasOwn(result, key))) throw new Error("非採用記録へ原値/数値/採用元を追加できません");
    }
    if (hasSelected && (entityUnsupported || entities.size !== 1 || entities.has("unknown"))) throw new Error("同一snapshot内の対象企業が不明または混在しています");
    return { metadata, selections } as FinancialDetailSnapshot;
}
/** 元XMLを再取得せず、保存された選択情報の内部整合を検証して複製します。 */
export function normalizeFinancialDetailSnapshot(value: unknown): FinancialDetailSnapshot { return normalizeCopied(copyJson(value)); }
function projection(metadata: FinancialDetailMetadata | undefined, requested?: readonly FinancialDetailMetricId[]): FinancialDetailMetricId[] {
    if (requested === undefined) return DEFAULT_FINANCIAL_DETAIL_METRICS.filter(id => !metadata || FINANCIAL_DETAIL_REGISTRY[id].periodType === kinds(metadata));
    if (!Array.isArray(requested) || !requested.length || requested.some(id => !known(id)) || new Set(requested).size !== requested.length) throw new Error("metricIdsに空/未知/重複項目があります");
    const selected = Array.from(requested as readonly FinancialDetailMetricId[]);
    if (new Set(selected.map(id => FINANCIAL_DETAIL_REGISTRY[id].periodType)).size > 1 || metadata && selected.some(id => FINANCIAL_DETAIL_REGISTRY[id].periodType !== kinds(metadata))) throw new Error("検索projectionの期間型が対象と異なります");
    return selected;
}
/** 保存済みJSONの明示集合を検索。保存していない項目を原本の欠損とは推定しません。 */
export function screenFinancialDetailSnapshots(snapshots: readonly FinancialDetailSnapshot[], options: FinancialDetailScreeningOptions = {}): FinancialDetailScreeningResult {
    const copied = copyJson(snapshots), settings = copyJson(options);
    if (!Array.isArray(copied)) throw new Error("保存snapshotは配列です");
    exactKeys(settings, ["metricIds", "conditions", "sortBy", "order", "offset", "limit"]);
    if (settings.conditions !== undefined && !Array.isArray(settings.conditions)) throw new Error("conditionsは配列です");
    const conditions = (settings.conditions ?? []) as FinancialDetailCondition[];
    for (const condition of conditions) {
        exactKeys(condition, ["metric", "operator", "value"]);
        if (!known(condition.metric) || !Object.values(ComparisonOperator).includes(condition.operator) || typeof condition.value !== "number" || !Number.isFinite(condition.value)) throw new Error("不正な保存財務検索条件です");
    }
    if (settings.sortBy !== undefined && !known(settings.sortBy) || settings.order !== undefined && !Object.values(SortOrder).includes(settings.order)) throw new Error("不正な保存財務の並び指定です");
    for (const value of [settings.offset, settings.limit]) if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new Error("offset/limitは0以上の安全な整数です");
    const rows = copied.map(normalizeCopied);
    const cohortKey = (metadata: FinancialDetailMetadata) => canonical([metadata.scope, metadata.accountingStandard, metadata.currency, metadata.periodType, metadata.period]);
    const seenCodes = new Set<string>(), seenDocs = new Set<string>();
    for (const row of rows) {
        if (seenCodes.has(row.metadata.secCode) || seenDocs.has(row.metadata.docID)) throw new Error("同一企業/書類の複数候補は明示的に絞ってください");
        seenCodes.add(row.metadata.secCode); seenDocs.add(row.metadata.docID);
        if (cohortKey(row.metadata) !== cohortKey(rows[0].metadata)) throw new Error("範囲/基準/通貨/対象期間/期間分類が混在しています");
    }
    const required = new Set<FinancialDetailMetricId>([...conditions.map(condition => condition.metric), ...(settings.sortBy ? [settings.sortBy] : [])]);
    if (new Set([...required].map(id => FINANCIAL_DETAIL_REGISTRY[id].periodType)).size > 1 || rows[0] && [...required].some(id => FINANCIAL_DETAIL_REGISTRY[id].periodType !== kinds(rows[0].metadata))) throw new Error("検索項目の期間型が対象と異なります");
    const selectedIds = projection(rows[0]?.metadata, settings.metricIds);
    if ([...required].some(id => !selectedIds.includes(id))) throw new Error("条件/並び項目をmetricIdsへ明示してください");
    if (!required.size) selectedIds.forEach(id => required.add(id));
    for (const row of rows) if (selectedIds.some(id => !Object.hasOwn(row.selections, id))) throw new Error("要求項目の選択記録が保存されていません。metricIdsを保存済みsubsetへ指定してください");
    const diagnostics: FinancialDetailDiagnostic[] = [], reasonCounts: FinancialDetailScreeningResult["reasonCounts"] = { missing: 0, unsupported: 0, ambiguous: 0, "unsafe-number": 0 };
    const found: FinancialDetailSnapshot[] = []; let excludedRows = 0, filteredRows = 0;
    const compare = (a: number, operator: ComparisonOperator, b: number) => operator === "gte" ? a >= b : operator === "lte" ? a <= b : operator === "gt" ? a > b : operator === "lt" ? a < b : a === b;
    for (const row of rows) {
        const selections = Object.fromEntries(selectedIds.map(id => [id, row.selections[id]])) as FinancialDetailSnapshot["selections"];
        let unavailable = false;
        for (const id of ids) {
            const selection = selections[id]; if (!selection) continue;
            const reason = selection.status !== "selected" ? selection.status : selection.safeNumber === undefined ? "unsafe-number" : undefined;
            if (reason) { diagnostics.push({ secCode: row.metadata.secCode, docID: row.metadata.docID, metric: id, reason, selectionReason: selection.reason, required: required.has(id) }); reasonCounts[reason]++; if (required.has(id)) unavailable = true; }
        }
        if (unavailable) { excludedRows++; continue; }
        if (!conditions.every(condition => compare(selections[condition.metric]!.safeNumber!, condition.operator, condition.value))) { filteredRows++; continue; }
        found.push({ metadata: row.metadata, selections });
    }
    found.sort((a, b) => (settings.sortBy ? (a.selections[settings.sortBy as FinancialDetailMetricId]!.safeNumber! - b.selections[settings.sortBy as FinancialDetailMetricId]!.safeNumber!) * (settings.order === "asc" ? 1 : -1) : 0) ||
        (a.metadata.secCode < b.metadata.secCode ? -1 : a.metadata.secCode > b.metadata.secCode ? 1 : a.metadata.docID < b.metadata.docID ? -1 : a.metadata.docID > b.metadata.docID ? 1 : 0));
    diagnostics.sort((a, b) => a.secCode < b.secCode ? -1 : a.secCode > b.secCode ? 1 : ids.indexOf(a.metric) - ids.indexOf(b.metric));
    const offset = settings.offset ?? 0;
    return { rows: found.slice(offset, settings.limit === undefined ? undefined : offset + settings.limit), total: found.length, excludedRows, filteredRows, diagnostics, reasonCounts };
}
