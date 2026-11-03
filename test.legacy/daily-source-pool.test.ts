import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { ObservedFinancialArchive, FinancialSourceJob } from "../dist/index.js";
import {
  checkDailySourcePoolSpace,
  prepareDailySourcePool,
} from "../scripts/roadmap/daily-source-pool.mjs";
import { atomicJSON, sha256, canonical } from "../scripts/roadmap/operational-files.mjs";

const observation = (id: string) => ({
  observationId: id,
  listDate: "2026-10-29",
  observedAt: "2026-10-30T00:00:00Z",
  document: {
    docID: id,
    edinetCode: "E12345",
    secCode: "10010",
    docTypeCode: "120",
    submitDateTime: "2026-10-29 09:00",
    periodStart: "2025-04-01",
    periodEnd: "2026-03-31",
    withdrawalStatus: "0",
    docInfoEditStatus: "0",
    disclosureStatus: "0",
    xbrlFlag: "1",
  },
});
async function fixture(work: (s: any) => Promise<void>, largeSources = false) {
  const dir = mkdtempSync(join(tmpdir(), "daily-pool-")),
    previousCycle = join(dir, "2026-10-30"),
    candidate = join(previousCycle, "candidate"),
    basePath = join(dir, "base.sqlite");
  mkdirSync(join(candidate, "duckdb"), { recursive: true });
  const base = new ObservedFinancialArchive(basePath);
  base.append(
    [observation("BASE")],
    [
      {
        docID: "BASE",
        availableAt: "2026-10-29T01:00:00Z",
        sourceSha256: sha256("<base/>"),
        xml: "<base/>",
      },
    ],
  );
  base.close();
  const archivePath = join(candidate, "archive.sqlite"),
    archive = new ObservedFinancialArchive(archivePath, { compression: "gzip" });
  const ids = Array.from({ length: 26 }, (_, i) => "SOURCE" + i.toString().padStart(2, "0"));
  archive.append(
    ids.map(observation),
    ids.map((docID) => {
      const xml = largeSources
        ? "<" + docID + ">" + randomBytes(48 * 1024).toString("hex") + "</" + docID + ">"
        : "<" + docID + "/>";
      return { docID, availableAt: "2026-10-31T02:00:00Z", sourceSha256: sha256(xml), xml };
    }),
  );
  archive.close();
  const statePath = join(candidate, "source-job.sqlite"),
    state = new FinancialSourceJob(statePath),
    frozen = new ObservedFinancialArchive(archivePath, { readOnly: true }),
    input = {
      id: "job",
      cutoff: "2026-10-30T01:00:00Z",
      population: {
        asOf: "2026-10-29",
        observedAt: "2026-10-30T00:00:00Z",
        source: "fixture",
        sourceSha256: "d".repeat(64),
        edinetCodes: ["E12345"],
      },
    };
  let plan: any;
  try {
    plan = state.begin(input, frozen);
  } finally {
    state.close();
    frozen.close();
  }
  const auditor = new FinancialSourceJob(statePath, { readOnly: true }),
    raw = new ObservedFinancialArchive(archivePath, { readOnly: true });
  let sourceAudit: any;
  try {
    sourceAudit = auditor.audit("job", raw, {
      planSha256: plan.planSha256,
      archiveSha256: raw.snapshotSha256(),
    });
  } finally {
    auditor.close();
    raw.close();
  }
  const inputSha256 = "a".repeat(64),
    receipt = {
      status: "acquired",
      inputSha256,
      planSha256: plan.planSha256,
      archivePath,
      statePath,
      archiveSha256: sha256(readFileSync(archivePath)),
      sourceAudit,
      completedAt: "2026-10-31T03:00:00Z",
    },
    body = { receipt };
  atomicJSON(
    join(candidate, "acquisition.json"),
    { version: 1, inputSha256, body, sha256: sha256(canonical([inputSha256, body])) },
    { createOnly: true },
  );
  const buildInput = "b".repeat(64),
    built = {
      status: "built",
      inputSha256: buildInput,
      indexPath: join(candidate, "duckdb/index.duckdb"),
      archivePath: join(candidate, "reconstructed/archive.sqlite"),
    };
  atomicJSON(
    join(candidate, "duckdb/build.json"),
    { inputSha256: buildInput, body: built, sha256: sha256(canonical([buildInput, built])) },
    { createOnly: true },
  );
  const baseSha256 = sha256(readFileSync(basePath)),
    config = {
      basePath,
      baseSha256,
      previousCycle,
      engine: "duckdb",
      origin: { input: basePath, inputSha256: baseSha256 },
    };
  try {
    await work({ dir, config, ids, archivePath, basePath, baseSha256, statePath, candidate });
  } finally {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  }
}
it("merges all base/source cache in bounded resumes without copying previous-day observations or changing availability", () =>
  fixture(async (s) => {
    const before = [s.basePath, s.archivePath, s.statePath].map((p) => sha256(readFileSync(p)));
    const first = await prepareDailySourcePool(s.config, { maxBatches: 1 });
    expect(first.status).toBe("source-pool-preparing");
    expect(first.transferred).toBe(20);
    const ready = await prepareDailySourcePool(s.config, { maxBatches: 1 });
    expect(ready.status).toBe("source-pool-ready");
    const db = new DatabaseSync(ready.path, { readOnly: true });
    try {
      expect(db.prepare("SELECT COUNT(*) n FROM archive_sources").get()!.n).toBe(27);
      expect(
        db
          .prepare("SELECT id FROM archive_observations")
          .all()
          .map((r) => r.id),
      ).toEqual(["BASE"]);
    } finally {
      db.close();
    }
    const pool = new ObservedFinancialArchive(ready.path, { readOnly: true });
    try {
      const declaration = pool.sourceDeclarations(s.ids[0]).sources[0];
      expect(declaration.availableAt).toBe("2026-10-31T02:00:00.000Z");
      expect(pool.readSource(declaration)!.xml).toBe("<SOURCE00/>");
    } finally {
      pool.close();
    }
    expect([s.basePath, s.archivePath, s.statePath].map((p) => sha256(readFileSync(p)))).toEqual(
      before,
    );
    expect(await prepareDailySourcePool(s.config)).toEqual(ready);
  }));
