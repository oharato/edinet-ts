import { EdinetDataUtil } from "./edinet-data-util";

export interface EdinetContext {
    id: string;
    period: {
        startDate?: string;
        endDate?: string;
        instant?: string;
    };
    scope: "Consolidated" | "NonConsolidated";
    // dimensions: explicit member のリスト (例: "NonConsolidatedMember")
    dimensions: string[];
}

export class ContextParser {
    /**
     * raw xbrli:context ノードを構造化された EdinetContext にパースします。
     */
    public static parse(node: any): EdinetContext | null {
        if (!node || !node["@_id"]) return null;

        const id = node["@_id"];
        // parsePeriod メソッドは期間ノードをパースします。
        const period = ContextParser.parsePeriod(node["xbrli:period"]);
        // findExplicitMembers メソッドは明示的なメンバーを抽出します。
        const dimensions = ContextParser.findExplicitMembers(node);
        // scope のロジックは findExplicitMembers の結果に基づいて直接統合されました。
        const scope = dimensions.includes("NonConsolidatedMember") ? "NonConsolidated" : "Consolidated";

        const context: EdinetContext = {
            id,
            period,
            scope,
            dimensions
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
                            if (v) members.push(v);
                        });
                    } else {
                        const val = EdinetDataUtil.getValue(explicit);
                        if (val) members.push(val);
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
