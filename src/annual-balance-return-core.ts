import type { FinancialDetailMetadata } from "./financial-detail-metadata";
export type AnnualBalanceMetadataReason = "incompatible-metadata" | "unsupported-standard" | "not-annual" | "unsupported-annual-period" | "balance-date-mismatch";
/** 利益期間と期首/期末残高の共通境界。52週決算や期末残高だけで代用しません。 */
export function validateAnnualBalanceMetadata(income: FinancialDetailMetadata, opening: FinancialDetailMetadata, closing: FinancialDetailMetadata): AnnualBalanceMetadataReason | undefined {
    for (const metadata of [income, opening, closing]) {
        if (metadata.accountingStandard !== "J-GAAP") return "unsupported-standard";
        if (metadata.secCode !== income.secCode || metadata.scope !== income.scope || metadata.currency !== income.currency) return "incompatible-metadata";
    }
    const dates = income.period;
    if (income.periodType !== "annual" || !dates.startDate || !dates.endDate) return "not-annual";
    const end = new Date(dates.startDate + "T00:00:00Z");
    if (end.getUTCDate() !== 1) return "unsupported-annual-period";
    end.setUTCFullYear(end.getUTCFullYear() + 1); end.setUTCDate(0);
    if (end.toISOString().slice(0, 10) !== dates.endDate) return "unsupported-annual-period";
    const openingDate = new Date(Date.parse(dates.startDate + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
    if (opening.period.instant !== openingDate || closing.period.instant !== dates.endDate) return "balance-date-mismatch";
}
