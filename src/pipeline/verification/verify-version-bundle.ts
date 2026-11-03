/** 保存した公式一覧・XML・ZIPから、三つの提出版と選択根拠を独立に再認証する。金額は検査しない。 */
import { strict as assert } from "node:assert";
import { bounded, MIB } from "./read-version-input";
import {
  POLICY,
  METHOD,
  canonical,
  sha,
  digest,
  equal,
  equalSets,
  keyed,
  omit,
  pick,
  timestamp,
} from "./version-evidence-format";
import { sourceVersionIdentity } from "./read-version-identity";
import { attachedZipProof } from "./verify-attached-zip";
export async function verifyVersionBundle(bundle: any, proof: any, expected: string) {
  assert(
    typeof expected === "string" && /^[0-9a-f]{64}$/.test(expected),
    "External manifest pin required",
  );
  const {
    observations,
    sources,
    evidence,
  }: { observations: any[]; sources: any[]; evidence: any[] } = bundle;
  assert(
    Array.isArray(observations) &&
      Array.isArray(sources) &&
      Array.isArray(evidence) &&
      observations.length <= 10000 &&
      sources.length <= 100 &&
      evidence.length <= 100 &&
      Buffer.byteLength(canonical(observations)) <= 16 * MIB,
    "Input count limits",
  );
  const hashes = {
    observationsSha256: digest(observations),
    sourcesSha256: digest(sources.map((s) => pick(s, ["docID", "sourceSha256", "availableAt"]))),
    evidenceSha256: digest(evidence.map((e) => pick(e, ["docID", "sha256", "receivedAt"]))),
  };
  const manifestHash = digest({ cutoff: bundle.cutoff, ...hashes });
  assert(
    manifestHash === expected &&
      expected === bundle.evidenceManifestSha256 &&
      expected === proof.evidenceManifestSha256,
    "Manifest fingerprint",
  );
  assert(
    proof.version === "1" &&
      proof.policy === POLICY &&
      proof.cutoff === bundle.cutoff &&
      Object.entries(hashes).every(([key, value]) => proof[key] === value) &&
      digest(omit(proof, "sha256")) === proof.sha256,
    "Proof fingerprint/policy",
  );
  const cutoff = timestamp(bundle.cutoff);
  keyed(observations, "observationId");
  const rawSources = new Map<string, Buffer>(),
    rawZips = new Map<string, Buffer>();
  let sourceBytes = 0,
    zipBytes = 0;
  for (const s of sources) {
    assert(!rawSources.has(s.docID), "Duplicate source");
    const raw = Object.hasOwn(s, "xml") ? Buffer.from(s.xml, "utf8") : bounded(s.file, 64 * MIB);
    sourceBytes += raw.length;
    assert(raw.length <= 64 * MIB && sourceBytes <= 256 * MIB, "Aggregate raw source limit");
    assert(sha(raw) === s.sourceSha256, "Source raw hash");
    rawSources.set(s.docID, raw);
  }
  for (const e of evidence) {
    assert(
      !rawZips.has(e.docID) && !Object.hasOwn(e, "bytes") && typeof e.path === "string",
      "Persisted ZIP path required",
    );
    const raw = bounded(e.path, 64 * MIB);
    zipBytes += raw.length;
    assert(zipBytes <= 256 * MIB, "Aggregate raw ZIP limit");
    assert(sha(raw) === e.sha256, "ZIP raw hash");
    rawZips.set(e.docID, raw);
  }
  const metadata = proof.metadataSelection;
  assert(
    metadata.cutoff === bundle.cutoff &&
      metadata.financialValuesMerged === false &&
      metadata.reconstructedUnobservedHistory === false,
    "Metadata mode",
  );
  const metadataDecisions = keyed(metadata.decisions, "rootDocID"),
    decisions = keyed(proof.decisions, "rootDocID");
  equalSets(
    Object.keys(decisions),
    Object.keys(metadataDecisions).filter((key) => metadataDecisions[key].status !== "selected"),
    "Missing unresolved decision",
  );
  let selected = 0,
    held = 0,
    members = 0;
  for (const decision of proof.decisions) {
    if (decision.status === "held") {
      held++;
      continue;
    }
    assert(
      decision.status === "selected-source" &&
        decision.reason === "same-root-complete-attached-inline-submission-sequence" &&
        digest(omit(decision, "sha256")) === decision.sha256,
      "Decision hash/status",
    );
    const rootId = decision.rootDocID,
      relevant: any[] = observations.filter(
        (o) =>
          timestamp(o.observedAt) <= cutoff &&
          (o.document.docID === rootId || o.document.parentDocID === rootId),
      ),
      latest: Record<string, any> = Object.create(null);
    for (const o of relevant) {
      const id = o.document.docID,
        old = latest[id];
      if (!old || timestamp(o.observedAt) > timestamp(old.observedAt)) latest[id] = o;
      else if (timestamp(o.observedAt) === timestamp(old.observedAt))
        equal(o.document, old.document, "Conflicting official metadata");
    }
    assert(
      Object.keys(latest).length === 3 && Object.hasOwn(latest, rootId),
      "Complete root/sibling closure",
    );
    const original = metadataDecisions[rootId];
    assert(
      original.status === "unresolved" &&
        original.reason === "multiple-correction-leaves" &&
        original.chainDocIDs.length === 3 &&
        !metadata.selected.some((s: any) => s.rootDocID === rootId),
      "Metadata unresolved not preserved",
    );
    equalSets(original.chainDocIDs, Object.keys(latest), "Metadata chain closure");
    const root = latest[rootId].document;
    assert(
      root.parentDocID == null &&
        ["120", "160"].includes(root.docTypeCode) &&
        root.formCode === (root.docTypeCode === "120" ? "030000" : "043A00") &&
        root.legalStatus === "1",
      "Original official form",
    );
    const versions = decision.sourceVersions;
    assert(versions.length === 3 && versions[0].docID === rootId, "Proof source closure");
    equalSets(
      versions.map((v: any) => v.docID),
      Object.keys(latest),
      "Proof source closure",
    );
    const identities: Record<string, string>[] = [],
      ordinals = new Map<number, string>(),
      dates = new Map<number, number>(),
      known: number[] = relevant.map((o) => timestamp(o.observedAt));
    for (const v of versions) {
      const docId = v.docID,
        official = latest[docId].document,
        declaration: any = sources.find((s) => s.docID === docId);
      assert(
        declaration &&
          v.sourceSha256 === declaration.sourceSha256 &&
          v.availableAt === declaration.availableAt,
        "Source declaration binding",
      );
      const submitted = timestamp(official.submitDateTime, true),
        available = timestamp(declaration.availableAt);
      assert(
        submitted <= available &&
          available <= cutoff &&
          ["1", 1].includes(official.xbrlFlag) &&
          String(official.withdrawalStatus) === "0" &&
          String(official.disclosureStatus) === "0",
        "Source/official availability",
      );
      const edit = String(official.docInfoEditStatus);
      assert(
        edit === "0" ||
          (edit === "2" &&
            latest[docId].listDate === official.submitDateTime.slice(0, 10) &&
            official.opeDateTime == null),
        "Official edit status",
      );
      const raw = rawSources.get(docId);
      assert(raw, "Raw source absent");
      const { identity, ordinal, flags, target } = sourceVersionIdentity(raw);
      equal(identity, v.identity, "Raw identity binding");
      assert(
        ordinal === v.ordinal &&
          identity.issuer === official.edinetCode &&
          identity.issuer === root.edinetCode &&
          identity.security === official.secCode &&
          identity.security === root.secCode,
        "Raw identity binding",
      );
      identities.push(identity);
      assert(!ordinals.has(ordinal), "Duplicate ordinal");
      ordinals.set(ordinal, docId);
      dates.set(ordinal, submitted);
      known.push(available);
      if (docId === rootId) {
        assert(
          ordinal === 1 &&
            flags.every((flag) => flag === "false") &&
            !target &&
            !Object.hasOwn(v, "zip"),
          "Original DEI",
        );
        assert(
          (root.docTypeCode === "120" ? ["FY"] : ["HY", "Q2"]).includes(identity.periodCode),
          "Official form family",
        );
        assert(
          root.periodStart === identity.fiscalStart &&
            [identity.currentPeriod, identity.fiscalEnd].includes(root.periodEnd),
          "Official root period",
        );
        continue;
      }
      assert(
        (official.periodStart == null || official.periodStart === root.periodStart) &&
          (official.periodEnd == null || official.periodEnd === root.periodEnd),
        "Official sibling period conflict",
      );
      assert(
        official.parentDocID === target &&
          target === rootId &&
          official.docTypeCode === (root.docTypeCode === "120" ? "130" : "170") &&
          ["true,true,false", "true,false,true"].includes(flags.join(",")),
        "Correction target/flags",
      );
      const e: any = evidence.find((e) => e.docID === docId);
      assert(e, "ZIP evidence absent");
      const received = timestamp(e.receivedAt);
      assert(
        submitted <= received && received <= available && available <= cutoff,
        "ZIP observation time",
      );
      const zip = rawZips.get(docId);
      assert(zip, "Raw ZIP absent");
      const actual = await attachedZipProof(
        zip,
        raw,
        e,
        ordinal,
        identity,
        official.submitDateTime.slice(0, 10),
      );
      equal(actual, v.zip, "Raw ZIP evidence mismatch");
      members += actual.memberCount;
      known.push(received);
    }
    equalSets(ordinals.keys(), [1, 2, 3], "Submission sequence");
    assert(
      dates.get(2)! < dates.get(3)! &&
        identities.every((i) => canonical(i) === canonical(identities[0])),
      "Submission sequence/common basis",
    );
    const chosen = ordinals.get(3)!,
      ids: string[] = relevant.map((o) => o.observationId).sort();
    assert(
      decision.selectedDocID === chosen &&
        timestamp(decision.knownAt) === Math.max(...known) &&
        original.observationIds.length === ids.length,
      "Causal selection binding",
    );
    equal(decision.chainDocIDs, [rootId, chosen], "Causal chain");
    equal(decision.observationIds, ids, "Causal observations");
    equalSets(original.observationIds, ids, "Metadata observations");
    const s = decision.selected;
    assert(
      s.rootDocID === rootId &&
        timestamp(s.observedAt) === Math.max(...relevant.map((o) => timestamp(o.observedAt))),
      "Selected projection lineage",
    );
    equal(s.chainDocIDs, [rootId, chosen], "Selected chain");
    equal(s.observationIds, ids, "Selected observations");
    equal(
      s.targetPeriod,
      { startDate: root.periodStart, endDate: root.periodEnd, sourceDocID: rootId },
      "Selected target period",
    );
    const observation = s.observation,
      official = latest[chosen].document,
      keys = [
        "docID",
        "parentDocID",
        "withdrawalStatus",
        "docInfoEditStatus",
        "disclosureStatus",
        "docTypeCode",
        "edinetCode",
        "secCode",
        "submitDateTime",
        "opeDateTime",
        "xbrlFlag",
        "pdfFlag",
        "csvFlag",
        "attachDocFlag",
        "englishDocFlag",
      ];
    const normalized = Object.fromEntries(
      Object.entries(official)
        .filter(([key]) => keys.includes(key))
        .map(([key, value]) => [
          key,
          key.endsWith("Flag") && value !== null ? String(value) : value,
        ]),
    );
    assert(
      observation.observationId === latest[chosen].observationId &&
        (observation.listDate ?? null) === (latest[chosen].listDate ?? null),
      "Selected official observation",
    );
    equal(observation.document, normalized, "Selected official document");
    for (const key of ["withdrawalStatus", "docInfoEditStatus", "disclosureStatus"])
      assert(
        observation.statuses[key].presence === "known" &&
          observation.statuses[key].code === String(official[key]),
        "Selected official statuses",
      );
    const availability = s.formatAvailability;
    assert(
      availability.observationId === latest[chosen].observationId &&
        timestamp(availability.observedAt) === timestamp(latest[chosen].observedAt),
      "Format observation",
    );
    for (const [key, name] of [
      ["xbrlFlag", "xbrl"],
      ["pdfFlag", "pdf"],
      ["csvFlag", "csv"],
      ["attachDocFlag", "attachments"],
      ["englishDocFlag", "english"],
    ]) {
      const code = official[key],
        text = String(code),
        expectedFormat = !Object.hasOwn(official, key)
          ? { state: "unknown", reason: "unrecorded" }
          : code === null
            ? { state: "unknown", reason: "null" }
            : ["0", "1"].includes(text)
              ? { state: text === "1" ? "provided" : "not-provided", code: text }
              : { state: "unknown", reason: "unrecognized-code", code: text };
      equal(availability.formats[name], expectedFormat, "Selected format binding");
    }
    selected++;
  }
  return {
    status: "passed",
    method: METHOD,
    evidenceManifestSha256: expected,
    proofSha256: proof.sha256,
    selectedSourceDecisions: selected,
    heldDecisions: held,
    documentsChecked: rawSources.size,
    zipFilesChecked: rawZips.size,
    sourceVersionDocumentsChecked: selected * 3,
    metadataDecisionsRetained: metadata.decisions.length,
    zipMembersChecked: members,
    financialValuesValidated: false,
    networkRequests: 0,
  };
}
