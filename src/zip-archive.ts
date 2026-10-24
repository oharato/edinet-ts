import JSZip from 'jszip';

/** 保守的な classic ZIP の上限。CPU時間や圧縮率の上限を保証するものではない。 */
export const ZIP_LIMITS = Object.freeze({
  compressedBytes: 64 * 1024 * 1024,
  entryBytes: 64 * 1024 * 1024,
  totalBytes: 256 * 1024 * 1024,
  entries: 10_000,
});
export interface ZipArchiveEntry {
  readonly name: string;
  readonly dir: boolean;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
}
export interface LoadedZipArchive {
  readonly entries: readonly ZipArchiveEntry[];
  readEntry(name: string): Promise<Uint8Array>;
}
type Limits = { -readonly [Key in keyof typeof ZIP_LIMITS]: number };
type RecordEntry = ZipArchiveEntry & { crc: number; offset: number; flags: number; method: number; rawName: Uint8Array };
const fail = (message: string): never => { throw new Error(`ZIP: ${message}`); };

export function assertDownloadDocId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.toLowerCase() === 'unknown' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new Error('書類IDが不正です');
  }
}
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function updateCrc(crc: number, bytes: Uint8Array): number {
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return crc >>> 0;
}
function crc32(bytes: Uint8Array): number { return (updateCrc(0xffffffff, bytes) ^ 0xffffffff) >>> 0; }
function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function decode(bytes: Uint8Array, utf8: boolean): string {
  if (!utf8 && bytes.some(byte => byte > 127)) fail('UTF-8指定のない非ASCII名は非対応です');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return fail('名前のUTF-8が不正です'); }
}
function safePath(name: string, dir: boolean): void {
  if (!name || name.includes('\\') || /[\u0000-\u001f\u007f-\u009f:<>"|?*]/.test(name) || name.startsWith('/')) fail('安全でないパスです');
  const encoder = new TextEncoder();
  if (encoder.encode(name).byteLength > 4096) fail('パス名が4096バイトを超えています');
  const path = dir ? name.slice(0, -1) : name;
  for (const part of path.split('/')) {
    if (encoder.encode(part).byteLength > 255) fail('パス要素が255バイトを超えています');
    if (!part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:[ .]*\.|[ .]*$)/i.test(part)) fail('安全でないパス要素です');
  }
}
function limitsFrom(overrides?: Partial<Limits>): Limits {
  if (overrides === undefined) return ZIP_LIMITS;
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) fail('上限指定が不正です');
  const result: Limits = { ...ZIP_LIMITS };
  for (const key of Reflect.ownKeys(overrides)) {
    if (typeof key !== 'string' || !Object.hasOwn(ZIP_LIMITS, key)) fail('未知の上限指定です');
    const value = overrides[key as keyof Limits];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > ZIP_LIMITS[key as keyof Limits]) fail('上限を拡大できません');
    result[key as keyof Limits] = value as number;
  }
  return result;
}
function preflight(bytes: Uint8Array, limits: Limits): RecordEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);
  const range = (at: number, length: number, end = bytes.length) => {
    if (!Number.isSafeInteger(at) || at < 0 || length < 0 || at + length > end) fail('ヘッダー範囲が不正です');
  };
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65535); at--) {
    if (u32(at) === 0x06054b50 && at + 22 + u16(at + 20) === bytes.length) { end = at; break; }
  }
  if (end < 0) fail('終端レコードがありません');
  if (u16(end + 4) !== 0 || u16(end + 6) !== 0 || u16(end + 8) !== u16(end + 10)) fail('分割ZIPは非対応です');
  const count = u16(end + 10), centralSize = u32(end + 12), central = u32(end + 16);
  if (count === 65535 || centralSize === 0xffffffff || central === 0xffffffff) fail('ZIP64は非対応です');
  if (count > limits.entries) fail('エントリー件数の上限を超えています');
  range(central, centralSize, end);
  if (central + centralSize !== end) fail('中央ディレクトリーの範囲が不正です');
  const extras = (at: number, length: number, raw: Uint8Array, name: string) => {
    const stop = at + length;
    while (at < stop) {
      range(at, 4, stop);
      const id = u16(at), size = u16(at + 2); at += 4; range(at, size, stop);
      if (id === 1) fail('ZIP64は非対応です');
      if (id === 0x7075) {
        if (size < 5 || bytes[at] !== 1 || u32(at + 1) !== crc32(raw) || decode(bytes.subarray(at + 5, at + size), true) !== name) fail('Unicode名の上書きは非対応です');
      }
      at += size;
    }
  };
  const entries: RecordEntry[] = [];
  type PathNode = { original: string; dir: boolean; declared: boolean; children: Map<string, PathNode> };
  const pathRoot: PathNode = { original: '', dir: true, declared: false, children: new Map() };
  let treeEntries = 0;
  let at = central, total = 0;
  for (let index = 0; index < count; index++) {
    range(at, 46, end);
    if (u32(at) !== 0x02014b50) fail('中央ディレクトリーが不正です');
    const flags = u16(at + 8), method = u16(at + 10);
    if (flags & ~0x080e) fail('暗号化または未対応のフラグです');
    if (method !== 0 && method !== 8) fail('圧縮方式が非対応です');
    const compressedSize = u32(at + 20), uncompressedSize = u32(at + 24), offset = u32(at + 42);
    if ([compressedSize, uncompressedSize, offset].includes(0xffffffff) || u16(at + 34) !== 0) fail('ZIP64または分割ZIPは非対応です');
    if (uncompressedSize > limits.entryBytes || compressedSize > limits.compressedBytes) fail('エントリーの宣言サイズが上限を超えています');
    total += uncompressedSize;
    if (total > limits.totalBytes) fail('合計展開サイズの上限を超えています');
    const nameLength = u16(at + 28), extraLength = u16(at + 30), commentLength = u16(at + 32);
    range(at + 46, nameLength + extraLength + commentLength, end);
    const rawName = bytes.slice(at + 46, at + 46 + nameLength);
    const name = decode(rawName, !!(flags & 0x800)), dir = name.endsWith('/');
    safePath(name, dir);
    const parts = (dir ? name.slice(0, -1) : name).split('/');
    let parent = pathRoot;
    for (let part = 0; part < parts.length; part++) {
      const original = parts[part], key = original.normalize('NFC').toLowerCase();
      const last = part === parts.length - 1;
      let node = parent.children.get(key);
      if (node && node.original !== original) fail('大小文字またはUnicodeが衝突する名前です');
      if (!node) {
        if (++treeEntries > ZIP_LIMITS.entries) fail('暗黙ディレクトリーを含む件数の上限を超えています');
        node = { original, dir: true, declared: false, children: new Map() };
        parent.children.set(key, node);
      }
      if (last) {
        if (node.declared || (!dir && node.children.size > 0)) fail('重複またはファイルとディレクトリーのパス衝突です');
        node.dir = dir; node.declared = true;
      } else if (!node.dir) fail('ファイルとディレクトリーのパスが衝突しています');
      parent = node;
    }
    const creator = bytes[at + 5], attrs = u32(at + 38), mode = (attrs >>> 16) & 0xf000;
    if (mode !== 0 && mode !== 0x4000 && mode !== 0x8000) fail('リンクまたは特殊ファイルは非対応です');
    if (attrs & 8) fail('ボリュームラベルは非対応です');
    if (((attrs & 0x10) !== 0 && !dir) || (creator === 3 && ((mode === 0x4000 && !dir) || (mode === 0x8000 && dir)))) fail('ファイル種別が一致しません');
    if (dir && (uncompressedSize !== 0 || u32(at + 16) !== 0)) fail('データを持つディレクトリーは非対応です');
    extras(at + 46 + nameLength, extraLength, rawName, name);
    entries.push({ name, dir, compressedSize, uncompressedSize, flags, method, offset, rawName, crc: u32(at + 16) });
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (at !== end) fail('中央ディレクトリーの件数が一致しません');
  const regions: { start: number; end: number }[] = [];
  for (const entry of entries) {
    const offset = entry.offset; range(offset, 30, central);
    if (u32(offset) !== 0x04034b50 || u16(offset + 6) !== entry.flags || u16(offset + 8) !== entry.method) fail('ローカルヘッダーが一致しません');
    const nameLength = u16(offset + 26), extraLength = u16(offset + 28), payload = offset + 30 + nameLength + extraLength;
    range(offset + 30, nameLength + extraLength, central);
    if (!equalBytes(bytes.subarray(offset + 30, offset + 30 + nameLength), entry.rawName)) fail('ローカル名が一致しません');
    extras(offset + 30 + nameLength, extraLength, entry.rawName, entry.name);
    range(payload, entry.compressedSize, central);
    let regionEnd = payload + entry.compressedSize;
    if (entry.flags & 8) {
      for (const [pos, expected] of [[14, entry.crc], [18, entry.compressedSize], [22, entry.uncompressedSize]]) {
        if (u32(offset + pos) !== 0 && u32(offset + pos) !== expected) fail('ローカルサイズが一致しません');
      }
      range(regionEnd, 12, central);
      if (u32(regionEnd) === 0x08074b50) { regionEnd += 4; range(regionEnd, 12, central); }
      if (u32(regionEnd) !== entry.crc || u32(regionEnd + 4) !== entry.compressedSize || u32(regionEnd + 8) !== entry.uncompressedSize) fail('データ記述子が一致しません');
      regionEnd += 12;
    } else if (u32(offset + 14) !== entry.crc || u32(offset + 18) !== entry.compressedSize || u32(offset + 22) !== entry.uncompressedSize) fail('ローカルサイズが一致しません');
    if (entry.method === 0 && entry.compressedSize !== entry.uncompressedSize) fail('STOREサイズが一致しません');
    regions.push({ start: offset, end: regionEnd });
  }
  regions.sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const region of regions) {
    if (region.start !== cursor) fail('ローカル領域に重複または未対応の空隙があります');
    cursor = region.end;
  }
  if (cursor !== central) fail('ローカル領域が一致しません');
  return entries;
}

