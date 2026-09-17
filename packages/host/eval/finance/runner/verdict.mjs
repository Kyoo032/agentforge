/**
 * What a case's outcome is called, and when.
 *
 * The rule this module exists to enforce: a score is only ever printed beside a
 * case that actually ran. Before it, a case whose parse fell over could still be
 * handed the truth rows as a stand-in and be scored 1.000 against them — the
 * harness marking its own homework — and then be labelled BLOCKED, which reads as
 * "we could not measure this" while carrying a perfect number. Both halves were
 * wrong. So:
 *
 * - BLOCKED_NO_RUNTIME means the stage could not run AT ALL because the app says
 *   there is no model behind it. No scores are produced, and none are printed.
 * - ERROR_TRANSIENT means the gateway was reachable in principle and gave up on
 *   this attempt — a 5xx, a timeout, a 429. The raw message is kept verbatim.
 *   The run may retry that one case once, but only when asked with
 *   `--retry-transient`, and the summary says a retry happened.
 * - FAIL means the app answered and the answer was not good enough.
 *
 * Pure: no network, no clock, no filesystem.
 */

export const CASE_STATUS = {
  pass: "PASS",
  fail: "FAIL",
  skipped: "SKIPPED_UNAVAILABLE",
  blocked: "BLOCKED_NO_RUNTIME",
  unsupportedInput: "BLOCKED_UNSUPPORTED_INPUT",
  transient: "ERROR_TRANSIENT",
  error: "ERROR",
};

/** Statuses that carry scores. Everything else prints `-` in every score column. */
export const SCORED_STATUSES = new Set([CASE_STATUS.pass, CASE_STATUS.fail]);

/** The host codes that mean "this task is not built yet", not "the harness is broken". */
export const UNAVAILABLE_CODES = new Set(["finance_task_unavailable"]);
/** The host codes that mean there is no live model behind the app at all. */
export const NO_RUNTIME_CODES = new Set(["runtime_stub", "gateway_required", "gateway_blocked"]);
/** The app refuses this file type on the finance import route — a product gap, not a harness bug. */
export const UNSUPPORTED_INPUT_CODES = new Set(["unsupported_content_type"]);
/** The app ran and could not produce a usable report: a failed case, not a broken harness. */
export const PRODUCT_FAILURE_CODES = new Set(["invalid_finance", "generation_failed"]);
/** Codes that are always the gateway giving up on this attempt rather than refusing the request. */
export const TRANSIENT_CODES = new Set(["transport_failed", "stream_incomplete", "bad_gateway", "job_failed"]);

/**
 * Phrases a gateway failure states in its own words. Matched on the message only
 * after the code and the status have both been consulted, so a 400 that happens to
 * contain the word "timeout" is never promoted to a transient.
 */
const TRANSIENT_MESSAGE =
  /(gateway (?:is )?(?:unreachable|unavailable)|no response within|status_code=(?:429|5\d\d)|after \d+ tries|timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|fetch failed)/i;

/** The kinds a failed stage can be, in the order they are decided. */
export const FAILURE_KINDS = [
  "no_runtime",
  "unavailable",
  "unsupported_input",
  "transient",
  "product_failure",
  "harness",
];

function statusOf(error) {
  return Number.isFinite(error?.status) ? error.status : 0;
}

/**
 * What kind of failure this is. `error` is the plain `{code, status, message}`
 * shape the client produces, so this can be asked of a trace that was read back
 * off disk as easily as of a live throw.
 */
export function classifyFailure(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = typeof error?.message === "string" ? error.message : "";
  const status = statusOf(error);
  if (NO_RUNTIME_CODES.has(code)) {
    return "no_runtime";
  }
  if (UNAVAILABLE_CODES.has(code)) {
    return "unavailable";
  }
  if (UNSUPPORTED_INPUT_CODES.has(code)) {
    return "unsupported_input";
  }
  if (TRANSIENT_CODES.has(code) || status >= 500 || status === 429) {
    return "transient";
  }
  // A 4xx with a gateway's own words in it: the host passed the gateway's failure
  // through without re-badging its status. `internal_error` at 0 lands here too.
  if (status !== 0 && status < 500 && TRANSIENT_MESSAGE.test(message) && code !== "invalid_request") {
    return "transient";
  }
  if (PRODUCT_FAILURE_CODES.has(code)) {
    return "product_failure";
  }
  return "harness";
}

/** The status a case ends with when one of its stages could not run. */
export function statusForFailure(kind) {
  switch (kind) {
    case "no_runtime":
      return CASE_STATUS.blocked;
    case "unavailable":
      return CASE_STATUS.skipped;
    case "unsupported_input":
      return CASE_STATUS.unsupportedInput;
    case "transient":
      return CASE_STATUS.transient;
    case "product_failure":
      return CASE_STATUS.fail;
    default:
      return CASE_STATUS.error;
  }
}

/** True when running this one case again could plausibly answer differently. */
export function isRetryable(kind) {
  return kind === "transient";
}

/**
 * The verdict line for a case that ran to the end.
 *
 * `gates` is the pass rule's answer (`{ pass, reasons }`); everything else here is
 * about saying so consistently.
 */
export function verdictForScoredCase(gates) {
  return {
    status: gates.pass ? CASE_STATUS.pass : CASE_STATUS.fail,
    reasons: gates.reasons ?? [],
  };
}

/**
 * The verdict for a case that stopped at a stage. It carries the stage, the kind,
 * and the app's own words — never a score, because nothing was measured.
 */
export function verdictForStoppedCase(stage, error) {
  const kind = classifyFailure(error);
  return {
    status: statusForFailure(kind),
    stoppedAt: stage,
    failureKind: kind,
    /** Verbatim. A gateway message is evidence and is never paraphrased. */
    error: {
      code: error?.code ?? "harness_error",
      status: statusOf(error),
      stage: error?.stage ?? stage,
      message: error?.message ?? String(error ?? "unknown failure"),
    },
    retryable: isRetryable(kind),
    reasons: [],
  };
}
