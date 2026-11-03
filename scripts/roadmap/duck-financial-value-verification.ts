/** Compatibility entry for repository workflows; the implementation and verifier are delivered by the SDK. */
export {
  recordDuckFinancialValueVerification,
  validateDuckFinancialValueVerification,
  activateVerifiedDuckFinancialPublication,
} from "../../src/pipeline/verification/verify-duck-financial-publication";
export type { DuckFinancialVerificationInput } from "../../src/pipeline/verification/verify-duck-financial-publication";
