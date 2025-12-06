import { EdinetDataUtil } from "./edinet-data-util";
import { EdinetContext } from "./edinet-context";

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
    private contextMap: Map<string, EdinetContext> = new Map();

    public clear(): void {
        this.dataMap.clear();
        this.contextMap.clear();
    }

    public addContext(context: EdinetContext): void {
        this.contextMap.set(context.id, context);
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
   * Uses context analysis to find the most appropriate data.
   */
    public getKeyMetrics(): KeyMetrics {
        const durationCons = this.findContext({ type: "Duration", scope: "Consolidated" });
        const durationNonCons = this.findContext({ type: "Duration", scope: "NonConsolidated" });

        const instantCons = this.findContext({ type: "Instant", scope: "Consolidated" });
        const instantNonCons = this.findContext({ type: "Instant", scope: "NonConsolidated" });

        // Build priority lists
        const durationIds: string[] = [];
        if (durationCons) durationIds.push(durationCons.id);
        if (durationNonCons) durationIds.push(durationNonCons.id);
        durationIds.push("CurrentYearDuration", "CurrentYearDuration_NonConsolidatedMember"); // Backups

        const instantIds: string[] = [];
        if (instantCons) instantIds.push(instantCons.id);
        if (instantNonCons) instantIds.push(instantNonCons.id);
        instantIds.push("CurrentYearInstant", "CurrentYearInstant_NonConsolidatedMember"); // Backups

        return {
            netSales: this.getNumberValue(["jppfs_cor:NetSales", "jpcrp_cor:NetSales"], durationIds),
            operatingIncome: this.getNumberValue(["jppfs_cor:OperatingIncome"], durationIds),
            ordinaryIncome: this.getNumberValue(["jppfs_cor:OrdinaryIncome"], durationIds),
            netIncome: this.getNumberValue(["jppfs_cor:ProfitLossAttributableToOwnersOfParent"], durationIds),
            netAssets: this.getNumberValue(["jppfs_cor:NetAssets"], instantIds),
            totalAssets: this.getNumberValue(["jppfs_cor:Assets"], instantIds),

            // Cash Flows
            operatingCashFlow: this.getNumberValue(["jppfs_cor:NetCashProvidedByUsedInOperatingActivities", "jpcrp_cor:NetCashProvidedByUsedInOperatingActivitiesSummaryOfBusinessResults"], durationIds),
            investingCashFlow: this.getNumberValue(["jppfs_cor:NetCashProvidedByUsedInInvestmentActivities", "jppfs_cor:NetCashProvidedByUsedInInvestingActivities", "jpcrp_cor:NetCashProvidedByUsedInInvestingActivitiesSummaryOfBusinessResults"], durationIds),
            financingCashFlow: this.getNumberValue(["jppfs_cor:NetCashProvidedByUsedInFinancingActivities", "jpcrp_cor:NetCashProvidedByUsedInFinancingActivitiesSummaryOfBusinessResults"], durationIds),
            cashAndEquivalents: this.getNumberValue(["jppfs_cor:CashAndCashEquivalents", "jppfs_cor:CashAndCashEquivalentsEndOfPeriod"], instantIds),

            // Per Share
            earningsPerShare: this.getNumberValue(["jppfs_cor:BasicEarningsLossPerShare", "jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults"], durationIds),
            bookValuePerShare: this.getNumberValue(["jppfs_cor:NetAssetsPerShare", "jpcrp_cor:NetAssetsPerShareSummaryOfBusinessResults"], instantIds)
        };
    }

    /**
   * Get data by specifying logical context criteria.
   * This is the preferred way to access data without knowing XBRL Context IDs.
   */
    public getData(key: string, options: {
        year?: "Current" | "Prior1Year" | "Prior2Year",
        type: "Duration" | "Instant",
        scope: "Consolidated" | "NonConsolidated"
    }): EdinetData | undefined {
        const context = this.findContext(options);
        if (!context) return undefined;
        return this.getDataByContextRef(key, context.id) || undefined;
    }

    /**
     * Find a context ID matching the criteria.
     * Logic:
     * 1. Check Scope.
     * 2. Check Type (Duration/Instant).
     * 3. Check "Year" (Offset from latest).
     */
    public findContext(options: {
        year?: "Current" | "Prior1Year" | "Prior2Year",
        type: "Duration" | "Instant",
        scope: "Consolidated" | "NonConsolidated"
    }): EdinetContext | undefined {
        let candidates = Array.from(this.contextMap.values()).filter(c => c.scope === options.scope);

        // Filter by type
        if (options.type === "Duration") {
            candidates = candidates.filter(c => c.period.startDate && c.period.endDate);
            // Sort by endDate descending (Latest first)
            candidates.sort((a, b) => (b.period.endDate || "").localeCompare(a.period.endDate || ""));
        } else {
            candidates = candidates.filter(c => c.period.instant);
            // Sort by instant descending (Latest first)
            candidates.sort((a, b) => (b.period.instant || "").localeCompare(a.period.instant || ""));
        }

        // Handle Year Offset
        // Current (default) = Index 0
        // Prior1Year = Index 1
        // Prior2Year = Index 2
        const offset = options.year === "Prior1Year" ? 1 :
            options.year === "Prior2Year" ? 2 : 0;

        return candidates[offset];
    }

    private getNumberValue(keys: string[], contextRefs: string[]): number | undefined {
        for (const contextRef of contextRefs) {
            for (const key of keys) {
                const data = this.getDataByContextRef(key, contextRef);
                if (data && data.value) {
                    const parsed = parseFloat(data.value);
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

    // Cash Flows
    operatingCashFlow?: number;
    investingCashFlow?: number;
    financingCashFlow?: number;
    cashAndEquivalents?: number;

    // Per Share
    earningsPerShare?: number;
    bookValuePerShare?: number;
}
