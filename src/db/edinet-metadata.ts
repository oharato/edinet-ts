import { EdinetDocumentType } from "../edinet-document-type";

export interface EdinetMetadata {
    docID: string;
    secCode: string;
    filerName: string;
    docTypeCode: EdinetDocumentType | string;
    submitDate: string;
    periodEnd: string;
    docDescription: string;
}
