import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { deflateRawSync } from 'node:zlib';
import { assertDownloadDocId, loadZipArchive, ZIP_LIMITS } from '../src/zip-archive';

const encoder = new TextEncoder();
function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}
interface Item {
  name: string; data?: string; method?: number; flags?: number; creator?: number; attrs?: number;
  declared?: number; crc?: number; localName?: string; centralExtra?: Uint8Array; localExtra?: Uint8Array;
  rawName?: Uint8Array; descriptor?: boolean;
}
function archive(items: Item[]): Uint8Array {
  const local: Uint8Array[] = [], central: Uint8Array[] = []; let offset = 0;
  for (const item of items) {
    const name = item.rawName ?? encoder.encode(item.name), localName = item.localName === undefined ? name : encoder.encode(item.localName);
    const data = encoder.encode(item.data ?? ''), method = item.method ?? 0, flags = item.flags ?? (0x800 | (item.descriptor ? 8 : 0));
    const compressed = method === 8 ? new Uint8Array(deflateRawSync(data)) : data;
    const crc = item.crc ?? crc32(data), declared = item.declared ?? data.length;
    const lextra = item.localExtra ?? new Uint8Array(), cextra = item.centralExtra ?? new Uint8Array();
    const l = new Uint8Array(30 + localName.length + lextra.length + compressed.length + (item.descriptor ? 16 : 0)), lv = new DataView(l.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, flags, true); lv.setUint16(8, method, true);
    if (!item.descriptor) { lv.setUint32(14, crc, true); lv.setUint32(18, compressed.length, true); lv.setUint32(22, declared, true); }
    lv.setUint16(26, localName.length, true); lv.setUint16(28, lextra.length, true); l.set(localName, 30); l.set(lextra, 30 + localName.length); l.set(compressed, 30 + localName.length + lextra.length);
    if (item.descriptor) { const pos = l.length - 16; lv.setUint32(pos, 0x08074b50, true); lv.setUint32(pos + 4, crc, true); lv.setUint32(pos + 8, compressed.length, true); lv.setUint32(pos + 12, declared, true); }
    const c = new Uint8Array(46 + name.length + cextra.length), cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, (item.creator ?? 3) * 256 + 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, flags, true); cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, compressed.length, true); cv.setUint32(24, declared, true); cv.setUint16(28, name.length, true); cv.setUint16(30, cextra.length, true);
    cv.setUint32(38, item.attrs ?? (item.name.endsWith('/') ? 0x41ed0010 : 0x81a40000), true); cv.setUint32(42, offset, true); c.set(name, 46); c.set(cextra, 46 + name.length);
    local.push(l); central.push(c); offset += l.length;
  }
  const centralSize = central.reduce((sum, value) => sum + value.length, 0), result = new Uint8Array(offset + centralSize + 22);
  let at = 0; for (const part of [...local, ...central]) { result.set(part, at); at += part.length; }
  const end = new DataView(result.buffer); end.setUint32(at, 0x06054b50, true); end.setUint16(at + 8, items.length, true); end.setUint16(at + 10, items.length, true); end.setUint32(at + 12, centralSize, true); end.setUint32(at + 16, offset, true);
  return result;
}
function patch(bytes: Uint8Array, offset: number, value: number, width = 4): Uint8Array {
  const result = bytes.slice(), view = new DataView(result.buffer);
  if (width === 2) view.setUint16(offset, value, true); else view.setUint32(offset, value, true);
  return result;
}
function unicodeExtra(raw: string, replacement: string): Uint8Array {
  const name = encoder.encode(replacement), result = new Uint8Array(9 + name.length), view = new DataView(result.buffer);
  view.setUint16(0, 0x7075, true); view.setUint16(2, 5 + name.length, true); result[4] = 1; view.setUint32(5, crc32(encoder.encode(raw)), true); result.set(name, 9); return result;
}

