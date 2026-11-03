import { it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { CorporateRegistryBlockStore } from "../src/db/corporate-registry-block-store";
import {
  registryStreamXml as xml,
  registryStreamRow as row,
  registryStreamSource as source,
} from "./fixtures/corporate-registry-stream";
import { registryCalendarFixture } from "./fixtures/corporate-registry-calendar";
import { signedRegistryFixture } from "./fixtures/signed-corporate-registry";
import { createStoredZip } from "./fixtures/create-stored-zip";
import { differenceListing } from "./fixtures/registry-download-response";
import { runCorporateRegistryDaily as run } from "../scripts/roadmap/run-corporate-registry-daily.mts";
vi.mock("node:fs", async (original) => {
  const real = await original<typeof import("node:fs")>(),
    rename = vi.fn(real.renameSync);
  return { ...real, renameSync: rename, default: { ...(real as any).default, renameSync: rename } };
});
const FORMAT = "edinet-ts-corporate-registry-daily-v1",
  hash = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
const active: { close: () => void; env: string | undefined }[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const f of active.splice(0)) {
    if (f.env === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = f.env;
    f.close();
  }
});
async function fixture() {
  const f = signedRegistryFixture();
  active.push({ close: f.close, env: process.env.NODE_OPTIONS });
  const root = path.join(f.root, "daily"),
    runtime = path.join(f.root, "runtime"),
    configPath = path.join(f.root, "config.json"),
    calendarPath = path.join(f.root, "calendar.json"),
    serverPath = path.join(f.root, "server.json"),
    requestLog = path.join(f.root, "requests.jsonl"),
    deployment = path.join(f.root, "deployment.json"),
    settings = path.join(f.root, "settings.json"),
    metadata = path.join(f.root, "metadata.json");
  fs.mkdirSync(root, { mode: 0o700 });
  const full = path.join(f.root, "full.xml"),
    fullText = xml(row({ updateDate: "2026-10-23", changeDate: "2026-10-20" })),
    db = path.join(root, "current.sqlite");
  fs.writeFileSync(full, fullText);
  const store = new CorporateRegistryBlockStore(db);
  let file;
  try {
    file = (
      await store.importFile({
        file: full,
        part: "full.xml",
        sha256: hash(fullText),
        source: {
          ...source,
          sourceUrl: "https://www.houjin-bangou.nta.go.jp/download/zenken/",
          kind: "full",
          purpose: "download",
          dataDate: "2026-10-23",
        },
      })
    ).file;
  } finally {
    store.close();
  }
  const manifests = [{ scope: "national", expectedParts: 1, fileIds: [file.id] }],
    bootId = hash("bootstrap"),
    bootDir = path.join(root, "jobs", bootId);
  fs.mkdirSync(bootDir, { recursive: true, mode: 0o700 });
  const receipt = {
    format: FORMAT,
    jobId: bootId,
    previousReceiptSha: null,
    dbShaAtAcceptance: hash(fs.readFileSync(db)),
    lastActualDataDate: "2026-10-23",
    calendarCoverageThrough: "2026-10-23",
    manifests,
  };
  fs.writeFileSync(path.join(bootDir, "accepted.json"), JSON.stringify(receipt));
  fs.writeFileSync(
    path.join(root, "current.json"),
    JSON.stringify({
      format: FORMAT,
      jobId: bootId,
      receiptSha256: hash(fs.readFileSync(path.join(bootDir, "accepted.json"))),
      dbSha256: receipt.dbShaAtAcceptance,
      lastActualDataDate: receipt.lastActualDataDate,
      calendarCoverageThrough: receipt.calendarCoverageThrough,
      manifests,
    }),
  );
  const calendar = registryCalendarFixture(),
    policy = path.join(f.root, "policy.html"),
    csv = path.join(f.root, "holidays.csv");
  fs.writeFileSync(policy, calendar.policy.html);
  fs.writeFileSync(
    csv,
    Buffer.concat([
      Buffer.from(
        "8d9196af82cc8f6a93fa81458b7893fa8c8e93fa2c8d9196af82cc8f6a93fa81458b7893fa96bc8fcc0d0a",
        "hex",
      ),
      Buffer.from(Array.from({ length: 11 }, (_, i) => `${2017 + i}/1/1,Holiday\r\n`).join("")),
    ]),
  );
  fs.writeFileSync(
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
  fs.writeFileSync(deployment, JSON.stringify({ dailySettings: settings }));
  fs.writeFileSync(settings, JSON.stringify({ metadataConfigPath: metadata }));
  fs.writeFileSync(
    metadata,
    JSON.stringify({ checkpointPath: path.join(f.root, "metadata-checkpoint.json") }),
  );
  const runtimeFiles = [
    "index",
    "utils/with-operational-locks",
    "companies/registry/collect-differences",
    "companies/registry/download-session",
  ];
  for (const name of runtimeFiles) {
    const dest = path.join(runtime, "dist", name + ".js");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(
      dest,
      "export * from " +
        JSON.stringify(pathToFileURL(path.resolve("src/" + name + ".ts")).href) +
        ";",
    );
  }
  const cli = path.join(runtime, "dist/cli.js");
  fs.writeFileSync(
    cli,
    `import fs from'node:fs';import {planCorporateRegistryDifferences as plan}from ${JSON.stringify(pathToFileURL(path.resolve("src/companies/registry/publication-calendar.ts")).href)};const flag=k=>process.argv[process.argv.indexOf(k)+1],c=JSON.parse(fs.readFileSync(flag('--calendar'))),q=JSON.parse(fs.readFileSync(flag('--query')));console.log(JSON.stringify(plan({policy:{sourceUrl:c.policy.sourceUrl,observedAt:c.policy.observedAt,html:fs.readFileSync(c.policy.file,'utf8')},holidays:{sourceUrl:c.holidays.sourceUrl,observedAt:c.holidays.observedAt,csv:new TextDecoder('shift_jis').decode(fs.readFileSync(c.holidays.file))}},q)));`,
  );
  const preload = path.join(runtime, "fetch.mjs");
  fs.writeFileSync(
    preload,
    `import fs from'node:fs';import{syncBuiltinESMExports}from'node:module';const stat=fs.statfsSync;fs.statfsSync=(p,o)=>({...stat(p,o),bavail:o?.bigint?2n**40n:2**40,bsize:o?.bigint?4096n:4096});const rename=fs.renameSync;fs.renameSync=(a,b)=>{const control=fs.existsSync(${JSON.stringify(serverPath)})?JSON.parse(fs.readFileSync(${JSON.stringify(serverPath)})):{};const marker=${JSON.stringify(path.join(f.root, "apply-interruption.marker"))};const selected=control.applyCutpoint==='before-db'?String(a).endsWith('.stage.sqlite')&&String(b).endsWith('/current.sqlite'):control.applyCutpoint==='before-checkpoint'&&/\\/apply-[a-f0-9]{64}\\.json$/.test(String(b));if(selected&&!fs.existsSync(marker)){fs.writeFileSync(marker,'stopped');throw Error('injected apply handoff');}const result=rename(a,b);if(control.reserveCutpoint&&String(b).endsWith('/http.json')&&JSON.parse(fs.readFileSync(b)).entries.some(e=>e.outcome==='reserved'))process.kill(process.pid,'SIGKILL');return result;};syncBuiltinESMExports();globalThis.fetch=async(url,options={})=>{if(!String(url).startsWith('https://www.houjin-bangou.nta.go.jp/download/sabun/'))throw Error('No real network');const c=JSON.parse(fs.readFileSync(${JSON.stringify(serverPath)}));fs.appendFileSync(${JSON.stringify(requestLog)},JSON.stringify({url,method:options.method??'GET',at:Date.now()})+'\\n');if(options.method!=='POST'&&c.delayMs)await new Promise(r=>setTimeout(r,c.delayMs));if(options.method!=='POST'&&c.changeDeployment)fs.writeFileSync(${JSON.stringify(deployment)},JSON.stringify({dailySettings:'changed'}));if(c.fail)throw Error('fixture unpublished');const body=options.method==='POST'?fs.readFileSync(c.zip):Buffer.from(c.html),r=new Response(body,{status:200,headers:{'Content-Length':String(body.length)}});Object.defineProperty(r,'url',{value:String(url)});return r;};`,
  );
  const verifier = path.join(runtime, "run-financial-pinned.mjs"),
    manifest = path.join(runtime, "runtime-manifest.json");
  fs.writeFileSync(
    manifest,
    JSON.stringify(
      [...runtimeFiles.map((n) => path.join(runtime, "dist", n + ".js")), cli, preload].map(
        (p) => ({ path: p, sha256: hash(fs.readFileSync(p)) }),
      ),
    ),
  );
  fs.writeFileSync(
    verifier,
    `import fs from'node:fs';import{createHash}from'node:crypto';for(const f of JSON.parse(fs.readFileSync(new URL('./runtime-manifest.json',import.meta.url))))if(createHash('sha256').update(fs.readFileSync(f.path)).digest('hex')!==f.sha256)throw Error('changed fixture runtime');console.log(JSON.stringify({status:'verified',networkRequested:false}));`,
  );
  const apply = path.resolve("scripts/roadmap/apply-corporate-registry-differences.mts"),
    config = {
      format: FORMAT,
      root,
      calendarPath,
      publicKeyPath: f.key,
      fingerprint: f.fingerprint,
      sdkPath: path.join(runtime, "dist/index.js"),
      runtimeVerifierPath: verifier,
      runtimeVerifierSha256: hash(fs.readFileSync(verifier)),
      applyScriptPath: apply,
      applyScriptSha256: hash(fs.readFileSync(apply)),
      metadataDeploymentPath: deployment,
      probeCorporateNumber: "1010001001202",
      networkEnabled: true,
    };
  fs.writeFileSync(configPath, JSON.stringify(config));
  process.env.NODE_OPTIONS = (
    (process.env.NODE_OPTIONS ?? "") +
    " --import=tsx --import=" +
    pathToFileURL(preload).href
  ).trim();
  const setDay = (day: string, controls: any = {}) => {
    const text = xml(row({ process: "12", updateDate: day, changeDate: day, name: "name-" + day }));
    fs.writeFileSync(f.xml, text);
    fs.rmSync(f.xml + ".asc");
    f.gpg(["--armor", "--detach-sign", f.xml]);
    const zip = path.join(f.root, "source-" + day + ".zip");
    fs.writeFileSync(
      zip,
      createStoredZip([
        ["diff_" + day.replaceAll("-", "") + ".xml", text],
        ["diff_" + day.replaceAll("-", "") + ".xml.asc", fs.readFileSync(f.xml + ".asc")],
      ]),
    );
    fs.writeFileSync(
      serverPath,
      JSON.stringify({ zip, html: differenceListing(day), ...controls }),
    );
    return zip;
  };
  setDay("2026-10-26");
  const pointer = () => JSON.parse(fs.readFileSync(path.join(root, "current.json"), "utf8")),
    requests = () =>
      fs.existsSync(requestLog)
        ? fs
            .readFileSync(requestLog, "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((x) => JSON.parse(x))
        : [];
  return {
    ...f,
    root,
    db,
    config,
    configPath,
    metadata,
    deployment,
    requestLog,
    serverPath,
    pointer,
    requests,
    setDay,
    initialHash: hash(fs.readFileSync(db)),
    bootId,
  };
}
it("休日は架空raw/checkpointを作らずcoverageだけ受理する", async () => {
  const f = await fixture(),
    r = await run(f.configPath, { targetThrough: "2026-10-25" });
  expect(r.status).toBe("accepted");
  expect(r.current.lastActualDataDate).toBe("2026-10-23");
  expect(r.current.calendarCoverageThrough).toBe("2026-10-25");
  expect(hash(fs.readFileSync(f.db))).toBe(f.initialHash);
  expect(f.requests()).toHaveLength(0);
  expect(fs.existsSync(path.join(f.root, "apply-" + r.jobId + ".json"))).toBe(false);
}, 20000);
it("実SDK/署名済みfixtureで2jobを適用し旧受理SHAとcurrentを区別する", async () => {
  const f = await fixture(),
    a = await run(f.configPath, { targetThrough: "2026-10-26", acquire: true });
  expect(a.status).toBe("accepted");
  const first = fs.readFileSync(path.join(f.root, "jobs", a.jobId, "accepted.json"));
  f.setDay("2026-10-27");
  const b = await run(f.configPath, { targetThrough: "2026-10-27", acquire: true });
  expect(b.status).toBe("accepted");
  expect(b.current.dbSha256).not.toBe(a.current.dbSha256);
  expect(fs.readFileSync(path.join(f.root, "jobs", a.jobId, "accepted.json"))).toEqual(first);
  expect((await run(f.configPath, { targetThrough: "2026-10-26" })).status).toBe("up-to-date");
  expect(f.requests()).toHaveLength(4);
}, 40000);
it("既定は前JST日horizonでも1回に最初の公表1日だけ進める", async () => {
  const f = await fixture(),
    r = await run(f.configPath, { acquire: true });
  expect(r.status).toBe("accepted");
  expect(r.current.lastActualDataDate).toBe("2026-10-26");
  expect(f.requests()).toHaveLength(2);
}, 20000);
it("未来日は通信/intent前に拒否し元DBを保持する", async () => {
  const f = await fixture();
  await expect(run(f.configPath, { targetThrough: "2099-01-01", acquire: true })).rejects.toThrow(
    "Future target",
  );
  expect(f.requests()).toHaveLength(0);
  expect(hash(fs.readFileSync(f.db))).toBe(f.initialHash);
  expect(fs.existsSync(path.join(f.root, "pending.json"))).toBe(false);
});
it("offline pendingを同じfrozen jobから取得再開する", async () => {
  const f = await fixture(),
    a = await run(f.configPath, { targetThrough: "2026-10-26" });
  expect(a.status).toBe("pending-source");
  const pending = fs.readFileSync(path.join(f.root, "pending.json"));
  const b = await run(f.configPath, { targetThrough: "2026-10-27", acquire: true });
  expect(b.status).toBe("accepted");
  expect(b.jobId).toBe(JSON.parse(pending.toString()).jobId);
  expect(b.current.lastActualDataDate).toBe("2026-10-26");
}, 30000);
it("200応答の未公表をpendingで保存し同jobの有限予算内で再開する", async () => {
  const f = await fixture();
  f.setDay("2026-10-27");
  const a = await run(f.configPath, { targetThrough: "2026-10-26", acquire: true });
  expect(a.status).toBe("pending-acquisition");
  expect(a.networkRequestsThisInvocation).toBe(1);
  expect(hash(fs.readFileSync(f.db))).toBe(f.initialHash);
  f.setDay("2026-10-26");
  const b = await run(f.configPath, { acquire: true });
  expect(b.current.lastActualDataDate).toBe("2026-10-26");
  expect(b.networkRequestsThisInvocation).toBe(2);
  expect(b.jobRespondedRequestsTotal).toBe(3);
}, 30000);
it("応答未確定の要求はjobに永続化して自動再要求しない", async () => {
  const f = await fixture();
  f.setDay("2026-10-26", { fail: true });
  const a = await run(f.configPath, { targetThrough: "2026-10-26", acquire: true });
  expect(a.reason).toBe("uncertain-request-requires-review");
  expect(a.networkRequestsThisInvocation).toBeNull();
  expect(a.httpReservationsThisInvocation).toBe(1);
  expect(a.jobUncertainRequests).toBe(1);
  f.setDay("2026-10-26");
  const b = await run(f.configPath, { acquire: true });
  expect(b.reason).toBe("uncertain-request-requires-review");
  expect(b.networkRequestsThisInvocation).toBe(0);
  expect(f.requests()).toHaveLength(1);
  expect(hash(fs.readFileSync(f.db))).toBe(f.initialHash);
}, 30000);
it("未公表3回のjob予算を再実行で増やさない", async () => {
  const f = await fixture();
  f.setDay("2026-10-27");
  for (let i = 0; i < 3; i++) {
    const r = await run(f.configPath, { targetThrough: "2026-10-26", acquire: true });
    expect(r.status).toBe("pending-acquisition");
    expect(r.jobAcquisitionAttempts).toBe(i + 1);
  }
  f.setDay("2026-10-26");
  const r = await run(f.configPath, { acquire: true });
  expect(r.reason).toBe("job-acquisition-attempt-budget-exhausted");
  expect(r.networkRequestsThisInvocation).toBe(0);
  expect(f.requests()).toHaveLength(3);
  expect(hash(fs.readFileSync(f.db))).toBe(f.initialHash);
}, 40000);
it("要求予約直後の子停止は未送信と推測せず自動再要求を止める", async () => {
  const f = await fixture();
  f.setDay("2026-10-26", { reserveCutpoint: true });
  const a = await run(f.configPath, { targetThrough: "2026-10-26", acquire: true });
  expect(a.reason).toBe("uncertain-request-requires-review");
  expect(a.networkRequestsThisInvocation).toBeNull();
  expect(a.jobReservedRequestsTotal).toBe(1);
  expect(a.jobRespondedRequestsTotal).toBe(0);
  f.setDay("2026-10-26");
  const b = await run(f.configPath, { acquire: true });
  expect(b.reason).toBe("uncertain-request-requires-review");
  expect(f.requests()).toHaveLength(0);
  expect(hash(fs.readFileSync(f.db))).toBe(f.initialHash);
}, 25000);
it.each(["query.json", "baseline.json", "job.json", "pending.json"])(
  "初期化%s保存後の停止から既知入力を削除せず再開する",
  async (name) => {
    const f = await fixture(),
      native = await vi.importActual<typeof import("node:fs")>("node:fs");
    let stopped = false;
    vi.mocked(fs.renameSync).mockImplementation((a, b) => {
      native.renameSync(a, b);
      if (!stopped && path.basename(String(b)) === name) {
        stopped = true;
        throw Error("injected init interruption");
      }
    });
    await expect(run(f.configPath, { targetThrough: "2026-10-26" })).rejects.toThrow(
      "init interruption",
    );
    expect(stopped).toBe(true);
    vi.mocked(fs.renameSync).mockImplementation(native.renameSync);
    const r = await run(f.configPath, { targetThrough: "2026-10-26", acquire: true });
    expect(r.status).toBe("accepted");
    expect(f.requests()).toHaveLength(2);
  },
  30000,
);
it("未封印collectionの未知内容は上書き/削除せず停止する", async () => {
  const f = await fixture(),
    native = await vi.importActual<typeof import("node:fs")>("node:fs");
  let dir = "";
  const mkdir = fs.mkdirSync;
  vi.spyOn(fs, "mkdirSync").mockImplementation(((p: any, options: any) => {
    const result = mkdir(p, options);
    if (path.basename(String(p)) === "collection") {
      dir = String(p);
      fs.writeFileSync(path.join(dir, "unknown-original"), "preserve");
      throw Error("init directory interruption");
    }
    return result;
  }) as typeof fs.mkdirSync);
  await expect(run(f.configPath, { targetThrough: "2026-10-26" })).rejects.toThrow(
    "init directory",
  );
  vi.mocked(fs.mkdirSync).mockRestore();
  await expect(run(f.configPath, { targetThrough: "2026-10-26" })).rejects.toThrow(
    "Unsealed collection",
  );
  expect(native.readFileSync(path.join(dir, "unknown-original"), "utf8")).toBe("preserve");
  expect(f.requests()).toHaveLength(0);
  expect(hash(fs.readFileSync(f.db))).toBe(f.initialHash);
}, 20000);
it("独立parent監視のメモリ不足は取得子だけを停止し元DBを保持する", async () => {
  const f = await fixture(),
    read = fs.readFileSync;
  f.setDay("2026-10-26", { delayMs: 15000 });
  vi.spyOn(fs, "readFileSync").mockImplementation(((p: any, options: any) =>
    String(p) === "/proc/meminfo" && f.requests().length
      ? "MemAvailable: 1024 kB\n"
      : read(p, options)) as typeof fs.readFileSync);
  await expect(run(f.configPath, { targetThrough: "2026-10-26", acquire: true })).rejects.toThrow(
    "Daily resource stop",
  );
  vi.mocked(fs.readFileSync).mockRestore();
  expect(hash(fs.readFileSync(f.db))).toBe(f.initialHash);
  expect(f.pointer().jobId).toBe(f.bootId);
  const pending = JSON.parse(fs.readFileSync(path.join(f.root, "pending.json"), "utf8"));
  expect(pending.execution).toBeNull();
  const reports = fs
    .readdirSync(path.join(f.root, "jobs", pending.jobId))
    .filter((n) => /^worker-/.test(n));
  expect(
    reports.some(
      (n) =>
        JSON.parse(fs.readFileSync(path.join(f.root, "jobs", pending.jobId, n), "utf8")).stopped ===
        "resource-or-time-limit",
    ),
  ).toBe(true);
}, 25000);
it("apply監査中はmetadata通信lockを解放する", async () => {
  const f = await fixture(),
    { spawnSync } = await import("node:child_process");
  let checked = false,
    free = false;
  const timer = setInterval(() => {
    const p = path.join(f.root, "pending.json");
    if (!fs.existsSync(p)) return;
    const execution = JSON.parse(fs.readFileSync(p, "utf8")).execution;
    if (!execution?.command?.includes(f.config.applyScriptPath)) return;
    checked = true;
    const fd = fs.openSync(
      JSON.parse(fs.readFileSync(f.metadata, "utf8")).checkpointPath + ".lock",
      "a+",
    );
    try {
      free =
        spawnSync("/usr/bin/flock", ["-n", "3"], { stdio: ["ignore", "pipe", "pipe", fd] })
          .status === 0;
    } finally {
      fs.closeSync(fd);
    }
  }, 20);
  try {
    expect((await run(f.configPath, { targetThrough: "2026-10-26", acquire: true })).status).toBe(
      "accepted",
    );
  } finally {
    clearInterval(timer);
  }
  expect(checked).toBe(true);
  expect(free).toBe(true);
}, 30000);
it("親SIGKILL後も取得子の継承flockが二重writerを拒否し保存済入力から回復する", async () => {
  const f = await fixture(),
    { spawn } = await import("node:child_process");
  f.setDay("2026-10-26", { delayMs: 5000 });
  const parent = spawn(
    process.execPath,
    [
      path.resolve("scripts/roadmap/run-corporate-registry-daily.mts"),
      "--config",
      f.configPath,
      "--through",
      "2026-10-26",
      "--acquire",
    ],
    { stdio: "ignore" },
  );
  const closed = new Promise((resolve) => parent.once("close", resolve));
  const until = async (condition: () => boolean) => {
    const deadline = Date.now() + 15000;
    while (!condition()) {
      if (Date.now() >= deadline) throw Error("fixture child timeout");
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  let worker = 0,
    workerStart = "";
  try {
    await until(() => f.requests().length === 1);
    const execution = JSON.parse(
      fs.readFileSync(path.join(f.root, "pending.json"), "utf8"),
    ).execution;
    worker = execution.pid;
    workerStart = execution.start;
    parent.kill("SIGKILL");
    await closed;
    await expect(run(f.configPath, { acquire: true })).rejects.toMatchObject({ exitCode: 75 });
    await until(() => {
      try {
        return /^\S+ \(.+\) [ZX] /.test(fs.readFileSync(`/proc/${worker}/stat`, "utf8"));
      } catch (e: any) {
        if (e.code === "ENOENT") return true;
        throw e;
      }
    });
    const r = await run(f.configPath);
    expect(r.status).toBe("accepted");
    expect(r.networkRequestsThisInvocation).toBe(0);
    expect(f.requests()).toHaveLength(2);
  } finally {
    parent.kill("SIGKILL");
    if (worker) {
      try {
        const stat = fs.readFileSync(`/proc/${worker}/stat`, "utf8");
        if (stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] === workerStart)
          process.kill(worker, "SIGKILL");
      } catch {
        /* The owned fixture worker may already have exited. */
      }
    }
  }
}, 40000);
it("取得中のdeployment切替はapplyしない", async () => {
  const f = await fixture();
  f.setDay("2026-10-26", { changeDeployment: true });
  await expect(run(f.configPath, { targetThrough: "2026-10-26", acquire: true })).rejects.toThrow(
    "Communication deployment changed",
  );
  expect(hash(fs.readFileSync(f.db))).toBe(f.initialHash);
  expect(f.requests()).toHaveLength(1);
}, 20000);
it.each(["before-receipt", "before-pointer", "after-pointer"] as const)(
  "%s停止からfrozen jobを回復しcurrent/historyを混同しない",
  async (cut) => {
    const f = await fixture(),
      native = await vi.importActual<typeof import("node:fs")>("node:fs");
    let stopped = false;
    const remove = fs.rmSync;
    vi.mocked(fs.renameSync).mockImplementation((a, b) => {
      const hit =
        cut === "before-receipt"
          ? String(b).endsWith("/accepted.json")
          : cut === "before-pointer" && String(b) === path.join(f.root, "current.json");
      if (hit && !stopped) {
        stopped = true;
        throw Error("injected daily cutpoint");
      }
      native.renameSync(a, b);
    });
    const deletion = vi.spyOn(fs, "rmSync").mockImplementation((p, o) => {
      if (cut === "after-pointer" && !stopped && String(p) === path.join(f.root, "pending.json")) {
        stopped = true;
        throw Error("injected daily cutpoint");
      }
      return remove(p, o);
    });
    try {
      await expect(
        run(f.configPath, { targetThrough: "2026-10-26", acquire: true }),
      ).rejects.toThrow("daily cutpoint");
      const dbAfter = hash(fs.readFileSync(f.db));
      expect(dbAfter).not.toBe(f.initialHash);
      expect(fs.existsSync(path.join(f.root, "pending.json"))).toBe(true);
      const r = await run(f.configPath, { acquire: true });
      expect(r.status).toBe("accepted");
      expect(r.current.dbSha256).toBe(dbAfter);
      expect(r.networkRequestsThisInvocation).toBe(0);
      expect(f.requests()).toHaveLength(2);
      expect(fs.existsSync(path.join(f.root, "pending.json"))).toBe(false);
    } finally {
      vi.mocked(fs.renameSync).mockImplementation(native.renameSync);
      deletion.mockRestore();
    }
  },
  40000,
);
it.each(["before-db", "before-checkpoint"] as const)(
  "実apply子の%s停止はpointer旧状態のまま安全再開する",
  async (cut) => {
    const f = await fixture();
    f.setDay("2026-10-26", { applyCutpoint: cut });
    const first = await run(f.configPath, { targetThrough: "2026-10-26", acquire: true });
    expect(first.status).toBe("pending-apply");
    expect(f.pointer().jobId).toBe(f.bootId);
    expect(hash(fs.readFileSync(f.db)) === f.initialHash).toBe(cut === "before-db");
    const second = await run(f.configPath, { acquire: true });
    expect(second.status).toBe("accepted");
    expect(second.current.dbSha256).toBe(hash(fs.readFileSync(f.db)));
    expect(f.requests()).toHaveLength(2);
  },
  40000,
);
it("metadata通信lock競合は75で元DBを保持し、解放後だけ取得する", async () => {
  const f = await fixture(),
    { spawnSync } = await import("node:child_process"),
    lock = JSON.parse(fs.readFileSync(f.metadata, "utf8")).checkpointPath + ".lock",
    fd = fs.openSync(lock, "a+", 0o600);
  try {
    expect(
      spawnSync("/usr/bin/flock", ["-n", "3"], { stdio: ["ignore", "pipe", "pipe", fd] }).status,
    ).toBe(0);
    await expect(
      run(f.configPath, { targetThrough: "2026-10-26", acquire: true }),
    ).rejects.toMatchObject({ exitCode: 75 });
    expect(f.requests()).toHaveLength(0);
    expect(hash(fs.readFileSync(f.db))).toBe(f.initialHash);
  } finally {
    fs.closeSync(fd);
  }
  expect((await run(f.configPath, { acquire: true })).status).toBe("accepted");
}, 30000);
it("wrapper lock競合は75で二重job/書込みを作らない", async () => {
  const f = await fixture(),
    { spawnSync } = await import("node:child_process"),
    fd = fs.openSync(path.join(f.root, ".daily.lock"), "a+", 0o600);
  try {
    expect(
      spawnSync("/usr/bin/flock", ["-n", "3"], { stdio: ["ignore", "pipe", "pipe", fd] }).status,
    ).toBe(0);
    await expect(
      run(f.configPath, { targetThrough: "2026-10-26", acquire: true }),
    ).rejects.toMatchObject({ exitCode: 75 });
    expect(hash(fs.readFileSync(f.db))).toBe(f.initialHash);
    expect(fs.existsSync(path.join(f.root, "pending.json"))).toBe(false);
  } finally {
    fs.closeSync(fd);
  }
}, 15000);
it("署名済み原本/full/keyは複数jobとno-opでも不変", async () => {
  const f = await fixture(),
    a = await run(f.configPath, { targetThrough: "2026-10-26", acquire: true }),
    dir = path.join(f.root, "jobs", a.jobId, "collection/days/2026-10-26/attempt-0001"),
    paths = [
      path.join(f.root, "..", "full.xml"),
      f.key,
      path.join(dir, "delivery.zip"),
      path.join(dir, "verified/part-000.xml"),
      path.join(dir, "verified/part-000.xml.asc"),
    ],
    before = paths.map((p) => hash(fs.readFileSync(p)));
  f.setDay("2026-10-27");
  await run(f.configPath, { targetThrough: "2026-10-27", acquire: true });
  await run(f.configPath, { targetThrough: "2026-10-27" });
  expect(paths.map((p) => hash(fs.readFileSync(p)))).toEqual(before);
}, 40000);
