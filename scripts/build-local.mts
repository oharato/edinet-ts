/** 既存の固定commitと配布物hashを再現する。現在のHEADを公開する処理ではない。 */
import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statfsSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { activate, archive, digest, files, locked, publish, run } from "./local-artifact-store.mts";

const PIN = "3cc4618e5fa8d3e35604e15dc49c31f9f35ebdd7";
const EXPECTED = "69e50093645fdd38a31c46c5b676e7efe32b523033e37def135c3d5b657d7a94";
const { values } = parseArgs({
  options: {
    output: { type: "string" },
    rollback: { type: "string" },
    "dry-run": { type: "boolean" },
  },
});
if (!values.output) throw Error("--output is required");
const repo = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  root = resolve(values.output);
const within = (parent: string, child: string) => {
  const r = relative(parent, child);
  return !r || (!r.startsWith("../") && r !== "..");
};
if (within(repo, root) || within(root, repo))
  throw Error("Output must be outside the source checkout");
if (values["dry-run"]) {
  console.log(
    JSON.stringify({
      sourceCommit: PIN,
      output: root,
      network: "offline npm cache only",
      fetchData: false,
      publish: false,
    }),
  );
} else {
  const version = (command: string) =>
    execFileSync(command, ["--version"], { encoding: "utf8" }).trim();
  if (!values.rollback && (version("node") !== "v26.12.1" || version("npm") !== "12.2.1"))
    throw Error("Use the pinned Node v26.12.1 and npm 12.2.1 toolchain");
  const mask = process.umask(0o077);
  try {
    locked(root, () => {
      if (values.rollback) {
        activate(root, values.rollback);
        return;
      }
      const space = statfsSync(root, { bigint: true });
      if (space.bavail * space.bsize < 2n * 1024n ** 3n)
        throw Error("At least 2 GiB of free space required");
      const name =
        new Date()
          .toISOString()
          .replace(/[-:]/g, "")
          .replace(/\.\d{3}Z$/, "Z") +
        "-" +
        randomUUID().slice(0, 8);
      const stage = join(root, ".staging-" + name),
        source = join(stage, "source");
      mkdirSync(stage, { mode: 0o700 });
      archive(repo, PIN, source);
      const lockHash = digest(join(source, "package-lock.json")),
        log = openSync(join(stage, "build.log"), "wx", 0o600);
      try {
        run(["npm", "ci", "--offline", "--no-audit", "--no-fund"], source, log);
        run(["npm", "run", "build"], source, log);
        run(["npm", "test", "--", "--maxWorkers=1", "--testTimeout=60000"], source, log);
        for (const path of [
          join(source, "LICENSE"),
          join(source, "README.md"),
          join(source, "package.json"),
          ...files(join(source, "dist")),
        ])
          chmodSync(path, 0o644);
        const old = process.umask(0o022);
        try {
          run(["npm", "pack", "--ignore-scripts", "--pack-destination", stage], source, log);
        } finally {
          process.umask(old);
        }
      } finally {
        closeSync(log);
      }
      const packages = readdirSync(stage).filter((name) => name.endsWith(".tgz"));
      if (packages.length !== 1 || digest(join(stage, packages[0])) !== EXPECTED)
        throw Error("Fixed-SHA package hash mismatch; current unchanged");
      renameSync(join(stage, packages[0]), join(stage, `edinet-ts-${PIN}.tgz`));
      const metadata = {
        sourceRepository: "https://github.com/oharato/edinet-ts",
        sourceCommit: PIN,
        packageLockSha256: lockHash,
        artifactSha256: EXPECTED,
        builderSha256: digest(fileURLToPath(import.meta.url)),
        storeSha256: digest(join(repo, "scripts/local-artifact-store.mts")),
        node: version("node"),
        npm: version("npm"),
        createdAt: new Date().toISOString(),
      };
      // Delete only this run's disposable checkout; retained generations are never pruned.
      rmSync(source, { recursive: true, force: true });
      console.log(publish(root, stage, metadata));
    });
  } finally {
    process.umask(mask);
  }
}
