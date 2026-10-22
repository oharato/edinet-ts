import { KeyMetrics, KeyMetricSources, KeyMetricSource } from "./edinet-xbrl-object";

/** 元factの期間・scope・通貨が一致する場合だけ計算します。来歴不明なら未定義です。 */
export function calculateFinancialMetrics(metrics: KeyMetrics, sources?: KeyMetricSources): DerivedFinancialMetrics {
    const compatible = (a: keyof KeyMetrics, b: keyof KeyMetrics) => {
        const x = sources?.[a], y = sources?.[b];
        return !!x && !!y && !!x.contextRef && x.contextRef === y.contextRef &&
            !!x.periodStart && validDate(x.periodStart) && x.periodStart === y.periodStart &&
            !!x.periodEnd && validDate(x.periodEnd) && x.periodEnd === y.periodEnd && x.periodStart <= x.periodEnd &&
            !!x.scope && ["Consolidated", "NonConsolidated"].includes(x.scope) && x.scope === y.scope && !!x.unit && /^iso4217:[A-Z]{3}$/.test(x.unit) && x.unit === y.unit;
    };
    const ratio = (numerator?: number, denominator?: number): number | undefined => {
        if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator! <= 0) return undefined;
        const value = numerator! / denominator!;
        return Number.isFinite(value) ? value : undefined;
    };
    const cashFlow = compatible("operatingCashFlow", "investingCashFlow") && Number.isFinite(metrics.operatingCashFlow) && Number.isFinite(metrics.investingCashFlow)
        ? metrics.operatingCashFlow! + metrics.investingCashFlow! : undefined;
    return {
        operatingMargin: compatible("operatingIncome", "netSales") ? ratio(metrics.operatingIncome, metrics.netSales) : undefined,
        netMargin: compatible("netIncome", "netSales") ? ratio(metrics.netIncome, metrics.netSales) : undefined,
        freeCashFlow: Number.isFinite(cashFlow) ? cashFlow : undefined
    };
}

export interface DerivedFinancialMetrics {
    /** 営業利益 / 売上高。0.1 = 10%。売上高が0以下なら未定義。 */
    operatingMargin?: number;
    /** 親会社帰属純利益 / 売上高。0.1 = 10%。売上高が0以下なら未定義。 */
    netMargin?: number;
    /** 営業CF + 投資CF。設備投資だけを控除する定義とは異なります。 */
    freeCashFlow?: number;
}

/** 指標のホワイトリスト。EDINET DB のスラッグとは別の edinet-ts のプロパティ名です。 */
export const FINANCIAL_SCREENING_METRICS = [
    "netSales", "operatingIncome", "ordinaryIncome", "netIncome", "netAssets", "totalAssets",
    "operatingCashFlow", "investingCashFlow", "financingCashFlow", "cashAndEquivalents",
    "earningsPerShare", "bookValuePerShare", "equityToTotalAssetsRatio", "rateOfReturnOnEquity",
    "priceEarningsRatio", "payoutRatio", "numberOfIssuedShares", "dividendPaidPerShare",
    "operatingMargin", "netMargin", "freeCashFlow"
] as const satisfies readonly (keyof (KeyMetrics & DerivedFinancialMetrics))[];

export type FinancialScreeningMetric = typeof FINANCIAL_SCREENING_METRICS[number];

/** 保存済みの値を明示的に渡すための形式。ファイルやネットワークを自動で取得しません。 */
export interface FinancialSnapshot {
    secCode: string;
    docID: string;
    docTypeCode: string;
    periodEnd: string;
    submitDate: string;
    /** annual と YTD、単四半期を同じ集団に混ぜないでください。 */
    metrics: KeyMetrics;
    /** getKeyMetricsWithSources()から取得。来歴なしでは派生値を計算しません。 */
    metricSources?: KeyMetricSources;
    /** 不明の場合は派生値を自動計算しません。書類種別だけから推測しません。 */
    periodType?: "annual" | "ytd" | "quarterly";
}

export interface FinancialCondition {
    metric: FinancialScreeningMetric;
    operator: "gte" | "lte" | "gt" | "lt" | "eq";
    value: number;
}

export interface FinancialScreeningOptions {
    conditions?: FinancialCondition[];
    secCodes?: string[];
    /** 既定は有報(120)。訂正報告書を自動で統合しません。 */
    docTypeCode?: string;
    /** 提出日と決算日の両方に適用。時刻指定の場合は提出時刻まで比較します。 */
    asOf?: string;
    sortBy?: FinancialScreeningMetric;
    order?: "asc" | "desc";
    offset?: number;
    limit?: number;
}

