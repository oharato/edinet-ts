/** QNameの名前空間解決だけの証跡。DTSの所属・型・表の妥当性は検証しません。 */
export type DimensionTraceDiagnosticCode = "invalid-qname" | "undeclared-prefix" | "unsupported-namespace-binding" |
    "unsupported-qname-serialization" | "invalid-dimension-shape" | "extra-dimension-content" |
    "unknown-dimension-content" | "typed-uninterpreted" | "duplicate-axis" | "duplicate-context" | "trace-unavailable";
export interface DimensionTraceDiagnostic {
    readonly code: DimensionTraceDiagnosticCode;
    readonly field?: "element" | "axis" | "member" | "typed-element";
    readonly dimensionIndex?: number;
    /** 解釈しなかった構造も、parser表現のまま診断に残します。 */
    readonly parsedContent?: unknown;
    readonly element?: DimensionQNameTrace;
}
export interface DimensionNamespaceBinding {
    readonly prefix: string;
    /** parserが保持した宣言値。文字参照などを推測して再変換しません。 */
    readonly parsedUri: unknown;
    readonly declaredAt: string;
    readonly state: "bound" | "unbound" | "unsupported";
}
export interface DimensionQNameTrace {
    /** parserが保持した表現。元XMLのQName字面を検証・復元した値ではありません。 */
    readonly raw: unknown;
    readonly normalized?: string;
    readonly prefix?: string;
    readonly localName?: string;
    readonly namespaceURI?: string;
    readonly binding?: DimensionNamespaceBinding;
    readonly status: "resolved" | "unresolved";
    readonly reason?: "invalid-qname" | "undeclared-prefix" | "unsupported-namespace-binding" | "unsupported-qname-serialization";
}
export interface TypedDimensionElementTrace {
    readonly name: DimensionQNameTrace;
    readonly children: readonly TypedDimensionElementTrace[];
}
interface DimensionEntryBase {
    readonly location: "scenario" | "segment";
    readonly element: DimensionQNameTrace;
    /** 元XMLの順序・空白・字面を復元した値ではなく、parserの解析済み表現です。 */
    readonly parsedContent: unknown;
    readonly diagnostics: readonly DimensionTraceDiagnostic[];
}
export type ContextDimensionEntryTrace = DimensionEntryBase & (
    { readonly kind: "explicit"; readonly axis: DimensionQNameTrace; readonly member: DimensionQNameTrace } |
    { readonly kind: "typed"; readonly axis: DimensionQNameTrace; readonly typedElements: readonly TypedDimensionElementTrace[] } |
    { readonly kind: "unknown" }
);
export interface ContextDimensionTraceCandidate {
    readonly contextElement: DimensionQNameTrace;
    readonly dimensions: readonly ContextDimensionEntryTrace[];
    readonly diagnostics: readonly DimensionTraceDiagnostic[];
}
export type ContextDimensionTraceMap = ReadonlyMap<string, readonly ContextDimensionTraceCandidate[]>;
export interface ContextDimensionsTraceResult {
    readonly contextId: string;
    readonly status: "missing" | "resolved" | "unsupported" | "ambiguous";
    readonly dtsValidation: "not-performed";
    readonly originalLexicalValidation: "not-performed";
    readonly candidates: readonly ContextDimensionTraceCandidate[];
    readonly diagnostics: readonly DimensionTraceDiagnostic[];
}

