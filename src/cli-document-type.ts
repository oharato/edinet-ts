import { EdinetDocumentType } from "./edinet-document-type";

/** CLI内部の別名変換。旧別名と未知入力の有報fallbackは互換のため維持します。 */
const DOCUMENT_TYPE_MAP: Record<string, EdinetDocumentType | EdinetDocumentType[]> = {
    // Aliases
    "annual": EdinetDocumentType.AnnualCards,
    "quarterly": EdinetDocumentType.QuarterlyReport,
    "semiannual": EdinetDocumentType.SemiAnnualReport,
    "extraordinary": EdinetDocumentType.ExtraordinaryReport,
    // 旧registrationは互換のため010。正しい届出書には下の明示名を使います。
    "registration": EdinetDocumentType.SecuritiesRegistrationStatement,
    "securities-notice": EdinetDocumentType.SecuritiesNotice,
    "registration-statement": EdinetDocumentType.RegistrationStatement,
    "amended": EdinetDocumentType.AmendedSecuritiesRegistrationStatement,
    "confirmation": EdinetDocumentType.ConfirmationLetter,
    "internalcontrol": EdinetDocumentType.InternalControlReport,
    "largeshareholding": [
        EdinetDocumentType.LargeShareholdingReport,
        EdinetDocumentType.ChangeReport,
        EdinetDocumentType.CorrectionReport
    ],
    "change": EdinetDocumentType.ChangeReport,
    "correction": EdinetDocumentType.CorrectionReport,
    "tenderoffer": EdinetDocumentType.TenderOfferStatement,
    "tenderofferreport": EdinetDocumentType.TenderOfferReport,
    // Short codes
    "120": EdinetDocumentType.AnnualCards,
    "140": EdinetDocumentType.QuarterlyReport,
    "160": EdinetDocumentType.SemiAnnualReport,
    "180": EdinetDocumentType.ExtraordinaryReport,
    "010": EdinetDocumentType.SecuritiesRegistrationStatement,
    "030": EdinetDocumentType.RegistrationStatement,
    "040": EdinetDocumentType.AmendedSecuritiesRegistrationStatement,
    "135": EdinetDocumentType.ConfirmationLetter,
    "235": EdinetDocumentType.InternalControlReport,
    "340": EdinetDocumentType.LargeShareholdingReport,
    "350": EdinetDocumentType.ChangeReport,
    "360": EdinetDocumentType.CorrectionReport,
    "240": EdinetDocumentType.TenderOfferStatement,
    "270": EdinetDocumentType.TenderOfferReport,
};

export function resolveCliDocumentType(input: string): EdinetDocumentType | EdinetDocumentType[] {
    const lower = input.toLowerCase();

    // Check aliases
    if (Object.hasOwn(DOCUMENT_TYPE_MAP, lower)) {
        return DOCUMENT_TYPE_MAP[lower];
    }

    // Check if raw value exists in Enum
    const values = Object.values(EdinetDocumentType);
    if (values.includes(input as EdinetDocumentType)) {
        return input as EdinetDocumentType;
    }

    // Default to Annual if unknown
    return EdinetDocumentType.AnnualCards;
}
