import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

it.each([
  {
    args: [],
    sourceCommit: "3cc4618e5fa8d3e35604e15dc49c31f9f35ebdd7",
    expectedArtifactSha256: "69e50093645fdd38a31c46c5b676e7efe32b523033e37def135c3d5b657d7a94",
    node: "v26.12.1",
  },
  {
    args: ["--current"],
    sourceCommit: "3d511d1aa3c894185ab574300f342d07551dffd7",
    expectedArtifactSha256: "d8781379697f57e81683e4952db226f33ad395d493fd9333a25eea0d98271140",
    node: "v26.13.0",
  },
])("dry-run fixes $sourceCommit without building or writing", (profile) => {
  const directory = mkdtempSync(join(tmpdir(), "artifact-profile-"));
  try {
    const result = spawnSync(
      process.execPath,
      ["scripts/build-local.mts", "--output", directory, "--dry-run", ...profile.args],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      sourceCommit: profile.sourceCommit,
      expectedArtifactSha256: profile.expectedArtifactSha256,
      node: profile.node,
      npm: "12.2.1",
      network: "offline npm cache only",
      fetchData: false,
      publish: false,
    });
    expect(readdirSync(directory)).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("rejects the source checkout as an artifact output before writing", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/build-local.mts", "--output", process.cwd(), "--current", "--dry-run"],
    { encoding: "utf8", timeout: 10000 },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Output must be outside the source checkout");
});
