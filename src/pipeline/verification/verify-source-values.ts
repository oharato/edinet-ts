/** 検索DBの値・出典を原本から独立に検査するNode専用コマンド。DBへ書き込まない。 */
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Database } from "../../db/node-sqlite";
import {
  readSourceXbrl,
  children,
  descendants,
  expanded,
  factKey,
  deiName,
  XBRL,
  DIMENSION,
  NIL,
  type SourceXmlNode,
  type SourceXbrl,
} from "./read-source-xbrl";
type Json = Record<string, any>;
type SqlRow = Record<string, any>;
const LIMIT = 256 * 1024 ** 2;
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
const equal = (a: unknown, b: unknown, message: string) =>
  assert(canonical(a) === canonical(b), message);
const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
async function fileDigest(path: string) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path, { highWaterMark: 1024 * 1024 })) h.update(chunk);
  return h.digest("hex");
}
const one = <T>(values: T[], message: string) => {
  assert(values.length === 1, message);
  return values[0];
};
const contextEntity = (n: SourceXmlNode) =>
  children(n, XBRL, "entity").flatMap((e) => children(e, XBRL, "identifier"));
function date(value: string) {
  assert(
    /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) > 0,
    "DEI date format differs",
  );
  const n = Date.parse(value + "T00:00:00Z");
  assert(
    Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value,
    "Invalid DEI date",
  );
  return n;
}
function timestamp(value: string) {
  assert(
    typeof value === "string" && /(Z|[+-]\d{2}:\d{2})$/.test(value),
    "Timestamp requires timezone",
  );
  const n = Date.parse(value);
  assert(Number.isFinite(n), "Invalid timestamp");
  return n;
}
function contextPeriod(context: SourceXmlNode) {
  const period = one(children(context, XBRL, "period"), "Context period is absent or duplicated"),
    value = Object.fromEntries(
      period.children.map((n) => [
        n.tag.startsWith("{" + XBRL + "}") ? n.tag.slice(XBRL.length + 2) : n.tag,
        n.text.trim(),
      ]),
    );
  assert(Object.keys(value).length === period.children.length, "Duplicate context period");
  return value;
}
function deiFields(document: SourceXbrl, tags: string[], optional: string[], code: string) {
  const values: Record<string, string> = Object.create(null),
    identities = new Set<string>();
  for (const tag of tags) {
    const nodes = [...document.facts.values()].flatMap((group) =>
      group.filter((n) => deiName(n.tag) === tag),
    );
    if (!nodes.length && optional.includes(tag)) continue;
    const node = one(nodes, "DEI absent or ambiguous");
    assert(
      !node.attributes.unitRef &&
        !node.children.length &&
        [undefined, "false", "0"].includes(node.attributes[NIL]),
      "DEI primitive differs",
    );
    const context = one(
      document.contexts.get(node.attributes.contextRef) ?? [],
      "DEI context differs",
    );
    assert(
      !descendants(context, DIMENSION, "explicitMember").length &&
        !descendants(context, DIMENSION, "typedMember").length,
      "DEI dimensions differ",
    );
    const entity = one(contextEntity(context), "DEI entity differs"),
      period = one(children(context, XBRL, "period"), "DEI period differs"),
      instant = one(children(period, XBRL, "instant"), "DEI filing instant differs");
    assert(period.children.length === 1, "DEI filing context differs");
    assert(
      entity.attributes.scheme === "http://disclosure.edinet-fsa.go.jp" &&
        entity.text.trim() === code + "-000",
      "DEI issuer differs",
    );
    identities.add(canonical([entity.text.trim(), instant.text.trim()]));
    values[tag] = node.text.trim();
  }
  assert(identities.size === 1, "DEI identities differ");
  return { values, filing: JSON.parse([...identities][0])[1] as string };
}
const genericTags = [
  "AccountingStandardsDEI",
  "WhetherConsolidatedFinancialStatementsArePreparedDEI",
  "CurrentFiscalYearStartDateDEI",
  "CurrentPeriodEndDateDEI",
  "CurrentFiscalYearEndDateDEI",
  "EDINETCodeDEI",
  "SecurityCodeDEI",
];
function verifyGenericDei(document: SourceXbrl, m: Json, code: string) {
  const { values: v, filing } = deiFields(
    document,
    genericTags,
    ["CurrentFiscalYearEndDateDEI"],
    code,
  );
  assert(
    ({ "Japan GAAP": "J-GAAP", IFRS: "IFRS" } as Record<string, string>)[
      v.AccountingStandardsDEI
    ] === m.accountingStandard,
    "Generic standard differs",
  );
  const main = v.WhetherConsolidatedFinancialStatementsArePreparedDEI;
  assert(["true", "1", "false", "0"].includes(main), "Generic main scope unknown");
  assert(
    ["Consolidated", "NonConsolidated"].includes(m.scope) &&
      (m.scope !== "Consolidated" || ["true", "1"].includes(main)),
    "Generic main scope differs",
  );
  assert(v.EDINETCodeDEI === code && v.SecurityCodeDEI === m.secCode, "Generic code differs");
  const start = date(v.CurrentFiscalYearStartDateDEI),
    end = date(v.CurrentPeriodEndDateDEI);
  assert(start <= end && end <= date(filing), "Generic chronology differs");
  if (v.CurrentFiscalYearEndDateDEI)
    assert(end <= date(v.CurrentFiscalYearEndDateDEI), "Generic fiscal chronology differs");
}
function verifyStandalone(document: SourceXbrl, m: Json, code: string) {
  if (m.accountingStandard !== "IFRS" || m.scope !== "NonConsolidated") return false;
  const { values: v } = deiFields(
    document,
    [...genericTags, "TypeOfCurrentPeriodDEI", "DocumentTypeDEI"],
    ["CurrentFiscalYearEndDateDEI", "DocumentTypeDEI"],
    code,
  );
  assert(
    v.AccountingStandardsDEI === "IFRS" &&
      ["false", "0"].includes(v.WhetherConsolidatedFinancialStatementsArePreparedDEI),
    "Standalone IFRS basis differs",
  );
  assert(
    v.EDINETCodeDEI === code && v.SecurityCodeDEI === m.secCode,
    "Standalone IFRS code differs",
  );
  const start = v.CurrentFiscalYearStartDateDEI,
    end = v.CurrentPeriodEndDateDEI;
  assert(date(start) <= date(end), "Standalone IFRS current dates differ");
  assert(
    ["FY", "HY", "Q1", "Q2", "Q3", "Q4"].includes(v.TypeOfCurrentPeriodDEI),
    "Standalone IFRS period unknown",
  );
  if (v.TypeOfCurrentPeriodDEI === "Q4") {
    const [year, month, day] = start.split("-").map(Number),
      boundary = (months: number) => {
        const total = year * 12 + month - 1 + months;
        const d =
          String(Math.floor(total / 12)).padStart(4, "0") +
          "-" +
          String((total % 12) + 1).padStart(2, "0") +
          "-" +
          String(day).padStart(2, "0");
        date(d);
        return d;
      };
    assert(v.DocumentTypeDEI === "第四号の三様式", "Q4 form differs");
    assert(
      date(end) === date(boundary(12)) - 86400000 &&
        date(v.CurrentFiscalYearEndDateDEI) > date(end),
      "Q4 fiscal year differs",
    );
    const expected = { startDate: boundary(9), endDate: end };
    let found = false;
    for (const group of document.contexts.values())
      for (const c of group) {
        if (canonical(contextPeriod(c)) !== canonical(expected)) continue;
        const members = descendants(c, DIMENSION, "explicitMember"),
          entities = contextEntity(c);
        if (
          entities.length === 1 &&
          entities[0].attributes.scheme === "http://disclosure.edinet-fsa.go.jp" &&
          entities[0].text.trim() === code + "-000" &&
          members.length === 1 &&
          members[0].attributes.dimension?.split(":").at(-1) ===
            "ConsolidatedOrNonConsolidatedAxis" &&
          members[0].text.trim().split(":").at(-1) === "NonConsolidatedMember" &&
          !descendants(c, DIMENSION, "typedMember").length
        ) {
          assert(group.length === 1, "Q4 context duplicated");
          verifyDimensionNamespace(document, members[0]);
          found = true;
        }
      }
    assert(found, "Q4 current context absent");
  }
  equal(
    m.period,
    "instant" in m.period ? { instant: end } : { startDate: start, endDate: end },
    "Standalone IFRS is not declared current period",
  );
  if (!("instant" in m.period))
    assert(
      m.periodType === (v.TypeOfCurrentPeriodDEI === "FY" ? "annual" : "ytd"),
      "Standalone period classification differs",
    );
  return true;
}
function verifyDimensionNamespace(document: SourceXbrl, member: SourceXmlNode) {
  for (const name of [member.attributes.dimension, member.text.trim()])
    assert(
      /^http:\/\/disclosure\.edinet-fsa\.go\.jp\/taxonomy\/(jppfs|jpcrp)\/\d{4}-\d{2}-\d{2}\/(jppfs_cor|jpcrp_cor)$/.test(
        document.namespaces.get(name.split(":")[0]) ?? "",
      ),
      "Dimension namespace differs",
    );
}
function verifyEvidence(document: SourceXbrl, e: Json, m: Json) {
  const context = one(document.contexts.get(e.contextRef) ?? [], "Context absent or duplicated"),
    entity = one(contextEntity(context), "Entity absent or duplicated");
  equal(
    { scheme: entity.attributes.scheme, identifier: entity.text.trim() },
    e.entity,
    "Entity differs",
  );
  equal(contextPeriod(context), e.period, "Period evidence differs");
  equal(e.period, m.period, "Period differs");
  const dimensions = descendants(context, DIMENSION, "explicitMember");
  assert(
    !descendants(context, DIMENSION, "typedMember").length,
    "Typed dimension requires separate verification",
  );
  if (m.scope === "Consolidated") {
    assert(!dimensions.length, "Consolidated scope differs");
    equal(e.dimensions, [], "Consolidated evidence differs");
  } else {
    assert(m.scope === "NonConsolidated", "Unknown scope");
    const member = one(dimensions, "Standalone scope differs");
    assert(
      member.attributes.dimension?.split(":").at(-1) === "ConsolidatedOrNonConsolidatedAxis" &&
        member.text.trim().split(":").at(-1) === "NonConsolidatedMember",
      "Standalone dimension differs",
    );
    verifyDimensionNamespace(document, member);
    equal(e.dimensions, ["NonConsolidatedMember"], "Standalone evidence differs");
  }
  assert(e.scope === m.scope, "Scope evidence differs");
  const unit = one(document.units.get(e.unitRef) ?? [], "Unit absent or duplicated"),
    measure = one(unit.children, "Unit is divided or empty");
  assert(measure.tag === expanded(XBRL, "measure"), "Unit is divided");
  const parts = measure.text.trim().split(":");
  assert(
    parts.length === 2 &&
      document.namespaces.get(parts[0]) === "http://www.xbrl.org/2003/iso4217" &&
      parts[1] === "JPY" &&
      e.unit === "iso4217:JPY" &&
      m.currency === "JPY",
    "Currency differs",
  );
  const matching =
    document.facts.get(
      factKey(expanded(e.namespaceURI, e.key.split(":")[1]), e.contextRef, e.unitRef),
    ) ?? [];
  assert(matching.length, "Selected fact absent");
  for (const fact of matching) {
    assert(
      !fact.children.length && [undefined, "false", "0"].includes(fact.attributes[NIL]),
      "Selected fact nil or structured",
    );
    assert(
      fact.text.trim() === e.raw && (fact.attributes.decimals ?? null) === (e.decimals ?? null),
      "Raw amount or precision differs",
    );
  }
  return matching.length;
}
/** Decimal comparison independent of the SDK's conversion helper. */
function decimal(value: string) {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value.trim());
  assert(match && (match[2] || match[3]), "Invalid decimal");
  let digits = (match[2] + (match[3] ?? "")).replace(/^0+/, "");
  let exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
  if (!digits) return "0";
  let end = digits.length;
  while (end > 0 && digits.charCodeAt(end - 1) === 48) end--;
  exponent += digits.length - end;
  digits = digits.slice(0, end);
  return (match[1] === "-" ? "-" : "") + digits + "e" + exponent;
}
function verifySqlValue(value: SqlRow, selection: Json) {
  const raw = selection.raw ?? null;
  let safe: number | null = null;
  if (selection.status === "selected") {
    assert(typeof raw === "string" && raw.trim(), "Selected raw absent");
    const n = Number(raw);
    if (
      Number.isFinite(n) &&
      Math.abs(n) <= Number.MAX_SAFE_INTEGER &&
      decimal(raw) === decimal(String(n))
    )
      safe = n;
    assert(
      (selection.safeNumber ?? null) === safe,
      "Safe number differs from independent decimal conversion",
    );
  }
  const failure =
    selection.status !== "selected" ? selection.status : safe === null ? "unsafe-number" : null;
  equal(
    [
      value.available,
      value.numeric_value,
      value.raw_text,
      value.status,
      value.reason,
      value.failure_kind,
    ],
    [Number(failure === null), safe, raw, selection.status, selection.reason, failure],
    "SQL projection differs",
  );
}
function verifyLineage(row: Json, selected: Json | undefined, dei: Map<string, string[]>) {
  assert(selected, "Row document not selected");
  for (const field of ["rootDocID", "chainDocIDs", "observationIds"])
    equal(row[field], selected[field], "Selection lineage differs");
  const chain = row.chainDocIDs;
  assert(
    Array.isArray(chain) &&
      chain.length &&
      chain.every((v) => typeof v === "string" && v) &&
      new Set(chain).size === chain.length &&
      chain[0] === row.rootDocID &&
      chain.at(-1) === row.snapshot.metadata.docID,
    "Invalid selected chain",
  );
  if (chain.length === 1) return [false, false];
  const targets = dei.get("IdentificationOfDocumentSubjectToAmendmentDEI") ?? [];
  if (!targets.some(Boolean)) return [false, true];
  assert(
    targets.length === 1 && chain.slice(0, -1).includes(targets[0]),
    "Amendment target not strict ancestor",
  );
  return [true, false];
}
interface IndexReader {
  rows(sql: string, args: unknown[]): Promise<SqlRow[]>;
  close(): void;
}
async function openIndex(engine: string, path: string): Promise<IndexReader> {
  if (engine === "sqlite") {
    const db = new Database(path, { readOnly: true });
    return {
      async rows(sql, args) {
        const s = db.prepare(sql);
        try {
          return s.all(...(args as any[])) as SqlRow[];
        } finally {
          s.close();
        }
      },
      close: () => db.close(),
    };
  }
  assert(engine === "duckdb", "Explicit index engine required");
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create(path, {
    access_mode: "READ_ONLY",
    threads: "1",
    memory_limit: "512MB",
    enable_external_access: "false",
    autoload_known_extensions: "false",
    autoinstall_known_extensions: "false",
  });
  let connection;
  try {
    connection = await instance.connect();
  } catch (error) {
    instance.closeSync();
    throw error;
  }
  return {
    async rows(sql, args) {
      const r = await connection.runAndReadAll(sql, args as any[]);
      return r.getRowObjects().map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => {
            if (typeof v === "bigint") {
              const n = Number(v);
              assert(Number.isSafeInteger(n), "Unsafe SQL integer");
              return [k, n];
            }
            return [k, v];
          }),
        ),
      );
    },
    close() {
      connection.closeSync();
      instance.closeSync();
    },
  };
}
/** Independent read-only replay for either search engine. No SDK extraction/selection imports. */
export async function verifySourceValues(
  engine: string,
  indexPath: string,
  archivePath: string,
  generation: string,
  expectedArchiveHash: string,
) {
  assert((await fileDigest(archivePath)) === expectedArchiveHash, "Archive fingerprint differs");
  const index = await openIndex(engine, indexPath);
  let archive;
  try {
    archive = new Database(archivePath, { readOnly: true });
  } catch (error) {
    index.close();
    throw error;
  }
  const query = (sql: string, args: unknown[] = []) => {
    const s = archive.prepare(sql);
    try {
      return s.all(...(args as any[])) as SqlRow[];
    } finally {
      s.close();
    }
  };
  try {
    const kind = one(query("select kind from archive_format"), "Archive format absent").kind;
    assert(
      [
        "edinet-ts-observed-financial-archive-v1",
        "edinet-ts-observed-financial-archive-gzip-v1",
      ].includes(kind),
      "Unknown archive format",
    );
    const report = JSON.parse(
        one(
          await index.rows("select body from financial_generations where id=?", [generation]),
          "Generation absent",
        ).body,
      ),
      cutoff = timestamp(report.selection.cutoff),
      selectedByDoc = new Map<string, Json>();
    for (const selected of report.selection.selected) {
      const id = selected.observation.document.docID;
      assert(!selectedByDoc.has(id), "Duplicate selected document");
      selectedByDoc.set(id, selected);
    }
    const sqlValues = new Map<string, SqlRow>();
    for (const value of await index.rows(
      "select row_id,metric_id,available,numeric_value,raw_text,status,reason,failure_kind from financial_values where generation=?",
      [generation],
    )) {
      const key = JSON.stringify([value.row_id, value.metric_id]);
      assert(!sqlValues.has(key), "Duplicate SQL value");
      sqlValues.set(key, value);
    }
    const rows = new Map<string, { id: string; row: Json }[]>();
    for (const c of await index.rows(
      "select generation,row_id,group_id,standard,scope,currency,period_start,period_end,period_type,edinet_code,sec_code,doc_id,body from financial_rows where generation=? order by row_id",
      [generation],
    )) {
      const row = JSON.parse(c.body),
        m = row.snapshot.metadata,
        p = m.period;
      equal(
        [
          c.generation,
          c.row_id,
          c.group_id,
          c.standard,
          c.scope,
          c.currency,
          c.period_start,
          c.period_end,
          c.period_type,
          c.edinet_code,
          c.sec_code,
          c.doc_id,
        ],
        [
          generation,
          c.row_id,
          row.group,
          m.accountingStandard,
          m.scope,
          m.currency,
          p.startDate ?? "",
          p.endDate ?? p.instant,
          m.periodType ?? "",
          row.edinetCode,
          m.secCode,
          m.docID,
        ],
        "SQL row metadata differs",
      );
      const group = rows.get(row.sourceSha256) ?? [];
      group.push({ id: c.row_id, row });
      rows.set(row.sourceSha256, group);
    }
    const checks: any[][] = [],
      documents = new Set<string>(),
      explicitTargets = new Set<string>(),
      legacyCorrections = new Set<string>();
    let checkedFacts = 0,
      standaloneRows = 0,
      totalRows = 0;
    for (const [sourceHash, group] of [...rows].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      let bytes = Buffer.from(
        one(
          query("select xml from archive_contents where sha256=?", [sourceHash]),
          "Source missing",
        ).xml,
      );
      assert(bytes.length <= LIMIT, "Oversized source");
      if (kind.endsWith("-gzip-v1")) bytes = gunzipSync(bytes, { maxOutputLength: LIMIT + 1 });
      assert(bytes.length <= LIMIT && digest(bytes) === sourceHash, "Source fingerprint differs");
      const wanted = new Set<string>();
      for (const { row } of group)
        for (const s of Object.values(row.snapshot.selections) as Json[])
          if (s.status === "selected")
            for (const e of s.evidence)
              if (["selected", "selected-raw-only"].includes(e.reason))
                wanted.add(expanded(e.namespaceURI, e.key.split(":")[1]));
      const document = readSourceXbrl(bytes, wanted);
      for (const { id, row } of group) {
        totalRows++;
        const m = row.snapshot.metadata;
        assert(timestamp(row.knownAt) <= cutoff, "Row not known by cutoff");
        const declarations = query("select body from archive_sources where doc_id=?", [
          m.docID,
        ]).map((s) => JSON.parse(s.body));
        assert(
          declarations.some(
            (s) =>
              s.docID === m.docID &&
              s.sourceSha256 === sourceHash &&
              timestamp(s.availableAt) <= cutoff,
          ),
          "Source identity/cutoff differs",
        );
        verifyGenericDei(document, m, row.edinetCode);
        standaloneRows += Number(verifyStandalone(document, m, row.edinetCode));
        const [explicit, legacy] = verifyLineage(row, selectedByDoc.get(m.docID), document.dei);
        if (explicit) explicitTargets.add(m.docID);
        if (legacy) legacyCorrections.add(m.docID);
        for (const [tag, expected] of [
          ["EDINETCodeDEI", row.edinetCode],
          ["SecurityCodeDEI", m.secCode],
        ]) {
          const values = document.dei.get(tag) ?? [];
          assert(
            values.length && values.every((v) => v === expected),
            "Issuer/security code DEI differs",
          );
        }
        for (const [metric, s] of Object.entries(row.snapshot.selections).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ) as [string, Json][]) {
          const key = JSON.stringify([id, metric]),
            value = sqlValues.get(key);
          assert(value, "SQL value absent");
          sqlValues.delete(key);
          verifySqlValue(value, s);
          if (s.status !== "selected") continue;
          assert(s.source.raw === s.raw, "Selection/source raw differs");
          const positive = s.evidence.filter((e: Json) =>
            ["selected", "selected-raw-only"].includes(e.reason),
          );
          assert(
            positive.length && positive.some((e: Json) => canonical(e) === canonical(s.source)),
            "Selected evidence absent",
          );
          for (const e of positive) {
            assert(e.raw === s.raw, "Competing raw differs");
            checkedFacts += verifyEvidence(document, e, m);
          }
          documents.add(m.docID);
          checks.push([id, metric, sourceHash, s.raw, s.source, positive]);
        }
      }
    }
    assert(checks.length && !sqlValues.size, "Selected values absent or unexpected SQL values");
    assert((await fileDigest(archivePath)) === expectedArchiveHash, "Archive changed");
    checks.sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
    );
    return {
      version: 1,
      method: "node-saxes-direct-facts-lineage-dei-v1",
      generation,
      rows: totalRows,
      selectedValues: checks.length,
      documents: documents.size,
      checkedFacts,
      lineageRowsChecked: totalRows,
      currentStandaloneIfrsRowsChecked: standaloneRows,
      explicitTargetDocumentsChecked: explicitTargets.size,
      legacyCorrectionDocumentsWithoutTarget: legacyCorrections.size,
      valuesSha256: digest(canonical(checks)),
    };
  } finally {
    archive.close();
    index.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    assert(process.argv.length === 7, "Explicit verifier arguments required");
    console.log(
      canonical(
        await verifySourceValues(
          ...(process.argv.slice(2) as [string, string, string, string, string]),
        ),
      ),
    );
  } catch {
    console.error("Independent financial source verification failed");
    process.exitCode = 1;
  }
}
