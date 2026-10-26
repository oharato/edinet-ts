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
    // 大量保有は350（変更報告書を含む）と訂正360。340は別途買付けの訂正申出書なので含めません。
    "largeshareholding": [
        EdinetDocumentType.LargeShareholdingReport,
        EdinetDocumentType.CorrectionReport
    ],
    // 旧changeは互換のため維持しますが、350全体（初回報告書を含む）を返します。変更だけの絞り込みは種別コードではできません。
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
    "330": EdinetDocumentType.SeparatePurchaseProhibitionException,
    "340": EdinetDocumentType.AmendedSeparatePurchaseProhibitionException,
    "350": EdinetDocumentType.LargeShareholdingReport,
    "360": EdinetDocumentType.CorrectionReport,
    "370": EdinetDocumentType.RecordDateNotification,
    "380": EdinetDocumentType.ChangeNotification,
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
