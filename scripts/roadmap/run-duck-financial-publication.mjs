import { resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DuckFinancialSearchIndex,
  FinancialIndexPublication,
  recordDuckFinancialValueVerification,
  activateVerifiedDuckFinancialPublication,
} from "../../dist/index.js";
import { readJSONSnapshot } from "./operational-files.mjs";
import { withOperationalLocks } from "./with-operational-locks.mjs";

/** Publish a retained snapshot under an explicit, recorded policy; never infer freshness or fill missing values. */
export async function runDuckFinancialPublication(configPath, mode) {
  if (
    !["record", "activate", "status"].includes(mode) ||
    !isAbsolute(configPath) ||
    resolve(configPath) !== configPath
  )
    throw Error("Explicit publication config and mode required");
  const first = readJSONSnapshot(configPath),
    c = first.value;
  const fields = [
    "version",
    "indexPath",
    "catalogPath",
    "recordPath",
    "archivePath",
    "generation",
    "candidateId",
    "inputSha256",
    "indexSha256",
    "generationSha256",
    "policy",
    "expectedActive",
  ];
  if (
    c?.version !== 1 ||
    Object.keys(c).length !== fields.length ||
    Object.keys(c).some((k) => !fields.includes(k))
  )
    throw Error("Invalid publication config");
  for (const k of ["indexPath", "catalogPath", "recordPath", "archivePath"])
    if (typeof c[k] !== "string" || !isAbsolute(c[k]) || resolve(c[k]) !== c[k])
      throw Error("Canonical publication paths required");
  for (const k of ["inputSha256", "indexSha256", "generationSha256"])
    if (typeof c[k] !== "string" || !/^[a-f0-9]{64}$/.test(c[k]))
      throw Error("Pinned publication hashes required");
  if (new Set([configPath, c.indexPath, c.catalogPath, c.recordPath, c.archivePath]).size !== 5)
    throw Error("Publication inputs must be separate");
  return withOperationalLocks(
    [configPath + ".lock", c.catalogPath + ".lock", c.indexPath + ".lock", c.archivePath + ".lock"],
    async () => {
      if (readJSONSnapshot(configPath).sha256 !== first.sha256)
        throw Error("Publication config changed");
      const reader = await DuckFinancialSearchIndex.open(c.indexPath);
      let catalog;
      try {
        if (
          (await reader.snapshotSha256()) !== c.indexSha256 ||
          (await reader.quality(c.generation)).generationSha256 !== c.generationSha256
        )
          throw Error("Publication snapshot differs");
        catalog = new FinancialIndexPublication(c.catalogPath, { readOnly: mode === "status" });
        if (mode === "status")
          return {
            status: "publication-status",
            current: await catalog.resolveAsync(reader),
            history: catalog.history(),
          };
        const candidate = await catalog.prepareAsync(c.candidateId, reader, c.generation, c.policy);
        if (!candidate.eligible) throw Error("Publication quality policy failed");
        const input = {
          reader,
          catalog,
          candidateId: c.candidateId,
          inputSha256: c.inputSha256,
          archivePath: c.archivePath,
          recordPath: c.recordPath,
        };
        if (mode === "record")
          return {
            status: "verified",
            verification: await recordDuckFinancialValueVerification(input),
            active: catalog.current()?.id ?? null,
          };
        const result = await activateVerifiedDuckFinancialPublication(input, {
          expectedActive: c.expectedActive,
        });
        return { status: "published", ...result };
      } finally {
        try {
          await reader.close();
        } finally {
          catalog?.close();
        }
      }
    },
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw Error("Publication config and mode required");
    console.log(
      JSON.stringify(await runDuckFinancialPublication(process.argv[2], process.argv[3])),
    );
  } catch (error) {
    console.error("DuckDB publication failed (details hidden).");
    process.exitCode = error?.exitCode === 75 ? 75 : 1;
  }
}