const XBRLI = "http://www.xbrl.org/2003/instance", XBRLDI = "http://xbrl.org/2006/xbrldi";
const XML = "http://www.w3.org/XML/1998/namespace", XMLNS = "http://www.w3.org/2000/xmlns/";
type Scope = ReadonlyMap<string, DimensionNamespaceBinding>;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const initialScope = (): Scope => new Map([["xml", { prefix: "xml", parsedUri: XML, declaredAt: "implicit:xml", state: "bound" }]]);
// XML 1.0 NCName。QNameの区切り以外にcolonは使えません。
const start = "A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}";
const ncName = new RegExp(`^[${start}][${start}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$`, "u");
function scopeAt(node: unknown, inherited: Scope, at: string): Scope {
    const scope = new Map(inherited);
    if (record(node)) for (const [key, parsedUri] of Object.entries(node)) {
        if (key !== "@_xmlns" && !key.startsWith("@_xmlns:")) continue;
        const prefix = key === "@_xmlns" ? "" : key.slice(8);
        const unsupported = typeof parsedUri !== "string" || key !== "@_xmlns" && !ncName.test(prefix) || prefix === "xmlns" ||
            typeof parsedUri === "string" && (/\s|&#/.test(parsedUri) || parsedUri === XMLNS || (prefix === "xml") !== (parsedUri === XML));
        scope.set(prefix, { prefix, parsedUri, declaredAt: at, state: unsupported ? "unsupported" : parsedUri === "" && prefix !== "" ? "unbound" : "bound" });
    }
    return scope;
}
function qname(raw: unknown, scope: Scope): DimensionQNameTrace {
    if (typeof raw !== "string") return { raw, status: "unresolved", reason: "invalid-qname" };
    const normalized = raw.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, "");
    // 数値参照を残すparser表現とCDATAの字面を区別できないため、再decodeしません。
    if (normalized.includes("&")) return { raw, normalized, status: "unresolved", reason: "unsupported-qname-serialization" };
    const parts = normalized.split(":");
    if (parts.length > 2 || parts.some(part => !ncName.test(part))) return { raw, normalized, status: "unresolved", reason: "invalid-qname" };
    const prefix = parts.length === 2 ? parts[0] : "", localName = parts.at(-1)!;
    const binding = scope.get(prefix);
    if (!binding && prefix === "") return { raw, normalized, prefix, localName, namespaceURI: "", status: "resolved" };
    if (!binding || binding.state === "unbound") return { raw, normalized, prefix, localName, binding, status: "unresolved", reason: "undeclared-prefix" };
    if (binding.state !== "bound") return { raw, normalized, prefix, localName, binding, status: "unresolved", reason: "unsupported-namespace-binding" };
    return { raw, normalized, prefix, localName, namespaceURI: binding.parsedUri as string, binding, status: "resolved" };
}
const matches = (name: DimensionQNameTrace, uri: string, local: string) => name.status === "resolved" && name.namespaceURI === uri && name.localName === local;
const children = (node: unknown): [string, unknown][] => record(node) ? Object.entries(node).filter(([key]) => !key.startsWith("@_") && key !== "#text")
    .flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map(child => [key, child] as [string, unknown])) : [];
