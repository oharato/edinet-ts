import { EdinetDataUtil } from "./edinet-data-util";
import { EdinetContext } from "./edinet-context";
import { JppfsCorTaxonomy } from "./types/jppfs_cor_taxonomy";

/**
 * 共通メタデータ
 * 全ての書類に含まれるメタデータ
 */
export interface CommonMetadata {
    /** 書類管理ID */
    docID: string;
    /** 提出者名 */
    filerName: string;
    /** 提出者のEDINETコード */
    edinetCode: string;
    /** 書類名/件名 */
    docDescription: string;
    /** 提出日 */
    submitDate: string;
}

export class EdinetData {
    constructor(
        public readonly key: string,
        public readonly value: string,
        public readonly decimals: number = 0,
        public readonly unitRef: string = "",
        public readonly contextRef: string = ""
    ) { }

    /**
     * XMLノードから `EdinetData` インスタンスを作成するファクトリメソッド。
     * @param node パース済みのXMLノード
     * @param key XBRLタグ名 (例: "jpcrp_cor:NetSales")
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

    /**
     * 保持しているデータを全てクリアします。
     */
    public clear(): void {
        this.dataMap.clear();
        this.contextMap.clear();
    }

    /**
     * コンテキスト定義を追加します。
     */
    public addContext(context: EdinetContext): void {
        this.contextMap.set(context.id, context);
    }

    /**
     * 指定されたキーのデータを追加します。同じキーに複数のデータ（期間違いなど）が存在し得ます。
     */
    public put(key: string, edinetData: EdinetData): void {
        const existing = this.dataMap.get(key) || [];
        existing.push(edinetData);
        this.dataMap.set(key, existing);
    }

    /**
     * 指定されたキーに関連するすべてのデータリストを取得します。
     */
    public getDataList(key: string): EdinetData[] {
        return this.dataMap.get(key) || [];
    }

    /**
     * 指定されたキーとコンテキストIDに対応するデータを取得します。
     */
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
            netSales: this.getNumberValue(["jppfs_cor:NetSales", "jpcrp_cor:NetSales", "jpcrp_cor:RevenueIFRSSummaryOfBusinessResults"], durationIds),
            operatingIncome: this.getNumberValue(["jppfs_cor:OperatingIncome", "jpcrp_cor:OperatingIncomeIFRSSummaryOfBusinessResults"], durationIds), // Note: OperatingIncome might be company-specific in IFRS
            ordinaryIncome: this.getNumberValue(["jppfs_cor:OrdinaryIncome"], durationIds), // IFRS doesn't usually have OrdinaryIncome
            netIncome: this.getNumberValue(["jppfs_cor:ProfitLossAttributableToOwnersOfParent", "jpcrp_cor:ProfitLossAttributableToOwnersOfParentIFRSSummaryOfBusinessResults"], durationIds),
            netAssets: this.getNumberValue(["jppfs_cor:NetAssets", "jpcrp_cor:EquityAttributableToOwnersOfParentIFRSSummaryOfBusinessResults"], instantIds),
            totalAssets: this.getNumberValue(["jppfs_cor:Assets", "jpcrp_cor:TotalAssetsIFRSSummaryOfBusinessResults"], instantIds),

