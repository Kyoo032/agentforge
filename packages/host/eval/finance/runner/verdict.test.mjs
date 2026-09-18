import { describe, expect, it } from "vitest";
import {
  CASE_STATUS,
  classifyFailure,
  isRetryable,
  statusForFailure,
  verdictForScoredCase,
  verdictForStoppedCase,
} from "./verdict.mjs";

describe("classifyFailure", () => {
  it("calls a host that says there is no runtime BLOCKED, not transient", () => {
    expect(classifyFailure({ code: "runtime_stub", status: 400, message: "no key" })).toBe("no_runtime");
    expect(statusForFailure("no_runtime")).toBe(CASE_STATUS.blocked);
  });

  it("calls a task that ships later SKIPPED", () => {
    expect(classifyFailure({ code: "finance_task_unavailable", status: 400, message: "not built yet" })).toBe(
      "unavailable",
    );
  });

  it("calls a 5xx from the model call transient", () => {
    const error = { code: "internal_error", status: 500, message: "Gateway unreachable: no response within 10s" };
    expect(classifyFailure(error)).toBe("transient");
    expect(statusForFailure("transient")).toBe(CASE_STATUS.transient);
    expect(isRetryable("transient")).toBe(true);
  });

  it("calls a gateway that gave up after three tries transient", () => {
    const error = {
      code: "internal_error",
      status: 502,
      message: "Could not reach model after 3 tries (status_code=503)",
    };
    expect(classifyFailure(error)).toBe("transient");
  });

  it("calls a socket that never answered transient", () => {
    expect(classifyFailure({ code: "transport_failed", status: 0, message: "fetch failed" })).toBe("transient");
  });

  it("calls a rate limit transient", () => {
    expect(classifyFailure({ code: "rate_limited", status: 429, message: "slow down" })).toBe("transient");
  });

  it("does not promote a 400 that merely mentions a timeout", () => {
    expect(classifyFailure({ code: "invalid_request", status: 400, message: "timeout must be a number" })).toBe(
      "harness",
    );
  });

  it("calls the app's own refusal to produce a report a product failure", () => {
    expect(classifyFailure({ code: "invalid_finance", status: 422, message: "no rows" })).toBe("product_failure");
    expect(statusForFailure("product_failure")).toBe(CASE_STATUS.fail);
  });

  it("calls an input type the import route refuses its own status", () => {
    expect(statusForFailure(classifyFailure({ code: "unsupported_content_type", status: 400, message: "pdf" }))).toBe(
      CASE_STATUS.unsupportedInput,
    );
  });
});

describe("verdictForStoppedCase", () => {
  it("keeps the gateway's own words verbatim and carries no scores", () => {
    const message =
      "Could not reach deepseek-v4-flash after 3 tries. The gateway is unavailable right now (status_code=503).";
    const verdict = verdictForStoppedCase("generate", {
      code: "internal_error",
      status: 500,
      message,
      stage: "generate",
    });
    expect(verdict.status).toBe(CASE_STATUS.transient);
    expect(verdict.stoppedAt).toBe("generate");
    expect(verdict.error.message).toBe(message);
    expect(verdict.retryable).toBe(true);
    expect(verdict.reasons).toEqual([]);
    expect(verdict).not.toHaveProperty("scores");
  });

  it("marks a no-runtime stop as not worth retrying", () => {
    const verdict = verdictForStoppedCase("parse", { code: "gateway_blocked", status: 403, message: "gate closed" });
    expect(verdict.status).toBe(CASE_STATUS.blocked);
    expect(verdict.retryable).toBe(false);
  });
});

describe("verdictForScoredCase", () => {
  it("passes only when the pass rule found nothing", () => {
    expect(verdictForScoredCase({ pass: true, reasons: [] }).status).toBe(CASE_STATUS.pass);
  });

  it("fails and keeps every reason", () => {
    const verdict = verdictForScoredCase({ pass: false, reasons: ["extraction F1 0.500 < 0.9"] });
    expect(verdict.status).toBe(CASE_STATUS.fail);
    expect(verdict.reasons).toHaveLength(1);
  });
});
