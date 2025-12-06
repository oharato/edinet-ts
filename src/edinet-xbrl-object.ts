import { EdinetDataUtil } from "./edinet-data-util";

export class EdinetData {
    constructor(
        public readonly key: string,
        public readonly value: string,
        public readonly decimals: number = 0,
        public readonly unitRef: string = "",
        public readonly contextRef: string = ""
    ) { }

    /**
     * Factory method to create an EdinetData instance from an XML node.
     * @param node The parsed XML node.
     * @param key The XBRL tag name (e.g. "jpcrp_cor:NetSales").
     */
    public static create(node: unknown, key: string): EdinetData {
        const value = EdinetDataUtil.getValue(node);
        const decimals = EdinetDataUtil.getDecimals(node);
        const unitRef = EdinetDataUtil.getUnitRef(node);
        const contextRef = EdinetDataUtil.getContextRef(node);

        return new EdinetData(key, value, decimals, unitRef, contextRef);
    }
}

export class EdinetXbrlObject {
    private dataMap: Map<string, EdinetData[]> = new Map();

    public clear(): void {
        this.dataMap.clear();
    }

    public put(key: string, edinetData: EdinetData): void {
        const existing = this.dataMap.get(key) || [];
        existing.push(edinetData);
        this.dataMap.set(key, existing);
    }

    public getDataList(key: string): EdinetData[] {
        return this.dataMap.get(key) || [];
    }

    public getDataByContextRef(key: string, contextRef: string): EdinetData | null {
        const list = this.getDataList(key);
        return list.find((d) => d.contextRef === contextRef) || null;
    }

    public getKeys(): string[] {
        return Array.from(this.dataMap.keys());
    }

    public hasKey(key: string): boolean {
        return this.dataMap.has(key);
    }

    /**
     * Extract standardized key financial metrics.
     * Currently supports J-GAAP Consolidated attributes.
     */
    public getKeyMetrics(): KeyMetrics {
        // Context definitions priority list
        // We prioritize Consolidated (CurrentYearDuration) over NonConsolidated.
        const CONTEXT_DURATIONS = ["CurrentYearDuration", "CurrentYearDuration_NonConsolidatedMember"];
        const CONTEXT_INSTANTS = ["CurrentYearInstant", "CurrentYearInstant_NonConsolidatedMember"];

        return {
            netSales: this.getNumberValue(["jppfs_cor:NetSales", "jpcrp_cor:NetSales"], CONTEXT_DURATIONS),
            operatingIncome: this.getNumberValue(["jppfs_cor:OperatingIncome"], CONTEXT_DURATIONS),
            ordinaryIncome: this.getNumberValue(["jppfs_cor:OrdinaryIncome"], CONTEXT_DURATIONS),
            netIncome: this.getNumberValue(["jppfs_cor:ProfitLossAttributableToOwnersOfParent"], CONTEXT_DURATIONS),
            netAssets: this.getNumberValue(["jppfs_cor:NetAssets"], CONTEXT_INSTANTS),
            totalAssets: this.getNumberValue(["jppfs_cor:Assets"], CONTEXT_INSTANTS),
        };
    }

    private getNumberValue(keys: string[], contextRefs: string[]): number | undefined {
        for (const contextRef of contextRefs) {
            for (const key of keys) {
                const data = this.getDataByContextRef(key, contextRef);
                if (data && data.value) {
                    const parsed = parseInt(data.value, 10);
                    if (!isNaN(parsed)) return parsed;
                }
            }
        }
        return undefined;
    }
}

export interface KeyMetrics {
    netSales?: number;
    operatingIncome?: number;
    ordinaryIncome?: number;
    netIncome?: number;
    netAssets?: number;
    totalAssets?: number;
}