export interface FinancialScreeningResult extends FinancialSnapshot {
    derivedMetrics: DerivedFinancialMetrics;
    /** 元データや対象期間が未検証、または欠損等により計算しなかった項目。 */
    unavailableDerivedMetrics: (keyof DerivedFinancialMetrics)[];
}

const metricsSet = new Set<string>(FINANCIAL_SCREENING_METRICS);
const sourceMetrics = FINANCIAL_SCREENING_METRICS.filter(key => !["operatingMargin", "netMargin", "freeCashFlow"].includes(key));
const operators = new Set(["gte", "lte", "gt", "lt", "eq"]);
const normalizeCode = (code: string) => {
    if (!/^[0-9A-Z]{4}0?$/.test(code)) throw new Error(`不正な証券コード: ${code}`);
    return code.length === 4 ? `${code}0` : code;
};

function validDate(value: string): boolean {
    const day = value.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    const time = Date.parse(day);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day;
}

function validTimestamp(value: string): boolean {
    return validDate(value) && (/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value)) && value.slice(11, 13) < "24" && value.slice(14, 16) < "60" && value.slice(17, 19) < "60");
}

/**
 * 保存済み主要指標を横断検索します。各銘柄の最新書類を選んでから AND 条件を適用します。
 * 欠損値は条件に一致せず、並べ替えでは常に末尾です。入力は変更しません。
 * 日時はEDINETと同じローカル時刻として比較します（タイムゾーン変換なし）。
 */
