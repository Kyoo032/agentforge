/**
 * The renderer's reading of a plan refusal.
 *
 * Two things have to be true and neither is obvious from the code alone.
 *
 * **A `plan_*` 403 is not a `gateway_blocked` 403.** They are the same flat shape on purpose
 * (`packages/host/src/entitlement-store.ts:418`), and the existing parser
 * (`gateway-gate.ts:145`) answers `gateway_blocked` with a typed block and everything else with
 * `null`. Read by the wrong parser, a past-due tenant is sent to the paste-your-key onboarding
 * screen — the exact dead end `web-phase5-plans-billing-decisions.md` §3(b) forbids, because a
 * hosted tenant holds no gateway key and cannot leave that screen. So this parser must answer
 * `null` for `gateway_blocked`, and the gateway parser must answer `null` for a plan code.
 *
 * **An envelope is not a code.** Most of the API answers `{ error: { code, message } }`; only the
 * two blocked shapes are flat. `{ error: { code: "plan_past_due" } }` reaching this parser would
 * mean some other route had grown a nested plan code, and treating it as a block would put a
 * paywall in front of whatever that route was really saying.
 */
import { describe, expect, it, vi } from "vitest";
import { ENTITLEMENT_BLOCKS } from "@agentforge/core";
import { parseGatewayBlocked } from "./gateway-gate";
import {
  PLAN_BLOCK_CODES,
  PLAN_BLOCK_EVENT,
  announcePlanBlocked,
  isPlanBlockCode,
  parsePlanBlocked,
  readPlanBlockEvent,
  reportPlanBlocked,
} from "./plan-block";

describe("PLAN_BLOCK_CODES", () => {
  it("is the host's block list plus the 503 that is not a paywall", () => {
    // A relation between two tables, not a restatement of one: every code the host can refuse a
    // gateway call with must have a screen, and `plan_unavailable` is the ApiError
    // `requireEntitlementAllowed` throws when the plan cannot be read at all.
    expect([...PLAN_BLOCK_CODES].sort()).toEqual([...ENTITLEMENT_BLOCKS, "plan_unavailable"].sort());
  });

  it("recognises its own codes and nothing else", () => {
    expect(isPlanBlockCode("plan_cancelled")).toBe(true);
    expect(isPlanBlockCode("gateway_blocked")).toBe(false);
    expect(isPlanBlockCode("plan_")).toBe(false);
    expect(isPlanBlockCode(undefined)).toBe(false);
  });
});

describe("parsePlanBlocked", () => {
  it("reads every flat plan refusal the host can send", () => {
    for (const code of PLAN_BLOCK_CODES) {
      expect(parsePlanBlocked({ error: code, message: "whatever the host said" })).toBe(code);
    }
  });

  it("answers null for a gateway block, which belongs to the other parser", () => {
    const body = { error: "gateway_blocked", status: "needs_key", message: "no key" };
    expect(parsePlanBlocked(body)).toBeNull();
    // ...and the other parser still owns it, so nothing has been taken away from it.
    expect(parseGatewayBlocked(body)).toEqual({ status: "needs_key", message: "no key" });
  });

  it("answers null for an enveloped error, even one carrying a plan code", () => {
    expect(parsePlanBlocked({ error: { code: "plan_past_due", message: "overdue" } })).toBeNull();
    expect(parsePlanBlocked({ error: { message: "plan_past_due" } })).toBeNull();
    expect(parsePlanBlocked({ error: {} })).toBeNull();
  });

  it("answers null for anything that is not a refusal body at all", () => {
    for (const body of [null, undefined, "plan_past_due", 7, [], { error: "runtime_stub" }, { ok: true }]) {
      expect(parsePlanBlocked(body), String(body)).toBeNull();
    }
  });

  it("does not read a plan code out of a gateway block's own parser", () => {
    expect(parseGatewayBlocked({ error: "plan_cancelled" })).toBeNull();
  });
});

describe("the event seam", () => {
  it("does nothing at all where there is no window", () => {
    // The desktop IPC transport and every node-side render reach this file too.
    expect(() => announcePlanBlocked("plan_past_due")).not.toThrow();
  });

  it("carries a parsed code from whoever read the body to whoever renders the screen", () => {
    const window = new EventTarget();
    vi.stubGlobal("window", window);
    try {
      const seen: Array<string | null> = [];
      window.addEventListener(PLAN_BLOCK_EVENT, (event) => seen.push(readPlanBlockEvent(event)));

      expect(reportPlanBlocked({ error: "plan_cancelled" })).toBe("plan_cancelled");
      // A body that is not a plan refusal announces nothing: a `gateway_blocked` answer must not
      // put a paywall on screen, and neither must an ordinary 500.
      expect(reportPlanBlocked({ error: "gateway_blocked" })).toBeNull();
      expect(reportPlanBlocked({ error: { code: "not_found" } })).toBeNull();
      announcePlanBlocked(null);

      expect(seen).toEqual(["plan_cancelled", null]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reads nothing out of an event that carries something else", () => {
    expect(readPlanBlockEvent(new CustomEvent(PLAN_BLOCK_EVENT, { detail: "gateway_blocked" }))).toBeNull();
    expect(readPlanBlockEvent(new Event(PLAN_BLOCK_EVENT))).toBeNull();
  });
});
