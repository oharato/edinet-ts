/** 公表1日ずつ取得・検査し、受理履歴と現在DBのpointerを分けて更新する。 */
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, spawnSync, execFile } from "node:child_process";
import { promisify, parseArgs } from "node:util";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { atomicJSON, canonical, normalFile, readJSONSnapshot } from "./operational-files.mjs";
import { resolveSdkModules, type ResolvedSdkLayout } from "./resolve-sdk-module.mts";
const FORMAT = "edinet-ts-corporate-registry-daily-v1",
  HERE = fileURLToPath(import.meta.url),
  RESERVE = 34n * 1024n ** 3n,
  MARGIN = 64n * 1024n ** 2n,
  DEADLINE = 1200000;
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const hash = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
async function fileHash(file: string) {
  const before = fs.statSync(normalFile(file), { bigint: true }),
    h = createHash("sha256");
  for await (const b of fs.createReadStream(file)) h.update(b);
  const after = fs.statSync(normalFile(file), { bigint: true });
  assert.equal(
    [before.dev, before.ino, before.size, before.mtimeNs, before.ctimeNs].join(":"),
    [after.dev, after.ino, after.size, after.mtimeNs, after.ctimeNs].join(":"),
    "Input changed",
  );
  return h.digest("hex");
}
const snapshot = (p: string) => {
  const s = readJSONSnapshot(p);
  assert(Buffer.byteLength(s.text) <= 16 * 1024 ** 2, "Control JSON limit");
  return s;
};
const write = (p: string, v: unknown) => atomicJSON(p, v, { createOnly: !fs.existsSync(p) });
const create = (p: string, v: unknown) => atomicJSON(p, v, { createOnly: true });
function date(v: unknown): asserts v is string {
  assert(
    typeof v === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v,
    "Invalid date",
  );
}
const addDate = (v: string, n: number) =>
  new Date(Date.parse(v + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
function directory(p: string) {
  const s = fs.lstatSync(p);
  assert(
    s.isDirectory() && !s.isSymbolicLink() && fs.realpathSync(p) === p && !(s.mode & 0o077),
    "Private canonical directory required",
  );
}
const absolute = (p: unknown): p is string =>
  typeof p === "string" &&
  path.resolve(p) === p &&
  fs.realpathSync(path.dirname(p)) === path.dirname(p);
export interface CorporateRegistryDailyConfig {
  format: typeof FORMAT;
  root: string;
  calendarPath: string;
  publicKeyPath: string;
  fingerprint: string;
  sdkPath: string;
  runtimeVerifierPath: string;
  runtimeVerifierSha256: string;
  applyScriptPath: string;
  applyScriptSha256: string;
  metadataDeploymentPath: string;
  probeCorporateNumber: string;
  networkEnabled: boolean;
}
export interface CorporateRegistryDailyOptions {
  targetThrough?: string;
  acquire?: boolean;
}
async function load(configPath: string) {
  assert(absolute(configPath));
  const s = snapshot(configPath),
    c = s.value as CorporateRegistryDailyConfig;
  const keys = [
    "format",
    "root",
    "calendarPath",
    "publicKeyPath",
    "fingerprint",
    "sdkPath",
    "runtimeVerifierPath",
    "runtimeVerifierSha256",
    "applyScriptPath",
    "applyScriptSha256",
    "metadataDeploymentPath",
    "probeCorporateNumber",
    "networkEnabled",
  ];
  assert(
    c &&
      typeof c === "object" &&
      Object.keys(c).sort().join() === keys.sort().join() &&
      c.format === FORMAT,
    "Invalid daily config",
  );
  for (const k of [
    "root",
    "calendarPath",
    "publicKeyPath",
    "sdkPath",
    "runtimeVerifierPath",
    "applyScriptPath",
    "metadataDeploymentPath",
  ] as const)
    assert(absolute(c[k]));
  directory(c.root);
  assert(
    typeof c.networkEnabled === "boolean" &&
      /^[A-Fa-f0-9]{40}(?:[A-Fa-f0-9]{24})?$/.test(c.fingerprint) &&
      /^\d{13}$/.test(c.probeCorporateNumber),
  );
  assert(digest(c.runtimeVerifierSha256) && digest(c.applyScriptSha256));
  assert.equal(c.sdkPath, path.join(path.dirname(c.runtimeVerifierPath), "dist/index.js"));
  assert.equal(await fileHash(c.applyScriptPath), c.applyScriptSha256, "Apply operation changed");
  const calendar = snapshot(c.calendarPath);
  for (const p of [calendar.value.policy.file, calendar.value.holidays.file]) {
    assert(absolute(p));
    assert(fs.statSync(normalFile(p)).size <= 1024 ** 2, "Calendar source limit");
  }
  assert(fs.statSync(normalFile(c.publicKeyPath)).size <= 1024 ** 2, "Public key limit");
  const inputs = [
    configPath,
    c.calendarPath,
    calendar.value.policy.file,
    calendar.value.holidays.file,
    c.publicKeyPath,
    c.sdkPath,
    c.runtimeVerifierPath,
    c.applyScriptPath,
    path.join(path.dirname(c.applyScriptPath), "operational-files.mjs"),
    path.join(path.dirname(c.applyScriptPath), "resolve-sdk-module.mts"),
    path.join(path.dirname(HERE), "resolve-sdk-module.mts"),
    c.metadataDeploymentPath,
    HERE,
  ];
  const controls = ["current.sqlite", "current.json", "pending.json", ".daily.lock"].map((p) =>
      path.join(c.root, p),
    ),
    jobs = path.join(c.root, "jobs");
  for (const p of inputs) {
    assert(
      !controls.some((o) => p === o || p.startsWith(o + ".") || p.startsWith(o + "-")) &&
        !p.startsWith(jobs + "/") &&
        !(path.dirname(p) === c.root && path.basename(p).startsWith("apply-")),
      "Input/output collision",
    );
    normalFile(p);
  }
  const runtime = path.dirname(c.runtimeVerifierPath);
  assert(c.root !== runtime && !c.root.startsWith(runtime + "/"), "Output/runtime collision");
  const identity = {
    configSha256: s.sha256,
    wrapperSha256: await fileHash(HERE),
    applySha256: c.applyScriptSha256,
    helperSha256: await fileHash(path.join(path.dirname(HERE), "operational-files.mjs")),
    applyHelperSha256: await fileHash(
      path.join(path.dirname(c.applyScriptPath), "operational-files.mjs"),
    ),
    resolverSha256: await fileHash(path.join(path.dirname(HERE), "resolve-sdk-module.mts")),
    applyResolverSha256: await fileHash(
      path.join(path.dirname(c.applyScriptPath), "resolve-sdk-module.mts"),
    ),
    nodeVersion: process.version,
    calendarManifestSha256: calendar.sha256,
    calendarSources: await Promise.all(
      [calendar.value.policy.file, calendar.value.holidays.file].map(async (p) => ({
        path: p,
        sha256: await fileHash(p),
      })),
    ),
    publicKeySha256: await fileHash(c.publicKeyPath),
  };
  const requestedModules = [
    "withOperationalLocks",
    "collectRegistryDifferences",
    "createRegistrySession",
  ] as const;
  let resolvedLayout: ResolvedSdkLayout | undefined;
  const verify = async () => {
    assert.equal(snapshot(configPath).sha256, identity.configSha256, "Config changed");
    assert.equal(await fileHash(HERE), identity.wrapperSha256);
    assert.equal(await fileHash(c.applyScriptPath), identity.applySha256);
    assert.equal(
      await fileHash(path.join(path.dirname(HERE), "operational-files.mjs")),
      identity.helperSha256,
    );
    assert.equal(
      await fileHash(path.join(path.dirname(c.applyScriptPath), "operational-files.mjs")),
      identity.applyHelperSha256,
      "Apply helper changed",
    );
    assert.equal(snapshot(c.calendarPath).sha256, identity.calendarManifestSha256);
    for (const p of identity.calendarSources)
      assert.equal(await fileHash(p.path), p.sha256, "Calendar changed");
    assert.equal(await fileHash(c.publicKeyPath), identity.publicKeySha256);
    assert.equal(
      await fileHash(path.join(path.dirname(HERE), "resolve-sdk-module.mts")),
      identity.resolverSha256,
      "SDK resolver changed",
    );
    assert.equal(
      await fileHash(path.join(path.dirname(c.applyScriptPath), "resolve-sdk-module.mts")),
      identity.applyResolverSha256,
      "Apply SDK resolver changed",
    );
    assert.equal(await fileHash(c.runtimeVerifierPath), c.runtimeVerifierSha256);
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [c.runtimeVerifierPath, "--verify"],
      { timeout: 30000, maxBuffer: 1024 ** 2 },
    );
    const r = JSON.parse(stdout);
    assert(r.status === "verified" && r.networkRequested === false, "Runtime verification failed");
    if (resolvedLayout)
      assert.equal(
        canonical(resolveSdkModules(c.sdkPath, requestedModules)),
        canonical(resolvedLayout),
        "SDK layout changed",
      );
  };
  await verify();
  const sdkModules = resolveSdkModules(c.sdkPath, requestedModules);
  resolvedLayout = sdkModules;
  const sdk = await import(pathToFileURL(c.sdkPath).href);
  return {
    c,
    identity: { ...identity, sdkLayout: sdkModules },
    sdkModules,
    verify,
    sdk,
    calendar: {
      policy: {
        sourceUrl: calendar.value.policy.sourceUrl,
        observedAt: calendar.value.policy.observedAt,
        html: fs.readFileSync(calendar.value.policy.file, "utf8"),
      },
      holidays: {
        sourceUrl: calendar.value.holidays.sourceUrl,
        observedAt: calendar.value.holidays.observedAt,
        csv: new TextDecoder("shift_jis", { fatal: true }).decode(
          fs.readFileSync(calendar.value.holidays.file),
        ),
      },
    },
  };
}
// Unlike the SDK helper, this local outer lock exposes its FD so an orphan worker retains it.
async function lock<T>(p: string, work: (fd: number) => Promise<T>) {
  assert(absolute(p));
  const fd = fs.openSync(
    p,
    fs.constants.O_CREAT | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    0o600,
  );
  try {
    checkFD(fd, p);
    const r = spawnSync("/usr/bin/flock", ["-n", "-E", "75", "3"], {
      stdio: ["ignore", "ignore", "ignore", fd],
      timeout: 10000,
    });
    if (r.status !== 0)
      throw Object.assign(Error("Daily lock unavailable"), { exitCode: r.status === 75 ? 75 : 1 });
    return await work(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function checkFD(fd: number, p: string) {
  const a = fs.fstatSync(fd),
    b = fs.lstatSync(p);
  assert(
    a.isFile() && a.nlink === 1 && !b.isSymbolicLink() && a.ino === b.ino && a.dev === b.dev,
    "Inherited lock changed",
  );
}
function proc(pid: number) {
  try {
    const s = fs.readFileSync("/proc/" + pid + "/stat", "utf8"),
      fields = s.slice(s.lastIndexOf(")") + 2).split(" ");
    if (fields[0] === "Z" || fields[0] === "X") return null;
    return {
      pid,
      start: fields[19],
      command: fs
        .readFileSync("/proc/" + pid + "/cmdline", "utf8")
        .split("\0")
        .filter(Boolean),
    };
  } catch (e: any) {
    if (["ENOENT", "ESRCH"].includes(e.code)) return null;
    throw e;
  }
}
function resources(root: string, pid: number) {
  let rss = 0;
  try {
    rss =
      Number(
        fs.readFileSync("/proc/" + pid + "/status", "utf8").match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0,
      ) * 1024;
  } catch (e: any) {
    if (!["ENOENT", "ESRCH"].includes(e.code)) throw e;
  }
  const mem =
    Number(fs.readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+)/m)![1]) * 1024;
  const volumes = new Map<bigint, bigint>();
  for (const dir of [root, tmpdir()]) {
    const s = fs.statfsSync(dir, { bigint: true }),
      dev = fs.statSync(dir, { bigint: true }).dev,
      free = s.bavail * s.bsize;
    volumes.set(dev, volumes.has(dev) && volumes.get(dev)! < free ? volumes.get(dev)! : free);
  }
  assert(
    rss <= 1024 ** 3 &&
      mem >= 2 * 1024 ** 3 &&
      [...volumes.values()].every((v) => v > RESERVE + MARGIN),
    "Daily resource guard",
  );
  return {
    rssBytes: rss,
    memAvailableBytes: mem,
    volumes: [...volumes].map(([dev, free]) => ({ dev: String(dev), freeBytes: String(free) })),
  };
}
function processTree(pid: number) {
  const found: NonNullable<ReturnType<typeof proc>>[] = [],
    queue = [pid];
  while (queue.length) {
    assert(found.length < 32, "Worker process limit");
    const next = queue.shift()!,
      info = proc(next);
    if (!info) continue;
    found.push(info);
    try {
      queue.push(
        ...fs
          .readFileSync(`/proc/${next}/task/${next}/children`, "utf8")
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map(Number),
      );
    } catch (e: any) {
      if (!["ENOENT", "ESRCH"].includes(e.code)) throw e;
    }
  }
  return found;
}
function signalOwned(tree: ReturnType<typeof processTree>, signal: NodeJS.Signals) {
  for (const info of [...tree].reverse()) {
    const live = proc(info.pid);
    if (live && live.start === info.start)
      try {
        process.kill(info.pid, signal);
      } catch (e: any) {
        if (e.code !== "ESRCH") throw e;
      }
  }
}
function captureProbes(tree: ReturnType<typeof processTree>, found: Map<string, any>) {
  const temporary = fs.realpathSync(tmpdir()),
    deferred = new Set<number>();
  for (const p of tree)
    try {
      for (const fd of fs.readdirSync(`/proc/${p.pid}/fd`))
        try {
          const file = fs.readlinkSync(`/proc/${p.pid}/fd/${fd}`),
            dir = path.dirname(file);
          if (
            path.basename(file) !== "probe.sqlite" ||
            path.dirname(dir) !== temporary ||
            !path.basename(dir).startsWith("edinet-observed-archive-")
          )
            continue;
          const s = fs.lstatSync(file),
            d = fs.lstatSync(dir);
          if (
            s.isFile() &&
            s.nlink === 1 &&
            d.isDirectory() &&
            !d.isSymbolicLink() &&
            !(d.mode & 0o077)
          )
            found.set(file, { path: file, dev: s.dev, ino: s.ino });
        } catch (e: any) {
          if (e.code === "EACCES") deferred.add(p.pid);
          else if (!["ENOENT", "ESRCH"].includes(e.code)) throw e;
        }
    } catch (e: any) {
      if (e.code === "EACCES") deferred.add(p.pid);
      else if (!["ENOENT", "ESRCH"].includes(e.code)) throw e;
    }
  // exec can briefly deny FD discovery; resource/PID checks still run and unknown probes stay untouched.
  return [...deferred];
}
async function cleanProbes(c: CorporateRegistryDailyConfig, job: any, records: any[]) {
  const results: any[] = [];
  let expected: Set<string> | undefined;
  const protectedPaths = new Set([
    ...Object.values(c).filter((p): p is string => typeof p === "string" && path.isAbsolute(p)),
    job.configPath,
    HERE,
    path.join(path.dirname(HERE), "operational-files.mjs"),
    path.join(path.dirname(c.applyScriptPath), "operational-files.mjs"),
    path.join(path.dirname(c.applyScriptPath), "resolve-sdk-module.mts"),
    path.join(path.dirname(HERE), "resolve-sdk-module.mts"),
  ]);
  const cal = snapshot(c.calendarPath).value;
  protectedPaths.add(cal.policy.file);
  protectedPaths.add(cal.holidays.file);
  const jobDir = path.join(c.root, "jobs", job.jobId);
  for (const name of fs.readdirSync(jobDir).filter((n) => /^coord-.*\.json$/.test(n)))
    for (const f of snapshot(path.join(jobDir, name)).value.files) protectedPaths.add(f.path);
  for (const p of records) {
    if (!fs.existsSync(p.path)) continue;
    if (
      protectedPaths.has(p.path) ||
      p.path.startsWith(jobDir + "/") ||
      p.path.startsWith(path.dirname(c.sdkPath) + "/")
    ) {
      results.push({ ...p, removed: false, reason: "protected-input" });
      continue;
    }
    const dir = path.dirname(p.path),
      s = fs.lstatSync(p.path);
    assert(
      path.dirname(dir) === fs.realpathSync(tmpdir()) &&
        path.basename(dir).startsWith("edinet-observed-archive-") &&
        path.basename(p.path) === "probe.sqlite",
      "Unknown probe path",
    );
    assert(
      s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && s.dev === p.dev && s.ino === p.ino,
      "Probe identity changed",
    );
    assert.deepEqual(fs.readdirSync(dir), ["probe.sqlite"], "Unknown probe contents");
    if (!expected) {
      expected = new Set();
      for (const candidate of [
        path.join(c.root, "current.sqlite"),
        job.checkpointPath + ".stage.sqlite",
      ])
        if (fs.existsSync(candidate)) expected.add(await fileHash(candidate));
    }
    if (expected.has(await fileHash(p.path))) {
      fs.rmSync(p.path);
      fs.rmdirSync(dir);
      results.push({ ...p, removed: true });
    } else results.push({ ...p, removed: false, reason: "incomplete-or-unknown-copy-preserved" });
  }
  return results;
}
function coordination(file: string) {
  const d = snapshot(file),
    settingsPath = d.value.dailySettings;
  assert(absolute(settingsPath));
  const s = snapshot(settingsPath),
    metadataPath = s.value.metadataConfigPath;
  assert(absolute(metadataPath));
  const m = snapshot(metadataPath);
  assert(absolute(m.value.checkpointPath));
  return {
    lockPath: m.value.checkpointPath + ".lock",
    files: [
      { path: file, sha256: d.sha256 },
      { path: settingsPath, sha256: s.sha256 },
      { path: metadataPath, sha256: m.sha256 },
    ],
  };
}
const checkCoord = (v: any) => {
  for (const f of v.files)
    assert.equal(snapshot(f.path).sha256, f.sha256, "Communication deployment changed");
  assert.equal(coordination(v.files[0].path).lockPath, v.lockPath, "Communication lock changed");
};
function readCurrent(c: CorporateRegistryDailyConfig) {
  const p = snapshot(path.join(c.root, "current.json")),
    v = p.value;
  assert(
    v.format === FORMAT &&
      digest(v.jobId) &&
      digest(v.dbSha256) &&
      digest(v.receiptSha256) &&
      Array.isArray(v.manifests),
  );
  date(v.lastActualDataDate);
  date(v.calendarCoverageThrough);
  const receipt = path.join(c.root, "jobs", v.jobId, "accepted.json"),
    a = snapshot(receipt);
  assert.equal(a.sha256, v.receiptSha256);
  assert(a.value.format === FORMAT && a.value.jobId === v.jobId, "Receipt identity mismatch");
  assert.equal(a.value.dbShaAtAcceptance, v.dbSha256);
  assert.equal(canonical(a.value.manifests), canonical(v.manifests));
  assert.equal(a.value.lastActualDataDate, v.lastActualDataDate);
  assert.equal(a.value.calendarCoverageThrough, v.calendarCoverageThrough);
  return { snapshot: p, value: v };
}
function checkManifests(v: any) {
  assert(Array.isArray(v) && v.length > 0 && v.length <= 100);
  let parts = 0;
  const ids: string[] = [];
  for (const m of v) {
    assert(
      m.scope === "national" &&
        Array.isArray(m.fileIds) &&
        m.fileIds.length === m.expectedParts &&
        m.fileIds.every(digest),
    );
    parts += m.fileIds.length;
    ids.push(...m.fileIds);
  }
  assert(new Set(ids).size === ids.length && parts <= 100, "Epoch parts limit reached");
  return parts;
}
function checkEpoch(db: string, value: any, sdk: any, calendar: any) {
  checkManifests(value.manifests);
  assert(value.calendarCoverageThrough >= value.lastActualDataDate, "Epoch coverage mismatch");
  const native = new DatabaseSync(normalFile(db), { readOnly: true });
  try {
    const ids = value.manifests.flatMap((m: any) => m.fileIds);
    assert.deepEqual(
      native
        .prepare("SELECT id FROM block_files ORDER BY id")
        .all()
        .map((r) => r.id),
      [...ids].sort(),
      "Epoch files mismatch",
    );
    let previous: string | undefined;
    for (const [i, m] of value.manifests.entries()) {
      const sources = m.fileIds.map(
        (id: string) =>
          JSON.parse(
            native.prepare("SELECT body FROM block_files WHERE id=?").get(id)!.body as string,
          ).source,
      );
      const day = sources[0].dataDate;
      date(day);
      assert(
        sources.every(
          (s: any) =>
            s.dataDate === day &&
            s.kind === (i === 0 ? "full" : "diff") &&
            s.purpose === "download",
        ),
        "Epoch baseline mismatch",
      );
      if (previous) {
        assert(day > previous, "Epoch order mismatch");
        const plan = sdk.planCorporateRegistryDifferences(calendar, {
          from: addDate(previous, 1),
          through: day,
          knownAt: new Date().toISOString(),
        });
        assert.deepEqual(plan.expectedDates, [day], "Epoch coverage gap");
      }
      previous = day;
    }
    assert.equal(previous, value.lastActualDataDate, "Epoch data date mismatch");
    if (value.calendarCoverageThrough > value.lastActualDataDate)
      assert.deepEqual(
        sdk.planCorporateRegistryDifferences(calendar, {
          from: addDate(value.lastActualDataDate, 1),
          through: value.calendarCoverageThrough,
          knownAt: new Date().toISOString(),
        }).expectedDates,
        [],
        "Unapplied publication date",
      );
  } finally {
    native.close();
  }
}
function sourcePacket(collected: any) {
  assert(
    collected.status === "complete" && Array.isArray(collected.completed),
    "Collection incomplete",
  );
  return {
    query: collected.query,
    calendar: collected.calendar,
    nonPublicationDays: collected.nonPublicationDays,
    days: collected.completed.map((day: any) => {
      const part = snapshot(day.importManifest),
        receipt = snapshot(day.acquisitionReceipt);
      assert.equal(part.value.sha256, day.sha256);
      assert.equal(canonical(part.value.source), canonical(day.source));
      assert.equal(part.value.part, "diff_" + day.date.replaceAll("-", "") + ".xml");
      assert.equal(receipt.value.acquisition.download.observedAt, day.source.observedAt);
      return {
        date: day.date,
        source: day.source,
        sha256: day.sha256,
        part: part.value.part,
        importManifest: day.importManifest,
        manifestSha256: part.sha256,
        acquisitionReceipt: day.acquisitionReceipt,
        receiptSha256: receipt.sha256,
      };
    }),
  };
}
function readJob(root: string, pending: any) {
  assert(pending.format === FORMAT && digest(pending.jobId) && digest(pending.jobSha256));
  const file = path.join(root, "jobs", pending.jobId, "job.json"),
    s = snapshot(file);
  assert.equal(s.sha256, pending.jobSha256);
  assert(s.value.jobId === pending.jobId && s.value.root === root);
  for (const [key, name] of [
    ["queryPath", "query.json"],
    ["baselineManifestPath", "baseline.json"],
    ["collectionPath", "collection"],
  ])
    assert.equal(s.value[key], path.join(root, "jobs", pending.jobId, name));
  assert.equal(s.value.checkpointPath, path.join(root, "apply-" + pending.jobId + ".json"));
  return s.value;
}
function httpLedger(job: any) {
  const file = path.join(job.root, "jobs", job.jobId, "http.json"),
    v = fs.existsSync(file)
      ? snapshot(file).value
      : { format: FORMAT, jobId: job.jobId, attempts: 0, entries: [] };
  assert(
    v.format === FORMAT &&
      v.jobId === job.jobId &&
      Number.isInteger(v.attempts) &&
      v.attempts >= 0 &&
      v.attempts <= 3 &&
      Array.isArray(v.entries) &&
      v.entries.length <= 6,
    "Invalid HTTP ledger",
  );
  for (const [i, e] of v.entries.entries())
    assert(
      e.sequence === i + 1 && ["reserved", "responded", "uncertain"].includes(e.outcome),
      "Invalid request reservation",
    );
  return { file, value: v };
}
function httpState(job: any) {
  const v = httpLedger(job).value,
    uncertain = v.entries.filter((e: any) => e.outcome !== "responded").length;
  return {
    jobReservedRequestsTotal: v.entries.length,
    jobRespondedRequestsTotal: v.entries.length - uncertain,
    jobAcquisitionAttempts: v.attempts,
    jobUncertainRequests: uncertain,
    reason: uncertain
      ? "uncertain-request-requires-review"
      : v.attempts >= 3
        ? "job-acquisition-attempt-budget-exhausted"
        : v.entries.length >= 6
          ? "job-http-budget-exhausted"
          : null,
  };
}
async function monitor(
  c: CorporateRegistryDailyConfig,
  job: any,
  pending: any,
  args: string[],
  fds: number[],
  started: number,
) {
  resources(c.root, process.pid);
  assert(performance.now() - started < DEADLINE, "Daily deadline");
  const dir = path.join(c.root, "jobs", job.jobId),
    attempt = fs.readdirSync(dir).filter((n) => /^worker-\d{4}\.json$/.test(n)).length + 1;
  assert(attempt <= 9999);
  const report = path.join(dir, "worker-" + String(attempt).padStart(4, "0") + ".json");
  const child = spawn(process.execPath, ["--max-old-space-size=1024", ...args], {
    stdio: ["ignore", "pipe", "pipe", ...fds],
  });
  let out = "",
    err = "",
    done = false,
    stopped: string | null = null,
    stopDetail: string | null = null;
  const exit = new Promise<any>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      done = true;
      resolve({ code, signal });
    });
  });
  exit.catch(() => {});
  child.stdout!.on("data", (b) => {
    out += b;
    if (Buffer.byteLength(out) > 16 * 1024 ** 2) {
      stopped = "output-limit";
      child.kill("SIGTERM");
    }
  });
  child.stderr!.on("data", (b) => {
    err = (err + b).slice(-(1024 ** 2));
  });
  assert(child.pid);
  const info = proc(child.pid);
  const samples: any[] = [];
  const probes = new Map<string, any>();
  try {
    while (!done) {
      try {
        if (info) {
          const now = proc(child.pid);
          if (now) assert.equal(now.start, info.start, "Worker PID reused");
        }
        const tree = processTree(child.pid);
        const probeCaptureDeferredPids = captureProbes(tree, probes);
        const r = resources(c.root, child.pid);
        r.rssBytes = tree.reduce((sum, p) => sum + resources(c.root, p.pid).rssBytes, 0);
        assert(r.rssBytes <= 1024 ** 3, "Worker tree RSS limit");
        write(path.join(c.root, "pending.json"), {
          ...pending,
          execution: info ? { ...info, children: tree, probes: [...probes.values()] } : null,
        });
        samples.push({
          ...r,
          ...(probeCaptureDeferredPids.length ? { probeCaptureDeferredPids } : {}),
        });
        assert(performance.now() - started < DEADLINE, "Daily deadline");
      } catch (e: any) {
        stopped = "resource-or-time-limit";
        stopDetail = String(e?.message ?? e).slice(0, 2048);
        const owned = processTree(child.pid);
        signalOwned(owned, "SIGTERM");
        await Promise.race([exit, new Promise((r) => setTimeout(r, 10000))]);
        signalOwned(owned, "SIGKILL");
        break;
      }
      await Promise.race([exit, new Promise((r) => setTimeout(r, 1000))]);
    }
    const status = await exit;
    const probeCleanup = await cleanProbes(c, job, [...probes.values()]);
    create(report, {
      at: new Date().toISOString(),
      execution: info,
      args,
      exit: status,
      stopped,
      stopDetail,
      samples,
      stderr: err,
      stdout: out,
      probeCleanup,
    });
    if (stopped) throw Error("Daily resource stop");
    if (status.code === 75) throw Object.assign(Error("Worker lock unavailable"), { exitCode: 75 });
    if (status.code !== 0) return { status: "worker-failed", exit: status };
    return JSON.parse(out);
  } finally {
    if (!done) {
      const owned = processTree(child.pid);
      signalOwned(owned, "SIGTERM");
      await Promise.race([exit.catch(() => {}), new Promise((r) => setTimeout(r, 10000))]);
      signalOwned(owned, "SIGKILL");
      await exit.catch(() => {});
    }
    await cleanProbes(c, job, [...probes.values()]);
    write(path.join(c.root, "pending.json"), { ...pending, execution: null });
  }
}
async function collectWorker(jobPath: string, budget: number, coordPath?: string) {
  const job = snapshot(jobPath).value,
    { c, identity, verify, sdkModules } = await load(job.configPath);
  assert.equal(canonical(identity), canonical(job.identity), "Pending operation changed");
  assert.equal(job.root, c.root);
  checkFD(3, path.join(c.root, ".daily.lock"));
  assert(budget === 0 || budget === 1);
  const coord = coordPath ? snapshot(coordPath).value : null;
  if (budget) {
    assert(c.networkEnabled && coord);
    checkFD(4, coord.lockPath);
    checkCoord(coord);
  }
  const base = path.dirname(c.sdkPath),
    { collectRegistryDifferences } = await import(
      pathToFileURL(sdkModules.modules.collectRegistryDifferences).href
    ),
    { createRegistrySession } = await import(
      pathToFileURL(sdkModules.modules.createRegistrySession).href
    );
  let requests = 0;
  const ledger = httpLedger(job);
  if (budget) {
    const state = httpState(job);
    if (state.reason) return { status: "pending-network", ...state, requestsObserved: 0 };
    ledger.value.attempts++;
    write(ledger.file, ledger.value);
  }
  const result = await collectRegistryDifferences(
    c.calendarPath,
    job.queryPath,
    c.publicKeyPath,
    c.fingerprint,
    job.collectionPath,
    budget,
    path.join(base, "cli.js"),
    process.execPath,
    () => {
      const request = createRegistrySession();
      return async (...args: any[]) => {
        assert(budget === 1 && ++requests <= 2, "Network budget");
        checkCoord(coord);
        assert(ledger.value.entries.length < 6, "Job HTTP budget");
        const entry = {
          sequence: ledger.value.entries.length + 1,
          url: args[0],
          method: args[1] ? "POST" : "GET",
          reservedAt: new Date().toISOString(),
          outcome: "reserved",
          responseStatus: undefined as number | undefined,
        };
        ledger.value.entries.push(entry);
        write(ledger.file, ledger.value);
        try {
          const response = await request(...args);
          entry.outcome = "responded";
          entry.responseStatus = response.status;
          write(ledger.file, ledger.value);
          return response;
        } catch (error) {
          entry.outcome = "uncertain";
          write(ledger.file, ledger.value);
          throw error;
        }
      };
    },
  );
  if (coord) checkCoord(coord);
  await verify();
  return { ...result, requestsObserved: requests, ...httpState(job) };
}
export async function runCorporateRegistryDaily(
  configPath: string,
  options: CorporateRegistryDailyOptions = {},
) {
  assert(
    options &&
      typeof options === "object" &&
      !Array.isArray(options) &&
      !Object.keys(options).some((k) => !["targetThrough", "acquire"].includes(k)),
  );
  assert(options.acquire === undefined || typeof options.acquire === "boolean");
  if (options.targetThrough !== undefined) {
    date(options.targetThrough);
    assert(
      options.targetThrough <= new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
      "Future target",
    );
  }
  const started = performance.now(),
    { c, identity, verify, sdk, calendar, sdkModules } = await load(configPath),
    rootLock = path.join(c.root, ".daily.lock");
  resources(c.root, process.pid);
  return lock(rootLock, async (rootFD) => {
    directory(c.root);
    const jobs = path.join(c.root, "jobs");
    if (!fs.existsSync(jobs)) fs.mkdirSync(jobs, { mode: 0o700 });
    directory(jobs);
    const pendingPath = path.join(c.root, "pending.json"),
      db = path.join(c.root, "current.sqlite");
    let current = readCurrent(c),
      pending = fs.existsSync(pendingPath) ? snapshot(pendingPath).value : null,
      job: any;
    if (pending) {
      if (pending.execution) {
        const live = proc(pending.execution.pid);
        if (live && live.start === pending.execution.start) {
          assert(
            live.command.includes(HERE) || live.command.includes(c.applyScriptPath),
            "Pending worker identity mismatch",
          );
          throw Object.assign(Error("Prior worker still live"), { exitCode: 75 });
        }
        await cleanProbes(c, readJob(c.root, pending), pending.execution.probes ?? []);
      }
      job = readJob(c.root, pending);
      assert.equal(canonical(job.identity), canonical(identity), "Pending operation changed");
      assert(
        job.previousReceiptSha === current.value.receiptSha256 || current.value.jobId === job.jobId,
        "Current lineage changed",
      );
    } else {
      assert.equal(await fileHash(db), current.value.dbSha256, "Current DB changed");
      assert(fs.statSync(db).size < 640 * 1024 ** 2, "Epoch DB limit");
      checkManifests(current.value.manifests);
      checkEpoch(db, current.value, sdk, calendar);
      const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
        target = options.targetThrough ?? addDate(today, -1);
      date(target);
      assert(target <= today, "Future target");
      if (target <= current.value.calendarCoverageThrough)
        return { status: "up-to-date", current: current.value, networkRequestsThisInvocation: 0 };
      const from = addDate(current.value.lastActualDataDate, 1),
        windowEnd = target < addDate(from, 99) ? target : addDate(from, 99),
        planned = sdk.planCorporateRegistryDifferences(calendar, {
          from,
          through: windowEnd,
          knownAt: new Date().toISOString(),
        }),
        through = planned.expectedDates[0] ?? windowEnd,
        query = { from, through, knownAt: new Date().toISOString() },
        jobId = hash(
          canonical({ previousReceiptSha: current.value.receiptSha256, from, through, identity }),
        ),
        dir = path.join(jobs, jobId);
      if (planned.expectedDates.length)
        assert(checkManifests(current.value.manifests) + 1 <= 100, "Epoch parts limit");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o700 });
      directory(dir);
      const queryPath = path.join(dir, "query.json"),
        baselineManifestPath = path.join(dir, "baseline.json"),
        collectionPath = path.join(dir, "collection"),
        jobPath = path.join(dir, "job.json");
      if (fs.existsSync(jobPath)) {
        job = snapshot(jobPath).value;
        assert.equal(canonical(job.identity), canonical(identity));
        assert.equal(job.previousReceiptSha, current.value.receiptSha256);
        assert.equal(job.beforeDbSha256, current.value.dbSha256);
        assert.equal(snapshot(queryPath).value.from, from);
        assert.equal(snapshot(queryPath).value.through, through);
        assert.equal(
          canonical(snapshot(baselineManifestPath).value),
          canonical(current.value.manifests),
        );
      } else {
        if (fs.existsSync(queryPath)) {
          const old = snapshot(queryPath).value;
          assert.equal(
            Object.keys(old).sort().join(),
            ["from", "through", "knownAt"].sort().join(),
          );
          assert.equal(old.from, from);
          assert.equal(old.through, through);
          sdk.planCorporateRegistryDifferences(calendar, old);
          assert(Date.parse(old.knownAt) <= Date.now(), "Future frozen cutoff");
        } else create(queryPath, query);
        if (fs.existsSync(baselineManifestPath))
          assert.equal(
            canonical(snapshot(baselineManifestPath).value),
            canonical(current.value.manifests),
            "Partial baseline changed",
          );
        else create(baselineManifestPath, current.value.manifests);
        if (fs.existsSync(collectionPath)) {
          directory(collectionPath);
          assert.deepEqual(fs.readdirSync(collectionPath), [], "Unsealed collection preserved");
        } else fs.mkdirSync(collectionPath, { mode: 0o700 });
        job = {
          format: FORMAT,
          root: c.root,
          jobId,
          configPath,
          identity,
          previousReceiptSha: current.value.receiptSha256,
          beforeDbSha256: current.value.dbSha256,
          beforePointerSha256: current.snapshot.sha256,
          queryPath,
          baselineManifestPath,
          collectionPath,
          checkpointPath: path.join(c.root, "apply-" + jobId + ".json"),
          querySha256: snapshot(queryPath).sha256,
          baselineManifestSha256: snapshot(baselineManifestPath).sha256,
          expectedPublicationDate: planned.expectedDates[0] ?? null,
        };
        create(jobPath, job);
      }
      pending = { format: FORMAT, jobId, jobSha256: snapshot(jobPath).sha256, execution: null };
      create(pendingPath, pending);
    }
    job = readJob(c.root, pending);
    const dir = path.join(jobs, job.jobId),
      acceptedPath = path.join(dir, "accepted.json"),
      checkpoint = job.checkpointPath,
      jobPath = path.join(dir, "job.json");
    const initialReservations = httpLedger(job).value.entries.length;
    const network = () => {
      const { reason, ...counts } = httpState(job),
        delta = httpLedger(job).value.entries.slice(initialReservations);
      return {
        networkRequestsThisInvocation: delta.some((e: any) => e.outcome !== "responded")
          ? null
          : delta.length,
        httpReservationsThisInvocation: delta.length,
        ...counts,
      };
    };
    assert.equal(snapshot(job.queryPath).sha256, job.querySha256);
    assert.equal(snapshot(job.baselineManifestPath).sha256, job.baselineManifestSha256);
    checkManifests(snapshot(job.baselineManifestPath).value);
    const query = snapshot(job.queryPath).value;
    date(query.from);
    date(query.through);
    const plan = sdk.planCorporateRegistryDifferences(calendar, query);
    assert(plan.expectedDates.length <= 1, "One publication day per job");
    const packetPath = path.join(dir, "source.json");
    const recheckSource = async () => {
      const retained = await monitor(
        c,
        job,
        pending,
        [HERE, "--worker-collect", jobPath, "--budget", "0"],
        [rootFD],
        started,
      );
      assert.equal(
        canonical(sourcePacket(retained)),
        canonical(snapshot(packetPath).value),
        "Frozen source changed",
      );
    };
    const publish = async (receipt: any, sourceChecked = false) => {
      if (!sourceChecked) await recheckSource();
      if (!sourceChecked) await verify();
      assert(
        receipt.format === FORMAT &&
          receipt.jobId === job.jobId &&
          receipt.previousReceiptSha === job.previousReceiptSha,
      );
      assert.equal(await fileHash(db), receipt.dbShaAtAcceptance, "Accepted DB changed");
      assert.equal(snapshot(packetPath).sha256, receipt.sourcePacketSha256);
      checkEpoch(db, receipt, sdk, calendar);
      assert.equal(snapshot(jobPath).sha256, pending.jobSha256);
      const ptr = {
        format: FORMAT,
        jobId: job.jobId,
        dbSha256: receipt.dbShaAtAcceptance,
        receiptSha256: snapshot(acceptedPath).sha256,
        lastActualDataDate: receipt.lastActualDataDate,
        calendarCoverageThrough: receipt.calendarCoverageThrough,
        manifests: receipt.manifests,
      };
      current = readCurrent(c);
      assert(
        current.value.receiptSha256 === job.previousReceiptSha || current.value.jobId === job.jobId,
        "Pointer lineage changed",
      );
      resources(c.root, process.pid);
      assert(performance.now() - started < DEADLINE, "Daily deadline");
      write(path.join(c.root, "current.json"), ptr);
      fs.rmSync(pendingPath);
      return {
        status: "accepted",
        jobId: job.jobId,
        current: ptr,
        ...network(),
      };
    };
    const { withOperationalLocks } = await import(
      pathToFileURL(sdkModules.modules.withOperationalLocks).href
    );
    if (fs.existsSync(acceptedPath))
      return withOperationalLocks([db + ".lock", checkpoint + ".lock"], () =>
        publish(snapshot(acceptedPath).value),
      );
    let collected = await monitor(
      c,
      job,
      pending,
      [HERE, "--worker-collect", jobPath, "--budget", "0"],
      [rootFD],
      started,
    );
    if (collected.status === "worker-failed")
      return {
        status: "pending-verification",
        reason: "saved-input-verification-failed",
        jobId: job.jobId,
        ...network(),
      };
    if (collected.status !== "complete") {
      if (collected.reason)
        return {
          status: "pending-acquisition",
          reason: collected.reason,
          jobId: job.jobId,
          ...network(),
        };
      if (!options.acquire || !c.networkEnabled)
        return {
          status: "pending-source",
          reason: "offline-or-acquisition-disabled",
          jobId: job.jobId,
          ...network(),
        };
      const coord = coordination(c.metadataDeploymentPath);
      assert(
        coord.lockPath !== rootLock && !coord.lockPath.startsWith(c.root + "/"),
        "Communication lock collision",
      );
      const coordFile = path.join(
        dir,
        "coord-" +
          String(
            fs.readdirSync(dir).filter((n) => /^coord-\d+\.json$/.test(n)).length + 1,
          ).padStart(4, "0") +
          ".json",
      );
      create(coordFile, coord);
      collected = await lock(coord.lockPath, async (metadataFD) => {
        checkCoord(coord);
        const r = await monitor(
          c,
          job,
          pending,
          [HERE, "--worker-collect", jobPath, "--budget", "1", "--coord", coordFile],
          [rootFD, metadataFD],
          started,
        );
        checkCoord(coord);
        return r;
      });
      if (collected.status !== "complete")
        return {
          status: "pending-acquisition",
          reason:
            collected.reason ?? httpState(job).reason ?? "source-or-signature-verification-pending",
          jobId: job.jobId,
          ...network(),
        };
      assert(Number.isInteger(collected.requestsObserved) && collected.requestsObserved <= 2);
    }
    await verify();
    const packet = sourcePacket(collected);
    if (fs.existsSync(packetPath))
      assert.equal(
        canonical(snapshot(packetPath).value),
        canonical(packet),
        "Frozen source changed",
      );
    else create(packetPath, packet);
    let manifests = current.value.manifests,
      lastDate = current.value.lastActualDataDate,
      dbSha = current.value.dbSha256,
      applyResult: any = null;
    if (plan.expectedDates.length) {
      assert(
        collected.completed?.length === 1 && collected.completed[0].date === plan.expectedDates[0],
      );
      assert(checkManifests(manifests) + 1 <= 100, "Epoch parts limit");
      const mapping = {
        calendar: c.calendarPath,
        query: job.queryPath,
        "public-key": c.publicKeyPath,
        fingerprint: c.fingerprint,
        collection: job.collectionPath,
        "baseline-manifest": job.baselineManifestPath,
        "baseline-db-sha256": job.beforeDbSha256,
        db,
        checkpoint,
        sdk: c.sdkPath,
        "runtime-verifier": c.runtimeVerifierPath,
        "runtime-verifier-sha256": c.runtimeVerifierSha256,
        "corporate-number": c.probeCorporateNumber,
        "max-days": "1",
      };
      applyResult = await monitor(
        c,
        job,
        pending,
        [c.applyScriptPath, ...Object.entries(mapping).flatMap(([k, v]) => ["--" + k, v])],
        [rootFD],
        started,
      );
      if (applyResult.status !== "complete")
        return {
          status: "pending-apply",
          reason: "apply-verification-or-resource-pending",
          jobId: job.jobId,
          ...network(),
        };
      assert(applyResult.networkRequests === 0 && [0, 1].includes(applyResult.appliedThisRun));
      const ck = snapshot(checkpoint).value;
      assert(
        ck.status === "complete" &&
          ck.applied.length === 1 &&
          ck.verification?.storage?.verification === "all-records" &&
          ["available", "deleted", "unavailable"].includes(ck.verification.selection?.status),
      );
      assert.equal(ck.applied[0].date, plan.expectedDates[0]);
      assert.equal(
        canonical(ck.applied[0].source),
        canonical(collected.completed[0].source),
        "Applied source changed",
      );
      manifests = ck.manifests;
      lastDate = ck.applied[0].date;
      dbSha = ck.dbSha256;
    } else {
      assert(collected.completed.length === 0 && collected.requestsObserved === 0);
      assert(!fs.existsSync(checkpoint), "Empty holiday must not fabricate apply checkpoint");
    }
    return withOperationalLocks([db + ".lock", checkpoint + ".lock"], async () => {
      assert.equal(await fileHash(db), dbSha);
      await recheckSource();
      await verify();
      const receipt = {
        format: FORMAT,
        jobId: job.jobId,
        acceptedAt: new Date().toISOString(),
        previousReceiptSha: job.previousReceiptSha,
        beforeDbSha256: job.beforeDbSha256,
        dbShaAtAcceptance: dbSha,
        lastActualDataDate: lastDate,
        calendarCoverageThrough: query.through,
        manifests,
        jobSha256: pending.jobSha256,
        identity,
        ...network(),
        calendar: plan.calendar,
        nonPublicationDays: plan.nonPublicationDays,
        collection: collected,
        applyCheckpointSha256: plan.expectedDates.length ? snapshot(checkpoint).sha256 : null,
        sourcePacketSha256: snapshot(packetPath).sha256,
      };
      create(acceptedPath, receipt);
      return publish(receipt, true);
    });
  });
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({
      options: {
        config: { type: "string" },
        through: { type: "string" },
        acquire: { type: "boolean" },
        "worker-collect": { type: "string" },
        budget: { type: "string" },
        coord: { type: "string" },
      },
    });
    const result = values["worker-collect"]
      ? await collectWorker(values["worker-collect"], Number(values.budget), values.coord)
      : await runCorporateRegistryDaily(values.config!, {
          targetThrough: values.through,
          acquire: values.acquire,
        });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error("Corporate registry daily job failed.");
    process.exitCode =
      error && typeof error === "object" && "exitCode" in error && error.exitCode === 75 ? 75 : 1;
  }
}
