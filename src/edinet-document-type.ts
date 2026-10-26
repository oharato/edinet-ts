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
    /** 通知書。書類種別コード010。 */
    SecuritiesNotice = "010",
    /** 有価証券届出書。書類種別コード030。 */
    RegistrationStatement = "030",
    /** @deprecated 互換用の旧名。値010は通知書です。届出書にはRegistrationStatementを使ってください。 */
    SecuritiesRegistrationStatement = "010",
    /** 訂正有価証券届出書 */
    AmendedSecuritiesRegistrationStatement = "040",
    /** 確認書 (Confirmation Letter) */
    ConfirmationLetter = "135",
    /** 内部統制報告書 (Internal Control Report) */
    InternalControlReport = "235",
    /** 別途買付け禁止の特例を受けるための申出書。書類種別コード330。 */
    SeparatePurchaseProhibitionException = "330",
    /** 訂正別途買付け禁止の特例を受けるための申出書。書類種別コード340。大量保有報告書ではありません。 */
    AmendedSeparatePurchaseProhibitionException = "340",
    /** 大量保有報告書。書類種別コード350。変更報告書も同じ350で、様式コード（010002等）とdocDescriptionで区別します。 */
    LargeShareholdingReport = "350",
    /** @deprecated 互換用の旧名。変更報告書に独立した種別コードはなく、値は大量保有報告書と同じ350です。初回と変更の区別には様式コードを使ってください。 */
    ChangeReport = "350",
    /** 訂正大量保有報告書 (Correction Report - Large Shareholding)。書類種別コード360。 */
    CorrectionReport = "360",
    /** 基準日の届出書。書類種別コード370。 */
    RecordDateNotification = "370",
    /** 変更の届出書。書類種別コード380。基準日の届出書に対する変更で、大量保有の変更報告書ではありません。 */
    ChangeNotification = "380",
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
 * 大量保有報告書・変更報告書は350、訂正大量保有報告書は360です。
 * 340は訂正別途買付け禁止の特例を受けるための申出書であり、対象外です。
 */
export function isLargeShareholding(code: string): boolean {
    return [
        EdinetDocumentType.LargeShareholdingReport,
        EdinetDocumentType.CorrectionReport
    ].includes(code as EdinetDocumentType);
}