            // Cash Flows
            operatingCashFlow: this.getNumberValue(["jppfs_cor:NetCashProvidedByUsedInOperatingActivities", "jpcrp_cor:NetCashProvidedByUsedInOperatingActivitiesSummaryOfBusinessResults", "jpcrp_cor:CashFlowsFromUsedInOperatingActivitiesIFRSSummaryOfBusinessResults"], durationIds),
            investingCashFlow: this.getNumberValue(["jppfs_cor:NetCashProvidedByUsedInInvestmentActivities", "jppfs_cor:NetCashProvidedByUsedInInvestingActivities", "jpcrp_cor:NetCashProvidedByUsedInInvestingActivitiesSummaryOfBusinessResults", "jpcrp_cor:CashFlowsFromUsedInInvestingActivitiesIFRSSummaryOfBusinessResults"], durationIds),
            financingCashFlow: this.getNumberValue(["jppfs_cor:NetCashProvidedByUsedInFinancingActivities", "jpcrp_cor:NetCashProvidedByUsedInFinancingActivitiesSummaryOfBusinessResults", "jpcrp_cor:CashFlowsFromUsedInFinancingActivitiesIFRSSummaryOfBusinessResults"], durationIds),
            cashAndEquivalents: this.getNumberValue(["jppfs_cor:CashAndCashEquivalents", "jppfs_cor:CashAndCashEquivalentsEndOfPeriod", "jpcrp_cor:CashAndCashEquivalentsIFRSSummaryOfBusinessResults"], instantIds),

            // Per Share
            earningsPerShare: this.getNumberValue(["jppfs_cor:BasicEarningsLossPerShare", "jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults", "jpcrp_cor:BasicEarningsLossPerShareIFRSSummaryOfBusinessResults"], durationIds),
            bookValuePerShare: this.getNumberValue(["jppfs_cor:NetAssetsPerShare", "jpcrp_cor:NetAssetsPerShareSummaryOfBusinessResults", "jpcrp_cor:EquityAttributableToOwnersOfParentPerShareIFRSSummaryOfBusinessResults"], instantIds),

            // Ratios & Types
            equityToTotalAssetsRatio: this.getNumberValue(["jpcrp_cor:EquityToAssetRatioSummaryOfBusinessResults", "jpcrp_cor:EquityToTotalAssetsRatioSummaryOfBusinessResults", "jppfs_cor:EquityToTotalAssetsRatio", "jpcrp_cor:RatioOfOwnersEquityToGrossAssetsIFRSSummaryOfBusinessResults"], instantIds),
            rateOfReturnOnEquity: this.getNumberValue(["jpcrp_cor:RateOfReturnOnEquitySummaryOfBusinessResults", "jpcrp_cor:RateOfReturnOnEquityIFRSSummaryOfBusinessResults", "jppfs_cor:RateOfReturnOnEquity"], durationIds),
            priceEarningsRatio: this.getNumberValue(["jpcrp_cor:PriceEarningsRatioSummaryOfBusinessResults", "jpcrp_cor:PriceEarningsRatioIFRSSummaryOfBusinessResults"], durationIds), // Less common in XBRL
            payoutRatio: this.getNumberValue(["jpcrp_cor:PayoutRatioSummaryOfBusinessResults", "jpcrp_cor:PayoutRatioIFRSSummaryOfBusinessResults"], durationIds),

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

    /**
     * 定性的なテキスト情報を抽出します。
     * （例：事業等のリスク、経営者による分析など）
     * テキストにはHTMLタグが含まれる場合があります。
     */
    public getQualitativeInfo(): QualitativeInfo {
        // テキスト情報は通常、FilingDateInstant などの特定のコンテキストに紐付いていますが、
        // 書類全体で一意であることが多いため、ここではコンテキストを厳密に指定せず、
        // 存在するデータの中から最初に見つかった妥当な値を返します。

        const getString = (keys: string[]): string | undefined => {
            for (const key of keys) {
                const dataList = this.getDataList(key);
                if (dataList.length > 0) {
                    // データが見つかれば、最初のものの値を返す
                    // 必要であればコンテキストによるフィルタリングを追加可能
                    return dataList[0].value;
                }
            }
            return undefined;
        }

        return {
            businessPolicy: getString(["jpcrp_cor:BusinessPolicyBusinessEnvironmentIssuesToAddressEtcTextBlock", "jpcrp_cor:DescriptionOfBusinessPolicyEnvironmentAndIssuesToAddressTextBlock"]),
            businessRisks: getString(["jpcrp_cor:BusinessRisksTextBlock"]),
            financialAnalysis: getString(["jpcrp_cor:AnalysisOfFinancialPositionOperatingResultsAndCashFlowsTextBlock", "jpcrp_cor:ManagementAnalysisOfFinancialPositionOperatingResultsAndCashFlowsTextBlock"]),
            businessDescription: getString(["jpcrp_cor:DescriptionOfBusinessTextBlock"]),
            companyHistory: getString(["jpcrp_cor:CompanyHistoryTextBlock"]),
            researchAndDevelopment: getString(["jpcrp_cor:ResearchAndDevelopmentActivitiesTextBlock"])
        };
    }

