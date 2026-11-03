import { it, expect, vi, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  renameSync,
  chmodSync,
  mkdirSync,
  statfsSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { CorporateRegistryBlockStore } from "../src/db/corporate-registry-block-store";
import {
  registryStreamRow as row,
  registryStreamXml as xml,
  registryStreamSource as source,
} from "./fixtures/corporate-registry-stream";
import { registryCalendarFixture } from "./fixtures/corporate-registry-calendar";
import { parseCorporateRegistryPublicationCalendar } from "../src/companies/registry/publication-calendar";
import { applyCorporateRegistryDifferences as run } from "../scripts/roadmap/apply-corporate-registry-differences.mts";
const mocks = vi.hoisted(() => ({ collect: vi.fn() }));
vi.mock("../src/companies/registry/collect-differences", () => ({
  collectRegistryDifferences: mocks.collect,
}));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    renameSync: vi.fn(fs.renameSync),
    statSync: vi.fn(fs.statSync),
    statfsSync: vi.fn((...args: Parameters<typeof fs.statfsSync>) => ({
      ...fs.statfsSync(...args),
      bavail: args[1]?.bigint ? 2n ** 40n : 2 ** 40,
      bsize: args[1]?.bigint ? 4096n : 4096,
    })),
  };
});
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});
const hash = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "registry-apply-"));
  dirs.push(dir);
  chmodSync(dir, 0o700);
  const verified = join(dir, "collection/days/2026-10-30/attempt-0001/verified");
  mkdirSync(verified, { recursive: true, mode: 0o700 });
  const dbPath = join(dir, "registry.sqlite"),
    full = join(dir, "full.xml"),
    diff = join(verified, "part-000.xml"),
    baselineManifestPath = join(dir, "baseline.json"),
    checkpointPath = join(dir, "checkpoint.json"),
    queryPath = join(dir, "query.json"),
    calendarPath = join(dir, "calendar.json"),
    publicKeyPath = join(dir, "key.asc"),
    part = join(verified, "part-000-import.json");
  const fullText = xml(row()),
    diffText = xml(
      row({ process: "12", name: "変更会社", updateDate: "2026-10-30", changeDate: "2026-10-30" }),
    );
  writeFileSync(full, fullText);
  writeFileSync(diff, diffText);
  writeFileSync(publicKeyPath, "fixture key");
  const store = new CorporateRegistryBlockStore(dbPath);
  let file;
  try {
    file = (
      await store.importFile({
        file: full,
        sha256: hash(fullText),
        part: "full.xml",
        source: { ...source, kind: "full", purpose: "download" },
      })
    ).file;
  } finally {
    store.close();
  }
  const manifest = {
    file: diff,
    sha256: hash(diffText),
    part: "diff_20261030.xml",
    source: {
      ...source,
      dataDate: "2026-10-30",
      observedAt: "2026-10-31T00:00:00Z",
      purpose: "download",
    },
  };
  writeFileSync(part, JSON.stringify(manifest));
  writeFileSync(
    baselineManifestPath,
    JSON.stringify([{ scope: "national", expectedParts: 1, fileIds: [file.id] }]),
  );
  const calendar = registryCalendarFixture(),
    { holidays: _holidays, ...metadata } = parseCorporateRegistryPublicationCalendar(calendar),
    policy = join(dir, "policy.html"),
    csv = join(dir, "holidays.csv");
  writeFileSync(policy, calendar.policy.html);
  const header = Buffer.from(
    "8d9196af82cc8f6a93fa81458b7893fa8c8e93fa2c8d9196af82cc8f6a93fa81458b7893fa96bc8fcc0d0a",
    "hex",
  );
  writeFileSync(
    csv,
    Buffer.concat([
      header,
      Buffer.from(Array.from({ length: 11 }, (_, i) => `${2017 + i}/1/1,Holiday\r\n`).join("")),
    ]),
  );
  const actualCalendar = {
      ...calendar,
      holidays: {
        ...calendar.holidays,
        csv: new TextDecoder("shift_jis").decode(readFileSync(csv)),
      },
    },
    { holidays: _actualHolidays, ...actualMetadata } =
      parseCorporateRegistryPublicationCalendar(actualCalendar);
  writeFileSync(
    calendarPath,
    JSON.stringify({
      policy: {
        file: policy,
        sourceUrl: calendar.policy.sourceUrl,
        observedAt: calendar.policy.observedAt,
      },
      holidays: {
        file: csv,
        sourceUrl: calendar.holidays.sourceUrl,
        observedAt: calendar.holidays.observedAt,
      },
    }),
  );
  writeFileSync(
    queryPath,
    JSON.stringify({ from: "2026-10-30", through: "2026-10-30", knownAt: "2026-10-31T00:00:00Z" }),
  );
  mocks.collect.mockResolvedValue({
    status: "complete",
    calendar: actualMetadata,
    completed: [
      {
        date: "2026-10-30",
        sha256: manifest.sha256,
        source: manifest.source,
        importManifest: part,
      },
    ],
  });
  const runtime = join(dir, "runtime"),
    sdkPath = join(runtime, "dist/index.js"),
    runtimeVerifierPath = join(runtime, "run-financial-pinned.mjs");
  const runtimeFiles = [
    "index",
    "utils/with-operational-locks",
    "companies/registry/collect-differences",
  ];
  for (const name of runtimeFiles) {
    const file = join(runtime, "dist", name + ".js");
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(
      file,
      "export * from " + JSON.stringify(pathToFileURL(resolve("src/" + name + ".ts")).href) + ";",
    );
  }
  const dependency = join(runtime, "dependency.txt");
  writeFileSync(dependency, "fixture dependency");
  writeFileSync(
    join(runtime, "runtime-manifest.json"),
    JSON.stringify(
      [...runtimeFiles.map((n) => join(runtime, "dist", n + ".js")), dependency].map((file) => ({
        file,
        sha256: hash(readFileSync(file)),
      })),
    ),
  );
  writeFileSync(
    runtimeVerifierPath,
    'import fs from "node:fs";import{createHash}from"node:crypto";const list=JSON.parse(fs.readFileSync(new URL("./runtime-manifest.json",import.meta.url)));for(const r of list)if(createHash("sha256").update(fs.readFileSync(r.file)).digest("hex")!==r.sha256)throw Error("Runtime dependency changed");console.log(JSON.stringify({status:"verified",networkRequested:false}));',
  );
  return {
    dependency,
    dir,
    manifest,
    part,
    diff,
    input: {
      dbPath,
      baselineManifestPath,
      checkpointPath,
      queryPath,
      calendarPath,
      publicKeyPath,
      baselineDbSha256: hash(readFileSync(dbPath)),
      collectionPath: join(dir, "collection"),
      fingerprint: "F4109E821F0DE67C4BA1947C4BCD87A24D615230",
      sdkPath,
      runtimeVerifierPath,
      runtimeVerifierSha256: hash(readFileSync(runtimeVerifierPath)),
      corporateNumber: "1010001001202",
    },
  };
}
it("通信0の再検査→適用→再実行で同じchainとDBを保持する", async () => {
  const f = await fixture(),
    first = await run(f.input);
  expect(first).toMatchObject({ status: "complete", appliedThisRun: 1, networkRequests: 0 });
  const after = hash(readFileSync(f.input.dbPath)),
    again = await run(f.input);
  expect(again).toMatchObject({ status: "complete", appliedThisRun: 0, networkRequests: 0 });
  expect(hash(readFileSync(f.input.dbPath))).toBe(after);
  expect(mocks.collect.mock.calls[0][5]).toBe(0);
  await expect(mocks.collect.mock.calls[0][8]()()).rejects.toThrow("prohibits network");
});
it("日数予算0は取込せず、入力指紋を変えた再開は拒否する", async () => {
  const f = await fixture();
  expect(await run({ ...f.input, maxDays: 0 })).toMatchObject({
    status: "pending",
    appliedThisRun: 0,
  });
  expect(hash(readFileSync(f.input.dbPath))).toBe(f.input.baselineDbSha256);
  await run(f.input);
  writeFileSync(f.input.queryPath, "{}");
  await expect(run(f.input)).rejects.toThrow("inputs changed");
});
it("保存collect再検査の失敗はDBとcheckpointを変更しない", async () => {
  const f = await fixture();
  mocks.collect.mockRejectedValueOnce(Error("retained receipt changed"));
  await expect(run(f.input)).rejects.toThrow("receipt changed");
  expect(hash(readFileSync(f.input.dbPath))).toBe(f.input.baselineDbSha256);
  expect(existsSync(f.input.checkpointPath)).toBe(false);
});
it("不完全XMLの取込はstageをrollbackし、修復後に再開できる", async () => {
  const f = await fixture();
  const original = readFileSync(f.diff);
  writeFileSync(f.diff, original.subarray(0, original.length / 2));
  await expect(run(f.input)).rejects.toThrow();
  expect(hash(readFileSync(f.input.dbPath))).toBe(f.input.baselineDbSha256);
  expect(existsSync(f.input.checkpointPath + ".stage.sqlite")).toBe(false);
  writeFileSync(f.diff, original);
  expect(await run(f.input)).toMatchObject({ status: "complete" });
});
it("基点からの欠落と不正予算を拒否する", async () => {
  const f = await fixture();
  await expect(run({ ...f.input, maxDays: -1 })).rejects.toThrow("budget");
  writeFileSync(f.input.queryPath, JSON.stringify({ from: "2026-11-02" }));
  await expect(run(f.input)).rejects.toThrow("immediately");
});

