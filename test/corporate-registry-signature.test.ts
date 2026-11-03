import { expect, it } from "vitest";
import { readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { verifyDetachedSignature } from "../src/platform/registry/verify-detached-signature";
import { sha256, signedRegistryFixture } from "./fixtures/signed-corporate-registry";
const linux = it.runIf(process.platform === "linux");
linux.each(["valid", "wrong-trust", "changed-xml", "wrong-hash", "symlink", "missing-signature"])(
  "署名検証: %s",
  async (mutation) => {
    const f = signedRegistryFixture();
    try {
      const m = { ...f.manifest };
      if (mutation === "wrong-trust") m.fingerprint = "0".repeat(40);
      if (mutation === "changed-xml") {
        writeFileSync(f.xml, "<test>changed</test>");
        m.sha256 = sha256(readFileSync(f.xml));
      }
      if (mutation === "wrong-hash") m.sha256 = "0".repeat(64);
      if (mutation === "symlink") {
        m.file = join(f.root, "link.xml");
        symlinkSync(f.xml, m.file);
      }
      if (mutation === "missing-signature") unlinkSync(f.xml + ".asc");
      const input = join(f.root, "input.json");
      writeFileSync(input, JSON.stringify(m));
      if (mutation === "valid")
        expect(await verifyDetachedSignature(input)).toMatchObject({
          trustedFingerprint: f.fingerprint,
          networkRequested: false,
          importManifest: { sha256: m.sha256 },
        });
      else await expect(verifyDetachedSignature(input)).rejects.toThrow();
    } finally {
      f.close();
    }
  },
);
linux("CLIは既存の署名検証結果を上書きしない", () => {
  const f = signedRegistryFixture();
  try {
    const input = join(f.root, "input.json"),
      out = join(f.root, "out");
    writeFileSync(input, JSON.stringify(f.manifest));
    const run = () =>
      spawnSync(
        process.execPath,
        [
          resolve("scripts/roadmap/verify-corporate-registry-signature.mts"),
          "--manifest",
          input,
          "--out",
          out,
        ],
        { encoding: "utf8" },
      );
    const first = run();
    expect(first.status, first.stderr).toBe(0);
    const before = readFileSync(join(out, "receipt.json"));
    expect(run().status).not.toBe(0);
    expect(readFileSync(join(out, "receipt.json"))).toEqual(before);
  } finally {
    f.close();
  }
});
