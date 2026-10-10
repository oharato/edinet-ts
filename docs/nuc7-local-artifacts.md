# Fixed-source packages on nuc7

Build and retain distribution artifacts on nuc7 without paid GitHub storage, new tokens,
self-hosted runners or public distribution. Existing packages/releases are not deleted.
This draft changes GitHub CI to source type checks/tests only and replaces the manual
publishing workflow with local-build instructions. The ESM integration suite builds
`dist`, so it is excluded from GitHub source CI and retained in the full local suite.
The manual workflow no longer creates tags, Releases, npm or GitHub Packages versions.
These changes take effect only after merge; do not dispatch the old release workflow.

## Reproducible input

`python3 scripts/build-local.py` archives exactly:

- Source: `6301b404a5d09fec0c5ad10b2796e95ac64bd4e9`
- Package SHA-256: `1c1e35c0348d24e1dbfc65d7586f6a9e5d1496ca1cfba49c9221e87c4c32f048`
- Toolchain used for the approved package: Node v24.13.0 / npm 11.6.2, linux-x64.

It uses a disposable checkout of that source, the committed lockfile, offline `npm ci`,
full build and all tests (including ESM checks), then `npm pack --ignore-scripts`.
The exact archive hash must match the reviewed stock-data dependency. A mismatch fails
rather than overwriting it. Package version alone is not proof of source identity.
No data fetching, API secrets, npm publish, tags or remote uploads are involved. Native
SQLite dependencies may compile locally. Populate the npm cache from trusted locked
dependencies before running; this builder does not silently fall back to network access.

## Run and inspect

```sh
OUT=/home/oharato/Documents/Codex/2026-10-07/task-2/nuc7-artifacts/edinet-ts
python3 scripts/build-local.py --output "$OUT" --dry-run
python3 scripts/build-local.py --output "$OUT"
python3 scripts/test_artifact_store.py
```

Output is private (0700), guarded by a nonblocking process lock. Each successful build
has a separate generation containing the `.tgz`, a build/test log, and a manifest with
source/lockfile/builder hashes, toolchain and file checksums. After checks succeed,
`current` is replaced atomically. Failed builds retain their staging log and do not
change `current`. At least 2 GiB of free space is required; no previous generations are
automatically pruned. Review disk use and retain at least three successful generations
before any separately authorized cleanup. This is local retention, not off-host backup
or a guarantee against sudden power loss.

Rollback verifies all hashes before moving the pointer:

```sh
python3 scripts/build-local.py --output "$OUT" --rollback GENERATION_BASENAME
```

Pass `"$OUT/current"` as `--edinet-generation` to stock-data's local builder. That builder
checks the fixed package against stock-data's existing provenance and uses these local
bytes for its file dependency. It does not consume an unverified registry version.

## Upgrade and cutover

A future source update must deliberately update the pinned SHA and approved archive hash,
stock-data's provenance and dependency lock, then rerun the full suite and installed-package
regressions. The current script intentionally continues to build the reviewed SHA even
when the wrapper script changes. Never replace a package in-place based only on version.
No local timer is added: this library only needs rebuilding when its reviewed source changes.
The existing stock-data acquisition timer and GitHub schedule require a separate coordinated
cutover, documented in stock-data; this library PR neither fetches data nor changes either.

## Validation on nuc7 (2026-10-10)

- Full fixed-source build and all 207 tests in 13 files passed.
- All 40 package members matched the reviewed build. Initial archive hash rejection
  exposed 0600 versus 0644 tar file modes caused by the private staging umask; the
  builder now normalizes only packaged files inside the 0700 staging tree. The final
  170,084-byte archive exactly matches the approved SHA-256 above.
- The five publication safeguard tests pass. The initial sandbox attempt was blocked
  executing esbuild; the normal host execution completed without data/API acquisition.
- A local generation and `current` pointer were created under the example output path.
  No remote publication, timer registration, installed-service change, or GitHub asset
  deletion occurred. Full builds/tests remain local after the proposed CI change.
