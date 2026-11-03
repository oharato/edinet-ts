export const DOCUMENT_FORMAT_KEYS = ['xbrlFlag','pdfFlag','csvFlag','attachDocFlag','englishDocFlag'] as const;
export type DocumentFormatFlag = string | number | null;
export type DocumentFormatStatus = {state:'provided'|'not-provided';code:'0'|'1'} | {state:'unknown';reason:'unrecorded'|'null'|'unrecognized-code';code?:string};
export interface DocumentFormats {xbrl:DocumentFormatStatus;pdf:DocumentFormatStatus;csv:DocumentFormatStatus;attachments:DocumentFormatStatus;english:DocumentFormatStatus;}
/** APIコードの表記を固定。欠損や未知値を0へ変換しません。 */
export function normalizeDocumentFormatFlag(value:unknown):string|null|undefined {
 if(value===undefined||value===null)return value;
 if(typeof value==='number'&&!Number.isSafeInteger(value)||typeof value!=='string'&&typeof value!=='number')throw Error('書類形式フラグは文字列/安全な整数/null/未記録です');
 const code=String(value);if(code.length>32||/[\x00-\x1f\x7f-\x9f]/.test(code))throw Error('書類形式フラグは32文字以下です');return code;
}
export function describeDocumentFormats(document:Partial<Record<typeof DOCUMENT_FORMAT_KEYS[number],unknown>>):DocumentFormats {
 if(!document||typeof document!=='object'||Array.isArray(document))throw Error('書類形式の宣言が必要です');
 const flags=DOCUMENT_FORMAT_KEYS.map(k=>normalizeDocumentFormatFlag(Object.hasOwn(document,k)?document[k]:undefined));
 const status=(code:string|null|undefined):DocumentFormatStatus=>code===undefined?{state:'unknown',reason:'unrecorded'}:code===null?{state:'unknown',reason:'null'}:code==='0'||code==='1'?{state:code==='1'?'provided':'not-provided',code}:{state:'unknown',reason:'unrecognized-code',code};
 return{xbrl:status(flags[0]),pdf:status(flags[1]),csv:status(flags[2]),attachments:status(flags[3]),english:status(flags[4])};
}
