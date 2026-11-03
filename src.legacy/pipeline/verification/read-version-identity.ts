/** XMLに記録された提出回数・訂正フラグ・報告対象を、本体のDEI処理を使わず読む。 */
import { strict as assert } from "node:assert";
import { readVersionXml, type VersionXmlNode } from "./read-version-input";
import { expanded, XBRL, NIL } from "./read-source-xbrl";
import { day } from "./version-evidence-format";
export const direct = (node: VersionXmlNode, uri: string, local: string) =>
  node.children.filter((n) => n.tag === expanded(uri, local));
export function sourceVersionIdentity(raw: Uint8Array) {
  const root = readVersionXml(raw),
    fields = new Map<string, VersionXmlNode[]>(),
    contextIds = new Set<string>(),
    namespaces = new Set<string>();
  for (const fact of root.children) {
    const local = fact.tag.slice(fact.tag.lastIndexOf("}") + 1);
    if (local.endsWith("DEI")) fields.set(local, [...(fields.get(local) ?? []), fact]);
  }
  const one = (name: string, empty = false) => {
    const facts = fields.get(name) ?? [];
    assert(facts.length === 1, "DEI cardinality: " + name);
    const f = facts[0],
      a = f.attributes,
      ordinal = name === "NumberOfSubmissionDEI",
      nil = ["true", "1"].includes(a[NIL]);
    assert(
      new RegExp(
        "^\\{http://disclosure\\.edinet-fsa\\.go\\.jp/taxonomy/jpdei/\\d{4}-\\d{2}-\\d{2}/jpdei_cor\\}" +
          name +
          "$",
      ).test(f.tag) &&
        !f.children.length &&
        (!nil || (empty && !f.text.trim())) &&
        (ordinal ? !!a.unitRef : !a.unitRef) &&
        a.contextRef,
      "DEI primitive/basis",
    );
    if (ordinal) {
      const units = direct(root, XBRL, "unit").filter((u) => u.attributes.id === a.unitRef);
      assert(
        units.length === 1 &&
          units[0].children.length === 1 &&
          units[0].children[0].tag === expanded(XBRL, "measure"),
        "Ordinal pure unit",
      );
      const node = units[0].children[0],
        measure = node.text,
        index = measure.indexOf(":"),
        prefix = index < 0 ? "" : measure.slice(0, index),
        local = index < 0 ? measure : measure.slice(index + 1);
      assert(
        local === "pure" && node.namespaces.get(prefix) === XBRL && a.decimals === "0",
        "Ordinal pure unit/precision",
      );
    }
    contextIds.add(a.contextRef);
    namespaces.add(f.tag.slice(0, f.tag.lastIndexOf("}")));
    assert(empty || f.text.trim(), "Empty DEI");
    return f.text;
  };
  const names = {
    issuer: "EDINETCodeDEI",
    security: "SecurityCodeDEI",
    form: "DocumentTypeDEI",
    currentPeriod: "CurrentPeriodEndDateDEI",
    fiscalStart: "CurrentFiscalYearStartDateDEI",
    fiscalEnd: "CurrentFiscalYearEndDateDEI",
    periodCode: "TypeOfCurrentPeriodDEI",
  };
  const identity = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, one(name)]));
  assert(
    one("AccountingStandardsDEI") === "Japan GAAP" &&
      ["true", "1"].includes(one("WhetherConsolidatedFinancialStatementsArePreparedDEI")),
    "Unsupported reporting basis",
  );
  Object.assign(identity, { standard: "J-GAAP", scope: "Consolidated" });
  const number = one("NumberOfSubmissionDEI");
  assert(
    /^[1-9][0-9]*$/.test(number) && Number.isSafeInteger(Number(number)),
    "Submission ordinal",
  );
  const flags = ["AmendmentFlagDEI", "ReportAmendmentFlagDEI", "XBRLAmendmentFlagDEI"].map((name) =>
    one(name),
  );
  const target = fields.has("IdentificationOfDocumentSubjectToAmendmentDEI")
    ? one("IdentificationOfDocumentSubjectToAmendmentDEI", true)
    : "";
  assert(contextIds.size === 1 && namespaces.size === 1, "Mixed DEI contexts/namespaces");
  const contexts = direct(root, XBRL, "context");
  assert(
    new Set(contexts.map((c) => c.attributes.id)).size === contexts.length,
    "Duplicate context ID",
  );
  const matches = contexts.filter((c) => contextIds.has(c.attributes.id));
  assert(matches.length === 1, "DEI context cardinality");
  const context = matches[0],
    entity = direct(context, XBRL, "entity").flatMap((e) => direct(e, XBRL, "identifier")),
    period = direct(context, XBRL, "period"),
    instants = period.flatMap((p) => direct(p, XBRL, "instant"));
  assert(
    entity.length === 1 &&
      instants.length === 1 &&
      entity[0].text === identity.issuer + "-000" &&
      entity[0].attributes.scheme === "http://disclosure.edinet-fsa.go.jp" &&
      !direct(context, XBRL, "scenario").length &&
      !direct(context, XBRL, "entity").some((e) => direct(e, XBRL, "segment").length) &&
      period[0].children.length === 1,
    "DEI filing context",
  );
  const filing = day(instants[0].text),
    start = day(identity.fiscalStart),
    end = day(identity.fiscalEnd),
    current = day(identity.currentPeriod);
  assert(
    start <= current &&
      current <= end &&
      current <= filing &&
      ["FY", "HY", "Q2"].includes(identity.periodCode),
    "Current period",
  );
  assert(
    identity.form === (identity.periodCode === "FY" ? "第三号様式" : "第四号の三様式") &&
      (identity.periodCode === "FY" ? current === end : current < end),
    "Form/period",
  );
  return { identity, ordinal: Number(number), flags, target };
}