    /**
     * 財務諸表本表タクソノミ (jppfs_cor) のデータを型安全に取得するためのプロキシを返します。
     * プロパティにアクセスすると、自動的に最適なコンテキスト（連結優先、最新年度）のデータを検索して返します。
     * 
     * @returns JppfsCorTaxonomy インターフェースに準拠したプロキシオブジェクト
     */
    public getJppfsCor(): import("./types/jppfs_cor_taxonomy").JppfsCorTaxonomy {
        const _this = this;

        // パフォーマンス向上のためにコンテキストをキャッシュします
        // 遅延読み込み: getJppfsCorが呼び出されたタイミングでのみ計算されます
        // EdinetXbrlObjectはパース後通常不変であるため、キャッシュしても安全です
        const contexts = [
            ..._this.findContexts({ type: "Duration", scope: "Consolidated" }),
            ..._this.findContexts({ type: "Instant", scope: "Consolidated" }),
            ..._this.findContexts({ type: "Duration", scope: "NonConsolidated" }),
            ..._this.findContexts({ type: "Instant", scope: "NonConsolidated" })
        ];

        // プロキシ内部で `contexts` 配列を再利用することで最適化を行っています。
        // 以前はプロパティアクセスのたびに `findContexts`（Mapのフィルタリングを含む）を4回呼び出していましたが、
        // これによりオーバーヘッドを削減しています。

        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        return new Proxy({} as import("./types/jppfs_cor_taxonomy").JppfsCorTaxonomy, {
            get(target, prop, receiver) {
                if (typeof prop !== "string") return Reflect.get(target, prop, receiver);

                // namespace prefix "jppfs_cor:" を付与して検索
                const key = `jppfs_cor:${prop}`;

                for (const context of contexts) {
                    // getDataByContextRef itself is fast (Map lookup)
                    const data = _this.getDataByContextRef(key, context.id);
                    if (data && data.value) {
                        const parsed = parseFloat(data.value);
                        return isNaN(parsed) ? data.value : parsed;
                    }
                }

                return undefined;
            }
        });
    }
    /**
     * 企業情報本表タクソノミ (jpcrp_cor) のデータを型安全に取得するためのプロキシを返します。
     * プロパティにアクセスすると、自動的に最適なコンテキスト（連結優先、最新年度）のデータを検索して返します。
     * 
     * @returns JpcrpCorTaxonomy インターフェースに準拠したプロキシオブジェクト
     */
    public getJpcrpCor(): import("./types/jpcrp_cor_taxonomy").JpcrpCorTaxonomy {
        const _this = this;

        // パフォーマンス向上のためにコンテキストをキャッシュします
        const contexts = [
            ..._this.findContexts({ type: "Duration", scope: "Consolidated" }),
            ..._this.findContexts({ type: "Instant", scope: "Consolidated" }),
            ..._this.findContexts({ type: "Duration", scope: "NonConsolidated" }),
            ..._this.findContexts({ type: "Instant", scope: "NonConsolidated" })
        ];

        return new Proxy({} as import("./types/jpcrp_cor_taxonomy").JpcrpCorTaxonomy, {
            get(target, prop, receiver) {
                if (typeof prop !== "string") return Reflect.get(target, prop, receiver);

                // namespace prefix "jpcrp_cor:" を付与して検索
                const key = `jpcrp_cor:${prop}`;

                for (const context of contexts) {
                    const data = _this.getDataByContextRef(key, context.id);
                    if (data && data.value) {
                        // 数値型の場合はパースを試みるが、jpcrpはテキストも多いため、
                        // タクソノミ定義(TS型)に合わせてキャストされることを期待する。
                        // ここでは生の値を返しつつ、数値変換可能なものは数値として扱うのが理想だが、
                        // TSの型定義上は string | number の判別が難しい (実行時にはすべて string で来る)

                        // 簡易的な判定: 数字のみで構成される場合は数値に変換？
                        // いや、電話番号や郵便番号の可能性もある。
                        // 安全のため、parseFloatしてNaNでなければ数値、そうでなければ文字列とする。
                        // ただし、TSの型定義と矛盾しないように注意が必要。
                        // JpcrpCorTaxonomyの型定義は generate_types_jpcrp.ts で生成されており、
                        // Monetary/Shares等は number、それ以外は string となっている。

                        const parsed = parseFloat(data.value);
                        // 単純な数値変換だと "0123" が 123 (number) になってしまう問題があるか？
                        // EDINETの数値データは通常フォーマット済みではない (カンマなし)。
                        // テキストブロックなどはNaNになるのでstringで返る。
                        return isNaN(parsed) ? data.value : parsed;
                    }
                }

                return undefined;
            }
        });
    }

