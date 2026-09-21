import { useEffect, useState } from "react";
import type { EntitlementBlock } from "@agentforge/core";

/**
 * Phase 9 lane G — the renderer's reading of a refusal that is about the **plan**, not the key.
 *
 * The host answers a blocked tenant with a flat `403 { error: "plan_*", message }`
 * (`packages/host/src/entitlement-store.ts:418-427`), deliberately the same shape as
 * `gateway_blocked` and deliberately a different code: `gateway_blocked` routes the renderer to
 * the paste-your-key onboarding screen, whose only exits are a key, a re-check or deleting a file
 * on the server's disk — none of which a hosted tenant has
 * (`docs/internal/web-phase5-plans-billing-decisions.md` §3(b)). So the one thing this module must
 * never do is confuse the two, in either direction. `parsePlanBlocked` answers `null` for a
 * gateway block, `parseGatewayBlocked` answers `null` for a plan code, and
 * `plan-block.test.ts` drives both halves.
 *
 * `plan_unavailable` is in the same list and is **not** a paywall: it is the 503 the host throws
 * when the plan cannot be read at all (`entitlement-store.ts:470`). It shares the list because it
 * shares the screen, and its screen offers a retry rather than a price.
 *
 * **The seam is a window event, not an interceptor.** There is no central place in this renderer
 * where a 403 body is inspected today — `parseGatewayBlocked` has exactly two call sites, both of
 * them the answer to one POST. Rather than grow an interceptor inside `apiFetch` (a file this lane
 * does not own) or a branch inside `App.tsx` (a file another lane owns), whoever reads a refusal
 * body calls `reportPlanBlocked(body)` and `PlanBlockBoundary` renders the screen. It mirrors
 * `GATE_EVENT` in `gateway-gate.ts`, which is the same problem solved the same way.
 */

/**
 * Every code that gets a full-screen state, in the order they are handled.
 *
 * The first three are `ENTITLEMENT_BLOCKS` in `packages/core/src/entitlement/types.ts:54`. They are
 * spelled out here rather than imported as values because that constant lives behind the
 * `@agentforge/core` root barrel, which no browser component in this app imports for a value — the
 * barrel re-exports the whole of core, and a dev-mode browser would fetch all of it to read three
 * strings. `plan-block.test.ts` runs in node, imports the real constant, and asserts this list is
 * exactly it plus `plan_unavailable`, so the two cannot drift.
 */
export const PLAN_BLOCK_CODES = [
  "plan_past_due",
  "plan_cancelled",
  "plan_allowance_exhausted",
  "plan_unavailable",
] as const;

export type PlanBlockCode = (typeof PLAN_BLOCK_CODES)[number];

/** Compile-time half of the same promise: every host block code is a code this module renders. */
const _everyHostBlockHasAScreen: Record<EntitlementBlock, PlanBlockCode> = {
  plan_past_due: "plan_past_due",
  plan_cancelled: "plan_cancelled",
  plan_allowance_exhausted: "plan_allowance_exhausted",
};
void _everyHostBlockHasAScreen;

export function isPlanBlockCode(value: unknown): value is PlanBlockCode {
  return typeof value === "string" && (PLAN_BLOCK_CODES as readonly string[]).includes(value);
}

/**
 * A 403 (or 503) body → the plan code it carries, or `null` for every other answer.
 *
 * `record.error` has to be the code itself. The enveloped `{ error: { code, message } }` shape that
 * the rest of the API uses answers `null` on purpose: only the two blocked errors are flat, so a
 * nested plan code means some other route grew one, and putting a paywall in front of that route's
 * real answer would be worse than showing it.
 */
export function parsePlanBlocked(body: unknown): PlanBlockCode | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const code = (body as Record<string, unknown>).error;
  return isPlanBlockCode(code) ? code : null;
}

/** Window event the renderer uses to push a plan refusal at whatever is rendering the app. */
export const PLAN_BLOCK_EVENT = "agentforge-plan-block";

/** Announce a plan refusal, or `null` to clear one. No-op outside a browser. */
export function announcePlanBlocked(code: PlanBlockCode | null): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent<PlanBlockCode | null>(PLAN_BLOCK_EVENT, { detail: code }));
}