describe('loadZipArchive', () => {
  it('JSZipの通常のPublicDoc、日本語、明示・暗黙directoryとSTORE/DEFLATEを読める', async () => {
    const zip = new JSZip(); zip.file('PublicDoc/報告書.xbrl', '<xbrl/>'); zip.file('other.txt', 'other');
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const loaded = await loadZipArchive(bytes);
    expect(loaded.entries.map(e => e.name)).toEqual(['PublicDoc/', 'PublicDoc/報告書.xbrl', 'other.txt']);
    expect(new TextDecoder().decode(await loaded.readEntry('PublicDoc/報告書.xbrl'))).toBe('<xbrl/>');
    expect(await loaded.readEntry('PublicDoc/')).toEqual(new Uint8Array());
    expect(Object.isFrozen(loaded.entries)).toBe(true); expect(Object.isFrozen(loaded.entries[0])).toBe(true);
  });
  it('明示directoryが子より後にあるZIPも読める', async () => {
    const loaded = await loadZipArchive(archive([{ name: 'PublicDoc/a.xbrl', data: 'a' }, { name: 'PublicDoc/' }]));
    expect(await loaded.readEntry('PublicDoc/a.xbrl')).toEqual(encoder.encode('a'));
  });
  it('ASCII without UTF8 flag、空ZIP、署名付きdata descriptorを扱える', async () => {
    expect((await loadZipArchive(archive([]))).entries).toEqual([]);
    for (const method of [0, 8]) {
      const loaded = await loadZipArchive(archive([{ name: 'a', data: 'content', flags: 8, descriptor: true, method }]));
      expect(await loaded.readEntry('a')).toEqual(encoder.encode('content'));
    }
  });
  it('JSZip streamFiles と圧縮された空directoryを扱える', async () => {
    const zip = new JSZip(); zip.file('PublicDoc/a.xbrl', 'abc');
    const loaded = await loadZipArchive(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', streamFiles: true }));
    expect(await loaded.readEntry('PublicDoc/a.xbrl')).toEqual(encoder.encode('abc'));
    const directory = await loadZipArchive(archive([{ name: 'a/', method: 8 }]));
    expect(await directory.readEntry('a/')).toEqual(new Uint8Array());
  });
  it('署名なしdata descriptorも扱い、descriptor破損を拒否する', async () => {
    const signed = archive([{ name: 'a', data: 'abc', method: 8, descriptor: true }]);
    const signedView = new DataView(signed.buffer), central = signedView.getUint32(signed.length - 6, true);
    const descriptor = central - 16;
    const unsigned = new Uint8Array(signed.length - 4);
    unsigned.set(signed.subarray(0, descriptor)); unsigned.set(signed.subarray(descriptor + 4), descriptor);
    new DataView(unsigned.buffer).setUint32(unsigned.length - 6, central - 4, true);
    expect(await (await loadZipArchive(unsigned)).readEntry('a')).toEqual(encoder.encode('abc'));
    await expect(loadZipArchive(patch(signed, descriptor + 4, 0))).rejects.toThrow('記述子');
  });
  it('元bytesの呼出し後変更が既存archiveに影響しない', async () => {
    const bytes = archive([{ name: 'a', data: 'abc' }]), loadedPromise = loadZipArchive(bytes); bytes.fill(0);
    const loaded = await loadedPromise;
    expect(await loaded.readEntry('a')).toEqual(encoder.encode('abc')); expect(await loaded.readEntry('a')).toEqual(encoder.encode('abc'));
    await expect(loaded.readEntry('../a')).rejects.toThrow('存在しない');
  });
  it.each(['../a', 'a/../b', './a', 'a/./b', '/a', 'C:/a', 'a\\b', 'a//b', 'a:', 'a\0b', 'a\nb', 'a\u0085b', 'a.', 'a ', 'CON', 'nul.txt', 'aux/a', 'COM1.txt', 'lpt9', 'COM¹.txt', 'CON .txt', 'a?', 'a*', 'a<', 'a"', '/'])('安全でないpathを拒否: %s', async name => {
    await expect(loadZipArchive(archive([{ name }]))).rejects.toThrow();
  });
  it.each([
    ['a', 'a'], ['a', 'A'], ['a', 'a/b'], ['a/b', 'a'], ['a/', 'a'], ['A/', 'a/b'], ['A/x', 'a/y'], ['é', 'e\u0301'],
  ])('重複・case・prefix・Unicode衝突を拒否: %j', async (a, b) => {
    await expect(loadZipArchive(archive([{ name: a }, { name: b }]))).rejects.toThrow();
  });
  it.each([0xa1ff0000, 0x11a40000, 0x21a40000, 0x61a40000, 0xc1a40000])('symlink/特殊fileを拒否: %i', async attrs => {
    await expect(loadZipArchive(archive([{ name: 'a', attrs }]))).rejects.toThrow('特殊');
  });
  it('種別矛盾とdirectory dataを拒否', async () => {
    for (const item of [{ name: 'a', attrs: 0x41ed0010 }, { name: 'a/', attrs: 0x81a40000 }, { name: 'a/', data: 'x' }]) await expect(loadZipArchive(archive([item]))).rejects.toThrow();
  });
  it.each([1, 64, 8192, 16])('暗号化または未対応flagを拒否: %i', async flags => {
    await expect(loadZipArchive(archive([{ name: 'a', flags }]))).rejects.toThrow('フラグ');
  });
  it('BZIP2等・ZIP64・分割を拒否', async () => {
    await expect(loadZipArchive(archive([{ name: 'a', method: 12 }]))).rejects.toThrow('圧縮方式');
    const bytes = archive([{ name: 'a' }]), end = bytes.length - 22;
    for (const altered of [patch(bytes, end + 4, 1, 2), patch(bytes, end + 10, 65535, 2), patch(bytes, end + 12, 0xffffffff), patch(bytes, end + 16, 0xffffffff)]) await expect(loadZipArchive(altered)).rejects.toThrow();
    await expect(loadZipArchive(archive([{ name: 'a', centralExtra: new Uint8Array([1, 0, 0, 0]) }]))).rejects.toThrow('ZIP64');
  });
  it('Unicode extraの一致は許可し置換/CRC不正/壊れたextraを拒否', async () => {
    await loadZipArchive(archive([{ name: 'a', centralExtra: unicodeExtra('a', 'a') }]));
    for (const extra of [unicodeExtra('a', '../a'), unicodeExtra('wrong', 'a'), new Uint8Array([0x75, 0x70, 9, 0, 1])]) await expect(loadZipArchive(archive([{ name: 'a', centralExtra: extra }]))).rejects.toThrow();
    await expect(loadZipArchive(archive([{ name: 'a', localExtra: unicodeExtra('a', '../a') }]))).rejects.toThrow();
  });
  it('非UTF8名と不正UTF8を拒否', async () => {
    await expect(loadZipArchive(archive([{ name: 'a', rawName: new Uint8Array([0xe3, 0x81]), flags: 0x800 }]))).rejects.toThrow('UTF-8');
    await expect(loadZipArchive(archive([{ name: '日本', flags: 0 }]))).rejects.toThrow('ASCII');
  });
  it('入力・件数・個別・合計サイズの境界を検査', async () => {
    const bytes = archive([{ name: 'a', data: '1234' }, { name: 'b', data: '5678' }]);
    await loadZipArchive(bytes, { compressedBytes: bytes.length, entries: 2, entryBytes: 4, totalBytes: 8 });
    for (const limits of [{ compressedBytes: bytes.length - 1 }, { entries: 1 }, { entryBytes: 3 }, { totalBytes: 7 }]) await expect(loadZipArchive(bytes, limits)).rejects.toThrow('上限');
    for (const limits of [{ entries: ZIP_LIMITS.entries + 1 }, { entryBytes: -1 }, { totalBytes: 1.1 }, { entries: NaN }, { bad: 1 }]) await expect(loadZipArchive(bytes, limits)).rejects.toThrow();
  });
  it('UTF-8のパス全体4096バイト・要素255バイトの境界を検査', async () => {
    await loadZipArchive(archive([{ name: 'a'.repeat(255) }]));
    await loadZipArchive(archive([{ name: '日'.repeat(85) }]));
    await expect(loadZipArchive(archive([{ name: 'a'.repeat(256) }]))).rejects.toThrow('255');
    await expect(loadZipArchive(archive([{ name: '日'.repeat(86) }]))).rejects.toThrow('255');
    const prefix = Array.from({ length: 16 }, () => 'a'.repeat(255)).join('/');
    const exact = prefix.slice(0, -1) + '/x';
    expect(encoder.encode(exact).length).toBe(4096);
    await loadZipArchive(archive([{ name: exact }]));
    await expect(loadZipArchive(archive([{ name: exact + 'x' }]))).rejects.toThrow('4096');
  });
  it('中央entryが少なくても暗黙directoryを含むtree件数を10000に制限', async () => {
    const names = Array.from({ length: 100 }, (_, index) => `root${index}/` + Array.from({ length: 99 }, (_, level) => `d${level}`).join('/'));
    await loadZipArchive(archive(names.map(name => ({ name }))));
    await expect(loadZipArchive(archive([...names.map(name => ({ name })), { name: 'extra/file' }]))).rejects.toThrow('暗黙ディレクトリー');
    // 中央entry上限の試験用overrideは、親directory数と別に扱う。
    await loadZipArchive(archive([{ name: 'PublicDoc/a.xbrl' }]), { entries: 1 });
  });
  it('偽の過小宣言と実展開上限超過をread時に停止', async () => {
    const loaded = await loadZipArchive(archive([{ name: 'a', data: 'x'.repeat(1000), method: 8, declared: 4 }]), { entryBytes: 4, totalBytes: 4 });
    await expect(loaded.readEntry('a')).rejects.toThrow('実展開サイズ');
    await expect(loaded.readEntry('a')).rejects.toThrow('実展開サイズ');
  });
  it('偽の過大宣言、CRC破損をread時に拒否', async () => {
    for (const item of [{ name: 'a', data: 'abc', method: 8, declared: 4 }, { name: 'a', data: 'abc', crc: 123 }]) {
      const loaded = await loadZipArchive(archive([item])); await expect(loaded.readEntry('a')).rejects.toThrow('ZIP:');
    }
  });
  it('local名、flag、圧縮方式、宣言サイズ、offset範囲、重複localを拒否', async () => {
    await expect(loadZipArchive(archive([{ name: 'a', localName: 'b' }]))).rejects.toThrow('ローカル名');
    const bytes = archive([{ name: 'a', data: 'abc' }]);
    for (const altered of [patch(bytes, 6, 0, 2), patch(bytes, 8, 8, 2), patch(bytes, 22, 4), patch(bytes, 0, 0)]) await expect(loadZipArchive(altered)).rejects.toThrow();
    const central = new DataView(bytes.buffer).getUint32(bytes.length - 6, true);
    await expect(loadZipArchive(patch(bytes, central + 42, central))).rejects.toThrow('範囲');
    await expect(loadZipArchive(bytes.subarray(0, 15))).rejects.toThrow();
  });
  it('EOCD偽comment長と中央dir件数/範囲不正を拒否', async () => {
    const bytes = archive([{ name: 'a' }]), end = bytes.length - 22;
    for (const altered of [patch(bytes, end + 20, 1, 2), patch(patch(bytes, end + 8, 0, 2), end + 10, 0, 2), patch(bytes, end + 12, 1)]) await expect(loadZipArchive(altered)).rejects.toThrow();
  });
});

describe('assertDownloadDocId', () => {
  it.each(['doc1', 'S100ABCD', 'a_-9', 'a'.repeat(128)])('有効なID %s', value => expect(() => assertDownloadDocId(value)).not.toThrow());
  it.each(['', '../a', '/a', 'a/b', '-a', 'a b', 'a'.repeat(129), null, 1, '日本', 'unknown', 'UNKNOWN'])('無効なID %s', value => expect(() => assertDownloadDocId(value)).toThrow());
});
