import { EdinetDataUtil } from "./edinet-data-util";

export interface EdinetContext {
    id: string;
    period: {
        startDate?: string;
        endDate?: string;
        instant?: string;
    };
    scope: "Consolidated" | "NonConsolidated";
}

export class ContextParser {
    /**
     * Parse a raw xbrli:context node into a structured EdinetContext.
     */
    public static parse(node: any): EdinetContext | null {
        if (!node || !node["@_id"]) return null;

        const id = node["@_id"];
        const period = ContextParser.parsePeriod(node["xbrli:period"]);
        const scope = ContextParser.parseScope(node["xbrli:scenario"] || node["xbrli:entity"]?.["xbrli:segment"]);

        return {
            id,
            period,
            scope,
        };
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

    private static parseScope(scenarioOrSegmentNode: any): "Consolidated" | "NonConsolidated" {
        // If no explicit member is defined, it is usually Consolidated (for Consolidated reports)
        // BUT, explicit NonConsolidatedMember marks it as NonConsolidated.
        // Also, some contexts might specify ConsolidatedMember explicitly, but usually lack of it implies "default" which matches the report type.
        // NOTE: This logic simplifies the reality. 
        // Usually:
        // - No member -> Consolidated (if the report is consolidated)
        // - "jpcrp_cor:NonConsolidatedMember" -> NonConsolidated

        if (!scenarioOrSegmentNode) return "Consolidated";

        const explicitMembers = ContextParser.findExplicitMembers(scenarioOrSegmentNode);

        for (const member of explicitMembers) {
            if (member.includes("NonConsolidatedMember")) {
                return "NonConsolidated";
            }
        }

        return "Consolidated";
    }

    private static findExplicitMembers(node: any): string[] {
        // Traverse to find xbrldi:explicitMember text
        // Structure varies: xbrli:scenario -> xbrldi:explicitMember
        const members: string[] = [];

        const visit = (n: any) => {
            if (!n) return;
            if (Array.isArray(n)) {
                n.forEach(visit);
                return;
            }
            if (typeof n === 'object') {
                // xbrldi:explicitMember check
                if (n["xbrldi:explicitMember"]) {
                    const val = EdinetDataUtil.getValue(n["xbrldi:explicitMember"]);
                    if (val) members.push(val);
                }

                Object.keys(n).forEach(key => {
                    if (key !== "#text" && key !== "@_id") {
                        visit(n[key]);
                    }
                });
            }
        };

        visit(node);
        return members;
    }
}
