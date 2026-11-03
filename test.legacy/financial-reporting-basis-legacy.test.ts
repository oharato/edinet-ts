import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  ParsedFinancialStore,
  parsedFinancialMappingVersions,
  parsedFinancialExtractionId,
} from "../src/db/parsed-financial-store";
import { createAutomaticFinancialSnapshots } from "../src/financial/snapshots/create-financial-snapshots";
import { reportingInstance } from "./fixtures/financial-reporting-basis";

it("keeps serialized basis4 outcomes readable and uses a different extraction key for the current basis", () => {
  const dir = mkdtempSync(join(tmpdir(), "basis-legacy-")),
    file = join(dir, "parsed.sqlite");
  const xml = reportingInstance(),
    current = {
      identity: {
        docID: "LEGACY",
        sourceSha256: createHash("sha256").update(xml).digest("hex"),
        extractorVersion: "fixture",
        sourceCommit: "a".repeat(40),
        mappingVersions: parsedFinancialMappingVersions(),
      },
      parsedAt: "2026-11-03T00:00:00.000Z",
      outcome: {
        status: "completed" as const,
        result: createAutomaticFinancialSnapshots(xml, { docID: "LEGACY" }),
      },
    };
  // Historical serialized input, not a rewrite of an existing store or real source.
  const legacy = JSON.parse(JSON.stringify(current));
  legacy.identity.mappingVersions.basis = "4";
  legacy.outcome.result.basis.version = "4";
  const oldId = parsedFinancialExtractionId(legacy.identity),
    newId = parsedFinancialExtractionId(current.identity);
  expect(newId).not.toBe(oldId);
  const store = new ParsedFinancialStore(file);
  try {
    store.put(legacy);
    const mismatched = JSON.parse(JSON.stringify(legacy));
    mismatched.identity.mappingVersions = current.identity.mappingVersions;
    expect(() => store.put(mismatched)).toThrow();
    store.put(current);
    expect(store.get(oldId)).toEqual(legacy);
  } finally {
    store.close();
  }
  const read = new ParsedFinancialStore(file, { readOnly: true });
  try {
    expect(read.get(oldId)?.outcome).toEqual(legacy.outcome);
    expect(read.get(newId)?.outcome).toEqual(current.outcome);
    expect(read.page().records).toHaveLength(2);
  } finally {
    read.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
