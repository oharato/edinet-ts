/** ローカル成果物を世代ごとに保持する。hash照合後だけcurrentを原子的に切り替える。 */
import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

export function digest(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) throw Error("Artifact must be a regular file");
    const hash = createHash("sha256"),
      buffer = Buffer.alloc(1024 * 1024);
    let count: number;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)))
      hash.update(buffer.subarray(0, count));
    return hash.digest("hex");
  } finally {
    closeSync(fd);
  }
}
export function files(root: string): string[] {
  const result: string[] = [];
  for (const name of readdirSync(root).sort()) {
    const path = join(root, name),
      info = lstatSync(path);
    if (info.isSymbolicLink()) throw Error("Symlinks are not accepted in artifacts");
    if (info.isDirectory()) result.push(...files(path));
    else if (info.isFile()) result.push(path);
    else throw Error("Special files are not accepted in artifacts");
  }
  return result;
}
export function locked<T>(root: string, work: () => T): T {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const info = lstatSync(root);
  if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077)
    throw Error("Output root must be private (mode 0700)");
  const fd = openSync(
    join(root, ".lock"),
    constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    0o600,
  );
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) throw Error("Invalid artifact lock");
    // flock locks the inherited open file description until this process closes fd.
    const result = spawnSync("flock", ["--nonblock", "3"], {
      stdio: ["ignore", "pipe", "pipe", fd],
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw Error("Another artifact operation holds the lock");
    return work();
  } finally {
    closeSync(fd);
  }
}
export function run(args: string[], cwd: string, log: number) {
  writeFileSync(log, "\n$ " + args.join(" ") + "\n");
  const result = spawnSync(args[0], args.slice(1), { cwd, stdio: ["ignore", log, log] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`Build command failed: ${args[0]} (${result.status})`);
}
export function archive(repo: string, sha: string, destination: string) {
  mkdirSync(destination);
  const tar = join(destination, "..", "source.tar");
  for (const args of [
    ["git", "-C", repo, "archive", "--format=tar", "-o", tar, sha],
    ["tar", "-xf", tar, "-C", destination],
  ]) {
    const result = spawnSync(args[0], args.slice(1), { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw Error("Git source archive failed");
  }
  unlinkSync(tar);
}
export function activate(root: string, name: string) {
  if (!name || basename(name) !== name || name.startsWith("."))
    throw Error("Expected a generation basename");
  const target = join(root, "generations", name),
    info = lstatSync(target);
  if (info.isSymbolicLink() || !info.isDirectory())
    throw Error("Generation is missing or is a symlink");
  const actual = Object.fromEntries(
    files(target)
      .filter((path) => relative(target, path) !== "manifest.json")
      .map((path) => [relative(target, path), digest(path)]),
  );
  const expected = JSON.parse(readFileSync(join(target, "manifest.json"), "utf8")).sha256;
  if (
    !expected ||
    JSON.stringify(Object.entries(actual).sort()) !==
      JSON.stringify(Object.entries(expected).sort())
  )
    throw Error("Generation hash verification failed; current unchanged");
  const link = join(root, ".current-" + randomUUID());
  symlinkSync(join("generations", name), link);
  renameSync(link, join(root, "current"));
}
export function publish(root: string, stage: string, metadata: Record<string, unknown>) {
  const hashes = Object.fromEntries(
    files(stage).map((path) => [relative(stage, path), digest(path)]),
  );
  writeFileSync(
    join(stage, "manifest.json"),
    JSON.stringify({ ...metadata, sha256: hashes }, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  const generations = join(root, "generations");
  mkdirSync(generations, { recursive: true, mode: 0o700 });
  if (lstatSync(generations).isSymbolicLink()) throw Error("Generation directory is a symlink");
  const target = join(generations, basename(stage).replace(/^\.staging-/, ""));
  renameSync(stage, target);
  activate(root, basename(target));
  return target;
}
