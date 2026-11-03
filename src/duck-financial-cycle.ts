import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { resolve, join, dirname, relative, isAbsolute, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ObservedFinancialArchive } from './db/observed-financial-archive';
import { ParsedFinancialStore, parsedFinancialMappingVersions, parsedFinancialExtractionId } from './db/parsed-financial-store';
import { ParsedFinancialJob, type ParsedFinancialTask } from './db/parsed-financial-job';
import { DuckFinancialIndexBuild } from './db/duck-financial-index-build';
import { DuckFinancialSearchIndex } from './db/duck-financial-search-index';
import { FinancialIndexPublication, type FinancialIndexPublicationCandidate } from './db/financial-index-publication';
import type { FinancialIndexQuality } from './db/financial-search-index';
import { normalizeFinancialIndexBuildInput, type FinancialIndexBuildInput } from './db/financial-index-build';
import { selectDocumentVersions } from './document-version-selection';
import { parseDocumentTimestamp } from './document-timestamp';
import { recoverManagedSqliteJournal, initializeManagedSqlite } from "./db/managed-sqlite-recovery";
import { readRegularFile } from './local-balance-sheet-import';
export interface DuckFinancialCycleInput {
    version: 1;
    archivePath: string;
    parsedStorePath: string;
    outputDirectory: string;
    build: FinancialIndexBuildInput;
}
export interface DuckFinancialBuiltCycle {
    status: 'built';
    inputSha256: string;
    generation: string;
    indexPath: string;
    archivePath: string;
    quality: FinancialIndexQuality;
    publicationCandidate: FinancialIndexPublicationCandidate;
    financialValuesValidated: false;
    metadataCurrentForCutoff: false;
    publicationEligible: false;
    publicationBlockers: string[];
    nextStage: string;
}
export type DuckFinancialCycleResult = DuckFinancialBuiltCycle | {
    status: 'partial' | 'aborted';
    phase: 'parse';
    inputSha256: string;
    progress: Awaited<ReturnType<ParsedFinancialJob['runNext']>>;
} | {
    status: 'partial' | 'aborted';
    phase: 'build';
    inputSha256: string;
    progress: Awaited<ReturnType<DuckFinancialIndexBuild['runNext']>>;
};
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
export function duckFinancialSdkSha256() { const base = dirname(fileURLToPath(import.meta.url)), files = fs.readdirSync(base, { recursive: true }).map(String).filter(p => /\.(?:ts|js|json|py)$/.test(p)).sort(); return hash(canonical([...files.map(p => [p.replaceAll('\\', '/'), hash(fs.readFileSync(join(base, p)))]), ['../package.json', hash(fs.readFileSync(join(dirname(base), 'package.json')))]])); }
function normalized(input: DuckFinancialCycleInput) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['version', 'archivePath', 'parsedStorePath', 'outputDirectory', 'build'].includes(k)) || input.version !== 1 || typeof input.archivePath !== 'string' || typeof input.parsedStorePath !== 'string' || input.parsedStorePath !== resolve(input.parsedStorePath) || input.parsedStorePath === input.archivePath || typeof input.outputDirectory !== 'string' || input.archivePath !== resolve(input.archivePath) || input.outputDirectory !== resolve(input.outputDirectory) || input.archivePath === input.outputDirectory)
        throw Error('Absolute fixed archive and output directory required');
    const plan = normalizeFinancialIndexBuildInput(input.build);
    if (!plan.options.sourceCommit)
        throw Error('Fixed parser source commit required');
    const sdkSha256 = duckFinancialSdkSha256(), build = { id: plan.id, generation: plan.generation, archiveSha256: plan.archiveSha256, population: plan.population, options: { ...plan.options, extractorVersion: `sdk-${sdkSha256}:${hash(plan.options.extractorVersion)}` } };
    normalizeFinancialIndexBuildInput(build);
    return { version: 1 as const, archivePath: input.archivePath, parsedStorePath: input.parsedStorePath, outputDirectory: input.outputDirectory, sdkSha256, requestedExtractorVersion: plan.options.extractorVersion, build };
}
function reserve(directory: string, archivePath: string, parsedPath: string) {
    const bytes = 34n * 1024n ** 3n + fs.statSync(archivePath, { bigint: true }).size + (fs.existsSync(parsedPath) ? fs.statSync(parsedPath, { bigint: true }).size : 0n);
    for (const path of [directory, tmpdir()]) {
        const s = fs.statfsSync(path, { bigint: true });
        if (s.bavail * s.bsize < bytes)
            throw Error('DuckDB financial cycle disk reserve');
    }
}
function save(file: string, value: unknown) {
    const temporary = file + '.' + randomUUID() + '.tmp';
    let fd: number | undefined;
    try {
        fd = fs.openSync(temporary, 'wx', 0o600);
        fs.writeFileSync(fd, canonical(value));
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        if (fs.existsSync(file))
            throw Error('Immutable cycle checkpoint already exists');
        fs.renameSync(temporary, file);
    }
    finally {
        if (fd !== undefined)
            fs.closeSync(fd);
        fs.rmSync(temporary, { force: true });
    }
}
const read = (path: string) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readRegularFile(path, 64 * 1024 * 1024).bytes));
/** Caller holds outputDirectory.lock then parsedStorePath.lock for the entire invocation (CLI uses the existing flock protocol). Never activates a publication. */
export async function buildDuckFinancialCycle(raw: DuckFinancialCycleInput, options: {
    maxDocuments?: number;
    maxCompanies?: number;
    maxBatches?: number;
    signal?: AbortSignal;
} = {}): Promise<DuckFinancialCycleResult> {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => !['maxDocuments', 'maxCompanies', 'maxBatches', 'signal'].includes(k)) || ![options.maxDocuments ?? 20, options.maxCompanies ?? 20, options.maxBatches ?? 1].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 100) || options.signal !== undefined && !(options.signal instanceof AbortSignal))
        throw Error('Invalid DuckDB cycle batch');
    const input = normalized(raw), directory = input.outputDirectory, relativeArchive = relative(directory, input.archivePath);
    if (!(relativeArchive === '..' || relativeArchive.startsWith('..' + sep) || isAbsolute(relativeArchive)))
        throw Error('Archive must be outside the owned output directory');
    for (const path of [input.archivePath, input.parsedStorePath]) {
        const part = relative(directory, path);
        if (!(part === '..' || part.startsWith('..' + sep) || isAbsolute(part)))
            throw Error('Shared inputs must be outside the candidate directory');
    }
    const sdkPart = relative(dirname(fileURLToPath(import.meta.url)), directory);
    if (!(sdkPart === '..' || sdkPart.startsWith('..' + sep) || isAbsolute(sdkPart)))
        throw Error('Output must be outside the SDK tree');
    for (const parent of [dirname(directory), dirname(input.parsedStorePath)])
        if (fs.realpathSync(parent) !== parent)
            throw Error('Canonical output/cache parents required');
    const parent = fs.lstatSync(dirname(directory));
    if (!parent.isDirectory() || parent.isSymbolicLink())
        throw Error('A regular output parent directory is required');
    if (!fs.existsSync(directory))
        fs.mkdirSync(directory, { mode: 0o700 });
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
        throw Error('A private output directory is required');
    const inputPath = join(directory, 'input.json'), parsedPath = input.parsedStorePath, snapshotPath = join(directory, 'parsed-snapshot.sqlite'), jobPath = join(directory, 'parse-job.sqlite'), duckPath = join(directory, 'index.duckdb'), receiptPath = join(directory, 'build.json'), inputSha256 = hash(canonical(input));
    if (fs.existsSync(inputPath)) {
        const saved = read(inputPath);
        if (saved.inputSha256 !== inputSha256 || canonical(saved.input) !== canonical(input))
            throw Error('DuckDB cycle input or SDK differs');
    }
    else {
        if (fs.readdirSync(directory).some(n => !/^input\.json\.[a-f0-9-]{36}\.tmp$/.test(n)))
            throw Error('Unowned DuckDB cycle output directory');
        save(inputPath, { inputSha256, input });
    }
    const bodyFor = (candidate: FinancialIndexPublicationCandidate, quality: FinancialIndexQuality): DuckFinancialBuiltCycle => ({ status: 'built', inputSha256, generation: input.build.generation, indexPath: duckPath, archivePath: input.archivePath, quality, publicationCandidate: candidate, financialValuesValidated: false, metadataCurrentForCutoff: false, publicationEligible: false, publicationBlockers: ['metadata-current-unverified', ...candidate.eligible ? [] : ['quality-conditions'], 'financial-values-unverified'], nextStage: 'metadata-and-value-verification' });
    const allowed = /^(?:input\.json|parsed-snapshot\.sqlite|parse-job\.sqlite(?:-(?:wal|shm|journal)|\.init-[a-f0-9-]{36}(?:-journal|-wal|-shm)?)?|index\.duckdb(?:\.wal)?|publication\.sqlite(?:-(?:wal|shm|journal)|\.init-[a-f0-9-]{36}(?:-journal|-wal|-shm)?)?|build\.json|(?:(?:input|build)\.json|parsed-snapshot\.sqlite)\.[a-f0-9-]{36}\.tmp)$/;
    if (fs.readdirSync(directory).some(n => !allowed.test(n)))
        throw Error('Unknown file in DuckDB cycle output');
    for (const name of fs.readdirSync(directory)) {
        const s = fs.lstatSync(join(directory, name));
        if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1)
            throw Error('Cycle files must be single-link regular files');
    }
    if ((stat.mode & 0o077) !== 0)
        throw Error('Managed output directory must be private');
    for (const name of fs.readdirSync(directory))
        if (/\.[a-f0-9-]{36}\.tmp$/.test(name))
            fs.rmSync(join(directory, name));
    reserve(directory, input.archivePath, fs.existsSync(snapshotPath) ? snapshotPath : parsedPath);
    options.signal?.throwIfAborted();
    const archive = new ObservedFinancialArchive(input.archivePath, { readOnly: true });
    let parsed: ParsedFinancialStore | undefined, job: ParsedFinancialJob | undefined;
    try {
        if (archive.snapshotSha256() !== input.build.archiveSha256)
            throw Error('DuckDB cycle archive differs');
        for (const [file, kind] of [[jobPath, 'parsed-financial-job'], [join(directory, 'publication.sqlite'), 'financial-index-publication']] as const)
            recoverManagedSqliteJournal(file, kind, dirname(directory));
        if (!fs.existsSync(snapshotPath))
            recoverManagedSqliteJournal(parsedPath, 'parsed-financial-store', dirname(directory));
        if (fs.existsSync(receiptPath)) {
            const saved = read(receiptPath);
            if (saved.inputSha256 !== inputSha256 || saved.sha256 !== hash(canonical([inputSha256, saved.body])))
                throw Error('DuckDB cycle receipt differs');
            const check = await DuckFinancialSearchIndex.open(duckPath);
            let catalog: FinancialIndexPublication | undefined;
            try {
                catalog = new FinancialIndexPublication(join(directory, 'publication.sqlite'), { readOnly: true });
                const candidate = catalog.candidate(input.build.generation);
                if (canonical(bodyFor(candidate, await check.quality(input.build.generation))) !== canonical(saved.body))
                    throw Error('Completed DuckDB cycle differs');
            }
            finally {
                await check.close();
                catalog?.close();
            }
            return saved.body as DuckFinancialBuiltCycle;
        }
        if (!fs.existsSync(snapshotPath)) {
            initializeManagedSqlite(parsedPath, 'parsed-financial-store');
            initializeManagedSqlite(jobPath, 'parsed-financial-job');
            parsed = new ParsedFinancialStore(parsedPath);
            job = new ParsedFinancialJob(jobPath);
            const selectedDocIDs = new Set<string>(), tasks = new Map<string, ParsedFinancialTask>();
            for (const edinetCode of input.build.population.edinetCodes) {
                // The archive follows related correction documents across issuers while keeping each selection bounded.
                const selected = selectDocumentVersions(archive.readObservations([edinetCode]), input.build.options.cutoff).selected;
                for (const record of selected)
                    if (record.observation.document.edinetCode === edinetCode)
                        selectedDocIDs.add(record.observation.document.docID);
            }
            for (const docID of selectedDocIDs) {
                let afterId: string | undefined;
                for (;;) {
                    const page = archive.sourceDeclarations(docID, { afterId });
                    for (const source of page.sources) {
                        if (parseDocumentTimestamp(source.availableAt, true)! > parseDocumentTimestamp(input.build.options.cutoff, true)!)
                            continue;
                        const identity = { docID, sourceSha256: source.sourceSha256, extractorVersion: input.build.options.extractorVersion, sourceCommit: input.build.options.sourceCommit!, mappingVersions: parsedFinancialMappingVersions(), detailMetricIds: input.build.options.detailMetricIds }, id = parsedFinancialExtractionId(identity), old = tasks.get(id);
                        if (!old || source.availableAt < old.availableAt)
                            tasks.set(id, { identity, availableAt: source.availableAt });
                    }
                    if (page.complete)
                        break;
                    afterId = page.nextAfterId;
                }
            }
            if (tasks.size) {
                job.begin({ id: input.build.id, archiveSha256: input.build.archiveSha256, tasks: [...tasks.values()] });
                reserve(directory, input.archivePath, parsedPath);
                let result = await job.runNext(input.build.id, archive, parsed, { limit: options.maxDocuments ?? 20, signal: options.signal });
                for (let batch = 1; batch < (options.maxBatches ?? 1) && result.pending && !options.signal?.aborted; batch++) {
                    reserve(directory, input.archivePath, parsedPath);
                    const current = read(inputPath);
                    if (current.inputSha256 !== inputSha256 || canonical(current.input) !== canonical(input) || duckFinancialSdkSha256() !== input.sdkSha256)
                        throw Error('Cycle input or SDK changed between batches');
                    result = await job.runNext(input.build.id, archive, parsed, { limit: options.maxDocuments ?? 20, signal: options.signal });
                }
                if (result.pending || options.signal?.aborted)
                    return { status: options.signal?.aborted ? 'aborted' : 'partial', phase: 'parse', inputSha256, progress: result };
            }
            job.close();
            job = undefined;
            parsed.close();
            parsed = undefined;
            const temporary = snapshotPath + '.' + randomUUID() + '.tmp', before = fs.lstatSync(parsedPath, { bigint: true }), identity = (s: fs.BigIntStats) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':');
            try {
                if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n)
                    throw Error('A normal shared parsed store is required');
                for (const suffix of ['-wal', '-shm', '-journal'])
                    if (fs.existsSync(parsedPath + suffix))
                        throw Error('Shared parsed store must be closed');
                reserve(directory, input.archivePath, parsedPath);
                fs.copyFileSync(parsedPath, temporary, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
                if (identity(before) !== identity(fs.lstatSync(parsedPath, { bigint: true })))
                    throw Error('Shared parsed store changed during snapshot');
                const check = new ParsedFinancialStore(temporary, { readOnly: true });
                check.close();
                options.signal?.throwIfAborted();
                fs.renameSync(temporary, snapshotPath);
            }
            finally {
                fs.rmSync(temporary, { force: true });
            }
        }
        parsed = new ParsedFinancialStore(snapshotPath, { readOnly: true });
        reserve(directory, input.archivePath, snapshotPath);
        options.signal?.throwIfAborted();
        const { DuckDBInstance } = await import('@duckdb/node-api'), scratch = fs.mkdtempSync(join(tmpdir(), 'edinet-duck-build-'));
        let instance: Awaited<ReturnType<typeof DuckDBInstance.create>> | undefined, connection: Awaited<ReturnType<Awaited<ReturnType<typeof DuckDBInstance.create>>['connect']>> | undefined;
        try {
            instance = await DuckDBInstance.create(duckPath, { threads: '1', memory_limit: '512MB', temp_directory: join(scratch, 'spill'), enable_external_access: 'false', autoload_known_extensions: 'false', autoinstall_known_extensions: 'false' });
            connection = await instance.connect();
            const builder = new DuckFinancialIndexBuild(connection);
            await builder.begin(input.build, parsed.snapshotSha256());
            let progress = await builder.runNext(input.build.id, archive, parsed, { limit: options.maxCompanies ?? 20, signal: options.signal });
            for (let batch = 1; batch < (options.maxBatches ?? 1) && progress.pending && !options.signal?.aborted; batch++) {
                reserve(directory, input.archivePath, snapshotPath);
                const current = read(inputPath);
                if (current.inputSha256 !== inputSha256 || canonical(current.input) !== canonical(input) || duckFinancialSdkSha256() !== input.sdkSha256)
                    throw Error('Cycle input or SDK changed between batches');
                progress = await builder.runNext(input.build.id, archive, parsed, { limit: options.maxCompanies ?? 20, signal: options.signal });
            }
            if (progress.pending || options.signal?.aborted)
                return { status: options.signal?.aborted ? 'aborted' : 'partial', phase: 'build', inputSha256, progress };
            await builder.finish(input.build.id);
            await connection.run('CHECKPOINT');
        }
        finally {
            try {
                connection?.closeSync();
            }
            finally {
                try {
                    instance?.closeSync();
                }
                finally {
                    fs.rmSync(scratch, { recursive: true, force: true });
                }
            }
        }
        const reader = await DuckFinancialSearchIndex.open(duckPath);
        let catalog: FinancialIndexPublication | undefined;
        try {
            initializeManagedSqlite(join(directory, 'publication.sqlite'), 'financial-index-publication');
            catalog = new FinancialIndexPublication(join(directory, 'publication.sqlite'));
            const candidate = await catalog.prepareAsync(input.build.generation, reader, input.build.generation), body = bodyFor(candidate, await reader.quality(input.build.generation));
            save(receiptPath, { inputSha256, body, sha256: hash(canonical([inputSha256, body])) });
            return body;
        }
        finally {
            await reader.close();
            catalog?.close();
        }
    }
    finally {
        job?.close();
        parsed?.close();
        archive.close();
    }
}
