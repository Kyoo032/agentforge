/**
 * The guide's store: when it opens on its own, what it tells the host, and what it does when the host
 * cannot be reached. The transitions themselves are `guide-machine.test.ts`; this is the layer that
 * decides whether an offer is allowed and writes the outcome down.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("./api-client", () => ({ apiFetch }));

import {
  dispatchGuide,
  getGuideSnapshot,
  hydrateGuide,
  offerGuideAfterOnboarding,
  replayGuide,
  resetGuideForTests,
  subscribeGuide,
} from "./guide-store";
import { GUIDE_STEPS } from "./guide-steps";

beforeEach(() => {
  resetGuideForTests();
  apiFetch.mockReset();
  apiFetch.mockResolvedValue(new Response("{}", { status: 200 }));
});

afterEach(() => {
  resetGuideForTests();
});

function posted(): Array<{ url: string; body: unknown; method: string }> {
  return apiFetch.mock.calls.map(([url, init]) => ({
    url: String(url),
    method: String((init as RequestInit).method),
    body: JSON.parse(String((init as RequestInit).body)),
  }));
}

describe("offering the guide after first-run setup", () => {
  it("offers it when the host has not said it was seen", () => {
    offerGuideAfterOnboarding();
    expect(getGuideSnapshot().state).toEqual({ kind: "offered" });
  });

  it("offers it when the host has said it was not seen", () => {
    hydrateGuide({ seen: false, outcome: null, at: null });
    offerGuideAfterOnboarding();
    expect(getGuideSnapshot().state).toEqual({ kind: "offered" });
  });

  it("does not offer it again once the host says it was seen", () => {
    hydrateGuide({ seen: true, outcome: "skipped", at: 5 });
    offerGuideAfterOnboarding();
    expect(getGuideSnapshot().state).toEqual({ kind: "idle" });
  });

  it("ignores a payload that is not a guide answer", () => {
    for (const junk of [null, undefined, 3, "seen", {}, { seen: "yes" }]) {
      hydrateGuide(junk);
    }
    expect(getGuideSnapshot().seen).toBeNull();
  });

  it("has a real tour to offer: the registry is 4 to 6 stops", () => {
    expect(GUIDE_STEPS.length).toBeGreaterThanOrEqual(4);
    expect(GUIDE_STEPS.length).toBeLessThanOrEqual(6);
  });
});

describe("recording how it ended", () => {
  it("writes finished after the last step's Next", () => {
    offerGuideAfterOnboarding();
    dispatchGuide({ type: "start" });
    for (let i = 0; i < GUIDE_STEPS.length; i += 1) {
      dispatchGuide({ type: "next" });
    }

    expect(getGuideSnapshot().state).toEqual({ kind: "done", outcome: "finished" });
    expect(posted()).toEqual([{ url: "/api/v1/settings/guide", method: "POST", body: { outcome: "finished" } }]);
  });

  it("writes skipped on Skip, from the offer", () => {
    offerGuideAfterOnboarding();
    dispatchGuide({ type: "skip" });

    expect(posted().map((call) => call.body)).toEqual([{ outcome: "skipped" }]);
  });

  it("writes closed on close, from a middle step", () => {
    offerGuideAfterOnboarding();
    dispatchGuide({ type: "start" });
    dispatchGuide({ type: "next" });
    dispatchGuide({ type: "close" });

    expect(posted().map((call) => call.body)).toEqual([{ outcome: "closed" }]);
  });

  it("writes nothing while the tour is only moving between steps", () => {
    offerGuideAfterOnboarding();
    dispatchGuide({ type: "start" });
    dispatchGuide({ type: "next" });
    dispatchGuide({ type: "back" });

    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("marks the guide seen locally at once, so a failed write cannot re-offer it this session", async () => {
    apiFetch.mockRejectedValue(new Error("offline"));
    offerGuideAfterOnboarding();
    dispatchGuide({ type: "close" });
    await Promise.resolve();

    expect(getGuideSnapshot().seen).toBe(true);
    offerGuideAfterOnboarding();
    expect(getGuideSnapshot().state).toEqual({ kind: "done", outcome: "closed" });
  });

  it("does not throw or reopen when the host answers an error", async () => {
    apiFetch.mockResolvedValue(new Response("{}", { status: 500 }));
    offerGuideAfterOnboarding();
    dispatchGuide({ type: "skip" });
    await Promise.resolve();

    expect(getGuideSnapshot().state.kind).toBe("done");
  });
});

describe("replaying the guide", () => {
  it("opens at the first step even after it was finished, and records the replay's end too", () => {
    hydrateGuide({ seen: true, outcome: "finished", at: 1 });
    replayGuide();
    expect(getGuideSnapshot().state).toEqual({ kind: "step", index: 0 });

    dispatchGuide({ type: "close" });
    expect(posted().map((call) => call.body)).toEqual([{ outcome: "closed" }]);
  });

  it("restarts from the first step when it is already open", () => {
    replayGuide();
    dispatchGuide({ type: "next" });
    dispatchGuide({ type: "next" });
    replayGuide();
    expect(getGuideSnapshot().state).toEqual({ kind: "step", index: 0 });
  });
});

describe("subscribing", () => {
  it("notifies on a change and not on a no-op, and stops after unsubscribe", () => {
    const seen = vi.fn();
    const stop = subscribeGuide(seen);

    dispatchGuide({ type: "back" });
    expect(seen).not.toHaveBeenCalled();

    offerGuideAfterOnboarding();
    expect(seen).toHaveBeenCalledTimes(1);

    stop();
    dispatchGuide({ type: "skip" });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("hands out the same snapshot object until something changes", () => {
    const first = getGuideSnapshot();
    expect(getGuideSnapshot()).toBe(first);
    offerGuideAfterOnboarding();
    expect(getGuideSnapshot()).not.toBe(first);
  });
});
