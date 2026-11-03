import { it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { duckFinancialReaderFixture as fixture } from "./fixtures/duck-financial-reader";
import { runDuckFinancialPublication as publish } from "../scripts/roadmap/run-duck-financial-publication.mjs";
it(
  "固定snapshot・明示policy・原本照合・CASを通して正式catalogへ切り替える",
  () =>
    fixture(async ({ duck, dir, path }) => {
      const config = join(dir, "publication.json"),
        quality = await duck.quality("all");
      const value = {
        version: 1,
        indexPath: path,
        catalogPath: join(dir, "production.sqlite"),
        recordPath: join(dir, "verification.json"),
        archivePath: join(dir, "a.sqlite"),
        generation: "all",
        candidateId: "release",
        inputSha256: "a".repeat(64),
        indexSha256: await duck.snapshotSha256(),
        generationSha256: quality.generationSha256,
        policy: {
          minimumCompaniesWithUsableValues: 4,
          maxUnavailableSources: 0,
          maxUnresolvedSelections: 0,
          maxUnavailableSelections: 0,
          maxUnresolvedRecords: 0,
          maxUnavailableGroups: 0,
          maxDuplicateCohortIdentifiers: 0,
          maxUnavailableValues: 100,
        },
        expectedActive: null,
      };
      writeFileSync(config, JSON.stringify({ ...value, indexSha256: "0".repeat(64) }));
      await expect(publish(config, "record")).rejects.toThrow("differs");
      writeFileSync(config, JSON.stringify(value));
      await expect(publish(config, "activate")).rejects.toThrow("unverified");
      expect((await publish(config, "record")).active).toBeNull();
      expect((await publish(config, "activate")).status).toBe("published");
      const status = await publish(config, "status");
      expect(status.current.id).toBe("release");
      expect(status.history).toHaveLength(1);
      await expect(publish(config, "activate")).rejects.toThrow();
      expect((await publish(config, "status")).history).toHaveLength(1);
    }),
  60000,
);
