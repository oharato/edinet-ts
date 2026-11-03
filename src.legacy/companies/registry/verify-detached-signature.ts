/** 保存済みXMLの署名を、固定した公開鍵fingerprintとSHA-2でオフライン検証する。 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { strict as assert } from "node:assert";
import { exactKeys, readRetainedJSON, RetainedFile } from "../../utils/retained-files";

export async function verifyDetachedSignature(manifest: string) {
  const m = readRetainedJSON(manifest),
    base = dirname(resolve(manifest));
  exactKeys(m, ["file", "signature", "publicKey", "fingerprint", "sha256", "source", "part"]);
  assert(
    typeof m.fingerprint === "string" &&
      /^(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})$/.test(m.fingerprint) &&
      typeof m.sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(m.sha256),
    "Expected full fingerprint and XML SHA-256",
  );
  assert(
    typeof m.part === "string" &&
      m.part.trim() &&
      m.source &&
      typeof m.source === "object" &&
      !Array.isArray(m.source),
    "Invalid source or part",
  );
  const opened = new Map<string, { file: RetainedFile; sha256: string }>();
  let home: string | undefined;
  try {
    for (const [name, limit] of [
      ["file", 8 * 1024 ** 3],
      ["signature", 1024 ** 2],
      ["publicKey", 1024 ** 2],
    ] as const) {
      assert(typeof m[name] === "string" && m[name].trim(), "Invalid input path");
      const file = new RetainedFile(resolve(base, m[name]), limit);
      opened.set(name, { file, sha256: "" });
      opened.get(name)!.sha256 = file.digest();
    }
    assert(opened.get("file")!.sha256 === m.sha256, "XML differs from acquisition hash");
    home = mkdtempSync(join(tmpdir(), "edinet-registry-gpg-"));
    const command = [
      "--no-options",
      "--homedir",
      home,
      "--batch",
      "--no-autostart",
      "--no-auto-key-retrieve",
      "--no-auto-key-import",
    ];
    const run = (args: string[]) =>
      new Promise<Buffer>((done, fail) => {
        const child = spawn("gpg", [...command, ...args], {
          stdio: ["ignore", "pipe", "pipe", ...Array.from(opened.values(), (v) => v.file.fd)],
        });
        const chunks: Buffer[] = [];
        let bytes = 0,
          stderrBytes = 0;
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          fail(Error("Signature verification timed out"));
        }, 120000);
        child.stdout!.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 1024 ** 2) {
            child.kill("SIGKILL");
            fail(Error("Oversized GPG output"));
          } else chunks.push(chunk);
        });
        child.stderr!.on("data", (chunk: Buffer) => {
          stderrBytes += chunk.length;
          if (stderrBytes > 1024 ** 2) {
            child.kill("SIGKILL");
            fail(Error("Oversized GPG diagnostics"));
          }
        });
        child.on("error", (error) => {
          clearTimeout(timeout);
          fail(error);
        });
        child.on("close", (code) => {
          clearTimeout(timeout);
          if (code !== 0) fail(Error("GPG signature verification failed"));
          else done(Buffer.concat(chunks));
        });
      });
    await run(["--import", "/proc/self/fd/5"]);
    const output = await run([
      "--status-fd",
      "1",
      "--verify",
      "/proc/self/fd/4",
      "/proc/self/fd/3",
    ]);
    assert(
      output.every((v) => v < 128),
      "Non-ASCII GPG status",
    );
    const status = output.toString("ascii"),
      lines = status
        .split(/\r?\n/)
        .filter((line) => line.startsWith("[GNUPG:] "))
        .map((line) => line.split(/\s+/));
    const valid = lines.filter((line) => line[1] === "VALIDSIG"),
      bad = new Set([
        "BADSIG",
        "ERRSIG",
        "EXPSIG",
        "EXPKEYSIG",
        "REVKEYSIG",
        "KEYEXPIRED",
        "SIGEXPIRED",
        "KEYREVOKED",
      ]);
    assert(
      valid.length === 1 && !lines.some((line) => bad.has(line[1])),
      "Signature is not uniquely valid",
    );
    const signature = valid[0],
      fingerprint = m.fingerprint.toUpperCase();
    assert(["8", "9", "10", "11"].includes(signature[9]), "Signature requires a SHA-2 digest");
    assert(
      fingerprint === signature[2] || fingerprint === signature.at(-1),
      "Signer differs from trusted fingerprint",
    );
    const version = (await run(["--version"])).toString("utf8").split(/\r?\n/)[0];
    for (const { file, sha256 } of opened.values())
      assert(file.digest() === sha256, "Input changed during verification");
    return {
      format: "edinet-ts-corporate-registry-signature-v1",
      verifiedAt: new Date().toISOString(),
      trustedFingerprint: fingerprint,
      gpgVersion: version,
      verificationStatus: status,
      signingFingerprint: signature[2],
      signatureCreatedAt: signature[3],
      files: Object.fromEntries(
        [...opened].map(([name, { file, sha256 }]) => [
          name,
          { path: file.path, sha256, bytes: file.bytes },
        ]),
      ),
      importManifest: {
        file: opened.get("file")!.file.path,
        sha256: m.sha256,
        source: m.source,
        part: m.part,
      },
      networkRequested: false,
    };
  } finally {
    for (const { file } of opened.values()) file.close();
    if (home) rmSync(home, { recursive: true, force: true });
  }
}
