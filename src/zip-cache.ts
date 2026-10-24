import * as fs from "node:fs";
import * as path from "node:path";
import { assertDownloadDocId, ZIP_LIMITS, type LoadedZipArchive } from "./zip-archive";
export { assertDownloadDocId } from "./zip-archive";

const entryLimit = ZIP_LIMITS.entries, fileLimit = ZIP_LIMITS.entryBytes, totalLimit = ZIP_LIMITS.totalBytes;
const lstat = (file: string): fs.Stats | undefined => {
    try { return fs.lstatSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
};
/** resolveはsymlinkを解決しません。既存の祖先を一つずつlstatします。 */
function directory(rootDir: string, create: boolean): string | null {
    if (typeof rootDir !== "string" || !rootDir.trim() || rootDir.includes("\0")) throw new Error("通常ディレクトリのrootDirが必要です");
    const root = path.resolve(rootDir), parsed = path.parse(root);
    let current = parsed.root;
    for (const component of root.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
        current = path.join(current, component);
        let stat = lstat(current);
        if (!stat) {
            if (!create) return null;
            try { fs.mkdirSync(current, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
            stat = lstat(current);
        }
        if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("rootDirと祖先にはsymlinkでない通常ディレクトリが必要です");
    }
    return root;
}
function regularXbrl(file: string, stat: fs.Stats): void {
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > fileLimit) throw new Error("XBRLキャッシュは空でない64MiB以下の通常ファイルが必要です");
}

/** 指定書類のtreeだけを全件検査します。壊れた既存cacheを取得失敗と混同しません。 */
export function findCachedXbrl(rootDir: string, docId: string): string | null {
    assertDownloadDocId(docId);
    const root = directory(rootDir, false);
    if (root === null) return null;
    const target = path.join(root, docId), targetStat = lstat(target);
    if (!targetStat) return null;
    if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) throw new Error("書類cacheは通常ディレクトリが必要です");
    const directories = [target], candidates: string[] = [];
    let entries = 0;
    while (directories.length) {
        const dir = directories.pop()!;
        for (const name of fs.readdirSync(dir)) {
            if (++entries > entryLimit) throw new Error("cachetreeは10000項目までです");
            const file = path.join(dir, name), stat = fs.lstatSync(file);
            if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) throw new Error("cachetreeにsymlinkや特殊ファイルは使えません");
            if (stat.isDirectory()) {
                if (name.endsWith(".xbrl")) throw new Error(".xbrlは通常ファイルだけです");
                directories.push(file);
            } else if (name.endsWith(".xbrl")) { regularXbrl(file, stat); candidates.push(file); }
        }
    }
    if (!candidates.length) throw new Error("既存書類cacheにXBRLがありません。既存ディレクトリは上書きしません");
    candidates.sort((left, right) => {
        const l = path.relative(target, left).split(path.sep).join("/"), r = path.relative(target, right).split(path.sep).join("/");
        return Number(r.split("/").includes("PublicDoc")) - Number(l.split("/").includes("PublicDoc")) || (l < r ? -1 : l > r ? 1 : 0);
    });
    return candidates[0];
}

const identity = (stat: fs.BigIntStats): string => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
/** UTF-8を厳密に読むNode専用入口。BOMを含む元文字列を保持します。 */
export function readCachedXbrl(file: string): string {
    if (typeof file !== "string" || !file.endsWith(".xbrl")) throw new Error("既存XBRLの通常ファイルが必要です");
    const target = path.resolve(file);
    if (directory(path.dirname(target), false) === null) throw new Error("既存XBRLの通常ファイルが必要です");
    const stat = lstat(target);
    if (!stat) throw new Error("XBRLキャッシュがありません");
    regularXbrl(target, stat);
    const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (fs.constants.O_NOFOLLOW ?? 0));
    try {
        const before = fs.fstatSync(fd, { bigint: true });
        if (!before.isFile() || before.size === 0n || before.size > BigInt(fileLimit)) throw new Error("XBRLキャッシュのファイル種別/容量が不正です");
        const bytes = Buffer.alloc(Number(before.size) + 1);
        let length = 0;
        while (length < bytes.length) { const n = fs.readSync(fd, bytes, length, bytes.length - length, null); if (!n) break; length += n; }
        if (length !== Number(before.size) || identity(before) !== identity(fs.fstatSync(fd, { bigint: true })) ||
            identity(before) !== identity(fs.lstatSync(target, { bigint: true }))) throw new Error("読取中にXBRLキャッシュが変化しました");
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length));
    } finally { fs.closeSync(fd); }
}

