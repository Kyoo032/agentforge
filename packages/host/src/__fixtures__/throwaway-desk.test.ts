import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertThrowawayDesk, isThrowawayDesk } from "./throwaway-desk";

describe("isThrowawayDesk", () => {
  it("accepts a directory under the temp root", () => {
    expect(isThrowawayDesk(join(tmpdir(), "agentforge-host-vitest-1", "worker-2-abc"))).toBe(true);
  });

  it("refuses the operator's own desk, which is where an un-isolated run lands", () => {
    // `localDataDir()` falls back to `resolve(cwd, "../../data")`: `<repo>/data` from packages/host.
    expect(isThrowawayDesk(resolve(process.cwd(), "../../data"))).toBe(false);
    expect(isThrowawayDesk(resolve(process.cwd(), ".webdev-data-design"))).toBe(false);
  });

  it("refuses the temp root itself and anything that only looks like it is inside it", () => {
    expect(isThrowawayDesk(tmpdir())).toBe(false);
    expect(isThrowawayDesk(join(tmpdir(), "..", "elsewhere"))).toBe(false);
    expect(isThrowawayDesk("relative/../../outside", join(tmpdir(), "root"))).toBe(false);
  });
});

describe("assertThrowawayDesk", () => {
  it("passes on the desk vitest set up for this run", () => {
    expect(() => assertThrowawayDesk()).not.toThrow();
  });

  it("names the directory and the fix when it is not a throwaway desk", () => {
    const desk = resolve(process.cwd(), "../../data");
    let message = "";
    try {
      assertThrowawayDesk(desk);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain(desk);
    expect(message).toContain("packages/host");
  });
});
