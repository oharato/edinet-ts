import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
/** ネットワークを使わず、テスト用鍵と署名済みXML/ZIPを作る。 */
export function signedRegistryFixture() {
  const root = mkdtempSync(join(tmpdir(), "registry-signature-test-")),
    home = join(root, "keys");
  mkdirSync(home, { mode: 0o700 });
  const gpg = (args: string[]) =>
    execFileSync(
      "gpg",
      [
        "--no-options",
        "--homedir",
        home,
        "--batch",
        "--pinentry-mode",
        "loopback",
        "--passphrase",
        "",
        ...args,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  gpg(["--quick-generate-key", "Test fixture <test@example.invalid>", "ed25519", "sign", "0"]);
  const fingerprint = gpg(["--with-colons", "--list-keys"])
    .toString()
    .split("\n")
    .find((line) => line.startsWith("fpr:"))!
    .split(":")[9];
  const key = join(root, "key.asc");
  writeFileSync(key, gpg(["--armor", "--export"]));
  const xml = join(root, "data.xml");
  writeFileSync(xml, "<test>signed bytes</test>");
  gpg(["--armor", "--detach-sign", xml]);
  const manifest = {
    file: xml,
    signature: xml + ".asc",
    publicKey: key,
    fingerprint,
    sha256: sha256(readFileSync(xml)),
    source: {
      sourceUrl: "https://example.invalid",
      observedAt: "2026-10-30T00:00:00Z",
      dataDate: "2026-10-29",
      kind: "diff",
      purpose: "sample",
    },
    part: "data.xml",
  };
  return {
    root,
    home,
    gpg,
    key,
    xml,
    fingerprint,
    manifest,
    async zip(change?: (zip: JSZip) => void) {
      const zip = new JSZip();
      zip.file("data.xml", readFileSync(xml));
      zip.file("data.xml.asc", readFileSync(xml + ".asc"));
      change?.(zip);
      const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
        archive = join(root, "delivery.zip");
      writeFileSync(archive, bytes);
      const input = join(root, "zip-input.json");
      const value = {
        archive,
        sha256: sha256(bytes),
        publicKey: key,
        fingerprint,
        source: manifest.source,
        expectedXmlParts: ["data.xml"],
      };
      writeFileSync(input, JSON.stringify(value));
      return { input, value, bytes };
    },
    close() {
      try {
        execFileSync("gpgconf", ["--homedir", home, "--kill", "all"], { stdio: "ignore" });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  };
}
