/** 保存HTMLからXML Unicodeの差分日付・全国全件ZIPを厳密に選ぶ。CSVや都道府県版を混ぜない。 */
import { Parser } from "htmlparser2";
import { strict as assert } from "node:assert";
const compact = (text: string) => text.replace(/\s/g, "");
export function registryDate(value: string) {
  assert(
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number(value.slice(0, 4)) > 0 &&
      Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
      new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value,
    "Invalid registry date",
  );
  return value;
}
function reiwa(year: string, month: string, day: string) {
  return registryDate(
    String(2018 + (year === "元" ? 1 : Number(year))).padStart(4, "0") +
      "-" +
      month.padStart(2, "0") +
      "-" +
      day.padStart(2, "0"),
  );
}
const linkId = (onclick: string | undefined) =>
  /^\s*return\s+doDownload\((\d+)\);?\s*$/.exec(onclick ?? "")?.[1];
export function parseRegistryListing(
  html: string,
  date: string,
  kind: "diff",
): { fields: Record<string, string>; selected: { dataDate: string; fileId: string } };
export function parseRegistryListing(
  html: string,
  date: string,
  kind: "full",
): {
  fields: Record<string, string>;
  selected: {
    dataDate: string;
    scope: string;
    format: string;
    zips: { fileId: string; label: string }[];
  };
};
export function parseRegistryListing(html: string, date: string, kind: "diff" | "full") {
  assert(Buffer.byteLength(html) <= 2 * 1024 ** 2, "Oversized registry listing");
  registryDate(date);
  let forms = 0,
    form = false,
    section = "",
    sections = 0,
    row: { text: string; ids: string[] } | undefined,
    group: { name: string; links: { fileId: string; label: string }[] } | undefined,
    inName = false,
    link: { fileId: string; label: string } | undefined;
  const fields: Record<string, string> = Object.create(null),
    dates: { dataDate: string; fileId: string }[] = [],
    national: { fileId: string; label: string }[][] = [],
    text: string[] = [];
  const parser = new Parser(
    {
      onopentag(tag, a) {
        if (tag === "form" && a.id === "appForm") {
          forms++;
          form = true;
          assert(
            a.action === `/download/${kind === "diff" ? "sabun" : "zenken"}/index.html` &&
              a.method?.toLowerCase() === "post",
            "Changed registry form",
          );
        }
        if (form && tag === "input" && a.type === "hidden" && a.name !== undefined) {
          assert(!Object.hasOwn(fields, a.name), "Duplicate form input");
          fields[a.name] = a.value ?? "";
        }
        if (tag === "h2") {
          section = a.id ?? "";
          if (section === "xml-unicode") sections++;
        }
        if (kind === "diff") {
          if (
            tag === "tr" &&
            section === "xml-unicode" &&
            /^type2_corpHistory\d+$/.test(a.class ?? "")
          ) {
            assert(!row, "Nested XML row");
            row = { text: "", ids: [] };
          }
          if (tag === "a" && row) {
            const id = linkId(a.onclick);
            if (id) row.ids.push(id);
          }
        } else if (section === "xml-unicode") {
          if (tag === "dl") {
            assert(!group, "Nested download group");
            group = { name: "", links: [] };
          }
          if (tag === "dt" && group) inName = true;
          if (tag === "a" && group) {
            const id = linkId(a.onclick);
            if (id) link = { fileId: id, label: "" };
          }
        }
      },
      ontext(value) {
        if (row) row.text += value;
        if (section === "xml-unicode") text.push(value);
        if (inName && group) group.name += value;
        if (link) link.label += value;
      },
      onclosetag(tag) {
        if (tag === "form") form = false;
        if (kind === "diff" && tag === "tr" && row) {
          const match = /令和(元|[0-9]+)年([0-9]+)月([0-9]+)日/.exec(compact(row.text));
          assert(match && row.ids.length === 1, "Invalid XML date row");
          dates.push({ dataDate: reiwa(match[1], match[2], match[3]), fileId: row.ids[0] });
          row = undefined;
        }
        if (kind === "full") {
          if (tag === "dt") inName = false;
          if (tag === "a" && link) {
            assert(group, "Link outside group");
            group.links.push(link);
            link = undefined;
          }
          if (tag === "dl" && group) {
            if (compact(group.name) === "全国") national.push(group.links);
            group = undefined;
          }
        }
      },
    },
    { decodeEntities: true },
  );
  parser.end(html);
  assert(
    forms === 1 && fields.event === "download" && Object.hasOwn(fields, "selDlFileNo"),
    "Unsupported download form",
  );
  if (kind === "diff") {
    const matches = dates.filter((entry) => entry.dataDate === date);
    assert(!row && matches.length === 1, "Date absent or ambiguous");
    return { fields, selected: matches[0] };
  }
  const matches = [
    ...compact(text.join("")).matchAll(/令和(元|[0-9]+)年([0-9]+)月([0-9]+)日更新/g),
  ];
  assert(
    sections === 1 &&
      !group &&
      matches.length === 1 &&
      national.length === 1 &&
      reiwa(matches[0][1], matches[0][2], matches[0][3]) === date,
    "Ambiguous national XML listing or wrong date",
  );
  const links = national[0];
  assert(
    links.length >= 1 &&
      links.length <= 100 &&
      new Set(links.map((v) => v.fileId)).size === links.length,
    "Invalid national split count",
  );
  const zips = links.map((value, i) => {
    const label = compact(value.label),
      match = /^(?:分割([0-9]+))?zip([0-9]+)(KB|MB|GB)$/.exec(label);
    assert(
      match &&
        (links.length > 1
          ? match[1] === String(i + 1)
          : match[1] === undefined || match[1] === "1"),
      "Missing national split sequence",
    );
    return { fileId: value.fileId, label };
  });
  return { fields, selected: { dataDate: date, scope: "national", format: "XML-Unicode", zips } };
}