    /**
     * 大量保有報告書（変更報告書、訂正報告書を含む）から主要な情報を抽出します。
     * ネームスペースは `jplvh_cor` を使用します。
     */
    public getLargeShareholdingInfo(): LargeShareholdingInfo {
        // ヘルパー: コンテキストを問わず、最初に見つかった値を返す
        const getVal = (key: string): string | undefined => {
            const list = this.getDataList(key);
            return list.length > 0 ? list[0].value : undefined;
        };

        const getNum = (key: string): number | undefined => {
            const val = getVal(key);
            return val ? parseFloat(val) : undefined;
        };

        return {
            filerName: getVal("jplvh_cor:FilerNameInJapaneseDEI") || getVal("jpdei_cor:FilerNameInJapaneseDEI") || getVal("jplvh_cor:Name"),
            issuerName: getVal("jplvh_cor:NameOfIssuer") || getVal("jplvh_cor:IssuerName"),
            holdingRatio: getNum("jplvh_cor:HoldingRatioOfShareCertificatesEtc"),
            prevHoldingRatio: getNum("jplvh_cor:HoldingRatioOfShareCertificatesEtcPerLastReport"),
            // Count can be inferred or found in tags like "NumberOfJointHolders"
            // For now, leaving it undefined as it requires counting members or finding specific tag
        };
    }
}

/**
 * 財務・業績の主要指標
 */
export interface KeyMetrics {
    /** 売上高 */
    netSales?: number;
    /** 営業利益 */
    operatingIncome?: number;
    /** 経常利益 */
    ordinaryIncome?: number;
    /** 当期純利益 (親会社株主に帰属する当期純利益) */
    netIncome?: number;
    /** 純資産 */
    netAssets?: number;
    /** 総資産 */
    totalAssets?: number;

    // Cash Flows
    /** 営業活動によるキャッシュ・フロー */
    operatingCashFlow?: number;
    /** 投資活動によるキャッシュ・フロー */
    investingCashFlow?: number;
    /** 財務活動によるキャッシュ・フロー */
    financingCashFlow?: number;
    /** 現金及び現金同等物の期末残高 */
    cashAndEquivalents?: number;

    // Per Share
    /** EPS (1株当たり当期純利益) */
    earningsPerShare?: number;
    /** BPS (1株当たり純資産) */
    bookValuePerShare?: number;

