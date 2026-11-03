/** 一日分の国税庁差分を取得する。失敗試行を残し、再開時は保存原本・署名を再検証する。 */
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { strict as assert } from "node:assert";
import { exactKeys, reserveSpace } from "../files/retained-files";
import { verifyDetachedSignature } from "./verify-detached-signature";
import { verifyRegistryZip } from "./verify-archive-parts";
import {
  createRegistrySession,
  downloadRegistryFile,
  type RegistryRequest,
} from "./download-session";
import { parseRegistryListing } from "./parse-download-listing";
import {
  atomic,
  checkRetained,
  load,
  nextAttempt,
  presentDate,
  retainedText,
  same,
  withRegistryOutput,
} from "./acquisition-files";
export const DIFFERENCE_URL = "https://www.houjin-bangou.nta.go.jp/download/sabun/";
const MAX_ZIP = 64 * 1024 ** 2;
async function validateComplete(root: string, receipt: any, plan: any) {
  exactKeys(receipt, [
    "format",
    "plan",
    "attempt",
    "acquisition",
    "verifiedReceipt",
    "importManifest",
  ]);
  same(receipt.plan, plan, "Completion plan mismatch");
  assert(
    typeof receipt.attempt === "string" && /^attempt-\d{4}$/.test(receipt.attempt),
    "Invalid completion attempt",
  );
  const attempt = join(root, receipt.attempt);
  assert(
    !lstatSync(attempt).isSymbolicLink() &&
      receipt.format === "edinet-ts-corporate-registry-acquisition-v1" &&
      receipt.verifiedReceipt === join(attempt, "verified/receipt.json") &&
      receipt.importManifest === join(attempt, "verified/part-000-import.json"),
    "Completion output mismatch",
  );
  const acquisition = load(join(attempt, "acquisition.json"));
  same(acquisition, receipt.acquisition, "Acquisition receipt mismatch");
  checkRetained(join(attempt, "listing.html"), acquisition.listing, 2 * 1024 ** 2);
  checkRetained(join(attempt, "delivery.zip"), acquisition.download, MAX_ZIP);
  const selected = parseRegistryListing(
    retainedText(join(attempt, "listing.html")),
    plan.dataDate,
    "diff",
  ).selected;
  same(selected, acquisition.selected, "Listing selection mismatch");
  const archive = load(join(attempt, "verified/receipt.json"));
  assert(
    acquisition.listing.url === DIFFERENCE_URL &&
      acquisition.download.url === DIFFERENCE_URL + "index.html" &&
      archive.archive.path === join(attempt, "delivery.zip") &&
      archive.archive.sha256 === acquisition.download.sha256 &&
      archive.parts.length === 1,
    "Acquisition URL, archive or membership mismatch",
  );
  const source = {
    sourceUrl: DIFFERENCE_URL,
    observedAt: acquisition.download.observedAt,
    dataDate: plan.dataDate,
    kind: "diff",
    purpose: "download",
  };
  same(archive.source, source, "Source mismatch");
  assert(archive.parts[0].trustedFingerprint === plan.fingerprint, "Trust mismatch");
  const part = await verifyDetachedSignature(join(attempt, "verified/part-000-input.json"));
  assert(
    part.trustedFingerprint === plan.fingerprint &&
      part.importManifest.part === "diff_" + plan.dataDate.replaceAll("-", "") + ".xml" &&
      part.files.file.path === join(attempt, "verified/part-000.xml") &&
      part.files.signature.path === join(attempt, "verified/part-000.xml.asc") &&
      part.files.publicKey.sha256 === plan.publicKeySha256,
    "Part source, path or key mismatch",
  );
  same(part.importManifest.source, source, "Part source mismatch");
  same(part.importManifest, archive.parts[0].importManifest, "Verified import changed");
  same(part.files, archive.parts[0].files, "Verified files changed");
  same(load(receipt.importManifest), part.importManifest, "Import manifest changed");
  return receipt;
}
export async function fetchRegistryDifference(
  date: string,
  key: string,
  fingerprint: string,
  output: string,
  request: RegistryRequest = createRegistrySession(),
  onRequest?: () => void,
) {
  presentDate(date);
  return withRegistryOutput(output, key, fingerprint, async (root, trust, key) => {
    const plan = { dataDate: date, sourceUrl: DIFFERENCE_URL, ...trust };
    if (existsSync(join(root, "plan.json")))
      same(load(join(root, "plan.json")), plan, "Resume plan differs");
    else atomic(join(root, "plan.json"), plan);
    if (existsSync(join(root, "complete.json")))
      return {
        status: "retained",
        networkRequested: false,
        requestCount: 0,
        ...(await validateComplete(root, load(join(root, "complete.json")), plan)),
      };
    for (const previous of readdirSync(root)
      .filter((name) => /^attempt-\d{4}$/.test(name))
      .sort()
      .reverse()) {
      if (existsSync(join(root, previous, "complete.json"))) {
        const receipt = await validateComplete(
          root,
          load(join(root, previous, "complete.json")),
          plan,
        );
        atomic(join(root, "complete.json"), receipt);
        return { status: "recovered", networkRequested: false, requestCount: 0, ...receipt };
      }
    }
    const attempt = nextAttempt(root);
    let requests = 0;
    try {
      reserveSpace(root, MAX_ZIP);
      requests++;
      onRequest?.();
      const listing = await downloadRegistryFile(
        request,
        DIFFERENCE_URL,
        join(attempt, "listing.html"),
        2 * 1024 ** 2,
      );
      const { fields, selected } = parseRegistryListing(
        retainedText(join(attempt, "listing.html")),
        date,
        "diff",
      );
      const form = new URLSearchParams({ ...fields, selDlFileNo: selected.fileId });
      requests++;
      onRequest?.();
      const downloaded = await downloadRegistryFile(
          request,
          DIFFERENCE_URL + "index.html",
          join(attempt, "delivery.zip"),
          MAX_ZIP,
          form,
        ),
        acquisition = { listing, download: downloaded, selected };
      atomic(join(attempt, "acquisition.json"), acquisition);
      const source = {
        sourceUrl: DIFFERENCE_URL,
        observedAt: downloaded.observedAt,
        dataDate: date,
        kind: "diff",
        purpose: "download",
      };
      const manifest = {
        archive: join(attempt, "delivery.zip"),
        sha256: downloaded.sha256,
        publicKey: key,
        fingerprint,
        source,
        expectedXmlParts: ["diff_" + date.replaceAll("-", "") + ".xml"],
      };
      atomic(join(attempt, "zip-input.json"), manifest);
      await verifyRegistryZip(join(attempt, "zip-input.json"), join(attempt, "verified"));
      const receipt = {
        format: "edinet-ts-corporate-registry-acquisition-v1",
        plan,
        attempt: basename(attempt),
        acquisition,
        verifiedReceipt: join(attempt, "verified/receipt.json"),
        importManifest: join(attempt, "verified/part-000-import.json"),
      };
      await validateComplete(root, receipt, plan);
      atomic(join(attempt, "complete.json"), receipt);
      atomic(join(root, "complete.json"), receipt);
      return { status: "downloaded", networkRequested: true, requestCount: requests, ...receipt };
    } catch (error) {
      atomic(join(attempt, "failure.json"), {
        errorType: error instanceof Error ? error.name : "Error",
        requestCount: requests,
        failedAt: new Date().toISOString(),
      });
      throw error;
    }
  });
}