/** 原本を変更せず検査。ZIP64等と外部エンコーディングは扱わない。 */
export async function loadZipArchive(input: Uint8Array, overrides?: Partial<Limits>): Promise<LoadedZipArchive> {
  const limits = limitsFrom(overrides);
  if (!(input instanceof Uint8Array) || input.byteLength > limits.compressedBytes) fail('圧縮ファイルの上限または型が不正です');
  const bytes = Uint8Array.from(input);
  const records = preflight(bytes, limits);
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false }); }
  catch { return fail("構造の読み込みに失敗しました"); }
  if (Object.keys(zip.files).length !== records.length) fail('展開ライブラリーの名前一覧が一致しません');
  for (const record of records) {
    const file = zip.files[record.name];
    if (!file || file.name !== record.name || file.dir !== record.dir || (file.unsafeOriginalName !== undefined && file.unsafeOriginalName !== record.name)) fail('展開ライブラリーの名前が一致しません');
  }
  const byName = new Map(records.map(record => [record.name, record]));
  const entries = Object.freeze(records.map(({ name, dir, compressedSize, uncompressedSize }) => Object.freeze({ name, dir, compressedSize, uncompressedSize })));
  return Object.freeze({ entries, readEntry(name: string): Promise<Uint8Array> {
    const record = byName.get(name);
    if (!record) return Promise.reject(new Error('ZIP: 存在しないエントリーです'));
    return new Promise((resolve, reject) => {
      // internalStreamはJSZipの公開APIだが、同梱JSZipObject型には宣言されていない。
      const file = zip.files[name] as JSZip.JSZipObject & { internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> };
      const stream = file.internalStream('uint8array');
      const chunks: Uint8Array[] = [];
      let size = 0, crc = 0xffffffff, finished = false;
      const stop = (error: Error) => {
        if (finished) return;
        finished = true; stream.pause(); chunks.length = 0; reject(error);
      };
      stream.on('data', chunk => {
        if (finished) return;
        size += chunk.length;
        if (size > limits.entryBytes || size > record.uncompressedSize) { stop(new Error('ZIP: 実展開サイズが上限または宣言と一致しません')); return; }
        crc = updateCrc(crc, chunk); chunks.push(Uint8Array.from(chunk));
      });
      stream.on('error', () => stop(new Error('ZIP: 展開に失敗しました')));
      stream.on('end', () => {
        if (finished) return;
        if (size !== record.uncompressedSize || ((crc ^ 0xffffffff) >>> 0) !== record.crc) { stop(new Error('ZIP: 展開サイズまたはCRC32が一致しません')); return; }
        finished = true;
        const result = new Uint8Array(size); let at = 0;
        for (const chunk of chunks) { result.set(chunk, at); at += chunk.length; }
        resolve(result);
      });
      stream.resume();
    });
  } });
}
