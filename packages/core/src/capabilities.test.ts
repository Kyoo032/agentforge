/**
 * Phase 8 — the capability flags, and the two properties that make them worth having.
 *
 * 1. Every flag is derived from `AGENTFORGE_SERVER` and nothing else, so a deployment cannot land
 *    in a combination nobody has thought about. The mirror test below says that as a rule rather
 *    than as twelve assertions, so a thirteenth flag added without a decision fails here.
 * 2. `parseCapabilities` reads every unknown as `false`, which hides a surface rather than
 *    offering one that will be refused. An older host sends no `capabilities` key at all.
 */
import { describe, expect, it } from "vitest";
import { hostCapabilities, parseCapabilities, type HostCapabilities } from "./capabilities";

const HOSTED = { AGENTFORGE_SERVER: "1" } as const;
const DESK = {} as const;

/** Flags that are true on the hosted server. Everything else must be true on a desk instead. */
const HOSTED_ONLY: ReadonlyArray<keyof HostCapabilities> = [
  "sessions",
  "storageQuota",
  "objectStorage",
  "plans",
  "tenantReset",
];

describe("hostCapabilities", () => {
  it("turns the hosted flags on for a server and off for a desk", () => {
    const hosted = hostCapabilities(HOSTED);
    const desk = hostCapabilities(DESK);
    for (const flag of HOSTED_ONLY) {
      expect(hosted[flag], `${flag} on a server`).toBe(true);
      expect(desk[flag], `${flag} on a desk`).toBe(false);
    }
  });

  it("is an exact mirror: every flag is true on exactly one of the two targets", () => {
    const hosted = hostCapabilities(HOSTED);
    const desk = hostCapabilities(DESK);
    const keys = Object.keys(hosted) as Array<keyof HostCapabilities>;
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      // A flag true on both, or false on both, is a flag whose meaning nobody decided. That is the
      // failure this catches — not a wrong value, an undecided one.
      expect(hosted[key], `${key} must differ between the two targets`).not.toBe(desk[key]);
    }
  });

  it("reads the flag the way `isServerMode` does, so one spelling cannot mean two things", () => {
    expect(hostCapabilities({ AGENTFORGE_SERVER: "true" }).sessions).toBe(true);
    expect(hostCapabilities({ AGENTFORGE_SERVER: " 1 " }).sessions).toBe(true);
    expect(hostCapabilities({ AGENTFORGE_SERVER: "0" }).sessions).toBe(false);
    expect(hostCapabilities({ AGENTFORGE_SERVER: "yes" }).sessions).toBe(false);
    expect(hostCapabilities({ AGENTFORGE_SERVER: "" }).sessions).toBe(false);
  });

  it("keeps the desktop's own surfaces on, off the hosted server", () => {
    const desk = hostCapabilities(DESK);
    expect(desk.startOver).toBe(true);
    expect(desk.relaunch).toBe(true);
    expect(desk.updater).toBe(true);
    expect(desk.nativeFilePicker).toBe(true);
    expect(desk.localPaths).toBe(true);
    expect(desk.componentInstall).toBe(true);
    expect(desk.singleOwner).toBe(true);
  });

  it("refuses the desktop's own surfaces on a server", () => {
    const hosted = hostCapabilities(HOSTED);
    expect(hosted.startOver).toBe(false);
    expect(hosted.relaunch).toBe(false);
    expect(hosted.updater).toBe(false);
    expect(hosted.nativeFilePicker).toBe(false);
    expect(hosted.localPaths).toBe(false);
    expect(hosted.componentInstall).toBe(false);
    expect(hosted.singleOwner).toBe(false);
  });
});

describe("parseCapabilities", () => {
  it("reads everything as false when the host sent nothing", () => {
    for (const payload of [null, undefined, {}, "capabilities", 7, []]) {
      const parsed = parseCapabilities(payload);
      for (const value of Object.values(parsed)) {
        expect(value).toBe(false);
      }
    }
  });

  it("only accepts a literal `true`, so a truthy string never opens a surface", () => {
    const parsed = parseCapabilities({ startOver: "true", tenantReset: 1, sessions: true });
    expect(parsed.startOver).toBe(false);
    expect(parsed.tenantReset).toBe(false);
    expect(parsed.sessions).toBe(true);
  });

  it("round-trips what the host actually sends, in both modes", () => {
    for (const env of [HOSTED, DESK]) {
      const resolved = hostCapabilities(env);
      expect(parseCapabilities(JSON.parse(JSON.stringify(resolved)))).toEqual(resolved);
    }
  });

  it("drops a flag the host invented rather than passing it through", () => {
    const parsed = parseCapabilities({ sessions: true, timeTravel: true }) as Record<string, unknown>;
    expect(parsed.timeTravel).toBeUndefined();
  });
});