interface Entry { name: string; dir: boolean; compressedSize: number; uncompressedSize: number; parts: string[]; }
/** loader以外が作ったstructural objectも保存境界で再検査します。 */
function archiveEntries(archive: LoadedZipArchive, xbrlName: string): Entry[] {
    const sourceEntries = archive?.entries;
    if (!Array.isArray(sourceEntries) || sourceEntries.length > entryLimit || typeof xbrlName !== "string") throw new Error("不正なZIP保存入力です");
    const entries: Entry[] = [], explicit = new Set<string>(), tree = new Map<string, { original: string; dir: boolean }>();
    let total = 0, compressed = 0;
    for (const entry of sourceEntries) {
        if (!entry) throw new Error("不正なZIP項目です");
        const { name, dir, compressedSize, uncompressedSize } = entry;
        if (typeof name !== "string" || typeof dir !== "boolean" || !Number.isSafeInteger(compressedSize) || compressedSize < 0 ||
            !Number.isSafeInteger(uncompressedSize) || uncompressedSize < 0 || uncompressedSize > fileLimit || dir && uncompressedSize !== 0) throw new Error("不正なZIP項目/容量です");
        const clean = dir && name.endsWith("/") ? name.slice(0, -1) : name;
        const parts = clean.split("/");
        if (!clean || name.length > 4096 || /[\\:<>"|?*\x00-\x1f\x7f-\x9f]/.test(name) || parts.some(part => !part || part === "." || part === ".." || /[. ]$/.test(part) ||
            /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?: *\.|$)/i.test(part)) || clean.endsWith(".xbrl") && (dir || uncompressedSize === 0)) throw new Error("安全でないZIP保存パスです");
        const key = clean.normalize("NFC").toLowerCase();
        if (explicit.has(key)) throw new Error("ZIP保存パスが重複しています");
        explicit.add(key);
        for (let i = 1; i <= parts.length; i++) {
            const original = parts.slice(0, i).join("/"), nodeKey = original.normalize("NFC").toLowerCase(), nodeDir = i < parts.length || dir, previous = tree.get(nodeKey);
            if (previous && (previous.original !== original || previous.dir !== nodeDir)) throw new Error("ZIP保存パスのfile/dirまたは文字表記が衝突しています");
            tree.set(nodeKey, { original, dir: nodeDir });
            if (tree.size > entryLimit) throw new Error("展開treeは10000項目までです");
        }
        total += uncompressedSize; compressed += compressedSize;
        if (total > totalLimit || compressed > ZIP_LIMITS.compressedBytes) throw new Error("ZIP保存合計容量が上限を超えます");
        entries.push({ name, dir, compressedSize, uncompressedSize, parts });
    }
    const chosen = entries.find(entry => entry.name === xbrlName && !entry.dir && entry.name.endsWith(".xbrl"));
    if (!chosen || chosen.uncompressedSize === 0) throw new Error("保存するXBRL項目がありません");
    return entries;
}

/** 協調lockと私有stagingで公開。既存docDirは空であっても置換しません。 */
export async function persistZipArchive(rootDir: string, docId: string, archive: LoadedZipArchive, xbrlName: string): Promise<string> {
    assertDownloadDocId(docId);
    const readEntry = archive?.readEntry;
    if (typeof readEntry !== "function") throw new Error("ZIP項目の読取関数が必要です");
    const entries = archiveEntries(archive, xbrlName), root = directory(rootDir, true)!;
    const target = path.join(root, docId), lock = path.join(root, `.${docId}.lock`);
    let lockFd: number | undefined, staging: string | undefined;
    try {
        lockFd = fs.openSync(lock, "wx", 0o600);
        if (lstat(target)) throw new Error("既存書類cacheは上書きしません");
        staging = fs.mkdtempSync(path.join(root, `.${docId}.staging-`));
        fs.chmodSync(staging, 0o700);
        for (const entry of entries) {
            const output = path.join(staging, ...entry.parts);
            const bytes = await readEntry.call(archive, entry.name);
            if (!(bytes instanceof Uint8Array) || bytes.byteLength !== entry.uncompressedSize || bytes.byteLength > fileLimit) throw new Error("ZIP項目の実展開サイズが一致しません");
            if (entry.dir) { fs.mkdirSync(output, { recursive: true, mode: 0o700 }); continue; }
            fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
            const fd = fs.openSync(output, "wx", 0o600);
            try { fs.writeFileSync(fd, bytes); } finally { fs.closeSync(fd); }
        }
        if (lstat(target)) throw new Error("公開前に書類cacheが作成されました。上書きしません");
        fs.renameSync(staging, target); staging = undefined;
        return path.join(target, ...entries.find(entry => entry.name === xbrlName)!.parts);
    } finally {
        try { if (staging) fs.rmSync(staging, { recursive: true, force: true }); }
        finally { if (lockFd !== undefined) { try { fs.closeSync(lockFd); } finally { fs.unlinkSync(lock); } } }
    }
}
