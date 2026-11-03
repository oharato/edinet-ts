import {createHash} from 'node:crypto';
import {gzipSync, gunzipSync} from 'node:zlib';

export type ArchiveContentEncoding = 'plain' | 'gzip';
const maximumBytes = 256 * 1024 * 1024;
function input(bytes: Uint8Array, encoding: ArchiveContentEncoding, sha256: string) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > maximumBytes || !['plain', 'gzip'].includes(encoding) || !/^[a-f0-9]{64}$/.test(sha256))
        throw new Error('Invalid archive content');
}
function verify(bytes: Buffer, sha256: string) {
    if (bytes.byteLength > maximumBytes || createHash('sha256').update(bytes).digest('hex') !== sha256)
        throw new Error('Archive content hash differs');
    return bytes;
}
/** 保存符号化を変えても原本のbyte列と内容hashは変えません。 */
export function encodeArchiveContent(bytes: Uint8Array, encoding: ArchiveContentEncoding, sha256: string): Buffer {
    input(bytes, encoding, sha256);
    const raw = verify(Buffer.from(bytes), sha256);
    const encoded = encoding === 'gzip' ? gzipSync(raw, {level: 1}) : raw;
    input(encoded, encoding, sha256);
    return encoded;
}
/** 展開容量を制限してから、非圧縮の原本hashを検査します。 */
export function decodeArchiveContent(bytes: Uint8Array, encoding: ArchiveContentEncoding, sha256: string): Buffer {
    input(bytes, encoding, sha256);
    let raw: Buffer;
    try {
        raw = encoding === 'gzip' ? gunzipSync(bytes, {maxOutputLength: maximumBytes}) : Buffer.from(bytes);
    } catch {
        throw new Error('Invalid compressed archive content');
    }
    return verify(raw, sha256);
}
