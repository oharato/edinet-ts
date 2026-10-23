/** 公開APIで補完できる値定数。JSONの既存文字列値も同じ型で受け付けます。 */
export const ConsolidationScope = Object.freeze({
    Consolidated: "Consolidated",
    NonConsolidated: "NonConsolidated"
} as const);
export type ConsolidationScope = typeof ConsolidationScope[keyof typeof ConsolidationScope];

export const ComparisonOperator = Object.freeze({
    GreaterThanOrEqual: "gte",
    LessThanOrEqual: "lte",
    GreaterThan: "gt",
    LessThan: "lt",
    Equal: "eq"
} as const);
export type ComparisonOperator = typeof ComparisonOperator[keyof typeof ComparisonOperator];

export const SortOrder = Object.freeze({ Ascending: "asc", Descending: "desc" } as const);
export type SortOrder = typeof SortOrder[keyof typeof SortOrder];

export const FinancialPeriodType = Object.freeze({ Annual: "annual", YearToDate: "ytd", Quarterly: "quarterly" } as const);
export type FinancialPeriodType = typeof FinancialPeriodType[keyof typeof FinancialPeriodType];
