import { afterEach, describe, expect, it } from "vitest";
import { clampPanelWidth, readPanelWidth, writePanelWidth } from "./panel-width";

describe("panel width", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("clamps to the inclusive range", () => {
    expect(clampPanelWidth(100, 160, 360)).toBe(160);
    expect(clampPanelWidth(400, 160, 360)).toBe(360);
    expect(clampPanelWidth(200.4, 160, 360)).toBe(200);
    expect(clampPanelWidth(Number.NaN, 160, 360)).toBe(160);
  });

  it("falls back without window and round-trips localStorage", () => {
    expect(readPanelWidth("agentforge-test-panel-width", 232, 168, 360)).toBe(232);

    const store = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    (globalThis as { window: { localStorage: typeof localStorage } }).window = { localStorage };

    const key = "agentforge-test-panel-width";
    expect(readPanelWidth(key, 232, 168, 360)).toBe(232);
    writePanelWidth(key, 180);
    expect(readPanelWidth(key, 232, 168, 360)).toBe(180);
    localStorage.setItem(key, "999");
    expect(readPanelWidth(key, 232, 168, 360)).toBe(360);
  });
});
