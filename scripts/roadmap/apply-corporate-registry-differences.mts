/** 保存済み差分だけを再検証し、検査済み私有DBコピーとcheckpointを再開可能に更新する。通信は常に拒否する。 */
import {
  copyFileSync,
  constants,
  createReadStream,
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  realpathSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { atomicJSON, canonical, normalFile, readJSONSnapshot } from "./operational-files.mjs";
const format = "edinet-ts-corporate-registry-difference-application-v1";
const digest = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
async function fileHash(file: string) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(normalFile(file))) hash.update(bytes);
  return hash.digest("hex");
}
export interface RegistryDifferenceApplication {
  calendarPath: string;
  queryPath: string;
  publicKeyPath: string;
  fingerprint: string;
  collectionPath: string;
  baselineManifestPath: string;
  baselineDbSha256: string;
  dbPath: string;
  checkpointPath: string;
  sdkPath: string;
  runtimeVerifierPath: string;
  runtimeVerifierSha256: string;
  corporateNumber: string;
  maxDays?: number;
}
export async function applyCorporateRegistryDifferences(input: RegistryDifferenceApplication) {
  const config = structuredClone(input),
    maxDays = config.maxDays ?? 1;
  assert(Number.isSafeInteger(maxDays) && maxDays >= 0 && maxDays <= 100, "Invalid day budget");
  assert(digest(config.baselineDbSha256) && /^\d{13}$/.test(config.corporateNumber));
  const paths = [
    config.calendarPath,
    config.queryPath,
    config.publicKeyPath,
    config.collectionPath,
    config.baselineManifestPath,
    config.dbPath,
    config.checkpointPath,
    config.sdkPath,
    config.runtimeVerifierPath,
  ];
  assert(paths.every((p) => typeof p === "string" && resolve(p) === p));
  assert.equal(new Set(paths).size, paths.length, "Job paths must be distinct");
  const stagePath = config.checkpointPath + ".stage.sqlite",
    commitPath = config.checkpointPath + ".commit.json",
    ownerPath = stagePath + ".owner.json";
  const outputs = [config.dbPath, config.checkpointPath, stagePath, commitPath, ownerPath];
  const derived = [
    stagePath,
    commitPath,
    ownerPath,
    ...[config.dbPath, config.checkpointPath, stagePath, commitPath].flatMap((p) => [
      p + ".lock",
      p + "-journal",
      p + "-wal",
      p + "-shm",
    ]),
  ];
  assert.equal(
    new Set([...paths, ...derived]).size,
    paths.length + derived.length,
    "Derived output/input collision",
  );
  const calendarSnapshot = readJSONSnapshot(config.calendarPath);
  const calendarChildren = [
    calendarSnapshot.value.policy.file,
    calendarSnapshot.value.holidays.file,
  ];
  assert(
    calendarChildren.every(
      (p) => typeof p === "string" && resolve(p) === p && realpathSync(dirname(p)) === dirname(p),
    ),
    "Canonical calendar sources required",
  );
  const inputs = [
    ...calendarChildren,
    config.calendarPath,
    config.queryPath,
    config.publicKeyPath,
    config.baselineManifestPath,
    config.sdkPath,
    config.runtimeVerifierPath,
  ];
  assert(
    inputs.every((p) => ![...outputs, ...derived].includes(p)),
    "Calendar/output collision",
  );
  assert(
    inputs.every((p) => !outputs.some((o) => p.startsWith(o + "."))),
    "Atomic output/input collision",
  );
  assert(
    [...inputs, ...outputs, ...derived].every((p) => !p.startsWith(config.collectionPath + "/")),
    "Collection/output collision",
  );
  assert(
    paths.every((p) => realpathSync(dirname(p)) === dirname(p)),
    "Canonical parents required",
  );
  assert.equal(realpathSync(config.collectionPath), config.collectionPath);
  assert(digest(config.runtimeVerifierSha256));
  assert.equal(
    config.sdkPath,
    join(dirname(config.runtimeVerifierPath), "dist/index.js"),
    "SDK must belong to the pinned verifier release",
  );
  const verifyRuntime = async () => {
    assert.equal(
      await fileHash(config.runtimeVerifierPath),
      config.runtimeVerifierSha256,
      "Pinned verifier changed",
    );
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [normalFile(config.runtimeVerifierPath), "--verify"],
      { timeout: 30000, maxBuffer: 1024 ** 2 },
    );
    const result = JSON.parse(stdout);
    assert.equal(result.status, "verified");
    assert.equal(result.networkRequested, false);
  };
  const protectedRuntime = dirname(config.runtimeVerifierPath);
  assert(
    [...outputs, ...derived, config.collectionPath].every(
      (p) => p !== protectedRuntime && !p.startsWith(protectedRuntime + "/"),
    ),
    "Output overlaps pinned runtime",
  );
  await verifyRuntime();
  const operationIdentity = {
    scriptSha256: await fileHash(fileURLToPath(import.meta.url)),
    helpersSha256: await fileHash(
      fileURLToPath(new URL("./operational-files.mjs", import.meta.url)),
    ),
    nodeVersion: process.version,
  };

  assert.equal(
    dirname(config.dbPath),
    dirname(config.checkpointPath),
    "DB/checkpoint must share a private directory",
  );
  assert(!(lstatSync(dirname(config.dbPath)).mode & 0o077), "Private job directory required");
  const sdk = await import(pathToFileURL(normalFile(config.sdkPath)).href),
    extension = extname(config.sdkPath),
    { withOperationalLocks } = await import(
      pathToFileURL(join(dirname(config.sdkPath), "utils/with-operational-locks" + extension)).href
    ),
    { collectRegistryDifferences } = await import(
      pathToFileURL(
        join(dirname(config.sdkPath), "companies/registry/collect-differences" + extension),
      ).href
    );
  return withOperationalLocks(
    [config.dbPath + ".lock", config.checkpointPath + ".lock"],
    async () => {
      const baseline = readJSONSnapshot(config.baselineManifestPath),
        calendar = readJSONSnapshot(config.calendarPath),
        query = readJSONSnapshot(config.queryPath),
        publicKeySha256 = await fileHash(config.publicKeyPath),
        binding = {
          format,
          operationIdentity,
          ...config,
          maxDays: undefined,
          baselineManifestSha256: baseline.sha256,
          calendarSha256: calendar.sha256,
          querySha256: query.sha256,
          publicKeySha256,
          calendarSourceSha256s: await Promise.all(calendarChildren.map(fileHash)),
        },
        stage = config.checkpointPath + ".stage.sqlite",
        commit = config.checkpointPath + ".commit.json";
      assert(
        Array.isArray(baseline.value) && baseline.value.length > 0,
        "Baseline delivery array required",
      );
      assert.equal(calendar.sha256, calendarSnapshot.sha256, "Calendar manifest changed");
      const write = (p: string, value: unknown) =>
        atomicJSON(p, value, { createOnly: !existsSync(p) });
      const checkCalendarSources = async () =>
        assert.deepEqual(
          await Promise.all(calendarChildren.map(fileHash)),
          binding.calendarSourceSha256s,
          "Calendar sources changed",
        );
      const collected = await collectRegistryDifferences(
        config.calendarPath,
        config.queryPath,
        config.publicKeyPath,
        config.fingerprint,
        config.collectionPath,
        0,
        join(dirname(config.sdkPath), "cli" + extension),
        process.execPath,
        () => async () => {
          throw Error("Offline application prohibits network");
        },
      );
      return withOperationalLocks([join(config.collectionPath, ".lock")], async () => {
        const checkApplied = (applied: any[]) => {
          assert.deepEqual(
            applied.map((a: any) => a.date),
            collected.completed.slice(0, applied.length).map((a: any) => a.date),
            "Applied chain changed",
          );
          for (const day of applied) {
            const retained = collected.completed.find((d: any) => d.date === day.date);
            assert.equal(day.sha256, retained?.sha256);
            assert.equal(
              canonical(day.source),
              canonical(retained.source),
              "Applied source changed",
            );
            assert.equal(
              canonical(day.file.source),
              canonical({
                ...retained.source,
                sourceUrl: new URL(retained.source.sourceUrl).href,
                observedAt: new Date(retained.source.observedAt).toISOString(),
              }),
              "Applied stored source changed",
            );
            assert.equal(
              day.file.part,
              "diff_" + day.date.replaceAll("-", "") + ".xml",
              "Applied part changed",
            );
            assert.equal(
              retained.importManifest,
              day.importManifestPath,
              "Applied manifest path changed",
            );
            assert.equal(
              readJSONSnapshot(retained.importManifest).sha256,
              day.importManifestSha256,
              "Applied manifest changed",
            );
          }
        };
        // Prepare-before-rename makes the DB/checkpoint handoff recoverable after either rename.
        if (existsSync(commit)) {
          const prepared = readJSONSnapshot(commit).value;
          assert.equal(
            canonical(prepared.binding),
            canonical(binding),
            "Prepared job inputs changed",
          );
          assert(digest(prepared.before) && digest(prepared.after));
          assert.equal(canonical(prepared.next.binding), canonical(binding));
          assert.equal(prepared.next.dbSha256, prepared.after);
          checkApplied(prepared.next.applied);
          await checkCalendarSources();
          const current = await fileHash(config.dbPath);
          if (current === prepared.before) {
            assert.equal(await fileHash(stage), prepared.after);
            renameSync(stage, config.dbPath);
          } else assert.equal(current, prepared.after, "Database changed during handoff");
          write(config.checkpointPath, prepared.next);
          rmSync(commit);
        }
        let checkpoint = existsSync(config.checkpointPath)
          ? readJSONSnapshot(config.checkpointPath).value
          : undefined;
        if (checkpoint)
          assert.equal(canonical(checkpoint.binding), canonical(binding), "Job inputs changed");
        const before = await fileHash(config.dbPath);
        assert.equal(
          before,
          checkpoint?.dbSha256 ?? config.baselineDbSha256,
          "Database fingerprint changed",
        );
        if (existsSync(ownerPath)) {
          const owner = readJSONSnapshot(ownerPath).value;
          assert.equal(canonical(owner.binding), canonical(binding), "Unknown stage owner");
          if (existsSync(stage)) assert.equal(owner.before, before, "Stage base changed");
        } else
          assert(!existsSync(stage) && !existsSync(stage + "-journal"), "Unknown stage retained");
        if (existsSync(stage)) {
          normalFile(stage);
          rmSync(stage);
        }
        if (existsSync(stage + "-journal")) {
          normalFile(stage + "-journal");
          rmSync(stage + "-journal");
        }
        if (existsSync(ownerPath)) rmSync(ownerPath);
        for (const suffix of ["-journal", "-wal", "-shm"])
          assert(!existsSync(config.dbPath + suffix), "Database has a sidecar");
        const db = new DatabaseSync(normalFile(config.dbPath), { readOnly: true });
        let initialDates: string[];
        try {
          const initialIds = baseline.value.flatMap((m: any) => m.fileIds);
          assert(initialIds.every(digest) && new Set(initialIds).size === initialIds.length);
          const allIds = db
            .prepare("SELECT id FROM block_files ORDER BY id")
            .all()
            .map((r) => r.id);
          const expectedIds = [
            ...initialIds,
            ...(checkpoint?.applied ?? []).map((d: any) => d.file.id),
          ].sort();
          assert.deepEqual(allIds, expectedIds, "Database contains undeclared files");
          initialDates = baseline.value.map((m: any, index: number) => {
            assert.equal(m.scope, "national");
            assert.equal(m.fileIds.length, m.expectedParts);
            const sources = m.fileIds.map(
              (id: string) =>
                JSON.parse(
                  db.prepare("SELECT body FROM block_files WHERE id=?").get(id)!.body as string,
                ).source,
            );
            assert(
              sources.every(
                (s: any) =>
                  s.kind === (index === 0 ? "full" : "diff") &&
                  s.dataDate === sources[0].dataDate &&
                  s.purpose === "download",
              ),
            );
            return sources[0].dataDate;
          });
        } finally {
          db.close();
        }
        assert(initialDates.every((date, i) => i === 0 || date > initialDates[i - 1]));
        const nextDate = new Date(Date.parse(initialDates.at(-1)! + "T00:00:00Z") + 86400000)
          .toISOString()
          .slice(0, 10);
        assert.equal(
          query.value.from,
          nextDate,
          "Collection must start immediately after the declared chain",
        );
        const applied = checkpoint?.applied ?? [];
        checkApplied(applied);
        const pending = collected.completed.slice(applied.length),
          selected = pending.slice(0, maxDays);
        if (!selected.length)
          return {
            status: collected.status === "complete" && !pending.length ? "complete" : "pending",
            appliedThisRun: 0,
            networkRequests: 0,
            checkpoint: checkpoint ?? null,
          };
        const space = (rootExtra: bigint, temporaryExtra: bigint) => {
          const volumes = new Map<bigint, { free: bigint; bytes: bigint }>();
          for (const [dir, bytes] of [
            [dirname(config.dbPath), rootExtra],
            [tmpdir(), temporaryExtra],
          ] as const) {
            const stats = statfsSync(dir, { bigint: true }),
              device = statSync(dir, { bigint: true }).dev,
              free = stats.bavail * stats.bsize,
              prior = volumes.get(device);
            volumes.set(device, {
              free: prior && prior.free < free ? prior.free : free,
              bytes: (prior?.bytes ?? 0n) + bytes,
            });
          }
          for (const { free, bytes } of volumes.values())
            assert(
              free > 34n * 1024n ** 3n + bytes + 64n * 1024n ** 2n,
              "Capacity reserve reached",
            );
        };
        const limit = BigInt(sdk.CORPORATE_REGISTRY_BLOCK_MAX_DB_BYTES);
        // The constructor probe is gone before import journal growth can begin.
        space(limit, limit);
        space(2n * limit, 0n);
        write(ownerPath, { binding, before });
        copyFileSync(config.dbPath, stage, constants.COPYFILE_EXCL);
        let store: any,
          reader: any,
          prepared = false;
        try {
          assert.equal(await fileHash(stage), before);
          space(0n, limit);
          store = new sdk.CorporateRegistryBlockStore(stage);
          const nextApplied = [...applied],
            partSnapshots: { path: string; sha256: string; file: string; sourceSha256: string }[] =
              [];
          for (const day of selected) {
            space(limit, 0n);
            assert(
              day.importManifest.startsWith(
                config.collectionPath + "/days/" + day.date + "/attempt-",
              ) && /\/attempt-\d{4}\/verified\/part-000-import\.json$/.test(day.importManifest),
              "Part outside retained collection",
            );
            const snapshot = readJSONSnapshot(day.importManifest),
              part = snapshot.value;
            const expected = {
              file: join(dirname(day.importManifest), "part-000.xml"),
              sha256: day.sha256,
              source: day.source,
              part: "diff_" + day.date.replaceAll("-", "") + ".xml",
            };
            assert.equal(canonical(part), canonical(expected), "Reverified part/source changed");
            partSnapshots.push({
              path: day.importManifest,
              sha256: snapshot.sha256,
              file: part.file,
              sourceSha256: part.sha256,
            });
            assert.equal(part.sha256, day.sha256);
            assert.equal(part.source.dataDate, day.date);
            const result = await store.importFile(part);
            nextApplied.push({
              date: day.date,
              sha256: day.sha256,
              file: result.file,
              source: part.source,
              importManifestPath: day.importManifest,
              importManifestSha256: snapshot.sha256,
            });
          }
          store.close();
          store = undefined;
          const manifests = [
            ...baseline.value,
            ...nextApplied.map((d: any) => ({
              scope: "national",
              expectedParts: 1,
              fileIds: [d.file.id],
            })),
          ];
          // All-record audit and calendar continuity remain mandatory before the stage can replace the DB.
          space(0n, limit);
          reader = new sdk.CorporateRegistryBlockStore(stage, { readOnly: true });
          const cm = calendar.value,
            inputCalendar = {
              policy: {
                sourceUrl: cm.policy.sourceUrl,
                observedAt: cm.policy.observedAt,
                html: readFileSync(cm.policy.file, "utf8"),
              },
              holidays: {
                sourceUrl: cm.holidays.sourceUrl,
                observedAt: cm.holidays.observedAt,
                csv: new TextDecoder("shift_jis", { fatal: true }).decode(
                  (await import("node:fs")).readFileSync(cm.holidays.file),
                ),
              },
            };
          const { holidays: _holidays, ...calendarMetadata } =
            sdk.parseCorporateRegistryPublicationCalendar(inputCalendar);
          assert.equal(
            canonical(calendarMetadata),
            canonical(collected.calendar),
            "Calendar content changed",
          );
          const verification = reader.reconstruct(
            manifests,
            {
              corporateNumber: config.corporateNumber,
              asOf: nextApplied.at(-1).date,
              knownAt: new Date().toISOString(),
              registryPurpose: "download",
            },
            inputCalendar,
          );
          assert(
            verification &&
              ["available", "deleted", "unavailable", "unresolved"].includes(
                verification.selection?.status,
              ) &&
              verification.storage?.verification === "all-records",
            "Invalid SDK verification response",
          );
          assert.notEqual(
            verification.selection.status,
            "unresolved",
            "Delivery chain did not resolve",
          );
          assert.equal(
            verification.coverage?.through,
            nextApplied.at(-1).date,
            "Incomplete verified coverage",
          );
          reader.close();
          reader = undefined;
          const after = await fileHash(stage),
            next = {
              binding,
              dbSha256: after,
              applied: nextApplied,
              manifests,
              verification,
              status:
                collected.status === "complete" && selected.length === pending.length
                  ? "complete"
                  : "pending",
            };
          assert.equal(await fileHash(config.dbPath), before);
          assert.equal(readJSONSnapshot(config.baselineManifestPath).sha256, baseline.sha256);
          assert.equal(readJSONSnapshot(config.calendarPath).sha256, calendar.sha256);
          assert.equal(readJSONSnapshot(config.queryPath).sha256, query.sha256);
          assert.equal(await fileHash(config.publicKeyPath), publicKeySha256);
          for (const part of partSnapshots) {
            assert.equal(readJSONSnapshot(part.path).sha256, part.sha256, "Part manifest changed");
            assert.equal(await fileHash(part.file), part.sourceSha256, "Part original changed");
          }
          await verifyRuntime();
          assert.equal(
            await fileHash(fileURLToPath(import.meta.url)),
            operationIdentity.scriptSha256,
            "Operation changed",
          );
          assert.equal(
            await fileHash(fileURLToPath(new URL("./operational-files.mjs", import.meta.url))),
            operationIdentity.helpersSha256,
            "Operations helper changed",
          );
          const fd = openSync(normalFile(stage), constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            fsyncSync(fd);
          } finally {
            closeSync(fd);
          }
          await checkCalendarSources();
          write(commit, { binding, before, after, next });
          prepared = true;
          renameSync(stage, config.dbPath);
          write(config.checkpointPath, next);
          rmSync(commit);
          rmSync(ownerPath);
          return {
            status: next.status,
            appliedThisRun: selected.length,
            networkRequests: 0,
            checkpoint: next,
          };
        } finally {
          reader?.close();
          store?.close();
          if (!prepared) {
            rmSync(stage, { force: true });
            rmSync(stage + "-journal", { force: true });
            rmSync(ownerPath, { force: true });
          }
        }
      });
    },
  );
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const names = [
      "calendar",
      "query",
      "public-key",
      "fingerprint",
      "collection",
      "baseline-manifest",
      "baseline-db-sha256",
      "db",
      "checkpoint",
      "sdk",
      "runtime-verifier",
      "runtime-verifier-sha256",
      "corporate-number",
      "max-days",
    ] as const;
    const options = Object.fromEntries(names.map((key) => [key, { type: "string" }])) as Record<
      (typeof names)[number],
      { type: "string" }
    >;
    const { values } = parseArgs({ options });
    const required = (key: (typeof names)[number]) => {
      const value = values[key];
      assert(typeof value === "string", "Missing --" + key);
      return value;
    };
    assert(
      values["max-days"] === undefined || /^\d+$/.test(values["max-days"]),
      "Invalid --max-days",
    );
    console.log(
      JSON.stringify(
        await applyCorporateRegistryDifferences({
          calendarPath: required("calendar"),
          queryPath: required("query"),
          publicKeyPath: required("public-key"),
          fingerprint: required("fingerprint"),
          collectionPath: required("collection"),
          baselineManifestPath: required("baseline-manifest"),
          baselineDbSha256: required("baseline-db-sha256"),
          dbPath: required("db"),
          checkpointPath: required("checkpoint"),
          sdkPath: required("sdk"),
          runtimeVerifierPath: required("runtime-verifier"),
          runtimeVerifierSha256: required("runtime-verifier-sha256"),
          corporateNumber: required("corporate-number"),
          maxDays: values["max-days"] === undefined ? 1 : Number(values["max-days"]),
        }),
      ),
    );
  } catch (error) {
    console.error("Corporate registry difference application failed.");
    process.exitCode =
      error && typeof error === "object" && "exitCode" in error && error.exitCode === 75 ? 75 : 1;
  }
}
