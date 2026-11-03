import { XMLValidator } from "fast-xml-parser";

/** 解析前のUTF-8換算byte上限。ZIP・深度・解析時間の上限とは別です。 */
export const XML_INPUT_MAX_BYTES = 64 * 1024 * 1024;
function invalidXml(): never { throw new Error("整形式の原本XMLが必要です（DOCTYPE非対応）"); }
const validXmlCharacter = (code: number): boolean => code === 0x9 || code === 0xa || code === 0xd ||
    code >= 0x20 && code <= 0xd7ff || code >= 0xe000 && code <= 0xfffd || code >= 0x10000 && code <= 0x10ffff;

/** Bufferや全体の再encodeを使わずUTF-8 byteを数え、XML1.0の不正文字も拒否します。 */
function assertCharactersAndBytes(value: string): void {
    const tooLarge = (): never => { throw new Error("原本XMLがUTF-8 byte上限（64MiB）を超えています"); };
    if (value.length > XML_INPUT_MAX_BYTES) tooLarge();
    let bytes = 0;
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
        else {
            if (!validXmlCharacter(code)) invalidXml();
            bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
        }
        if (bytes > XML_INPUT_MAX_BYTES) tooLarge();
    }
}

/** DTDを許さないため、組込み5種とXML1.0で有効な数値文字参照だけを受理します。 */
function assertReferences(value: string, start: number, end: number): void {
    // 各tag/text区間の外を検索すると、参照の少ないXMLで後方全体を繰り返し走査します。
    for (let cursor = start; cursor < end; cursor++) {
        if (value.charCodeAt(cursor) !== 38) continue;
        let terminator = cursor + 1;
        while (terminator < end && value.charCodeAt(terminator) !== 59) terminator++;
        if (terminator === end) invalidXml();
        const reference = value.slice(cursor + 1, terminator);
        if (!["amp", "lt", "gt", "quot", "apos"].includes(reference)) {
            if (!/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(reference)) invalidXml();
            const code = reference[1] === "x" ? Number.parseInt(reference.slice(2), 16) : Number(reference.slice(1));
            if (!Number.isInteger(code) || !validXmlCharacter(code)) invalidXml();
        }
        cursor = terminator;
    }
}

/** XML文字列の全入口から共用。依存validatorが許す既知の不正境界も解析前に補います。 */
export function assertXmlInput(value: unknown): asserts value is string {
    if (typeof value !== "string") invalidXml();
    assertCharactersAndBytes(value);
    let cursor = 0, depth = 0, roots = 0;
    while (cursor < value.length) {
        const start = value.indexOf("<", cursor);
        const textEnd = start === -1 ? value.length : start;
        assertReferences(value, cursor, textEnd);
        if (value.slice(cursor, textEnd).includes("]]>")) invalidXml();
        if (start === -1) break;
        cursor = start;
        // コメント・CDATA・処理命令の文字列は宣言や文字参照ではありません。
        const terminator = value.startsWith("<!--", cursor) ? "-->" : value.startsWith("<![CDATA[", cursor) ? "]]>" : value.startsWith("<?", cursor) ? "?>" : undefined;
        if (terminator) {
            if (terminator === "]]>" && depth === 0) invalidXml();
            const end = value.indexOf(terminator, cursor + 2);
            if (end === -1) break; // 不完全な構文はこの後のvalidatorで拒否します。
            cursor = end + terminator.length;
        } else {
            if (/^<!DOCTYPE\b/i.test(value.slice(cursor, cursor + 10))) invalidXml();
            // 引用符内の > はtag終端ではなく、生の < は属性値として不正です。
            let end = cursor + 1, quote = "";
            for (; end < value.length; end++) {
                const char = value[end];
                if (quote) { if (char === "<") invalidXml(); if (char === quote) quote = ""; }
                else if (char === '"' || char === "'") quote = char;
                else if (char === ">") break;
            }
            if (end === value.length) break;
            assertReferences(value, cursor, end + 1);
            if (value[cursor + 1] === "/") depth--;
            else if (value[cursor + 1] !== "!") {
                if (depth === 0) roots++;
                if (value[end - 1] !== "/") depth++;
            }
            cursor = end + 1;
        }
    }
    if (roots !== 1 || XMLValidator.validate(value) !== true) invalidXml();
}
