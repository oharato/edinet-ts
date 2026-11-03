import { EdinetDocumentType } from "./document-types";

export interface EdinetMetadata {
  docID: string;
  secCode: string;
  filerName: string;
  docTypeCode: EdinetDocumentType | string;
  submitDate: string;
  periodEnd: string;
  docDescription: string;
}
