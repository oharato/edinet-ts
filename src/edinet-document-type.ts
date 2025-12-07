/**
 * EDINET Document Type Codes (docTypeCode)
 * Based on EDINET API specifications and research.
 */
export enum EdinetDocumentType {
    /** 有価証券報告書 (Annual Securities Report) */
    AnnualCards = "120",
    /** 四半期報告書 (Quarterly Report) */
    QuarterlyReport = "140",
    /** 半期報告書 (Semi-annual Report) */
    SemiAnnualReport = "160",
    /** 臨時報告書 (Extraordinary Report) */
    ExtraordinaryReport = "180",
    /** 有価証券届出書 (Securities Registration Statement) */
    SecuritiesRegistrationStatement = "010",
    /** 訂正有価証券届出書 */
    AmendedSecuritiesRegistrationStatement = "040",
    /** 確認書 (Confirmation Letter) */
    ConfirmationLetter = "135",
    /** 内部統制報告書 (Internal Control Report) */
    InternalControlReport = "235",
    /** 大量保有報告書 (Large Shareholding Report) */
    LargeShareholdingReport = "340",
    /** 変更報告書 (Change Report - Large Shareholding) */
    ChangeReport = "350",
    /** 訂正報告書 (Correction Report - Large Shareholding) */
    CorrectionReport = "360",
    /** 公開買付届出書 (Tender Offer Statement) */
    TenderOfferStatement = "240",
    /** 公開買付報告書 (Tender Offer Report) */
    TenderOfferReport = "270",
}

/**
 * Helper to check if a document is a periodic financial report.
 */
export function isFinancialReport(code: string): boolean {
    return [
        EdinetDocumentType.AnnualCards,
        EdinetDocumentType.QuarterlyReport,
        EdinetDocumentType.SemiAnnualReport
    ].includes(code as EdinetDocumentType);
}

/**
 * Helper to check if a document is related to Large Shareholding.
 */
export function isLargeShareholding(code: string): boolean {
    return [
        EdinetDocumentType.LargeShareholdingReport,
        EdinetDocumentType.ChangeReport,
        EdinetDocumentType.CorrectionReport
    ].includes(code as EdinetDocumentType);
}
