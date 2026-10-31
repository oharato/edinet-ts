import * as fs from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID as cryptoRandomUUID } from 'node:crypto';
import { Database } from './node-sqlite';
import { recoverDedicatedSqliteSnapshot, SQLITE_RECOVERY_MAX_BYTES } from './sqlite-recovery';
import { ParsedFinancialStore } from './parsed-financial-store';
import { ParsedFinancialJob } from './parsed-financial-job';
import { FinancialIndexPublication } from './financial-index-publication';
type Kind = 'parsed-financial-store' | 'parsed-financial-job' | 'financial-index-publication';
function hash(file: string) {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK), h = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
    try {
        const s = fs.fstatSync(fd);
        if (!s.isFile() || s.nlink !== 1)
            throw Error('Recovery requires single-link regular files');
        for (;;) {
            const n = fs.readSync(fd, buffer);
            if (!n)
                break;
            h.update(buffer.subarray(0, n));
        }
        return h.digest('hex');
    }
    finally {
        fs.closeSync(fd);
    }
}
function application(file: string, kind: Kind) {
    if (kind === 'parsed-financial-store') {
        const store = new ParsedFinancialStore(file, { readOnly: true });
        try {
            let afterId: string | undefined;
            for (;;) {
                const page = store.page({ afterId });
                if (page.complete)
                    break;
                afterId = page.nextAfterId;
            }
        }
        finally {
            store.close();
        }
        return;
    }
    const db = new Database(file, { readOnly: true }), table = kind === 'parsed-financial-job' ? 'parsed_job_plans' : 'publication_candidates';
    let reader: ParsedFinancialJob | FinancialIndexPublication | undefined;
    try {
        reader = kind === 'parsed-financial-job' ? new ParsedFinancialJob(file, { readOnly: true }) : new FinancialIndexPublication(file, { readOnly: true });
        const stats = db.prepare(`SELECT count(*) AS n,max(length(CAST(body AS BLOB))) AS bytes FROM ${table}`);
        let count: number;
        try {
            const s = stats.get()!;
            count = Number(s.n);
            if (!Number.isSafeInteger(count) || count > 100000 || Number(s.bytes) > 64 * 1024 * 1024)
                throw Error('Recovery application records exceed bounds');
        }
        finally {
            stats.close();
        }
        const page = db.prepare(`SELECT substr(id,1,257) AS id FROM ${table} WHERE id>? ORDER BY id LIMIT 100`);
        let after = '', seen = 0;
        try {
            for (;;) {
                const rows = page.all(after);
                if (!rows.length)
                    break;
                for (const row of rows) {
                    if (typeof row.id !== 'string' || row.id.length > 256)
                        throw Error('Invalid recovery record ID');
                    if (reader instanceof ParsedFinancialJob)
                        reader.plan(row.id);
                    else
                        reader.candidate(row.id);
                    seen++;
                }
                after = String(rows.at(-1)!.id);
            }
        }
        finally {
            page.close();
        }
        if (seen !== count)
            throw Error('Recovery records are missing');
        if (reader instanceof FinancialIndexPublication) {
            const s = db.prepare('SELECT count(*) AS n,sum(length(CAST(body AS BLOB))) AS bytes FROM publication_history');
            try {
                const row = s.get()!;
                if (Number(row.n) > 100000 || Number(row.bytes) > 64 * 1024 * 1024)
                    throw Error('Recovery publication history exceeds bounds');
            }
            finally {
                s.close();
            }
            reader.history();
        }
    }
    finally {
        reader?.close();
        db.close();
    }
}
/** Caller holds the managed candidate/cache locks. Unknown files are tested only in a private copy. */
export function recoverManagedSqliteJournal(source: string, kind: Kind, backupParent: string) {
    const journal = source + '-journal';
    try {
        fs.lstatSync(journal);
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            return undefined;
        throw error;
    }
    if (source !== resolve(source) || backupParent !== resolve(backupParent) || fs.realpathSync(backupParent) !== backupParent || !['parsed-financial-store', 'parsed-financial-job', 'financial-index-publication'].includes(kind))
        throw Error('Invalid managed recovery target');
    const databaseBytes = fs.lstatSync(source, { bigint: true }).size, journalBytes = fs.lstatSync(journal, { bigint: true }).size;
    if (databaseBytes <= 0n || databaseBytes + journalBytes > BigInt(SQLITE_RECOVERY_MAX_BYTES))
        throw Error('Managed recovery input exceeds bounds');
    const databaseSha256 = hash(source), journalSha256 = hash(journal), reserve = 34n * 1024n ** 3n + 4n * databaseBytes + 3n * journalBytes + 64n * 1024n ** 2n;
    for (const directory of [backupParent, tmpdir()]) {
        const free = fs.statfsSync(directory, { bigint: true });
        if (free.bavail * free.bsize < reserve)
            throw Error('Managed recovery disk reserve');
    }
    const scratch = fs.mkdtempSync(join(tmpdir(), 'edinet-cycle-recovery-'));
    let backup: string | undefined;
    try {
        for (const suffix of ['-wal', '-shm']) {
            try {
                fs.lstatSync(source + suffix);
            }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                    continue;
                throw error;
            }
            throw Error('WAL/SHM are not supported for managed SQLite recovery');
        }
        const mainHeader = Buffer.alloc(100), mainFd = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
            if (fs.readSync(mainFd, mainHeader, 0, 100, 0) !== 100 || !mainHeader.subarray(0, 16).equals(Buffer.from('SQLite format 3\0')) || mainHeader[18] !== 1 || mainHeader[19] !== 1)
                throw Error('Rollback-journal SQLite format required');
        }
        finally {
            fs.closeSync(mainFd);
        }
        const header = Buffer.alloc(8), footer = Buffer.alloc(8), journalFd = fs.openSync(journal, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
            fs.readSync(journalFd, header, 0, 8, 0);
            if (journalBytes >= 8n)
                fs.readSync(journalFd, footer, 0, 8, Number(journalBytes) - 8);
        }
        finally {
            fs.closeSync(journalFd);
        }
        const inactive = header.every(b => b === 0);
        if (inactive && footer.equals(Buffer.from('d9d505f920a163d7', 'hex')))
            throw Error('Super-journals are not supported');
        const proof = inactive ? (() => {
            const file = join(scratch, 'inactive.sqlite');
            fs.copyFileSync(source, file, fs.constants.COPYFILE_EXCL);
            const db = new Database(file, { readOnly: true });
            try {
                db.exec('PRAGMA trusted_schema=OFF');
                const s = db.prepare('PRAGMA integrity_check(1)');
                try {
                    const rows = s.all();
                    if (rows.length !== 1 || rows[0].integrity_check !== 'ok')
                        throw Error('Inactive-journal database is corrupt');
                }
                finally {
                    s.close();
                }
            }
            finally {
                db.close();
            }
            return { recoveryVersion: 'inactive-journal-1', kind, output: { path: file, sha256: hash(file) }, integrityCheck: 'ok', schemaCheck: 'matched', applicationRecordsValidated: false };
        })() : recoverDedicatedSqliteSnapshot({ source, outputDirectory: join(scratch, 'candidate'), kind, databaseSha256, journalSha256 });
        application(proof.output.path, kind);
        if (hash(source) !== databaseSha256 || hash(journal) !== journalSha256 || hash(proof.output.path) !== proof.output.sha256)
            throw Error('Managed recovery inputs changed');
        backup = fs.mkdtempSync(join(backupParent, 'edinet-cycle-recovery-'));
        for (const [original, name] of [[source, 'database.sqlite'], [journal, 'database.sqlite-journal']] as const) {
            const file = join(backup, name);
            fs.copyFileSync(original, file, fs.constants.COPYFILE_EXCL);
            fs.chmodSync(file, 0o600);
            const fd = fs.openSync(file, 'r');
            try {
                fs.fsyncSync(fd);
            }
            finally {
                fs.closeSync(fd);
            }
        }
        if (hash(join(backup, 'database.sqlite')) !== databaseSha256 || hash(join(backup, 'database.sqlite-journal')) !== journalSha256 || hash(source) !== databaseSha256 || hash(journal) !== journalSha256)
            throw Error('Managed recovery backup differs');
        const receipt = { version: 1, node: process.version, source, kind, backup, sourceDatabaseSha256: databaseSha256, sourceJournalSha256: journalSha256, sourceDatabaseBytes: Number(databaseBytes), sourceJournalBytes: Number(journalBytes), proof, applicationRecordsValidated: true };
        const fd = fs.openSync(join(backup, 'validated.json'), 'wx', 0o600);
        try {
            fs.writeFileSync(fd, JSON.stringify(receipt, null, 2));
            fs.fsyncSync(fd);
        }
        finally {
            fs.closeSync(fd);
        }
        for (const folder of [backup, backupParent]) {
            const directory = fs.openSync(folder, 'r');
            try {
                fs.fsyncSync(directory);
            }
            finally {
                fs.closeSync(directory);
            }
        }
        // Let SQLite recover its own journal; never replace a main file while leaving an old journal beside it.
        const db = new Database(source, { timeout: 5000 });
        try {
            db.exec('PRAGMA trusted_schema=OFF');
            if (inactive) {
                db.exec('BEGIN EXCLUSIVE');
                if (hash(source) !== databaseSha256 || fs.existsSync(journal) && hash(journal) !== journalSha256)
                    throw Error('Inactive-journal source changed');
                if (fs.existsSync(journal))
                    fs.unlinkSync(journal);
            }
            const statement = db.prepare('PRAGMA integrity_check(1)');
            try {
                const check = statement.all();
                if (check.length !== 1 || check[0].integrity_check !== 'ok')
                    throw Error('Managed SQLite recovery failed');
            }
            finally {
                statement.close();
            }
            if (inactive)
                db.exec('COMMIT');
        }
        catch (error) {
            if (inactive)
                try {
                    db.exec('ROLLBACK');
                }
                catch { }
            throw error;
        }
        finally {
            db.close();
        }
        if (fs.existsSync(journal) || hash(source) !== proof.output.sha256)
            throw Error('Managed recovery differs from validated private image');
        application(source, kind);
        fs.writeFileSync(join(backup, 'restored.json'), JSON.stringify({ source, sha256: proof.output.sha256, applicationRecordsValidated: true }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        return receipt;
    }
    finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}