it("does not treat completion for the other DB engine as complete", () =>
  fixture(async (s) => {
    await expect(prepareDailySourcePool({ ...s.config, engine: "sqlite" })).rejects.toThrow(
      "incomplete",
    );
  }));
it("rejects modified seed and modified finished source before inheritance", () =>
  fixture(async (s) => {
    await expect(
      prepareDailySourcePool({ ...s.config, baseSha256: "f".repeat(64) }),
    ).rejects.toThrow("fingerprint");
    const db = new DatabaseSync(s.archivePath);
    db.exec("UPDATE archive_sources SET available_ms=available_ms+1");
    db.close();
    await expect(prepareDailySourcePool(s.config)).rejects.toThrow("fingerprint");
  }));
it("rejects altered verified pool rather than overwriting it", () =>
  fixture(async (s) => {
    const ready = await prepareDailySourcePool(s.config);
    const db = new DatabaseSync(ready.path);
    db.exec("DELETE FROM archive_sources");
    db.close();
    await expect(prepareDailySourcePool(s.config)).rejects.toThrow("proof");
  }));
it("resumes a committed transfer when progress persistence failed without duplicating declarations", () =>
  fixture(async (s) => {
    const transfer = ObservedFinancialArchive.prototype.transferSourcesTo;
    let failed = false;
    const spy = vi
      .spyOn(ObservedFinancialArchive.prototype, "transferSourcesTo")
      .mockImplementation(function (...args: any[]) {
        const result = transfer.apply(this, args as any);
        if (!failed) {
          failed = true;
          throw Error("checkpoint interrupted");
        }
        return result;
      });
    await expect(prepareDailySourcePool(s.config, { maxBatches: 1 })).rejects.toThrow(
      "checkpoint interrupted",
    );
    spy.mockRestore();
    const ready = await prepareDailySourcePool(s.config);
    expect(ready.status).toBe("source-pool-ready");
    const db = new DatabaseSync(ready.path, { readOnly: true });
    try {
      expect(db.prepare("SELECT COUNT(*) n FROM archive_sources").get()!.n).toBe(27);
    } finally {
      db.close();
    }
  }));
it("an already aborted invocation does not publish a pool", () =>
  fixture(async (s) => {
    const controller = new AbortController();
    controller.abort();
    expect((await prepareDailySourcePool(s.config, { signal: controller.signal })).status).toBe(
      "aborted",
    );
  }));

it("refuses active source sidecars before making an inherited copy", () =>
  fixture(async (s) => {
    writeFileSync(s.basePath + "-journal", "active");
    await expect(prepareDailySourcePool(s.config)).rejects.toThrow("sidecars");
  }));
it("keeps the34GiB reserve rather than beginning a seed copy", () =>
  fixture(async (s) => {
    const spy = vi
      .spyOn(fs, "statfsSync")
      .mockReturnValue({ bavail: 34n * 1024n ** 3n, bsize: 1n } as any);
    syncBuiltinESMExports();
    try {
      await expect(prepareDailySourcePool(s.config)).rejects.toThrow("disk reserve");
    } finally {
      spy.mockRestore();
      syncBuiltinESMExports();
    }
  }));
