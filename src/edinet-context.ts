import { EdinetDataUtil } from "./edinet-data-util";
import { ConsolidationScope } from "./financial-options";

export interface EdinetContext {
    /** コンテキストのID (例: "CurrentYearDuration") */
    id: string;
    /** 期間情報 */
    period: {
        /** 開始日 (YYYY-MM-DD) - Durationの場合 */
        startDate?: string;
        /** 終了日 (YYYY-MM-DD) - Durationの場合 */
        endDate?: string;
        /** 時点 (YYYY-MM-DD) - Instantの場合 */
        instant?: string;
    };
    /** 連結範囲 ("Consolidated" または "NonConsolidated") */
    scope: ConsolidationScope;
    /** 明示的なメンバーのリスト (例: "NonConsolidatedMember") */
    dimensions: string[];
    /** 未解釈のtyped dimension等がある場合は厳密選択を拒否します。 */
    unsupportedDimensions?: boolean;
    /** XML名前空間を検証できたcontextにだけ付与します。 */
    namespaceVerified?: boolean;
    /** 元のaxis/memberを含むscenario/segment。 */
    rawDimensions?: unknown;
    /** 元のentity identifier。未確認の場合は厳密選択へ利用しません。 */
    entity?: { identifier: string; scheme: string };
    /** Instant/Durationの混在・重複等を厳密選択で拒否します。 */
    periodValid?: boolean;
}

export class ContextParser {
    /**
     * raw xbrli:context ノードを構造化された EdinetContext オブジェクトにパースします。
     * @param node XMLノード
     * @returns パースされた EdinetContext。無効なノードの場合は null。
     */
    public static parse(node: any, namespaces?: Readonly<Record<string, string>>): EdinetContext | null {
        if (!node || !node["@_id"]) return null;

        const id = node["@_id"];
        // parsePeriod メソッドは期間ノードをパースします。
        const period = ContextParser.parsePeriod(node["xbrli:period"]);
        // findExplicitMembers メソッドは明示的なメンバーを抽出します。
        const dimensions = ContextParser.findExplicitMembers(node);
        // scope のロジックは findExplicitMembers の結果に基づいて直接統合されました。
        const scope = dimensions.includes("NonConsolidatedMember") ? ConsolidationScope.NonConsolidated : ConsolidationScope.Consolidated;

        const scenario = node["xbrli:scenario"], segment = node["xbrli:entity"]?.["xbrli:segment"];
        const validStandaloneDimension = (part: any): boolean => {
            const members = part?.["xbrldi:explicitMember"];
            if (!members) return true;
            return (Array.isArray(members) ? members : [members]).every(member => {
                if (!member || typeof member !== "object") return false;
                const axis = member["@_dimension"];
                const value = EdinetDataUtil.getValue(member);
                if (typeof axis !== "string") return false;
                const [axisPrefix, axisName, axisExtra] = axis.split(":");
                const [memberPrefix, memberName, memberExtra] = value.split(":");
                const official = /^http:\/\/disclosure\.edinet-fsa\.go\.jp\/taxonomy\/jppfs\/\d{4}-\d{2}-\d{2}\/jppfs_cor$/;
                return !axisExtra && !memberExtra && axisName === "ConsolidatedOrNonConsolidatedAxis" &&
                    memberName === "NonConsolidatedMember" && official.test(namespaces?.[axisPrefix] ?? "") &&
                    namespaces?.[axisPrefix] === namespaces?.[memberPrefix];
            });
        };
        const unsupported = [scenario, segment].some(part => part && (typeof part !== "object" ||
            Object.keys(part).some(key => key !== "xbrldi:explicitMember" && !key.startsWith("@_xmlns:")) || !validStandaloneDimension(part)));
        // 内部でnamespaceを再定義したcontextはこの段階では解釈しません。
        const hasLocalNamespace = (value: any): boolean => value && typeof value === "object" &&
            Object.entries(value).some(([key, child]) => key.startsWith("@_xmlns:") || hasLocalNamespace(child));
        const namespaceVerified = !!namespaces && namespaces.xbrli === "http://www.xbrl.org/2003/instance" &&
            (!scenario && !segment || namespaces.xbrldi === "http://xbrl.org/2006/xbrldi") && !hasLocalNamespace(node);
        const identifierNode = node["xbrli:entity"]?.["xbrli:identifier"];
        const identifier = EdinetDataUtil.getValue(identifierNode);
        const scheme = identifierNode?.["@_scheme"];
        const entity = !Array.isArray(node["xbrli:entity"]) && identifierNode && !Array.isArray(identifierNode) &&
            typeof identifier === "string" && identifier.trim() && typeof scheme === "string" && scheme.trim()
            ? { identifier, scheme } : undefined;
        const rawPeriod = node["xbrli:period"];
        const simpleDate = (key: string): boolean => typeof rawPeriod?.[key] === "string";
        const periodValid = !!rawPeriod && !Array.isArray(rawPeriod) &&
            Object.keys(rawPeriod).every(key => ["xbrli:startDate", "xbrli:endDate", "xbrli:instant"].includes(key)) &&
            (simpleDate("xbrli:instant") && Object.keys(rawPeriod).length === 1 ||
                simpleDate("xbrli:startDate") && simpleDate("xbrli:endDate") && Object.keys(rawPeriod).length === 2);
        const context: EdinetContext = {
            id,
            period,
            scope,
            dimensions,
            unsupportedDimensions: unsupported || JSON.stringify(node).includes("xbrldi:typedMember"),
            namespaceVerified,
            entity,
            periodValid,
            rawDimensions: { scenario: node["xbrli:scenario"], segment: node["xbrli:entity"]?.["xbrli:segment"] }
        };
        return context;
    }

