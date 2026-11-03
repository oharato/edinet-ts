import { it, expect } from "vitest";
import { FacilityDetailStore } from "../src/platform/db/stores/disclosures/facility-detail-store";
import { facilityDocument, facilityTable } from "./fixtures/facility-details";
import { parseFacilitySiteAndLocation } from "../src/domain/disclosures/business/parse-facility-location";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
it("設備CLIはopt-in時だけ所在地分離を付記し、元行・検索結果・DBを保持する", () => {
  const dir = mkdtempSync(join(tmpdir(), "facility-location-cli-")),
    file = join(dir, "facilities.sqlite");
  try {
    const cells = ["本社（東京都中央区）", "通信", "1", "2", "3", "4", "－", "10", "1"],
      doc = facilityDocument("A", facilityTable(9, cells)),
      store = new FacilityDetailStore(file);
    store.append([doc]);
    const expected = store.search({ asOfDate: "2026-03-31" });
    store.close();
    const sha = () => createHash("sha256").update(readFileSync(file)).digest("hex"),
      before = sha();
    const run = (...extra: string[]) =>
      spawnSync(
        process.execPath,
        [
          "--import",
          resolve("node_modules/tsx/dist/loader.mjs"),
          resolve("src/cli.ts"),
          "search-facility-detail-store",
          "--db",
          file,
          "--as-of-date",
          "2026-03-31",
          ...extra,
        ],
        { cwd: "/tmp", encoding: "utf8", timeout: 30000 },
      );
    const plain = run();
    expect(plain.status, plain.stderr).toBe(0);
    expect(JSON.parse(plain.stdout)).toEqual(JSON.parse(JSON.stringify(expected)));
    const split = run("--location-parts");
    expect(split.status, split.stderr).toBe(0);
    const actual = JSON.parse(split.stdout);
    expect(actual.matched).toBe(1);
    expect(actual.rows[0].reportedLocation).toEqual(parseFacilitySiteAndLocation(cells[0]));
    delete actual.rows[0].reportedLocation;
    expect(actual).toEqual(JSON.parse(JSON.stringify(expected)));
    expect(actual.rows[0].row.rights).toBe("unconfirmed");
    expect(sha()).toBe(before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);