    // Ratios & Others
    /** 自己資本比率 (例: 0.5 = 50%) */
    equityToTotalAssetsRatio?: number;
    /** ROE (自己資本利益率) (例: 0.1 = 10%) */
    rateOfReturnOnEquity?: number;
    /** PER (株価収益率) ※XBRLに含まれる場合のみ */
    priceEarningsRatio?: number;
    /** 配当性向 */
    payoutRatio?: number;
    /** 発行済株式総数 */
    numberOfIssuedShares?: number;
    /** 1株当たり配当額 */
    dividendPaidPerShare?: number;
}

/**
 * 大量保有報告書の情報
 */
export interface LargeShareholdingInfo {
    /** 提出者名 (氏名又は名称) */
    filerName?: string;
    /** 発行者名 (氏名又は名称) */
    issuerName?: string;
    /** 保有割合 (%) */
    holdingRatio?: number;
    /** 直前報告書における保有割合 (%) */
    prevHoldingRatio?: number;
    /** 共同保有者の数 */
    jointHoldersCount?: number;
}

/**
 * 定性的情報（テキスト）
 */
export interface QualitativeInfo {
    /** 事業の方針、事業環境及び対処すべき課題 */
    businessPolicy?: string;
    /** 事業等のリスク */
    businessRisks?: string;
    /** 経営者による財政状態、経営成績及びキャッシュ・フローの状況の分析 */
    financialAnalysis?: string;
    /** 事業の内容 */
    businessDescription?: string;
    /** 沿革 */
    companyHistory?: string;
    /** 研究開発活動 */
    researchAndDevelopment?: string;
}

/**
 * 年次の有価証券報告書。財務情報を含みます。
 * @documentType Annual (有価証券報告書) [120]
 * @japaneseLabel 有価証券報告書
 */
export interface AnnualResponse {
    metadata: CommonMetadata;
    metrics: KeyMetrics;
}

/**
 * 四半期ごとの報告書。財務情報を含みます。
 * @documentType Quarterly (四半期報告書) [140]
 * @japaneseLabel 四半期報告書
 */
export interface QuarterlyResponse {
    metadata: CommonMetadata;
    metrics: KeyMetrics;
}

/**
 * 半期ごとの報告書。財務情報を含みます。
 * @documentType SemiAnnual (半期報告書) [160]
 * @japaneseLabel 半期報告書
 */
export interface SemiAnnualResponse {
    metadata: CommonMetadata;
    metrics: KeyMetrics;
}

/**
 * 臨時報告書。財務情報を含む場合があります。
 * @documentType Extraordinary (臨時報告書) [180]
 * @japaneseLabel 臨時報告書
 */
export interface ExtraordinaryResponse {
    metadata: CommonMetadata;
    metrics: KeyMetrics;
}

/**
 * 大量保有報告書、変更報告書、訂正報告書。保有情報を含みます。
 * @documentType LargeShareholding (大量保有報告書) [340/350/360]
 * @japaneseLabel 大量保有報告書
 */
export interface LargeShareholdingResponse {
    metadata: CommonMetadata;
    info: LargeShareholdingInfo;
}

/**
 * 有価証券届出書。財務情報を含む場合があります。
 * @documentType SecuritiesRegistration (有価証券届出書) [010]
 * @japaneseLabel 有価証券届出書
 */
export interface SecuritiesRegistrationResponse {
    metadata: CommonMetadata;
    metrics: KeyMetrics;
}

/**
 * 内部統制報告書。主にメタデータのみが返されます。
 * @documentType InternalControl (内部統制報告書) [235]
 * @japaneseLabel 内部統制報告書
 */
export interface InternalControlResponse {
    metadata: CommonMetadata;
}

/**
 * 公開買付届出書または公開買付報告書。主にメタデータのみが返されます。
 * @documentType TenderOffer (公開買付届出書/報告書) [240/270]
 * @japaneseLabel 公開買付関連書類
 */
export interface TenderOfferResponse {
    metadata: CommonMetadata;
}
