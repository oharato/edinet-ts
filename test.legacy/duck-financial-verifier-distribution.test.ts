import { expect, it } from "vitest";
import { existsSync } from "node:fs";
import { financialSourceVerifierSha256 } from "../src/pipeline/verification/source-verifier-command";
import { recordDuckFinancialValueVerification as sdk } from "../src/pipeline/verification/verify-duck-financial-publication";
import { recordDuckFinancialValueVerification as legacy } from "../scripts/roadmap/duck-financial-value-verification";
it("SDKと既存入口は同じ照合gateを使い、Nodeの照合コード一式を同梱する", () => {
  expect(sdk).toBe(legacy);
  expect(financialSourceVerifierSha256()).toMatch(/^[a-f0-9]{64}$/);
  expect(existsSync(new URL("../dist/assets/verify-financial-values.py", import.meta.url))).toBe(
    false,
  );
});
