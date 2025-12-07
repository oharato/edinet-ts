import { EdinetDocumentType } from "../edinet-document-type";

export interface EdinetMetadata {
    doc_id: string;
    sec_code: string;
    filer_name: string;
    doc_type_code: EdinetDocumentType | string;
    submit_date: string;
    period_end: string;
    doc_description: string;
}
