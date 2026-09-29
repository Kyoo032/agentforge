import { describe, expect, it } from "vitest";
import type { UpdateStatus } from "./app-updates-copy";
import type { SetupStatus } from "./components-client";
import { MASCOT_STATES } from "./mascot-states";
import {
  componentSetupMascot,
  LETS_GO_MS,
  liveTurnMascot,
  type OnboardingStep,
  onboardingMascot,
  updateMascot,
} from "./mascot-triggers";

describe("mascot triggers", () => {
  it("charges while the component installer runs, and reacts to how it ended", () => {
    expect(componentSetupMascot("running")).toBe("charging");
    expect(componentSetupMascot("done")).toBe("celebrating");
    expect(componentSetupMascot("failed")).toBe("error");
    expect(componentSetupMascot("idle")).toBeNull();
  });

  it("charges while an update downloads and is surprised when it is ready", () => {
    expect(updateMascot("downloading")).toBe("charging");
    expect(updateMascot("ready")).toBe("surprised");
    expect(updateMascot("error")).toBe("error");
    for (const quiet of ["idle", "checking", "current", "available", "unavailable"] as const) {
      expect(updateMascot(quiet), quiet).toBeNull();
    }
  });

  it("waves hello, waits calmly for the key and shows love once onboarding is done", () => {
    expect(onboardingMascot("welcome")).toBe("wave");
    expect(onboardingMascot("key")).toBe("idle");
    expect(onboardingMascot("try")).toBe("love");
  });

  it("says lets-go only while a new chat's first turn is launching", () => {
    expect(liveTurnMascot({ launching: true })).toBe("lets-go");
    expect(liveTurnMascot({ launching: false })).toBe("thinking");
    expect(liveTurnMascot({ streaming: true })).toBe("answering");
    expect(liveTurnMascot({ launching: true, failed: true })).toBe("error");
    expect(LETS_GO_MS).toBeGreaterThanOrEqual(600);
    expect(LETS_GO_MS).toBeLessThanOrEqual(1200);
  });

  it("only ever names a state the mascot has", () => {
    const named = [
      ...(["idle", "running", "done", "failed"] as SetupStatus[]).map(componentSetupMascot),
      ...(
        ["idle", "checking", "current", "available", "downloading", "ready", "error", "unavailable"] as UpdateStatus[]
      ).map(updateMascot),
      ...(["welcome", "key", "try"] as OnboardingStep[]).map(onboardingMascot),
      liveTurnMascot({ launching: true }),
    ];
    for (const state of named) {
      if (state) {
        expect(MASCOT_STATES).toContain(state);
      }
    }
  });
});