it.each(["before-db-rename", "before-checkpoint-write"])(
  "%sで停止してもprepared commitから再開する",
  async (phase) => {
    const f = await fixture();
    const original = await vi.importActual<typeof import("node:fs")>("node:fs");
    let interrupted = false;
    vi.mocked(renameSync).mockImplementation((from, to) => {
      if (
        !interrupted &&
        (phase === "before-db-rename"
          ? String(from).endsWith(".stage.sqlite")
          : String(to) === f.input.checkpointPath)
      ) {
        interrupted = true;
        throw Error("injected handoff interruption");
      }
      original.renameSync(from, to);
    });
    try {
      await expect(run(f.input)).rejects.toThrow("handoff interruption");
      expect(existsSync(f.input.checkpointPath + ".commit.json")).toBe(true);
      expect(await run(f.input)).toMatchObject({
        status: "complete",
        appliedThisRun: 0,
        networkRequests: 0,
      });
      expect(existsSync(f.input.checkpointPath + ".commit.json")).toBe(false);
    } finally {
      vi.mocked(renameSync).mockImplementation(original.renameSync);
    }
  },
);
it.each(["query-stage", "calendar-stage", "collection-output"])(
  "%s衝突を原入力不変で拒否する",
  async (kind) => {
    const f = await fixture(),
      stage = f.input.checkpointPath + ".stage.sqlite";
    if (kind === "query-stage") {
      writeFileSync(stage, readFileSync(f.input.queryPath));
      const before = readFileSync(stage);
      await expect(run({ ...f.input, queryPath: stage })).rejects.toThrow("collision");
      expect(readFileSync(stage)).toEqual(before);
    } else if (kind === "calendar-stage") {
      const calendar = JSON.parse(readFileSync(f.input.calendarPath, "utf8"));
      writeFileSync(stage, readFileSync(calendar.policy.file));
      calendar.policy.file = stage;
      writeFileSync(f.input.calendarPath, JSON.stringify(calendar));
      const before = readFileSync(stage);
      await expect(run(f.input)).rejects.toThrow("collision");
      expect(readFileSync(stage)).toEqual(before);
    } else
      await expect(
        run({
          ...f.input,
          dbPath: join(f.input.collectionPath, "status.json"),
          checkpointPath: join(f.input.collectionPath, "checkpoint.json"),
        }),
      ).rejects.toThrow("collision");
    expect(hash(readFileSync(f.input.dbPath))).toBe(f.input.baselineDbSha256);
  },
);
it("index以外のSDK依存変更とoperation指紋変更を再開時に拒否する", async () => {
  const f = await fixture();
  await run(f.input);
  const before = hash(readFileSync(f.input.dbPath)),
    dependency = readFileSync(f.dependency);
  writeFileSync(f.dependency, "changed");
  await expect(run(f.input)).rejects.toThrow("dependency changed");
  expect(hash(readFileSync(f.input.dbPath))).toBe(before);
  writeFileSync(f.dependency, dependency);
  const checkpoint = JSON.parse(readFileSync(f.input.checkpointPath, "utf8"));
  checkpoint.binding.operationIdentity.scriptSha256 = "0".repeat(64);
  writeFileSync(f.input.checkpointPath, JSON.stringify(checkpoint));
  await expect(run(f.input)).rejects.toThrow("inputs changed");
});
it("collect再検証後のsource差替えを取込前に拒否する", async () => {
  const f = await fixture(),
    good = await mocks.collect();
  mocks.collect.mockImplementationOnce(async () => {
    writeFileSync(
      f.part,
      JSON.stringify({
        ...f.manifest,
        source: { ...f.manifest.source, observedAt: "2026-10-30T00:00:00Z" },
      }),
    );
    return good;
  });
  await expect(run(f.input)).rejects.toThrow("source changed");
  expect(hash(readFileSync(f.input.dbPath))).toBe(f.input.baselineDbSha256);
});
it.each(["same-volume", "separate-tmp-volume"])(
  "%sのscratch予算を合算し不足時は無変更で拒否する",
  async (mode) => {
    const f = await fixture(),
      space = vi.mocked(statfsSync).getMockImplementation()!,
      stats = vi.mocked(statSync).getMockImplementation()!,
      original = await vi.importActual<typeof import("node:fs")>("node:fs"),
      reserve = 34n * 1024n ** 3n,
      limit = 640n * 1024n ** 2n;
    vi.mocked(statfsSync).mockImplementation(((p: any, options: any) => {
      const actual = original.statfsSync(p, options);
      const bytes =
        mode === "same-volume"
          ? reserve + 2n * limit + 63n * 1024n ** 2n
          : String(p) === tmpdir()
            ? reserve + limit - 1n
            : 2n ** 50n;
      return {
        ...actual,
        bsize: options?.bigint ? 1n : 1,
        bavail: options?.bigint ? bytes : Number(bytes),
      };
    }) as typeof statfsSync);
    vi.mocked(statSync).mockImplementation(((p: any, options: any) => {
      const actual = original.statSync(p, options);
      return mode === "separate-tmp-volume" && String(p) === tmpdir()
        ? { ...actual, dev: options?.bigint ? 99999999n : 99999999 }
        : actual;
    }) as typeof statSync);
    try {
      await expect(run(f.input)).rejects.toThrow("Capacity reserve");
      expect(hash(readFileSync(f.input.dbPath))).toBe(f.input.baselineDbSha256);
      expect(existsSync(f.input.checkpointPath + ".stage.sqlite")).toBe(false);
    } finally {
      vi.mocked(statfsSync).mockImplementation(space);
      vi.mocked(statSync).mockImplementation(stats);
    }
  },
);
it("既適用XMLが同じでもsource/manifest変更をno-op completeにしない", async () => {
  const f = await fixture();
  await run(f.input);
  const before = hash(readFileSync(f.input.dbPath)),
    good = await mocks.collect();
  mocks.collect.mockResolvedValue({
    ...good,
    completed: good.completed.map((d: any) => ({
      ...d,
      source: { ...d.source, sourceUrl: "https://example.test/replaced" },
    })),
  });
  await expect(run(f.input)).rejects.toThrow("Applied source changed");
  expect(hash(readFileSync(f.input.dbPath))).toBe(before);
  mocks.collect.mockResolvedValue(good);
  writeFileSync(f.part, JSON.stringify({ ...f.manifest, part: "replaced.xml" }));
  await expect(run(f.input)).rejects.toThrow("Applied manifest changed");
  expect(hash(readFileSync(f.input.dbPath))).toBe(before);
});
it("出所不明の既存stageを削除しない", async () => {
  const f = await fixture(),
    stage = f.input.checkpointPath + ".stage.sqlite";
  writeFileSync(stage, "unrelated original");
  await expect(run(f.input)).rejects.toThrow("Unknown stage retained");
  expect(readFileSync(stage, "utf8")).toBe("unrelated original");
});
it("連続2公表日を1日budgetずつ適用し、未作成日を挟んで再開する", async () => {
  const f = await fixture(),
    good = await mocks.collect(),
    verified = join(f.input.collectionPath, "days/2026-11-02/attempt-0001/verified");
  mkdirSync(verified, { recursive: true, mode: 0o700 });
  const text = xml(
      row({ process: "12", name: "次の名称", updateDate: "2026-11-02", changeDate: "2026-11-02" }),
    ),
    file = join(verified, "part-000.xml"),
    part = join(verified, "part-000-import.json"),
    source = { ...f.manifest.source, dataDate: "2026-11-02", observedAt: "2026-11-03T00:00:00Z" };
  writeFileSync(file, text);
  writeFileSync(
    part,
    JSON.stringify({ file, part: "diff_20261102.xml", source, sha256: hash(text) }),
  );
  writeFileSync(
    f.input.queryPath,
    JSON.stringify({ from: "2026-10-30", through: "2026-11-02", knownAt: "2026-11-03T00:00:00Z" }),
  );
  mocks.collect.mockResolvedValue({
    ...good,
    completed: [
      ...good.completed,
      { date: "2026-11-02", sha256: hash(text), source, importManifest: part },
    ],
  });
  const first = await run({ ...f.input, maxDays: 1 });
  expect(first).toMatchObject({ status: "pending", appliedThisRun: 1 });
  const second = await run({ ...f.input, maxDays: 1 });
  expect(second).toMatchObject({ status: "complete", appliedThisRun: 1 });
  expect(second.checkpoint.applied.map((x: any) => x.date)).toEqual(["2026-10-30", "2026-11-02"]);
});
it("実BlockStore/reconstructのcoverage-gapは不採用とし元DBを保持する", async () => {
  const f = await fixture(),
    good = await mocks.collect(),
    verified = join(f.input.collectionPath, "days/2026-11-02/attempt-0001/verified");
  mkdirSync(verified, { recursive: true, mode: 0o700 });
  const text = xml(
      row({ process: "12", name: "gap", updateDate: "2026-11-02", changeDate: "2026-11-02" }),
    ),
    file = join(verified, "part-000.xml"),
    part = join(verified, "part-000-import.json"),
    source = { ...f.manifest.source, dataDate: "2026-11-02", observedAt: "2026-11-03T00:00:00Z" };
  writeFileSync(file, text);
  writeFileSync(
    part,
    JSON.stringify({ file, part: "diff_20261102.xml", source, sha256: hash(text) }),
  );
  writeFileSync(
    f.input.queryPath,
    JSON.stringify({ from: "2026-10-30", through: "2026-11-02", knownAt: "2026-11-03T00:00:00Z" }),
  );
  mocks.collect.mockResolvedValue({
    ...good,
    status: "pending",
    completed: [{ date: "2026-11-02", sha256: hash(text), source, importManifest: part }],
  });
  await expect(run(f.input)).rejects.toThrow("Delivery chain did not resolve");
  expect(hash(readFileSync(f.input.dbPath))).toBe(f.input.baselineDbSha256);
  expect(existsSync(f.input.checkpointPath)).toBe(false);
});
it.each([undefined, {}, { selection: {} }, { selection: { status: "available" } }])(
  "SDK応答の必須shape欠損を成功扱いしない",
  async (value) => {
    const f = await fixture(),
      spy = vi
        .spyOn(CorporateRegistryBlockStore.prototype, "reconstruct")
        .mockReturnValueOnce(value as any);
    try {
      await expect(run(f.input)).rejects.toThrow("Invalid SDK verification response");
      expect(hash(readFileSync(f.input.dbPath))).toBe(f.input.baselineDbSha256);
    } finally {
      spy.mockRestore();
    }
  },
);
it("実flock競合のCLIは固定stderrとexit75で終わり元DBを変えない", async () => {
  const f = await fixture(),
    { spawnSync } = await import("node:child_process"),
    { openSync, closeSync } = await import("node:fs"),
    fd = openSync(f.input.dbPath + ".lock", "a+", 0o600);
  try {
    const held = spawnSync("/usr/bin/flock", ["-n", "3"], {
      stdio: ["ignore", "pipe", "pipe", fd],
    });
    expect(held.status).toBe(0);
    const mapping = {
      calendar: f.input.calendarPath,
      query: f.input.queryPath,
      "public-key": f.input.publicKeyPath,
      fingerprint: f.input.fingerprint,
      collection: f.input.collectionPath,
      "baseline-manifest": f.input.baselineManifestPath,
      "baseline-db-sha256": f.input.baselineDbSha256,
      db: f.input.dbPath,
      checkpoint: f.input.checkpointPath,
      sdk: f.input.sdkPath,
      "runtime-verifier": f.input.runtimeVerifierPath,
      "runtime-verifier-sha256": f.input.runtimeVerifierSha256,
      "corporate-number": f.input.corporateNumber,
    };
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("scripts/roadmap/apply-corporate-registry-differences.mts"),
        ...Object.entries(mapping).flatMap(([key, value]) => ["--" + key, value]),
      ],
      { encoding: "utf8", timeout: 30000, maxBuffer: 1024 ** 2 },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(75);
    expect(result.stderr.trim()).toBe("Corporate registry difference application failed.");
    expect(result.stdout).toBe("");
    expect(hash(readFileSync(f.input.dbPath))).toBe(f.input.baselineDbSha256);
    expect(existsSync(f.input.checkpointPath)).toBe(false);
  } finally {
    closeSync(fd);
  }
});
it.each([
  ["before-db-rename", "receipt"],
  ["before-db-rename", "source"],
  ["before-checkpoint-write", "receipt"],
  ["before-checkpoint-write", "source"],
] as const)("%s後の%s変更はcommit回復前に拒否し実DBを保持する", async (phase, change) => {
  const f = await fixture(),
    native = await vi.importActual<typeof import("node:fs")>("node:fs");
  let interrupted = false;
  vi.mocked(renameSync).mockImplementation((from, to) => {
    if (
      !interrupted &&
      (phase === "before-db-rename"
        ? String(from).endsWith(".stage.sqlite")
        : String(to) === f.input.checkpointPath)
    ) {
      interrupted = true;
      throw Error("injected handoff interruption");
    }
    native.renameSync(from, to);
  });
  try {
    await expect(run(f.input)).rejects.toThrow("handoff interruption");
    const before = hash(readFileSync(f.input.dbPath)),
      good = await mocks.collect();
    if (change === "receipt")
      mocks.collect.mockRejectedValueOnce(Error("retained receipt changed"));
    else
      mocks.collect.mockResolvedValueOnce({
        ...good,
        completed: good.completed.map((d: any) => ({
          ...d,
          source: { ...d.source, observedAt: "2026-10-30T00:00:00Z" },
        })),
      });
    await expect(run(f.input)).rejects.toThrow(
      change === "receipt" ? "retained receipt changed" : "Applied source changed",
    );
    expect(hash(readFileSync(f.input.dbPath))).toBe(before);
    expect(existsSync(f.input.checkpointPath)).toBe(false);
    expect(existsSync(f.input.checkpointPath + ".commit.json")).toBe(true);
    expect(await run(f.input)).toMatchObject({ status: "complete", appliedThisRun: 0 });
  } finally {
    vi.mocked(renameSync).mockImplementation(native.renameSync);
  }
});
it("collect中のcalendar副入力変更をcommit前に拒否し元DBを保持する", async () => {
  const f = await fixture(),
    good = await mocks.collect(),
    calendar = JSON.parse(readFileSync(f.input.calendarPath, "utf8"));
  mocks.collect.mockImplementationOnce(async () => {
    const html = readFileSync(calendar.policy.file, "utf8") + " ";
    writeFileSync(calendar.policy.file, html);
    return {
      ...good,
      calendar: {
        ...good.calendar,
        sources: {
          ...good.calendar.sources,
          policy: { ...good.calendar.sources.policy, inputTextSha256: hash(html) },
        },
      },
    };
  });
  await expect(run(f.input)).rejects.toThrow("Calendar sources changed");
  expect(hash(readFileSync(f.input.dbPath))).toBe(f.input.baselineDbSha256);
  expect(existsSync(f.input.checkpointPath)).toBe(false);
  expect(existsSync(f.input.checkpointPath + ".stage.sqlite")).toBe(false);
});
it.each([
  ["constructor-probe", 3],
  ["import-journal", 4],
  ["readonly-probe", 5],
] as const)("%s段階の追加容量不足は元DB不変で止める", async (_phase, target) => {
  const f = await fixture(),
    previous = vi.mocked(statfsSync).getMockImplementation()!,
    native = await vi.importActual<typeof import("node:fs")>("node:fs");
  let roots = 0,
    reached = false;
  vi.mocked(statfsSync).mockImplementation(((p: any, options: any) => {
    const actual = native.statfsSync(p, options);
    if (String(p) === f.dir) roots++;
    const low = String(p) === f.dir && roots === target;
    reached ||= low;
    const bytes = low ? 34n * 1024n ** 3n + 640n * 1024n ** 2n + 63n * 1024n ** 2n : 2n ** 50n;
    return {
      ...actual,
      bsize: options?.bigint ? 1n : 1,
      bavail: options?.bigint ? bytes : Number(bytes),
    };
  }) as typeof statfsSync);
  try {
    await expect(run(f.input)).rejects.toThrow("Capacity reserve");
    expect(reached).toBe(true);
    expect(hash(readFileSync(f.input.dbPath))).toBe(f.input.baselineDbSha256);
    expect(existsSync(f.input.checkpointPath + ".stage.sqlite")).toBe(false);
  } finally {
    vi.mocked(statfsSync).mockImplementation(previous);
  }
});
it("実SDKのwriter constructor probeはimport前に消え、reader probeはcloseまで存在する", async () => {
  const f = await fixture(),
    importFile = CorporateRegistryBlockStore.prototype.importFile,
    reconstruct = CorporateRegistryBlockStore.prototype.reconstruct;
  let writerChecked = false,
    readerChecked = false;
  const writer = vi
    .spyOn(CorporateRegistryBlockStore.prototype, "importFile")
    .mockImplementation(function (
      this: CorporateRegistryBlockStore,
      ...args: Parameters<typeof importFile>
    ) {
      expect((this as any).scratch).toBeUndefined();
      writerChecked = true;
      return importFile.apply(this, args);
    });
  const reader = vi
    .spyOn(CorporateRegistryBlockStore.prototype, "reconstruct")
    .mockImplementation(function (
      this: CorporateRegistryBlockStore,
      ...args: Parameters<typeof reconstruct>
    ) {
      expect(existsSync((this as any).scratch + "/probe.sqlite")).toBe(true);
      readerChecked = true;
      return reconstruct.apply(this, args);
    });
  try {
    expect(await run(f.input)).toMatchObject({ status: "complete" });
    expect(writerChecked).toBe(true);
    expect(readerChecked).toBe(true);
  } finally {
    writer.mockRestore();
    reader.mockRestore();
  }
});
