/** SDKの選択処理に依存しない、版証拠のfingerprintと日時の検査。 */
import { createHash } from "node:crypto";
import { strict as assert } from "node:assert";
export const POLICY = "whole-attached-asr-q2r-v1",
  METHOD = "node-raw-zip-xml-official-financial-version-evidence-v1";
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v) => {
    assert(
      v !== undefined && (typeof v !== "number" || Number.isFinite(v)),
      "Undefined or nonfinite evidence value",
    );
    return v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v;
  });
export const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const digest = (value: unknown) => sha(canonical(value));
export const equal = (a: unknown, b: unknown, message: string) =>
  assert(canonical(a) === canonical(b), message);
export const pick = (value: Record<string, any>, keys: string[]) =>
  Object.fromEntries(
    keys.map((key) => {
      assert(Object.hasOwn(value, key), "Missing evidence field: " + key);
      return [key, value[key]];
    }),
  );
export const omit = (value: Record<string, any>, key: string) =>
  Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));
export function timestamp(value: string, official = false) {
  assert(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(
        value,
      ),
    "Timestamp type",
  );
  day(value.slice(0, 10));
  const h = Number(value.slice(11, 13)),
    m = Number(value.slice(14, 16)),
    seconds = value[16] === ":" ? Number(value.slice(17, 19)) : 0;
  assert(h < 24 && m < 60 && seconds < 60, "Invalid timestamp time");
  let normalized = value.replace(" ", "T");
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(normalized)) {
    assert(official, "Timezone required");
    normalized += "+09:00";
  }
  const parsed = Date.parse(normalized);
  assert(Number.isFinite(parsed), "Invalid timestamp");
  return parsed;
}
export function day(value: string) {
  assert(
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) > 0,
    "Invalid date",
  );
  const parsed = Date.parse(value + "T00:00:00Z");
  assert(
    Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value,
    "Invalid date",
  );
  return parsed;
}
export function keyed(items: any[], key: string): Record<string, any> {
  assert(Array.isArray(items), "Expected evidence array");
  const result: Record<string, any> = Object.create(null);
  for (const item of items) {
    assert(
      item &&
        Object.hasOwn(item, key) &&
        typeof item[key] === "string" &&
        !Object.hasOwn(result, item[key]),
      "Duplicate or missing evidence key",
    );
    result[item[key]] = item;
  }
  return result;
}
export const equalSets = (a: Iterable<unknown>, b: Iterable<unknown>, message: string) =>
  equal([...new Set(a)].sort(), [...new Set(b)].sort(), message);
