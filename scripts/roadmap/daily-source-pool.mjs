import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  lstatSync,
  realpathSync,
  copyFileSync,
  renameSync,
  rmSync,
  readFileSync,
  statSync,
  statfsSync,
  createReadStream,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { ObservedFinancialArchive } from "../../dist/index.js";
import {
  canonical,
  sha256,
  normalFile,
  readJSONSnapshot,
  atomicJSON,
} from "./operational-files.mjs";
import { withOperationalLocks } from "./with-operational-locks.mjs";

const hash = /^[a-f0-9]{64}$/;
const codeHash = () => sha256(readFileSync(fileURLToPath(import.meta.url)));
function directory(path) {
  const s = lstatSync(path);
  if (!s.isDirectory() || s.isSymbolicLink() || realpathSync(path) !== path)
    throw Error("Invalid daily source pool directory");
}
export async function dailySourceFileHash(path, signal) {
  path = normalFile(path);
  for (const suffix of ["-wal", "-shm", "-journal"])
    if (existsSync(path + suffix)) throw Error("Daily source pool input has sidecars");
  const identity = () => {
      const s = lstatSync(normalFile(path), { bigint: true });
      return [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(":");
    },
    before = identity(),
    digest = createHash("sha256");
  for await (const bytes of createReadStream(path, { signal })) digest.update(bytes);
  if (identity() !== before) throw Error("Daily source pool input changed");
  return digest.digest("hex");
}
const RESERVE = 34n * 1024n ** 3n;
// transferSourcesTo bounds decoded raw per batch at256MiB. Another256MiB covers codec/page growth; journal reserves the current pool separately.
const TRANSFER_GROWTH = 512n * 1024n ** 2n;
function space(path, rootExtra = 0n, temporaryExtra = 0n) {
  const volumes = new Map();
  for (const [dir, bytes] of [
    [path, rootExtra],
    [tmpdir(), temporaryExtra],
  ]) {
    const stats = statfsSync(dir, { bigint: true }),
      device = statSync(dir, { bigint: true }).dev;
    const free = stats.bavail * stats.bsize,
      prior = volumes.get(device);
    volumes.set(device, {
      bytes: (prior?.bytes ?? 0n) + bytes,
      free: prior && prior.free < free ? prior.free : free,
    });
  }
  for (const { bytes, free } of volumes.values())
    if (free < RESERVE + bytes) throw Error("Daily source pool disk reserve");
}
/** Count only future allocations: an existing pool is already reflected in current free space. */
export function checkDailySourcePoolSpace(
  path,
  { phase, baseBytes = 0n, sourceBytes = 0n, poolBytes = 0n },
) {
  if (phase === "seed") return space(path, baseBytes, sourceBytes + baseBytes);
  if (phase === "transfer") return space(path, 0n, sourceBytes + poolBytes);
  if (phase === "audit") return space(path, 0n, poolBytes);
  throw Error("Invalid daily source pool disk phase");
}
export function completedDailyCycle(cycle, engine) {
  if (!["sqlite", "duckdb"].includes(engine)) throw Error("Invalid daily completion engine");
  const path = join(
    cycle,
    "candidate",
    engine === "duckdb" ? "duckdb" : "reconstructed",
    "build.json",
  );
  if (!existsSync(path)) return;
  const snapshot = readJSONSnapshot(path),
    r = snapshot.value;
  if (
    (engine === "sqlite" && r.version !== 1) ||
    r.body?.status !== "built" ||
    !hash.test(r.inputSha256) ||
    r.body.inputSha256 !== r.inputSha256 ||
    r.sha256 !== sha256(canonical([r.inputSha256, r.body])) ||
    (engine === "sqlite" &&
      r.body.indexPath !== join(cycle, "candidate/reconstructed/index.sqlite")) ||
    (engine === "duckdb" &&
      (r.body.indexPath !== join(cycle, "candidate/duckdb/index.duckdb") ||
        r.body.archivePath !== join(cycle, "candidate/reconstructed/archive.sqlite")))
  )
    throw Error("Invalid completed daily cycle");
  return snapshot;
}
/** Root and metadata locks are held by the caller. A previous day contributes raw cache only, never its metadata observations. */
export async function prepareDailySourcePool(
  { basePath, baseSha256, previousCycle, engine, origin },
  { signal, maxBatches = 100 } = {},
) {
  if (
    !origin ||
    origin.input !== resolve(origin.input) ||
    !hash.test(origin.inputSha256) ||
    !hash.test(baseSha256) ||
    basePath !== resolve(basePath) ||
    previousCycle !== resolve(previousCycle) ||
    !Number.isSafeInteger(maxBatches) ||
    maxBatches < 1 ||
    maxBatches > 1000
  )
    throw Error("Invalid daily source pool input");
  directory(previousCycle);
  return withOperationalLocks([join(previousCycle, "candidate.lock")], async () => {
    const completion = completedDailyCycle(previousCycle, engine);
    if (!completion) throw Error("Previous daily cycle is incomplete");
    const candidate = join(previousCycle, "candidate"),
      acquisitionPath = join(candidate, "acquisition.json"),
      acquisition = readJSONSnapshot(acquisitionPath),
      a = acquisition.value,
      receipt = a.body?.receipt;
    if (
      a.version !== 1 ||
      !hash.test(a.inputSha256) ||
      a.sha256 !== sha256(canonical([a.inputSha256, a.body])) ||
      receipt?.status !== "acquired" ||
      receipt.inputSha256 !== a.inputSha256 ||
      receipt.archivePath !== join(candidate, "archive.sqlite") ||
      receipt.statePath !== join(candidate, "source-job.sqlite") ||
      !hash.test(receipt.archiveSha256) ||
      receipt.sourceAudit?.finished !== true ||
      receipt.sourceAudit.planSha256 !== receipt.planSha256 ||
      receipt.sourceAudit.archiveSha256 !== receipt.archiveSha256 ||
      !hash.test(receipt.sourceAudit.stateSha256) ||
      !Number.isFinite(Date.parse(receipt.completedAt)) ||
      Date.parse(receipt.completedAt) > Date.now()
    )
      throw Error("Previous daily acquisition differs");
    if (
      (await dailySourceFileHash(basePath, signal)) !== baseSha256 ||
      (await dailySourceFileHash(receipt.archivePath, signal)) !== receipt.archiveSha256 ||
      (await dailySourceFileHash(receipt.statePath, signal)) !== receipt.sourceAudit.stateSha256
    )
      throw Error("Completed daily source fingerprint differs");
    const root = join(previousCycle, "inherited-source-pool"),
      pool = join(root, "archive.sqlite"),
      progressPath = join(root, "progress.json"),
      proofPath = join(root, "proof.json"),
      inputPath = join(root, "input.json");
    const binding = {
        version: 1,
        operationsSha256: codeHash(),
        origin,
        basePath,
        baseSha256,
        previousCycle,
        engine,
        completionSha256: completion.sha256,
        acquisitionSha256: acquisition.sha256,
        archiveSha256: receipt.archiveSha256,
        stateSha256: receipt.sourceAudit.stateSha256,
      },
      bindingSha256 = sha256(canonical(binding));
    if (!existsSync(root)) mkdirSync(root, { mode: 0o700 });
    directory(root);
    if (existsSync(inputPath)) {
      if (canonical(readJSONSnapshot(inputPath).value) !== canonical(binding))
        throw Error("Daily source pool binding differs");
    } else {
      if (existsSync(pool) || existsSync(progressPath) || existsSync(proofPath))
        throw Error("Unowned daily source pool");
      atomicJSON(inputPath, binding, { createOnly: true });
    }
    if (existsSync(proofPath)) {
      const proof = readJSONSnapshot(proofPath);
      if (
        proof.value.kind !== "daily-source-pool-v1" ||
        proof.value.status !== "independently-verified" ||
        proof.value.input !== origin.input ||
        proof.value.inputSha256 !== origin.inputSha256 ||
        proof.value.output !== pool ||
        proof.value.outputSha256 !== proof.value.body?.sha256 ||
        proof.value.bindingSha256 !== bindingSha256 ||
        proof.value.sha256 !== sha256(canonical([bindingSha256, proof.value.body])) ||
        proof.value.body?.status !== "verified" ||
        proof.value.body.path !== pool ||
        (await dailySourceFileHash(pool, signal)) !== proof.value.body.sha256
      )
        throw Error("Daily source pool proof differs");
      return {
        status: "source-pool-ready",
        path: pool,
        sha256: proof.value.body.sha256,
        proofPath,
        proofSha256: proof.sha256,
      };
    }
    if (!existsSync(pool)) {
      checkDailySourcePoolSpace(root, {
        phase: "seed",
        baseBytes: BigInt(statSync(basePath).size),
        sourceBytes: BigInt(statSync(receipt.archivePath).size),
      });
      const temporary = pool + "." + randomUUID() + ".tmp";
      try {
        copyFileSync(basePath, temporary);
        if ((await dailySourceFileHash(temporary, signal)) !== baseSha256)
          throw Error("Daily source seed copy differs");
        renameSync(temporary, pool);
      } finally {
        rmSync(temporary, { force: true });
      }
    }
    let progress = { afterId: undefined, transferred: 0 };
    if (existsSync(progressPath)) {
      const old = readJSONSnapshot(progressPath).value;
      if (
        old.bindingSha256 !== bindingSha256 ||
        old.sha256 !== sha256(canonical([bindingSha256, old.body])) ||
        !Number.isSafeInteger(old.body?.transferred) ||
        old.body.transferred < 0 ||
        (old.body.afterId !== undefined && !hash.test(old.body.afterId))
      )
        throw Error("Daily source pool progress differs");
      progress = old.body;
    } else {
      if ((await dailySourceFileHash(pool, signal)) !== baseSha256)
        throw Error("Unowned daily source pool contents");
      atomicJSON(
        progressPath,
        { bindingSha256, body: progress, sha256: sha256(canonical([bindingSha256, progress])) },
        { createOnly: true },
      );
    }
    let source,
      target,
      complete = progress.complete === true;
    try {
      if (!complete) {
        checkDailySourcePoolSpace(root, {
          phase: "transfer",
          sourceBytes: BigInt(statSync(receipt.archivePath).size),
          poolBytes: BigInt(statSync(pool).size),
        });
        source = new ObservedFinancialArchive(receipt.archivePath, { readOnly: true });
        target = new ObservedFinancialArchive(pool);
      }
      for (let batch = 0; batch < maxBatches && !complete && !signal?.aborted; batch++) {
        // The constructor probe is gone; reserve rollback pages and growth while the source copy remains allocated.
        space(root, BigInt(statSync(pool).size) + TRANSFER_GROWTH);
        const result = source.transferSourcesTo(target, {
          sourceArchiveSha256: receipt.archiveSha256,
          limit: 20,
          ...(progress.afterId ? { afterId: progress.afterId } : {}),
        });
        progress = {
          afterId: result.complete ? undefined : result.nextAfterId,
          transferred: progress.transferred + result.transferredIds.length,
          complete: result.complete,
        };
        atomicJSON(
          progressPath,
          { bindingSha256, body: progress, sha256: sha256(canonical([bindingSha256, progress])) },
          { createOnly: !existsSync(progressPath) },
        );
        if (result.complete) {
          complete = true;
          break;
        }
        await yieldTurn();
      }
    } finally {
      target?.close();
      source?.close();
    }
    if (!complete)
      return {
        status: signal?.aborted ? "aborted" : "source-pool-preparing",
        transferred: progress.transferred,
      };
    // The audit index is a temporary SQLite file, so long-lived cache histories do not grow JS sets.
    const poolSha256 = await dailySourceFileHash(pool, signal),
      merged = new DatabaseSync(pool, { readOnly: true });
    let expected, auditDirectory;
    let sourceDeclarations, contents;
    const headers =
      "SELECT substr(id,1,65) id,substr(doc_id,1,257) doc_id,CASE WHEN typeof(available_ms) IN ('integer','real') THEN CAST(available_ms AS REAL) END available_ms,substr(body,1,2049) body,length(body) body_length,substr(sha256,1,65) sha256 FROM archive_sources";
    const capture = (row) => {
      if (
        !row ||
        !hash.test(row.id) ||
        !hash.test(row.sha256) ||
        typeof row.doc_id !== "string" ||
        row.doc_id.length > 256 ||
        !Number.isSafeInteger(row.available_ms) ||
        typeof row.body !== "string" ||
        row.body_length > 2048 ||
        sha256(row.body) !== row.id ||
        sha256(canonical([row.id, row.body])) !== row.sha256
      )
        throw Error("Inherited source record is invalid");
      let body;
      try {
        body = JSON.parse(row.body);
      } catch {
        throw Error("Inherited source JSON is invalid");
      }
      if (
        body.docID !== row.doc_id ||
        Date.parse(body.availableAt) !== row.available_ms ||
        !hash.test(body.sourceSha256)
      )
        throw Error("Inherited source index differs");
      const { body_length, ...stored } = row;
      return { stored, body };
    };
    try {
      space(root, 0n, 256n * 1024n ** 2n);
      auditDirectory = mkdtempSync(join(tmpdir(), "edinet-daily-source-audit-"));
      expected = new DatabaseSync(join(auditDirectory, "index.sqlite"));
      expected.exec(
        "PRAGMA cache_size=-2048; PRAGMA journal_mode=OFF; PRAGMA temp_store=FILE; CREATE TABLE sources(id TEXT PRIMARY KEY) WITHOUT ROWID; CREATE TABLE raw(sha TEXT PRIMARY KEY) WITHOUT ROWID; CREATE TABLE refs(sha TEXT PRIMARY KEY) WITHOUT ROWID",
      );
      const find = merged.prepare(headers + " WHERE id=?"),
        insertSource = expected.prepare("INSERT OR IGNORE INTO sources VALUES(?)"),
        insertRaw = expected.prepare("INSERT OR IGNORE INTO raw VALUES(?)"),
        insertRef = expected.prepare("INSERT OR IGNORE INTO refs VALUES(?)");
      expected.exec("BEGIN");
      let checked = 0;
      for (const file of [basePath, receipt.archivePath]) {
        const input = new DatabaseSync(file, { readOnly: true });
        try {
          for (const row of input.prepare(headers + " ORDER BY id").iterate()) {
            const source = capture(row),
              target = capture(find.get(row.id));
            if (canonical(source.stored) !== canonical(target.stored))
              throw Error("Inherited source declaration differs");
            insertSource.run(row.id);
            insertRef.run(source.body.sourceSha256);
            if (++checked % 1000 === 0) space(root, 0n, 256n * 1024n ** 2n);
          }
          for (const row of input
            .prepare("SELECT substr(sha256,1,65) sha256 FROM archive_contents")
            .iterate()) {
            if (!hash.test(row.sha256)) throw Error("Invalid inherited raw key");
            insertRaw.run(row.sha256);
            if (++checked % 1000 === 0) space(root, 0n, 256n * 1024n ** 2n);
          }
          if (file === basePath) {
            const output = merged.prepare("SELECT * FROM archive_observations WHERE id=?");
            for (const row of input
              .prepare("SELECT * FROM archive_observations ORDER BY id")
              .iterate())
              if (canonical(output.get(row.id)) !== canonical(row))
                throw Error("Inherited base observation differs");
            if (
              merged.prepare("SELECT COUNT(*) n FROM archive_observations").get().n !==
              input.prepare("SELECT COUNT(*) n FROM archive_observations").get().n
            )
              throw Error("Previous daily observations leaked into pool");
          }
        } finally {
          input.close();
        }
      }
      expected.exec("COMMIT");
      sourceDeclarations = expected.prepare("SELECT COUNT(*) n FROM sources").get().n;
      contents = expected.prepare("SELECT COUNT(*) n FROM raw").get().n;
      if (
        merged.prepare("SELECT COUNT(*) n FROM archive_sources").get().n !== sourceDeclarations ||
        merged.prepare("SELECT COUNT(*) n FROM archive_contents").get().n !== contents ||
        expected
          .prepare(
            "SELECT 1 bad FROM raw LEFT JOIN refs ON raw.sha=refs.sha WHERE refs.sha IS NULL LIMIT 1",
          )
          .get()
      )
        throw Error("Unexpected inherited cache rows");
      checkDailySourcePoolSpace(root, { phase: "audit", poolBytes: BigInt(statSync(pool).size) });
      const verified = new ObservedFinancialArchive(pool, { readOnly: true }),
        hasRaw = expected.prepare("SELECT 1 present FROM raw WHERE sha=?");
      try {
        if (verified.snapshotSha256() !== poolSha256)
          throw Error("Daily source pool changed during validation");
        for (const row of merged.prepare(headers + " ORDER BY id").iterate()) {
          const { body } = capture(row),
            source = verified.readSource(body);
          if (
            hasRaw.get(body.sourceSha256) &&
            (typeof source?.xml !== "string" ||
              sha256(Buffer.from(source.xml, "utf8")) !== body.sourceSha256)
          )
            throw Error("Inherited raw source differs");
        }
      } finally {
        verified.close();
      }
    } finally {
      merged.close();
      expected?.close();
      if (auditDirectory) rmSync(auditDirectory, { recursive: true, force: true });
    }
    if (
      (await dailySourceFileHash(pool, signal)) !== poolSha256 ||
      (await dailySourceFileHash(basePath, signal)) !== baseSha256 ||
      (await dailySourceFileHash(receipt.archivePath, signal)) !== receipt.archiveSha256 ||
      (await dailySourceFileHash(receipt.statePath, signal)) !== receipt.sourceAudit.stateSha256 ||
      readJSONSnapshot(acquisitionPath).sha256 !== acquisition.sha256 ||
      completedDailyCycle(previousCycle, engine)?.sha256 !== completion.sha256
    )
      throw Error("Daily pool inputs changed during transfer");
    const body = {
      status: "verified",
      path: pool,
      sha256: poolSha256,
      sourceDeclarations,
      contents,
      previousObservationsCopied: false,
      availabilityTimesPreserved: true,
      financialValuesValidated: false,
    };
    atomicJSON(
      proofPath,
      {
        version: 1,
        kind: "daily-source-pool-v1",
        status: "independently-verified",
        ...origin,
        output: pool,
        outputSha256: body.sha256,
        bindingSha256,
        body,
        sha256: sha256(canonical([bindingSha256, body])),
      },
      { createOnly: true },
    );
    return {
      status: "source-pool-ready",
      path: pool,
      sha256: body.sha256,
      proofPath,
      proofSha256: readJSONSnapshot(proofPath).sha256,
    };
  }).catch((error) => {
    if (signal?.aborted && error?.name === "AbortError") return { status: "aborted" };
    throw error;
  });
}