it("SQLite completion selects its own validated source pool", () =>
  fixture(async (s) => {
    mkdirSync(join(s.candidate, "reconstructed"));
    const duck = JSON.parse(readFileSync(join(s.candidate, "duckdb/build.json"), "utf8"));
    const body = {
      status: "built",
      inputSha256: duck.inputSha256,
      indexPath: join(s.candidate, "reconstructed/index.sqlite"),
    };
    atomicJSON(
      join(s.candidate, "reconstructed/build.json"),
      {
        version: 1,
        inputSha256: body.inputSha256,
        body,
        sha256: sha256(canonical([body.inputSha256, body])),
      },
      { createOnly: true },
    );
    const ready = await prepareDailySourcePool({ ...s.config, engine: "sqlite" });
    expect(ready.status).toBe("source-pool-ready");
    const input = JSON.parse(
      readFileSync(join(s.config.previousCycle, "inherited-source-pool/input.json"), "utf8"),
    );
    expect(input.engine).toBe("sqlite");
  }));
it("a DuckDB receipt copied into the SQLite path is rejected", () =>
  fixture(async (s) => {
    mkdirSync(join(s.candidate, "reconstructed"));
    writeFileSync(
      join(s.candidate, "reconstructed/build.json"),
      readFileSync(join(s.candidate, "duckdb/build.json")),
    );
    await expect(prepareDailySourcePool({ ...s.config, engine: "sqlite" })).rejects.toThrow(
      "completed daily cycle",
    );
  }));

it("reserves the remaining constructor copies at unchanged capacity on partial resume", () => {
  const gib = 1024n ** 3n;
  const spy = vi
    .spyOn(fs, "statfsSync")
    .mockReturnValue({ bavail: 34n * gib + 2600n * 1024n ** 2n, bsize: 1n } as any);
  syncBuiltinESMExports();
  try {
    expect(() =>
      checkDailySourcePoolSpace(tmpdir(), { phase: "seed", baseBytes: gib, sourceBytes: gib }),
    ).toThrow("disk reserve");
    expect(() =>
      checkDailySourcePoolSpace(tmpdir(), { phase: "transfer", poolBytes: gib, sourceBytes: gib }),
    ).not.toThrow();
    expect(() =>
      checkDailySourcePoolSpace(tmpdir(), {
        phase: "transfer",
        poolBytes: 3n * gib,
        sourceBytes: gib,
      }),
    ).toThrow("disk reserve");
  } finally {
    spy.mockRestore();
    syncBuiltinESMExports();
  }
});
it("checks the actual enlarged partial pool before opening constructor copies", () =>
  fixture(async (s) => {
    await prepareDailySourcePool(s.config, { maxBatches: 1 });
    const base = BigInt(fs.statSync(s.basePath).size),
      source = BigInt(fs.statSync(s.archivePath).size);
    const pool = BigInt(
      fs.statSync(join(s.config.previousCycle, "inherited-source-pool/archive.sqlite")).size,
    );
    expect(pool).toBeGreaterThan(2n * base);
    const stats = vi
      .spyOn(fs, "statfsSync")
      .mockReturnValue({ bavail: 34n * 1024n ** 3n + source + 2n * base + 1n, bsize: 1n } as any);
    const allocations = vi.spyOn(fs, "mkdtempSync");
    syncBuiltinESMExports();
    try {
      await expect(prepareDailySourcePool(s.config)).rejects.toThrow("disk reserve");
      expect(allocations).not.toHaveBeenCalled();
    } finally {
      stats.mockRestore();
      allocations.mockRestore();
      syncBuiltinESMExports();
    }
  }, true));
it("retries completed transfer validation with only the final pool readonly copy", () =>
  fixture(async (s) => {
    const original = fs.mkdtempSync;
    const interrupted = vi.spyOn(fs, "mkdtempSync").mockImplementation(((
      prefix: string,
      ...args: any[]
    ) => {
      if (prefix.includes("edinet-daily-source-audit-")) throw Error("audit interrupted");
      return original(prefix, ...(args as []));
    }) as any);
    syncBuiltinESMExports();
    try {
      await expect(prepareDailySourcePool(s.config)).rejects.toThrow("audit interrupted");
    } finally {
      interrupted.mockRestore();
      syncBuiltinESMExports();
    }
    const progress = JSON.parse(
      readFileSync(join(s.config.previousCycle, "inherited-source-pool/progress.json"), "utf8"),
    );
    expect(progress.body.complete).toBe(true);
    const allocations = vi.spyOn(fs, "mkdtempSync");
    syncBuiltinESMExports();
    try {
      expect((await prepareDailySourcePool(s.config)).status).toBe("source-pool-ready");
      expect(
        allocations.mock.calls.filter(([prefix]) =>
          String(prefix).includes("edinet-observed-archive-"),
        ).length,
      ).toBe(1);
    } finally {
      allocations.mockRestore();
      syncBuiltinESMExports();
    }
  }));