    private static parsePeriod(periodNode: any): { startDate?: string; endDate?: string; instant?: string } {
        if (!periodNode) return {};

        if (periodNode["xbrli:startDate"] && periodNode["xbrli:endDate"]) {
            return {
                startDate: EdinetDataUtil.getValue(periodNode["xbrli:startDate"]),
                endDate: EdinetDataUtil.getValue(periodNode["xbrli:endDate"]),
            };
        }

        if (periodNode["xbrli:instant"]) {
            return {
                instant: EdinetDataUtil.getValue(periodNode["xbrli:instant"]),
            };
        }

        return {};
    }

    private static findExplicitMembers(contextNode: any): string[] {
        const members: string[] = [];

        // 明示的なメンバーをトラバースして検索するためのヘルパー関数
        const visit = (n: any) => {
            if (!n) return;
            if (Array.isArray(n)) {
                n.forEach(visit);
                return;
            }
            if (typeof n === 'object') {
                // このノードが明示的なメンバーであるかどうかを確認します
                // 構造によっては、xbrldi:explicitMember であるか、それを含んでいる可能性があります。
                // 通常の構造: xbrli:scenario -> xbrldi:explicitMember (テキスト値)
                if (n["xbrldi:explicitMember"]) {
                    const explicit = n["xbrldi:explicitMember"];
                    if (Array.isArray(explicit)) {
                        explicit.forEach(val => {
                            const v = EdinetDataUtil.getValue(val);
                            if (v) members.push(EdinetDataUtil.getKey(v));
                        });
                    } else {
                        const val = EdinetDataUtil.getValue(explicit);
                        if (val) members.push(EdinetDataUtil.getKey(val));
                    }
                }

                // 再帰のためにキーもチェックします
                Object.keys(n).forEach(key => {
                    if (key !== "#text" && key !== "@_id" && key !== "xbrldi:explicitMember") {
                        visit(n[key]);
                    }
                });
            }
        };

        // scenario と segment のみを対象とします
        if (contextNode["xbrli:scenario"]) visit(contextNode["xbrli:scenario"]);
        if (contextNode["xbrli:entity"] && contextNode["xbrli:entity"]["xbrli:segment"]) visit(contextNode["xbrli:entity"]["xbrli:segment"]);

        return members;
    }
}