/** New managed DBs are initialized off-path, so a killed schema transaction never leaves an empty final DB. */
export function initializeManagedSqlite(source: string, kind: Kind) {
    if (source !== resolve(source) || fs.realpathSync(dirname(source)) !== dirname(source) || !['parsed-financial-store', 'parsed-financial-job', 'financial-index-publication'].includes(kind))
        throw Error('Invalid managed initialization target');
    const constructors = { 'parsed-financial-store': ParsedFinancialStore, 'parsed-financial-job': ParsedFinancialJob, 'financial-index-publication': FinancialIndexPublication }, prefix = basename(source) + '.init-';
    const staged = (name: string) => name.startsWith(prefix) && /^[a-f0-9-]{36}(?:-journal|-wal|-shm)?$/.test(name.slice(prefix.length));
    for (const name of fs.readdirSync(dirname(source)).filter(staged)) {
        const path = join(dirname(source), name), s = fs.lstatSync(path);
        if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1)
            throw Error('Invalid managed initialization remainder');
        fs.rmSync(path);
    }
    const present = () => {
        try {
            fs.lstatSync(source);
            return true;
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                return false;
            throw error;
        }
    };
    if (present())
        return;
    const temporary = source + '.init-' + cryptoRandomUUID();
    try {
        const initialized = new constructors[kind](temporary);
        initialized.close();
        const fd = fs.openSync(temporary, 'r');
        try {
            fs.fsyncSync(fd);
        }
        finally {
            fs.closeSync(fd);
        }
        if (present())
            throw Error('Managed DB appeared during initialization');
        fs.renameSync(temporary, source);
        const directory = fs.openSync(dirname(source), 'r');
        try {
            fs.fsyncSync(directory);
        }
        finally {
            fs.closeSync(directory);
        }
    }
    finally {
        for (const suffix of ['', '-journal', '-wal', '-shm'])
            fs.rmSync(temporary + suffix, { force: true });
    }
}
