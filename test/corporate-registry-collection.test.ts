import { expect, it, vi } from "vitest";
vi.mock("../src/companies/registry/create-difference-plan", () => ({
  createRegistryDifferencePlan: vi.fn(),
}));
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { collectRegistryDifferences } from "../src/companies/registry/collect-differences";
import { createRegistryDifferencePlan } from "../src/companies/registry/create-difference-plan";
import * as retained from "../src/utils/retained-files";
import { signedRegistryFixture } from "./fixtures/signed-corporate-registry";
import { createStoredZip } from "./fixtures/create-stored-zip";
import { differenceListing, mockRegistrySession } from "./fixtures/registry-download-response";
const linux = it.runIf(process.platform === "linux");
async function fixture(
  run: (v: {
    out: string;
    plan: any;
    sessions: ReturnType<typeof mockRegistrySession>[];
    collect: (budget?: number) => ReturnType<typeof collectRegistryDifferences>;
    fail: () => void;
  }) => Promise<void>,
) {
  const f = signedRegistryFixture(),
    out = join(f.root, "collection"),
    space = vi.spyOn(retained, "reserveSpace").mockImplementation(() => {}),
    sessions: ReturnType<typeof mockRegistrySession>[] = [];
  const plan = {
    query: { from: "2026-10-24", through: "2026-10-26", knownAt: "2026-10-30T01:00:00Z" },
    calendar: { observedAt: "2026-10-30T00:00:00Z" },
    expectedDates: ["2026-10-26"],
    nonPublicationDays: [
      { date: "2026-10-24", reason: "weekend" },
      { date: "2026-10-25", reason: "weekend" },
    ],
  };
  vi.mocked(createRegistryDifferencePlan).mockResolvedValue(plan);
  let fail = false;
  const factory = (date: string) => {
    const stem = "diff_" + date.replaceAll("-", "") + ".xml",
      bytes = createStoredZip([
        [stem, readFileSync(f.xml)],
        [stem + ".asc", readFileSync(f.xml + ".asc")],
      ]),
      session = mockRegistrySession(bytes, differenceListing(date));
    session.controls.fail = fail;
    fail = false;
    sessions.push(session);
    return session.request;
  };
  const collect = (budget = 1) =>
    collectRegistryDifferences(
      join(f.root, "calendar.json"),
      join(f.root, "query.json"),
      f.key,
      f.fingerprint,
      out,
      budget,
      undefined,
      undefined,
      factory,
    );
  try {
    await run({
      out,
      plan,
      sessions,
      collect,
      fail() {
        fail = true;
      },
    });
  } finally {
    space.mockRestore();
    f.close();
  }
}
linux("予算0でも非公開日と未取得日を保持する", () =>
  fixture(async ({ collect, sessions }) => {
    expect(await collect(0)).toMatchObject({
      status: "pending",
      pendingDates: ["2026-10-26"],
      downloadsThisRun: 0,
      requestsThisRun: 0,
      nonPublicationDays: [{ date: "2026-10-24" }, { date: "2026-10-25" }],
    });
    expect(sessions).toEqual([]);
  }),
);
linux("取得済み日は通信せず署名を再検証する", () =>
  fixture(async ({ collect, sessions }) => {
    expect(await collect()).toMatchObject({
      status: "complete",
      downloadsThisRun: 1,
      requestsThisRun: 2,
    });
    expect(await collect(0)).toMatchObject({
      status: "complete",
      downloadsThisRun: 0,
      requestsThisRun: 0,
    });
    expect(sessions.flatMap((v) => v.calls)).toHaveLength(2);
  }),
);
linux("通信失敗は未取得として残し、次回に再開する", () =>
  fixture(async ({ collect, fail, out }) => {
    fail();
    await expect(collect()).rejects.toThrow();
    expect(JSON.parse(readFileSync(join(out, "status.json"), "utf8"))).toMatchObject({
      status: "failed",
      pendingDates: ["2026-10-26"],
      requestsThisRun: 2,
      downloadsThisRun: 1,
    });
    expect((await collect()).status).toBe("complete");
  }),
);
linux("計画が変われば通信前に停止する", () =>
  fixture(async ({ collect, plan, sessions }) => {
    await collect(0);
    plan.query.knownAt = "2026-10-30T02:00:00Z";
    await expect(collect()).rejects.toThrow("plan changed");
    expect(sessions).toEqual([]);
  }),
);
linux("全日が非公開なら架空のXMLを作らない", () =>
  fixture(async ({ collect, plan, out }) => {
    plan.expectedDates = [];
    plan.query.through = "2026-10-25";
    expect(await collect(0)).toMatchObject({
      status: "complete",
      completed: [],
      latestObservedAt: null,
    });
    expect(existsSync(join(out, "days"))).toBe(false);
  }),
);
linux("保存原本の改変を置き換えずfailedとして止める", () =>
  fixture(async ({ collect, out, sessions }) => {
    await collect();
    appendFileSync(join(out, "days/2026-10-26/attempt-0001/delivery.zip"), "bad");
    await expect(collect(0)).rejects.toThrow();
    expect(sessions.flatMap((v) => v.calls)).toHaveLength(2);
    expect(JSON.parse(readFileSync(join(out, "status.json"), "utf8")).status).toBe("failed");
  }),
);
linux("日数予算ごとに再開して全日を埋める", () =>
  fixture(async ({ collect, plan, sessions }) => {
    plan.query.through = "2026-10-27";
    plan.expectedDates.push("2026-10-27");
    expect(await collect(1)).toMatchObject({
      status: "pending",
      pendingDates: ["2026-10-27"],
      requestsThisRun: 2,
    });
    const second = await collect(1);
    expect(second).toMatchObject({ status: "complete", requestsThisRun: 2 });
    expect(second.completed.map((v) => v.date)).toEqual(["2026-10-26", "2026-10-27"]);
    expect(await collect(0)).toMatchObject({ status: "complete", requestsThisRun: 0 });
    expect(sessions.flatMap((v) => v.calls)).toHaveLength(4);
  }),
);