export function screenFinancialSnapshots(
    snapshots: readonly FinancialSnapshot[], options: FinancialScreeningOptions = {}
): FinancialScreeningResult[] {
    if (!Array.isArray(snapshots)) throw new Error("snapshots は配列で指定してください");
    const conditions = options.conditions ?? [];
    if (!Array.isArray(conditions)) throw new Error("conditions は配列で指定してください");
    for (const condition of conditions) {
        if (!condition || !metricsSet.has(condition.metric) || !operators.has(condition.operator) ||
            !Number.isFinite(condition.value)) throw new Error("不正な財務条件です");
    }
    if (options.sortBy !== undefined && !metricsSet.has(options.sortBy)) throw new Error("不正な並べ替え指標です");
    if (options.order !== undefined && !["asc", "desc"].includes(options.order)) throw new Error("不正な並べ替え順です");
    for (const value of [options.limit, options.offset]) {
        if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new Error("limit/offset は0以上の整数です");
    }
    if (options.asOf !== undefined && !validTimestamp(options.asOf)) throw new Error("asOf は YYYY-MM-DD または YYYY-MM-DD HH:mm:ss です");
    const codes = options.secCodes ? new Set(options.secCodes.map(normalizeCode)) : undefined;
    const cutoff = options.asOf?.replace("T", " ");
    const latest = new Map<string, FinancialSnapshot>();
    const timestamp = (value: string) => value.length === 10 ? `${value} 00:00:00` : value.replace("T", " ");
    const chronology = (row: FinancialSnapshot) => [row.periodEnd, timestamp(row.submitDate), row.docID].join("|");
    for (const row of snapshots) {
        if (!row || typeof row.secCode !== "string" || typeof row.docID !== "string" || !row.docID ||
            typeof row.docTypeCode !== "string" || typeof row.periodEnd !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(row.periodEnd) || !validDate(row.periodEnd) ||
            typeof row.submitDate !== "string" || !validTimestamp(row.submitDate) ||
            !row.metrics || typeof row.metrics !== "object" || Array.isArray(row.metrics)) throw new Error("不正な財務スナップショットです");
        if (row.periodType !== undefined && !["annual", "ytd", "quarterly"].includes(row.periodType)) throw new Error("不正なperiodTypeです");
        if (row.metricSources !== undefined && (!row.metricSources || typeof row.metricSources !== "object" || Array.isArray(row.metricSources))) throw new Error("不正なmetricSourcesです");
        for (const source of Object.values(row.metricSources ?? {}) as KeyMetricSource[]) {
            if (!source || typeof source !== "object" ||
                [source.contextRef, source.unit, source.periodStart, source.periodEnd, source.instant, source.scope].some(value => value !== undefined && typeof value !== "string") ||
                source.scope !== undefined && !["Consolidated", "NonConsolidated"].includes(source.scope)) throw new Error("不正な指標来歴です");
        }
        const code = normalizeCode(row.secCode);
        for (const key of sourceMetrics) {
            const value = row.metrics[key as keyof KeyMetrics];
            if (value !== undefined && value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
                throw new Error(`不正な指標値: ${key}`);
            }
        }
        if (row.docTypeCode !== (options.docTypeCode ?? "120") || codes && !codes.has(code)) continue;
        if (cutoff && (row.periodEnd > cutoff.slice(0, 10) ||
            (cutoff.length === 10 ? row.submitDate.slice(0, 10) > cutoff :
                row.submitDate.length === 10 && row.submitDate === cutoff.slice(0, 10) || row.submitDate.replace("T", " ") > cutoff))) continue;
        const previous = latest.get(code);
        if (!previous || chronology(row) > chronology(previous)) latest.set(code, { ...row, secCode: code });
    }
    const getMetric = (row: FinancialScreeningResult, key: FinancialScreeningMetric): number | undefined => {
        const value = key in row.derivedMetrics ? row.derivedMetrics[key as keyof DerivedFinancialMetrics] : row.metrics[key as keyof KeyMetrics];
        return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    };
    const selected = [...latest.values()];
    const knownPeriodTypes = new Set(selected.map(row => row.periodType).filter(Boolean));
    if (knownPeriodTypes.size > 1) throw new Error("通期・YTD・単四半期を混在させることはできません");
    // 判明している通貨とscopeの混在は拒否します。不明な来歴は復元しません。
    const dependencies: Record<keyof DerivedFinancialMetrics, (keyof KeyMetrics)[]> = {
        operatingMargin: ["operatingIncome", "netSales"], netMargin: ["netIncome", "netSales"],
        freeCashFlow: ["operatingCashFlow", "investingCashFlow"]
    };
    const requested = [...conditions.map(condition => condition.metric), ...(options.sortBy ? [options.sortBy] : [])];
    const comparedSources = new Set(requested.flatMap(key => key in dependencies
        ? dependencies[key as keyof DerivedFinancialMetrics] : [key as keyof KeyMetrics]));
    for (const key of comparedSources) {
        const sources = selected.map(row => row.metricSources?.[key]);
        const durationDays = sources.filter(source => source?.periodStart && source.periodEnd &&
            validDate(source.periodStart) && validDate(source.periodEnd)).map(source =>
            (Date.parse(source!.periodEnd!) - Date.parse(source!.periodStart!)) / 86400000 + 1);
        // 閏年・52/53週の差は許容し、半年/通年や変則決算の大きな期間差は比較しません。
        if (durationDays.length > 1 && Math.max(...durationDays) - Math.min(...durationDays) > 7) {
            throw new Error(`比較する期間長が異なります: ${key}`);
        }
        if (new Set(sources.map(source => source?.unit).filter(Boolean)).size > 1 ||
            new Set(sources.map(source => source?.scope).filter(Boolean)).size > 1) {
            throw new Error(`通貨・連結範囲が混在しています: ${key}`);
        }
    }
    const results = selected.map(row => {
        const sources = Object.fromEntries(Object.entries(row.metricSources ?? {}).filter(([, source]) =>
            source.periodEnd === row.periodEnd || source.instant === row.periodEnd)) as KeyMetricSources;
        const derivedMetrics = calculateFinancialMetrics(row.metrics, row.periodType ? sources : undefined);
        return {
            ...row, metrics: { ...row.metrics },
            metricSources: row.metricSources ? Object.fromEntries(Object.entries(row.metricSources).map(([key, source]) => [key, { ...source }])) : undefined,
            derivedMetrics,
            unavailableDerivedMetrics: (Object.keys(derivedMetrics) as (keyof DerivedFinancialMetrics)[]).filter(key => derivedMetrics[key] === undefined)
        };
    })
        .filter(row => conditions.every(condition => {
            const value = getMetric(row, condition.metric);
            if (value === undefined) return false;
            switch (condition.operator) {
                case "gte": return value >= condition.value;
                case "lte": return value <= condition.value;
                case "gt": return value > condition.value;
                case "lt": return value < condition.value;
                case "eq": return value === condition.value;
            }
        }));
    results.sort((a, b) => {
        if (options.sortBy) {
            const av = getMetric(a, options.sortBy), bv = getMetric(b, options.sortBy);
            if (av === undefined && bv !== undefined) return 1;
            if (bv === undefined && av !== undefined) return -1;
            if (av !== undefined && bv !== undefined && av !== bv) return (av < bv ? -1 : 1) * (options.order === "asc" ? 1 : -1);
        }
        return a.secCode.localeCompare(b.secCode);
    });
    const offset = options.offset ?? 0;
    return results.slice(offset, options.limit === undefined ? undefined : offset + options.limit);
}
