/**
 * C1 disclaimer: stamped by code into every market payload, never by a model.
 *
 * `withDisclaimer` is the single path that stamps it. It runs `assertNoAdvice`
 * on the payload first, so nothing can be stamped without being scanned, and
 * returns a new object.
 */
import { assertNoAdvice } from "./advice-guard";

export const MARKET_DISCLAIMER_ID =
  "Informasi ini adalah rangkuman data dari sumber pihak ketiga, bukan rekomendasi atau saran investasi. Keputusan investasi sepenuhnya tanggung jawab pengguna.";

export const MARKET_DISCLAIMER_EN =
  "This information is a summary of data from third-party sources, not a recommendation or investment advice. Investment decisions are entirely the user's responsibility.";

export const MARKET_DISCLAIMER = `${MARKET_DISCLAIMER_ID} ${MARKET_DISCLAIMER_EN}`;

/** Scan `value` for advice (throws AdviceLeakError), then return a stamped copy. */
export function withDisclaimer<T extends { disclaimer: string }>(value: T): T {
  assertNoAdvice(value);
  return { ...value, disclaimer: MARKET_DISCLAIMER };
}
