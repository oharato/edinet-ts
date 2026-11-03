/** 版の証拠を、保存されたSQLite世代・会社別part・構築checkpointへ独立に結び付ける。 */
import { strict as assert } from "node:assert";
import { lstatSync } from "node:fs";
import { resolve } from "node:path";
import { Database, type NativeDatabase } from "../../db/engines/sqlite/node-sqlite";
import { RetainedFile } from "../../files/retained-files";
import { strictJSON, MIB } from "./read-version-input";
import {
  POLICY,
  canonical,
  sha,
  digest,
  equal,
  equalSets,
  keyed,
  omit,
  timestamp,
  day,
} from "./version-evidence-format";
const ROW_COLUMNS = [
  "generation",
  "row_id",
  "group_id",
  "standard",
  "scope",
  "currency",
  "period_start",
  "period_end",
  "period_type",
  "edinet_code",
  "sec_code",
  "doc_id",
];
const field = (o: any, key: string, fallback: any) => (Object.hasOwn(o, key) ? o[key] : fallback);
function stopped(path: string) {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try {
      lstatSync(path + suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    throw Error("Stopped index/build state without sidecars required");
  }
}
function rows(db: NativeDatabase, sql: string, args: any[] = []): any[] {
  const statement = db.prepare(sql);
  try {
    return statement.all(...args);
  } finally {
    statement.close();
  }
}
const single = (values: any[], message: string) => {
  assert(values.length === 1, message);
  return values[0];
};
export function verifyVersionIndex(
  path: string,
  generation: string,
  planPin: string,
  archivePin: string,
  buildPath: string,
  bundle: any,
  proof: any,
) {
  assert(
    [planPin, archivePin].every((pin) => typeof pin === "string" && /^[0-9a-f]{64}$/.test(pin)),
    "External plan/archive pins required",
  );
  path = resolve(path);
  buildPath = resolve(buildPath);
  stopped(path);
  stopped(buildPath);
  const indexFile = new RetainedFile(path, 1024 ** 4);
  let buildFile: RetainedFile | undefined,
    database: NativeDatabase | undefined,
    state: NativeDatabase | undefined;
  try {
    buildFile = new RetainedFile(buildPath, 1024 ** 4);
    const indexHash = indexFile.digest(),
      buildHash = buildFile.digest();
    database = new Database(path, { readOnly: true });
    state = new Database(buildPath, { readOnly: true });
    database.exec("PRAGMA query_only=ON");
    state.exec("PRAGMA query_only=ON");
    equal(
      rows(database, "SELECT kind FROM financial_index_format").map((r) => r.kind),
      ["edinet-ts-financial-search-index-v1"],
      "Index physical format",
    );
    equal(
      rows(state, "SELECT kind FROM financial_build_format").map((r) => r.kind),
      ["edinet-ts-financial-index-build-v1"],
      "Build state physical format",
    );
    const reports: Record<string, any> = Object.create(null),
      rowsByGeneration: Record<string, Record<string, any>> = Object.create(null),
      expectedProvenancePin = {
        policy: POLICY,
        evidenceManifestSha256: proof.evidenceManifestSha256,
        proofSha256: proof.sha256,
      };
    const planHeader = single(
      rows(
        state,
        "SELECT id,length(CAST(body AS BLOB)) AS bytes FROM financial_build_plans WHERE sha256=?",
        [planPin],
      ),
      "Externally pinned plan absent",
    );
    assert(planHeader.bytes <= 64 * MIB, "Plan oversize");
    const storedPlan = single(
      rows(state, "SELECT * FROM financial_build_plans WHERE id=?", [planHeader.id]),
      "Pinned plan absent",
    );
    assert(
      sha(storedPlan.body) === storedPlan.sha256 && storedPlan.sha256 === planPin,
      "Plan SQL body hash",
    );
    const plan = strictJSON(storedPlan.body);
    assert(
      storedPlan.body === canonical(plan) &&
        plan.id === storedPlan.id &&
        /^[A-Za-z0-9_.:-]{1,200}$/.test(plan.id) &&
        plan.buildVersion === "1" &&
        plan.indexVersion === "2" &&
        plan.generation === generation &&
        plan.archiveSha256 === archivePin &&
        plan.options.cutoff === proof.cutoff &&
        plan.options.extractorVersion === plan.provenance.extractorVersion &&
        (plan.options.sourceCommit ?? null) === (plan.provenance.sourceCommit ?? null),
      "Plan identity/version/proof/archive contract",
    );
    equal(plan.options.financialVersion, expectedProvenancePin, "Plan options proof");
    equal(plan.provenance.financialVersion, expectedProvenancePin, "Plan provenance proof");
    const proofDecisions = keyed(proof.decisions, "rootDocID"),
      proofMetadata = keyed(proof.metadataSelection.decisions, "rootDocID"),
      latest: Record<string, any> = Object.create(null);
    for (const o of bundle.observations)
      if (timestamp(o.observedAt) <= timestamp(proof.cutoff)) {
        const old = latest[o.document.docID];
        if (!old || timestamp(o.observedAt) > timestamp(old.observedAt))
          latest[o.document.docID] = o;
      }
    const readReport = (identifier: string): { report: any; sha256: string } => {
      const header = single(
        rows(
          database!,
          "SELECT length(CAST(body AS BLOB)) AS bytes FROM financial_generations WHERE id=?",
          [identifier],
        ),
        "Generation absent",
      );
      assert(header.bytes <= 64 * MIB, "Generation oversize");
      const stored = single(
        rows(database!, "SELECT id,body,sha256 FROM financial_generations WHERE id=?", [
          identifier,
        ]),
        "Generation absent",
      );
      assert(digest([identifier, stored.body]) === stored.sha256, "Generation SQL hash");
      const report = strictJSON(stored.body);
      assert(
        stored.body === canonical(report) &&
          report.id === identifier &&
          report.indexVersion === "2" &&
          report.selectionMode === POLICY,
        "V2 generation required",
      );
      equal(report.financialVersionProof, proof, "Stored full proof binding");
      equal(report.provenance.financialVersion, expectedProvenancePin, "Stored provenance proof");
      const owners = report.provenance.edinetCodes;
      assert(
        Array.isArray(owners) &&
          owners.length &&
          owners.every((code) => typeof code === "string" && /^E[0-9]{5}$/.test(code)),
        "Fixed generation owners",
      );
      equal(owners, [...new Set(owners)].sort(), "Fixed sorted generation owners");
      const metadata = report.metadataSelection,
        selection = report.selection;
      for (const value of [metadata, selection])
        assert(
          value.cutoff === proof.cutoff &&
            value.financialValuesMerged === false &&
            value.reconstructedUnobservedHistory === false,
          "Stored selection mode",
        );
      const metadataDecisions = keyed(metadata.decisions, "rootDocID"),
        scope = Object.fromEntries(
          Object.entries(proofDecisions).filter(
            ([root]) => latest[root] && owners.includes(latest[root].document.edinetCode),
          ),
        );
      equal(
        keyed(report.financialVersionSelection, "rootDocID"),
        scope,
        "Stored financial decision scope",
      );
      for (const root of Object.keys(scope))
        equal(metadataDecisions[root], proofMetadata[root], "Stored metadata unresolved changed");
      const chosen = Object.fromEntries(
          Object.entries(scope).filter(([, d]) => d.status === "selected-source"),
        ),
        expectedSelected = keyed(metadata.selected, "rootDocID"),
        expectedDecisions = { ...metadataDecisions };
      for (const [root, d] of Object.entries(chosen)) {
        assert(!Object.hasOwn(expectedSelected, root), "Metadata selected overridden");
        expectedSelected[root] = d.selected;
        expectedDecisions[root] = {
          rootDocID: root,
          status: "selected",
          reason: "selected",
          selectedDocID: d.selectedDocID,
          chainDocIDs: d.chainDocIDs,
          observationIds: d.observationIds,
          targetPeriod: d.selected.targetPeriod,
        };
      }
      equal(
        keyed(selection.selected, "rootDocID"),
        expectedSelected,
        "Stored effective selection changed",
      );
      equal(
        keyed(selection.decisions, "rootDocID"),
        expectedDecisions,
        "Stored effective decisions changed",
      );
      equal(selection.ignored, metadata.ignored, "Stored ignored observations changed");
      const manifests = keyed(report.rows, "id"),
        count = single(
          rows(database!, "SELECT count(*) AS n FROM financial_rows WHERE generation=?", [
            identifier,
          ]),
          "Row count absent",
        ).n;
      assert(count === Object.keys(manifests).length && count <= 200000, "Stored row count");
      const storedRows: Record<string, any> = Object.create(null),
        headers = rows(
          database!,
          "SELECT substr(row_id,1,65) AS row_id,length(CAST(body AS BLOB)) AS bytes FROM financial_rows WHERE generation=? ORDER BY row_id",
          [identifier],
        );
      for (const h of headers) {
        assert(/^[a-f0-9]{64}$/.test(h.row_id) && h.bytes <= 64 * MIB, "Stored row capacity/key");
        const row = single(
            rows(
              database!,
              `SELECT ${ROW_COLUMNS.join(",")},sha256,body FROM financial_rows WHERE generation=? AND row_id=?`,
              [identifier, h.row_id],
            ),
            "Stored row absent",
          ),
          value = strictJSON(row.body),
          m = value.snapshot.metadata,
          period = m.period;
        const columns = [
          identifier,
          row.row_id,
          value.group,
          m.accountingStandard,
          m.scope,
          m.currency,
          field(period, "startDate", ""),
          field(period, "endDate", period.instant),
          field(m, "periodType", ""),
          value.edinetCode,
          m.secCode,
          m.docID,
        ];
        assert(
          ["balanceSheet", "details"].includes(value.group) &&
            row.row_id === digest([m.docID, value.group]) &&
            digest([columns, row.body]) === row.sha256 &&
            manifests[row.row_id]?.sha256 === row.sha256,
          "Stored row SQL/hash binding",
        );
        equal(
          ROW_COLUMNS.map((key) => row[key]),
          columns,
          "Stored row SQL projection binding",
        );
        equal(manifests[row.row_id].metadata, columns, "Stored row manifest binding");
        const selected = expectedSelected[value.rootDocID];
        assert(
          selected &&
            m.docID === selected.observation.document.docID &&
            owners.includes(value.edinetCode) &&
            value.edinetCode === selected.observation.document.edinetCode,
          "Stored row official lineage",
        );
        equal(value.chainDocIDs, selected.chainDocIDs, "Stored row chain");
        equal(value.observationIds, selected.observationIds, "Stored row observations");
        const d = chosen[value.rootDocID];
        if (!d)
          assert(
            !Object.hasOwn(value, "financialVersionDecisionSha256") &&
              !Object.hasOwn(value, "financialVersionEvidenceSha256"),
            "Ordinary row has financial proof",
          );
        else {
          const source = d.sourceVersions.find((s: any) => s.docID === d.selectedDocID);
          assert(source, "Selected source absent");
          const identity = source.identity;
          assert(
            value.financialVersionDecisionSha256 === d.sha256 &&
              value.financialVersionEvidenceSha256 === proof.sha256 &&
              value.sourceSha256 === source.sourceSha256 &&
              value.knownAt === d.knownAt &&
              m.docID === d.selectedDocID &&
              m.secCode === identity.security &&
              m.accountingStandard === identity.standard &&
              m.scope === identity.scope &&
              m.currency === "JPY",
            "stored source-backed row evidence binding",
          );
          equal(value.chainDocIDs, d.chainDocIDs, "Stored source-backed chain");
          equal(value.observationIds, d.observationIds, "Stored source-backed observations");
          if (value.group === "balanceSheet") {
            equal(
              period,
              { instant: identity.currentPeriod },
              "stored source-backed reporting period",
            );
            assert(!Object.hasOwn(m, "periodType"), "stored source-backed reporting period");
          } else {
            equal(
              period,
              { startDate: identity.fiscalStart, endDate: identity.currentPeriod },
              "stored source-backed reporting period",
            );
            assert(
              m.periodType === (identity.periodCode === "FY" ? "annual" : "ytd"),
              "stored source-backed reporting period",
            );
          }
        }
        storedRows[row.row_id] = value;
      }
      reports[identifier] = report;
      rowsByGeneration[identifier] = storedRows;
      return { report, sha256: stored.sha256 };
    };
    const { report: aggregate, sha256: generationSha } = readReport(generation),
      assembly = aggregate.assembly;
    assert(
      assembly.planSha256 === planPin && assembly.archiveSha256 === archivePin,
      "Assembly external plan/archive pin",
    );
    const population = assembly.population;
    equal(population, plan.population, "Assembly population differs from pinned plan");
    equal(
      omit(aggregate.provenance, "edinetCodes"),
      plan.provenance,
      "Assembly provenance differs from pinned plan",
    );
    const owners = aggregate.provenance.edinetCodes;
    equal(population.edinetCodes, owners, "Assembly fixed owners");
    assert(
      timestamp(population.observedAt) <= timestamp(proof.cutoff) &&
        typeof population.sourceSha256 === "string" &&
        /^[0-9a-f]{64}$/.test(population.sourceSha256) &&
        typeof population.source === "string" &&
        population.source.trim(),
      "Assembly fixed population",
    );
    assert(
      day(population.asOf) <=
        day(new Date(timestamp(proof.cutoff) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)),
      "Population future asOf",
    );
    const parts = keyed(assembly.parts, "id"),
      expectedPartIds = Object.fromEntries(
        owners.map((owner: string) => ["buildpart:" + digest([planPin, owner]), owner]),
      );
    equalSets(Object.keys(parts), Object.keys(expectedPartIds), "Assembly company part IDs");
    const unionRows: Record<string, any> = Object.create(null);
    for (const [identifier, owner] of Object.entries(expectedPartIds)) {
      const { report: part, sha256: partSha } = readReport(identifier);
      assert(
        partSha === parts[identifier].sha256 && !Object.hasOwn(part, "assembly"),
        "Part generation hash",
      );
      equal(part.provenance.edinetCodes, [owner], "Part generation owner");
      equal(
        omit(part.provenance, "edinetCodes"),
        omit(aggregate.provenance, "edinetCodes"),
        "Part provenance",
      );
      for (const [key, value] of Object.entries(rowsByGeneration[identifier])) {
        assert(!Object.hasOwn(unionRows, key), "Duplicate part row");
        unionRows[key] = value;
      }
    }
    equal(unionRows, rowsByGeneration[generation], "Aggregate rows differ from fixed parts");
    assert(
      single(
        rows(state, "SELECT count(*) AS n FROM financial_build_tasks WHERE build=?", [plan.id]),
        "Checkpoint count absent",
      ).n === owners.length,
      "Fixed build checkpoint count",
    );
    const tasks: Record<string, any> = Object.create(null),
      taskHeaders = rows(
        state,
        "SELECT substr(edinet_code,1,7) AS edinet_code,length(CAST(body AS BLOB)) AS bytes FROM financial_build_tasks WHERE build=?",
        [plan.id],
      );
    for (const h of taskHeaders) {
      assert(owners.includes(h.edinet_code) && h.bytes <= MIB, "Checkpoint owner/capacity");
      const stored = single(
        rows(state, "SELECT * FROM financial_build_tasks WHERE build=? AND edinet_code=?", [
          plan.id,
          h.edinet_code,
        ]),
        "Checkpoint absent",
      );
      assert(
        digest([plan.id, stored.edinet_code, stored.status, stored.body]) === stored.sha256,
        "Checkpoint SQL hash",
      );
      const task = strictJSON(stored.body);
      assert(
        stored.body === canonical(task) &&
          task.edinetCode === stored.edinet_code &&
          task.status === stored.status &&
          stored.status === "complete" &&
          Number.isSafeInteger(task.attempts) &&
          task.attempts >= 1,
        "Checkpoint complete/attempt binding",
      );
      const identifier = "buildpart:" + digest([planPin, task.edinetCode]),
        part = reports[identifier];
      assert(
        task.partID === identifier && task.partSha256 === parts[identifier].sha256,
        "Checkpoint part binding",
      );
      const counts = {
        rowCount: part.rows.length,
        selectedDocuments: part.selection.selected.filter(
          (s: any) => s.observation.document.edinetCode === task.edinetCode,
        ).length,
        unavailableSources: part.unavailableSources.length,
        unresolvedRecords: part.unresolvedRecords.length,
        unavailableGroups: part.unavailableGroups.length,
      };
      assert(
        Object.entries(counts).every(
          ([key, value]) => Number.isSafeInteger(task[key]) && task[key] === value,
        ),
        "Checkpoint row/evidence counts",
      );
      assert(!Object.hasOwn(tasks, task.edinetCode), "Duplicate checkpoint owner");
      tasks[task.edinetCode] = task;
    }
    equalSets(Object.keys(tasks), owners, "Checkpoint population incomplete");
    const completionHeader = single(
      rows(
        state,
        "SELECT length(CAST(body AS BLOB)) AS bytes FROM financial_build_completions WHERE build=?",
        [plan.id],
      ),
      "Finished build receipt missing",
    );
    assert(completionHeader.bytes <= MIB, "Finished build receipt oversize");
    const completion = single(
      rows(state, "SELECT * FROM financial_build_completions WHERE build=?", [plan.id]),
      "Finished build receipt missing",
    );
    assert(
      digest([plan.id, completion.body]) === completion.sha256 &&
        completion.body ===
          canonical({
            id: plan.id,
            generation,
            planSha256: planPin,
            generationSha256: generationSha,
          }),
      "Finished build plan/generation binding",
    );
    const merge = (field: string[], key: (item: any) => string) => {
      const merged: Record<string, any> = Object.create(null);
      for (const identifier of Object.keys(expectedPartIds)) {
        let items = reports[identifier];
        for (const segment of field) items = items[segment];
        for (const item of items) {
          const name = key(item);
          if (Object.hasOwn(merged, name)) equal(merged[name], item, "Conflicting part evidence");
          merged[name] = item;
        }
      }
      return merged;
    };
    for (const field of ["selection", "metadataSelection"])
      for (const [collection, key] of [
        ["selected", "rootDocID"],
        ["decisions", "rootDocID"],
        ["ignored", "observationId"],
      ])
        equal(
          keyed(aggregate[field][collection], key),
          merge([field, collection], (item) => item[key]),
          "Aggregate selection differs from parts",
        );
    for (const [collection, key] of [
      ["financialVersionSelection", (item: any) => item.rootDocID],
      ["unavailableSources", (item: any) => item.docID],
      ["unresolvedRecords", (item: any) => item.docID],
      ["unavailableGroups", (item: any) => canonical([item.docID, item.group])],
    ] as const)
      equal(
        Object.fromEntries(aggregate[collection].map((item: any) => [key(item), item])),
        merge([collection], key),
        "Aggregate evidence differs from parts",
      );
    assert(
      indexFile.digest() === indexHash && buildFile.digest() === buildHash,
      "Index/build state changed during independent verification",
    );
    stopped(path);
    stopped(buildPath);
    return {
      method: "node-stored-v2-index-plan-checkpoint-binding-v1",
      generation,
      generationSha256: generationSha,
      planSha256: planPin,
      archiveSha256: archivePin,
      indexSha256: indexHash,
      indexUnchanged: true,
      buildStateSha256: buildHash,
      buildStateUnchanged: true,
      buildID: plan.id,
      completedCheckpointsChecked: Object.keys(tasks).length,
      companyPartsChecked: Object.keys(parts).length,
      storedRowsChecked: Object.keys(unionRows).length,
      storedGenerationsChecked: Object.keys(reports).length,
      financialValuesValidated: false,
    };
  } finally {
    database?.close();
    state?.close();
    buildFile?.close();
    indexFile.close();
  }
}
