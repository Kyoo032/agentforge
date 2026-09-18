/**
 * The finance helpers this harness scores with already exist in TypeScript
 * (`packages/core/src/finance/**`). Node 22+ strips the types on its own, but the
 * package's relative imports carry no extension, so plain `node run.mjs` cannot
 * resolve them. A resolve hook adds the `.ts` Node will not guess.
 *
 * The hook has to be registered before the specifier is resolved, and ESM hoists
 * every static import above the module body — hence the dynamic import and the
 * re-export below. Under vitest the hook never fires: vite resolves the same
 * specifiers itself and `next()` succeeds on the first try.
 */
import { registerHooks } from "node:module";

/** Tried in order when a relative specifier fails to resolve as written. */
const TS_SUFFIXES = [".ts", "/index.ts", ".mts"];

function registerTypescriptResolve() {
  if (typeof registerHooks !== "function") {
    // Older Node: the caller is running under a bundler that resolves TS itself.
    return;
  }
  registerHooks({
    resolve(specifier, context, next) {
      try {
        return next(specifier, context);
      } catch (error) {
        if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
          throw error;
        }
        for (const suffix of TS_SUFFIXES) {
          try {
            return next(specifier + suffix, context);
          } catch {
            // Not this extension; the original error is rethrown once all are tried.
          }
        }
        throw error;
      }
    },
  });
}

registerTypescriptResolve();

const finance = await import("@agentforge/core/finance");
const pii = await import("@agentforge/core/pii");

export const {
  GUARD_ABSOLUTE_TOLERANCE,
  GUARD_RELATIVE_TOLERANCE,
  UNVERIFIED_MARKER,
  computeFinance,
  expandMagnitudes,
  extractNumbers,
  financeReportFromBrief,
  isFreeNumber,
  matchesAllowed,
  normalizeAmount,
  readFinanceTable,
  tableToFiguresText,
} = finance;

export const { scanPii } = pii;
