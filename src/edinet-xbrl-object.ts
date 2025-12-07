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
   * 主要な経営指標を抽出します。
   * コンテキスト（連結/単体、期間）を自動的に解析し、最適なデータを検索します。
   */
    public getKeyMetrics(): KeyMetrics {
        // 戦略: まず連結(Consolidated)を探し、なければ単体(NonConsolidated)を探します。
        // 日付が新しい順にソートされた全コンテキストを使用します。
        // これにより、最新のコンテキスト（提出日など）にデータがなく、その次（当期）にある場合でも取得できます。

        // 過去年度のデータを誤って取得しないよう、最新の日付から半年以内のデータに限定します。
        const filterRecent = (ctxs: EdinetContext[]) => {
            if (ctxs.length === 0) return [];
            const latest = ctxs[0].period.endDate || ctxs[0].period.instant || "";
            if (!latest) return ctxs;

            const latestTime = new Date(latest).getTime();
            const threshold = 180 * 24 * 60 * 60 * 1000; // 180 days

            return ctxs.filter(c => {
                const current = c.period.endDate || c.period.instant || "";
                if (!current) return false;
                return (latestTime - new Date(current).getTime()) < threshold;
            });
        }

        const durationContexts = [
            ...filterRecent(this.findContexts({ type: "Duration", scope: "Consolidated" })),
            ...filterRecent(this.findContexts({ type: "Duration", scope: "NonConsolidated" })),
            // レガシー/ハードコードされたIDへのフォールバック
            { id: "CurrentYearDuration", period: {}, scope: "Consolidated" } as EdinetContext,
            { id: "CurrentYearDuration_NonConsolidatedMember", period: {}, scope: "NonConsolidated" } as EdinetContext
        ];

        const instantContexts = [
            ...filterRecent(this.findContexts({ type: "Instant", scope: "Consolidated" })),
            ...filterRecent(this.findContexts({ type: "Instant", scope: "NonConsolidated" })),
            // レガシー/ハードコードされたIDへのフォールバック
            { id: "CurrentYearInstant", period: {}, scope: "Consolidated" } as EdinetContext,
            { id: "CurrentYearInstant_NonConsolidatedMember", period: {}, scope: "NonConsolidated" } as EdinetContext
        ];

        const durationIds = durationContexts.map(c => c.id);
        const instantIds = instantContexts.map(c => c.id);

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
            bookValuePerShare: this.getNumberValue(["jppfs_cor:NetAssetsPerShare", "jpcrp_cor:NetAssetsPerShareSummaryOfBusinessResults"], instantIds),

            // Ratios & Types
            equityToTotalAssetsRatio: this.getNumberValue(["jpcrp_cor:EquityToAssetRatioSummaryOfBusinessResults", "jpcrp_cor:EquityToTotalAssetsRatioSummaryOfBusinessResults", "jppfs_cor:EquityToTotalAssetsRatio"], instantIds),
            rateOfReturnOnEquity: this.getNumberValue(["jpcrp_cor:RateOfReturnOnEquitySummaryOfBusinessResults", "jpcrp_cor:RateOfReturnOnEquityIFRSSummaryOfBusinessResults", "jppfs_cor:RateOfReturnOnEquity"], durationIds),
            priceEarningsRatio: this.getNumberValue(["jpcrp_cor:PriceEarningsRatioSummaryOfBusinessResults"], durationIds), // Less common in XBRL
            payoutRatio: this.getNumberValue(["jpcrp_cor:PayoutRatioSummaryOfBusinessResults"], durationIds),

            // Shares
            numberOfIssuedShares: this.getNumberValue(["jpcrp_cor:TotalNumberOfIssuedSharesSummaryOfBusinessResults", "jppfs_cor:TotalNumberOfIssuedShares"], instantIds),
            dividendPaidPerShare: this.getNumberValue(["jpcrp_cor:DividendPaidPerShareSummaryOfBusinessResults"], durationIds)
        };
    }

    /**
   * 論理的な条件を指定してデータを取得します。
   * コンテキストIDを意識せずにデータを取得するための推奨メソッドです。
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
     * 条件に合致するコンテキストIDを検索します。
     * ロジック:
     * 1. 範囲(Scope)でフィルタ
     * 2. タイプ(Duration/Instant)でフィルタ
     * 3. 年度("Year")でオフセット指定 (0=最新, 1=前年...)
     */
    public findContext(options: {
        year?: "Current" | "Prior1Year" | "Prior2Year",
        type: "Duration" | "Instant",
        scope: "Consolidated" | "NonConsolidated"
    }): EdinetContext | undefined {
        const candidates = this.findContexts(options);
        return candidates[0];
    }

    /**
     * 条件に合致するすべてのコンテキストIDを、日付の新しい順に検索します。
     */
    public findContexts(options: {
        year?: "Current" | "Prior1Year" | "Prior2Year",
        type: "Duration" | "Instant",
        scope: "Consolidated" | "NonConsolidated"
    }): EdinetContext[] {
        let candidates = Array.from(this.contextMap.values()).filter(c => c.scope === options.scope);

        // 次元の厳密なチェック
        // 連結: 次元なし
        // 単体: "NonConsolidatedMember" のみを次元として持つ
        if (options.scope === "Consolidated") {
            candidates = candidates.filter(c => c.dimensions.length === 0);
        } else {
            candidates = candidates.filter(c => c.dimensions.length === 1 && c.dimensions[0] === "NonConsolidatedMember");
        }

        // タイプでフィルタ
        if (options.type === "Duration") {
            candidates = candidates.filter(c => c.period.startDate && c.period.endDate);
            // endDateの降順（最新優先）
            candidates.sort((a, b) => (b.period.endDate || "").localeCompare(a.period.endDate || ""));
        } else {
            candidates = candidates.filter(c => c.period.instant);
            // instantの降順（最新優先）
            candidates.sort((a, b) => (b.period.instant || "").localeCompare(a.period.instant || ""));
        }

        // 年度のオフセット処理
        // Current (default) = Index 0
        // Prior1Year = Index 1
        // Prior2Year = Index 2
        const offset = options.year === "Prior1Year" ? 1 :
            options.year === "Prior2Year" ? 2 : 0;

        // オフセット以降の候補を返す
        return candidates.slice(offset);
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

    // Ratios & Others
    equityToTotalAssetsRatio?: number; // % or decimal (check unit)
    rateOfReturnOnEquity?: number; // % or decimal
    priceEarningsRatio?: number;
    payoutRatio?: number;
    numberOfIssuedShares?: number;
    dividendPaidPerShare?: number;
}
