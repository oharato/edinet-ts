/** 全国全件のXML ZIPを予算内で取得する。容量に応じて全展開か一つずつの署名検証を行う。 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { strict as assert } from "node:assert";
import { availableBytes, RESERVE, reserveSpace } from "../files/retained-files";
import {
  createRegistrySession,
  downloadRegistryFile,
  type RegistryRequest,
} from "./download-session";
import { parseRegistryListing } from "./parse-download-listing";
import {
  inspectRegistryArchive,
  verifyRegistryArchiveParts,
  verifyRegistryZip,
} from "./verify-archive-parts";
import { verifyDetachedSignature } from "./verify-detached-signature";
import {
  atomic,
  budget,
  checkRetained,
  load,
  nextAttempt,
  presentDate,
  retainedText,
  same,
  withRegistryOutput,
} from "./acquisition-files";
export const NATIONAL_URL = "https://www.houjin-bangou.nta.go.jp/download/zenken/";
const MAX_ZIP = 2 * 1024 ** 3;
const listing = (file: string, date: string) =>
  parseRegistryListing(retainedText(file), date, "full");
function retainedArchive(directory: string, receipt: any, selected: any, fileId: string) {
  same(receipt.selected, selected, "Retained national selection differs");
  assert(
    receipt.fileId === fileId &&
      typeof receipt.attempt === "string" &&
      /^attempt-\d{4}$/.test(receipt.attempt),
    "Invalid national attempt",
  );
  const attempt = join(directory, receipt.attempt);
  assert(!lstatSync(attempt).isSymbolicLink(), "National attempt is a symlink");
  checkRetained(join(attempt, "listing.html"), receipt.listing, 2 * 1024 ** 2);
  checkRetained(join(attempt, "delivery.zip"), receipt.download, MAX_ZIP);
  same(
    listing(join(attempt, "listing.html"), selected.dataDate).selected,
    selected,
    "National listing changed",
  );
  assert(
    receipt.listing.url === NATIONAL_URL && receipt.download.url === NATIONAL_URL + "index.html",
    "National URL changed",
  );
  return attempt;
}
export async function fetchNationalRegistry(
  date: string,
  key: string,
  fingerprint: string,
  output: string,
  maxZips = 1,
  sessionFactory: () => RegistryRequest = createRegistrySession,
) {
  presentDate(date);
  budget(maxZips);
  return withRegistryOutput(output, key, fingerprint, async (root, trust, key) => {
    const query = { dataDate: date, ...trust };
    let requests = 0,
      downloads = 0;
    const getListing = async (parent: string) => {
      const attempt = nextAttempt(parent),
        request = sessionFactory();
      requests++;
      const receipt = await downloadRegistryFile(
        request,
        NATIONAL_URL,
        join(attempt, "listing.html"),
        2 * 1024 ** 2,
      );
      return { attempt, request, receipt, ...listing(join(attempt, "listing.html"), date) };
    };
    let plan: any, initial: Awaited<ReturnType<typeof getListing>> | undefined;
    if (existsSync(join(root, "plan.json"))) {
      plan = load(join(root, "plan.json"));
      same(plan.query, query, "National resume plan differs");
    } else {
      initial = await getListing(join(root, "catalog"));
      plan = {
        query,
        selected: initial.selected,
        catalog: { file: join(initial.attempt, "listing.html"), receipt: initial.receipt },
      };
      atomic(join(root, "plan.json"), plan);
    }
    atomic(join(root, "status.json"), {
      status: "checking",
      dataDate: date,
      signaturesVerified: false,
      materialized: false,
    });
    const selected = listing(plan.catalog.file, date).selected;
    same(selected, plan.selected, "National catalog changed");
    assert(
      createHash("sha256").update(retainedText(plan.catalog.file)).digest("hex") ===
        plan.catalog.receipt.sha256,
      "National catalog hash changed",
    );
    const parts: {
        directory: string;
        attempt: string;
        receipt: any;
        inventory: Awaited<ReturnType<typeof inspectRegistryArchive>>;
      }[] = [],
      pending: string[] = [];
    for (const [i, link] of selected.zips.entries()) {
      const directory = join(root, "part-" + String(i).padStart(3, "0"));
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      assert(!lstatSync(directory).isSymbolicLink(), "Part directory is a symlink");
      if (!existsSync(join(directory, "acquisition.json"))) {
        if (downloads >= maxZips) {
          pending.push(link.fileId);
          continue;
        }
        reserveSpace(root, MAX_ZIP);
        let attempt: string, current: Awaited<ReturnType<typeof getListing>>;
        if (initial) {
          current = initial;
          initial = undefined;
          attempt = nextAttempt(directory);
          copyFileSync(join(current.attempt, "listing.html"), join(attempt, "listing.html"));
        } else {
          current = await getListing(directory);
          attempt = current.attempt;
        }
        same(current.selected, selected, "National catalog changed before download");
        requests++;
        downloads++;
        const downloaded = await downloadRegistryFile(
          current.request,
          NATIONAL_URL + "index.html",
          join(attempt, "delivery.zip"),
          MAX_ZIP,
          new URLSearchParams({ ...current.fields, selDlFileNo: link.fileId }),
        );
        atomic(join(directory, "acquisition.json"), {
          selected,
          fileId: link.fileId,
          attempt: basename(attempt),
          listing: current.receipt,
          download: downloaded,
        });
      }
      const receipt = load(join(directory, "acquisition.json")),
        attempt = retainedArchive(directory, receipt, selected, link.fileId),
        inventory = await inspectRegistryArchive(
          join(attempt, "delivery.zip"),
          receipt.download.sha256,
        );
      parts.push({ directory, attempt, receipt, inventory });
      assert(
        parts.reduce((n, p) => n + p.inventory.expectedXmlParts.length, 0) <= 100,
        "National XML part count",
      );
    }
    const status: any = {
      dataDate: date,
      scope: "national",
      requestsThisRun: requests,
      downloadsThisRun: downloads,
      pendingFileIds: pending,
      parts: parts.map((p) => ({
        fileId: p.receipt.fileId,
        archive: join(p.attempt, "delivery.zip"),
        ...p.inventory,
      })),
      signaturesVerified: false,
      materialized: false,
    };
    const manifestFor = (p: (typeof parts)[number]) => ({
      archive: join(p.attempt, "delivery.zip"),
      sha256: p.receipt.download.sha256,
      publicKey: key,
      fingerprint,
      source: {
        sourceUrl: NATIONAL_URL,
        observedAt: p.receipt.download.observedAt,
        dataDate: date,
        kind: "full",
        purpose: "download",
      },
      expectedXmlParts: p.inventory.expectedXmlParts,
    });
    if (pending.length) status.status = "pending";
    else {
      const required = parts
          .filter((p) => !existsSync(join(p.directory, "verified/receipt.json")))
          .reduce((n, p) => n + p.inventory.expandedBytes, 0),
        free = availableBytes(root);
      Object.assign(status, {
        requiredExpandedBytes: required,
        freeBytes: Number(free),
        reserveBytes: RESERVE,
      });
      if (free < BigInt(RESERVE) + BigInt(required)) {
        const largest = Math.max(
          0,
          ...parts.map(
            (p) =>
              Math.max(
                ...p.inventory.members.filter((m) => m.entry.endsWith(".xml")).map((m) => m.bytes),
              ) +
              1024 ** 2,
          ),
        );
        status.requiredTemporaryBytes = largest;
        if (free < BigInt(RESERVE) + BigInt(largest)) status.status = "pending-capacity";
        else {
          const proofs: string[] = [];
          let count = 0;
          for (const p of parts) {
            const input = join(p.directory, "archive-verification-input.json");
            atomic(input, manifestFor(p));
            const proof = await verifyRegistryArchiveParts(input);
            count += proof.parts.length;
            assert(count <= 100, "National XML part count");
            const number =
              1 +
              Math.max(
                0,
                ...readdirSync(p.directory)
                  .filter((name) => /^archive-verification-\d{4}\.json$/.test(name))
                  .map((name) => Number(name.slice(-9, -5))),
              );
            assert(number <= 9999, "Verification receipt count");
            const target = join(
              p.directory,
              "archive-verification-" + String(number).padStart(4, "0") + ".json",
            );
            atomic(target, proof);
            proofs.push(target);
          }
          for (const part of status.parts) part.signaturesVerified = true;
          Object.assign(status, {
            status: "verified-archive",
            signaturesVerified: true,
            expectedParts: count,
            archiveVerifications: proofs,
            materialized: false,
          });
        }
      } else {
        const imports: string[] = [];
        for (const p of parts) {
          const manifest = manifestFor(p),
            verifiedDir = join(p.directory, "verified");
          if (!existsSync(join(verifiedDir, "receipt.json"))) {
            if (existsSync(verifiedDir))
              renameSync(
                verifiedDir,
                join(p.directory, "verified-incomplete-" + basename(p.attempt)),
              );
            const input = join(p.directory, "zip-input.json");
            atomic(input, manifest);
            await verifyRegistryZip(input, verifiedDir);
          }
          const verified = load(join(verifiedDir, "receipt.json"));
          assert(
            verified.parts.length === p.inventory.expectedXmlParts.length &&
              verified.archive.sha256 === manifest.sha256,
            "Verified archive mismatch",
          );
          for (const [j, part] of verified.parts.entries()) {
            const stem = "part-" + String(j).padStart(3, "0"),
              actual = await verifyDetachedSignature(join(verifiedDir, stem + "-input.json"));
            assert(
              actual.importManifest.part === p.inventory.expectedXmlParts[j] &&
                actual.files.file.path === join(verifiedDir, stem + ".xml") &&
                actual.trustedFingerprint === query.fingerprint &&
                actual.files.publicKey.sha256 === query.publicKeySha256,
              "National part membership or trust mismatch",
            );
            same(actual.files, part.files, "Verified national files changed");
            same(actual.importManifest, part.importManifest, "Verified national import changed");
            same(actual.importManifest.source, manifest.source, "National source changed");
            const importFile = join(verifiedDir, stem + "-import.json");
            same(load(importFile), actual.importManifest, "National import file changed");
            imports.push(importFile);
          }
        }
        assert(imports.length >= 1 && imports.length <= 100, "National XML part count");
        for (const part of status.parts) part.signaturesVerified = true;
        Object.assign(status, {
          status: "complete",
          signaturesVerified: true,
          materialized: true,
          expectedParts: imports.length,
          importManifests: imports,
        });
      }
    }
    atomic(join(root, "status.json"), status);
    return status;
  });
}