function issue(name: DimensionQNameTrace, field: DimensionTraceDiagnostic["field"]): DimensionTraceDiagnostic[] {
    return name.reason ? [{ code: name.reason, field }] : [];
}
function typedElements(node: unknown, scope: Scope, at: string, diagnostics: DimensionTraceDiagnostic[]): TypedDimensionElementTrace[] {
    return children(node).map(([key, child], index) => {
        const childAt = `${at}/${key}[${index}]`, inherited = scopeAt(child, scope, childAt), name = qname(key, inherited);
        diagnostics.push(...issue(name, "typed-element"));
        return { name, children: typedElements(child, inherited, childAt, diagnostics) };
    });
}
function collectCandidate(node: unknown, contextElement: DimensionQNameTrace, inherited: Scope, at: string): ContextDimensionTraceCandidate {
    const dimensions: ContextDimensionEntryTrace[] = [], diagnostics: DimensionTraceDiagnostic[] = [];
    const part = (location: "scenario" | "segment", key: string, value: unknown, scope: Scope, partAt: string) => {
        const entries = children(value);
        if (!record(value) || typeof value["#text"] === "string" && value["#text"].trim() !== "") {
            dimensions.push({ kind: "unknown", location, element: qname(key, scope), parsedContent: structuredClone(value), diagnostics: [{ code: "unknown-dimension-content" }] });
        }
        for (const [entryKey, entryNode] of entries) {
            const entryAt = `${partAt}/${entryKey}[${dimensions.length}]`, entryScope = scopeAt(entryNode, scope, entryAt), element = qname(entryKey, entryScope);
            const entryDiagnostics = issue(element, "element");
            if (!matches(element, XBRLDI, "explicitMember") && !matches(element, XBRLDI, "typedMember")) {
                dimensions.push({ kind: "unknown", location, element, parsedContent: structuredClone(entryNode), diagnostics: [...entryDiagnostics, { code: "unknown-dimension-content" }] }); continue;
            }
            const axis = qname(record(entryNode) ? entryNode["@_dimension"] : undefined, entryScope);
            entryDiagnostics.push(...issue(axis, "axis"));
            if (!record(entryNode)) entryDiagnostics.push({ code: "invalid-dimension-shape" });
            else if (Object.keys(entryNode).some(key => key.startsWith("@_") && key !== "@_dimension" && key !== "@_xmlns" && !key.startsWith("@_xmlns:"))) entryDiagnostics.push({ code: "extra-dimension-content" });
            if (matches(element, XBRLDI, "explicitMember")) {
                const member = qname(record(entryNode) ? entryNode["#text"] : entryNode, entryScope);
                entryDiagnostics.push(...issue(member, "member"));
                if (children(entryNode).length) entryDiagnostics.push({ code: "extra-dimension-content" });
                dimensions.push({ kind: "explicit", location, element, axis, member, parsedContent: structuredClone(entryNode), diagnostics: entryDiagnostics });
            } else {
                const elements = typedElements(entryNode, entryScope, entryAt, entryDiagnostics);
                entryDiagnostics.push({ code: "typed-uninterpreted" });
                if (elements.length !== 1 || record(entryNode) && typeof entryNode["#text"] === "string" && entryNode["#text"].trim() !== "") entryDiagnostics.push({ code: "invalid-dimension-shape" });
                dimensions.push({ kind: "typed", location, element, axis, typedElements: elements, parsedContent: structuredClone(entryNode), diagnostics: entryDiagnostics });
            }
        }
    };
    const unrecognized = (element: DimensionQNameTrace, value: unknown) => diagnostics.push({ code: "unknown-dimension-content", field: "element", element, parsedContent: structuredClone(value) });
    let scenarios = 0, entities = 0, segments = 0;
    for (const [key, child] of children(node)) {
        const childAt = `${at}/${key}`, scope = scopeAt(child, inherited, childAt), name = qname(key, scope);
        if (matches(name, XBRLI, "scenario")) { scenarios++; part("scenario", key, child, scope, childAt); }
        else if (matches(name, XBRLI, "entity")) {
            entities++;
            for (const [segmentKey, segmentNode] of children(child)) {
                const segmentAt = `${childAt}/${segmentKey}`, segmentScope = scopeAt(segmentNode, scope, segmentAt), segmentName = qname(segmentKey, segmentScope);
                if (matches(segmentName, XBRLI, "segment")) { segments++; part("segment", segmentKey, segmentNode, segmentScope, segmentAt); }
                else if (!matches(segmentName, XBRLI, "identifier")) unrecognized(segmentName, segmentNode);
            }
        } else if (!matches(name, XBRLI, "period")) unrecognized(name, child);
    }
    if (scenarios > 1 || entities > 1 || segments > 1) diagnostics.push({ code: "invalid-dimension-shape" });
    const axes = new Map<string, number>();
    dimensions.forEach((entry, index) => {
        if (entry.kind === "unknown" || entry.axis.status !== "resolved") return;
        const key = JSON.stringify([entry.axis.namespaceURI, entry.axis.localName]), previous = axes.get(key);
        if (previous !== undefined) diagnostics.push({ code: "duplicate-axis", dimensionIndex: index });
        else axes.set(key, index);
    });
    return { contextElement, dimensions, diagnostics };
}

/** @internal 既存XMLParserの一回の解析結果だけを読む。root直下のcontext以外は提出contextとして拾いません。 */
export function collectContextDimensionTraces(parsed: unknown): Map<string, readonly ContextDimensionTraceCandidate[]> {
    const result = new Map<string, ContextDimensionTraceCandidate[]>();
    for (const [rootKey, root] of children(parsed)) {
        const rootAt = `/${rootKey}`, rootScope = scopeAt(root, initialScope(), rootAt);
        if (!matches(qname(rootKey, rootScope), XBRLI, "xbrl")) continue;
        for (const [key, node] of children(root)) {
            const at = `${rootAt}/${key}`, scope = scopeAt(node, rootScope, at), name = qname(key, scope);
            if (!matches(name, XBRLI, "context") || !record(node) || typeof node["@_id"] !== "string" || !node["@_id"].trim()) continue;
            const id = node["@_id"], candidate = collectCandidate(node, name, scope, at);
            const bucket = result.get(id);
            if (bucket) bucket.push(candidate); else result.set(id, [candidate]);
        }
    }
    return result;
}