/**
 * Read a refusal body, announce it when it is one, and hand the code back to the caller.
 *
 * The one call every consumer needs: a handler that has just read a JSON body passes it here and
 * carries on. A body that is not a plan refusal announces nothing and returns `null`, so this is
 * safe to call on any response without first deciding what it is.
 */
export function reportPlanBlocked(body: unknown): PlanBlockCode | null {
  const code = parsePlanBlocked(body);
  if (code) {
    announcePlanBlocked(code);
  }
  return code;
}

/**
 * The two statuses a plan refusal can arrive with: `403` for a block, `503` for `plan_unavailable`
 * (`packages/host/src/entitlement-store.ts`). Any other status does no work at all.
 */
const PLAN_REFUSAL_STATUSES: ReadonlySet<number> = new Set([403, 503]);

/**
 * The plan code in a refusal body, in **either** shape.
 *
 * `parsePlanBlocked` above deliberately answers `null` for an envelope, because a handler that has
 * just read one body cannot tell a plan refusal from some other route's nested error, and a paywall
 * in front of a route's real answer is worse than the answer. `notePlanResponse` below can tell:
 * it knows the status is 403 or 503 before it reads anything, and at that status an envelope
 * carrying `plan_past_due` is a plan refusal by any reading. So this one reads both, and only the
 * status-gated caller uses it.
 */
export function planCodeFromRefusal(body: unknown): PlanBlockCode | null {
  const flat = parsePlanBlocked(body);
  if (flat) {
    return flat;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const error = (body as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return isPlanBlockCode(code) ? code : null;
}

/**
 * Every plan refusal, from every call, raised once — the shared half of this seam.
 *
 * Until this existed, `reportPlanBlocked` had exactly ONE caller: `job-stream.ts`. So a past-due
 * tenant saw the paywall if they happened to start a job, and saw an ordinary red error banner for
 * a chat send, a settings save, a music generate, an upload or anything else — the same tenant, the
 * same block, a different app depending on which button they pressed first.
 *
 * Shaped exactly like `noteApiResponse` in `session-signal.ts`, and called beside it:
 *
 * - **A clone, always.** The caller's body is untouched and still unread, so a handler that parses
 *   its own error envelope still can. That is the difference between reporting a refusal and
 *   stealing it.
 * - **Nothing at all off 403/503.** No clone, no read, no promise — the overwhelming majority of
 *   responses leave this function on the first line.
 * - **Silent when it is not a plan code.** `gateway_blocked` has its own screen and its own parser,
 *   and `session_required` belongs to `session-signal`. Neither announces anything here.
 */
export function notePlanResponse(response: Response): void {
  if (!PLAN_REFUSAL_STATUSES.has(response.status) || typeof response.clone !== "function") {
    return;
  }
  void response
    .clone()
    .json()
    .then((body: unknown) => {
      const code = planCodeFromRefusal(body);
      if (code) {
        announcePlanBlocked(code);
      }
    })
    .catch(() => {
      // A refusal with no readable body says nothing about a plan; leave the app as it is.
    });
}

/** Read a `PLAN_BLOCK_EVENT` back, through the same narrowing as a body. */
export function readPlanBlockEvent(event: Event): PlanBlockCode | null {
  const detail = (event as CustomEvent<unknown>).detail;
  return isPlanBlockCode(detail) ? detail : null;
}

/**
 * The live plan refusal, and the way out of it.
 *
 * `clear` is what a retry presses: `plan_unavailable` is transient by definition, and a tenant who
 * has just paid must be able to get back to the desk without the app being reloaded for them.
 */
export function usePlanBlock(): { code: PlanBlockCode | null; clear: () => void } {
  const [code, setCode] = useState<PlanBlockCode | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const onBlock = (event: Event) => setCode(readPlanBlockEvent(event));
    window.addEventListener(PLAN_BLOCK_EVENT, onBlock);
    return () => window.removeEventListener(PLAN_BLOCK_EVENT, onBlock);
  }, []);

  return { code, clear: () => setCode(null) };
}
