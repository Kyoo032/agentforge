import { describe, expect, it } from "vitest";
import {
  DEFAULT_THINKING_PREF,
  THINKING_EFFORT_STORAGE_KEY,
  THINKING_LEGACY_STORAGE_KEY,
  readStoredThinkingPref,
  thinkingRequestFields,
  writeThinkingPref,
} from "./chat-thinking";

/**
 * Chat used to post `reasoningEffort` on every send, and the picker starts at Normal, so the host read
 * "the person picked medium" even for someone who never touched Thinking. A model the policy table does
 * not know is sent no effort unless one was chosen, and that could never apply from Chat. The renderer
 * now sends a level only once the person has picked one; the picker shows the same words either way.
 */

function memoryStore(initial: Record<string, string> = {}): Storage {
  const data = { ...initial };
  return {
    get length() {
      return Object.keys(data).length;
    },
    clear() {
      for (const key of Object.keys(data)) {
        delete data[key];
      }
    },
    getItem(key: string) {
      return key in data ? (data[key] as string) : null;
    },
    key() {
      return null;
    },
    removeItem(key: string) {
      delete data[key];
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
  };
}

function throwingStore(): Storage {
  const fail = () => {
    throw new Error("storage is blocked");
  };
  return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail };
}

describe("thinkingRequestFields", () => {
  it("sends nothing while the person has not picked a level", () => {
    expect(thinkingRequestFields("medium", false)).toEqual({});
    expect(JSON.stringify({ content: "hi", model: "m", ...thinkingRequestFields("medium", false) })).toBe(
      '{"content":"hi","model":"m"}',
    );
  });

  it("sends nothing whatever the picker shows while it is unchosen", () => {
    expect(thinkingRequestFields("high", false)).toEqual({});
    expect(thinkingRequestFields("none", false)).toEqual({});
  });

  it("sends the level, and the on/off flag beside it, once the person has picked one", () => {
    expect(thinkingRequestFields("xhigh", true)).toEqual({ thinking: true, reasoningEffort: "xhigh" });
    expect(thinkingRequestFields("medium", true)).toEqual({ thinking: true, reasoningEffort: "medium" });
  });

  it("sends Off as a choice", () => {
    expect(thinkingRequestFields("none", true)).toEqual({ thinking: false, reasoningEffort: "none" });
  });
});

describe("readStoredThinkingPref", () => {
  it("starts an untouched picker at Normal, not chosen", () => {
    expect(readStoredThinkingPref(memoryStore())).toEqual({ effort: "medium", chosen: false });
    expect(DEFAULT_THINKING_PREF).toEqual({ effort: "medium", chosen: false });
  });

  it("counts a stored level as a choice: only the picker writes it", () => {
    expect(readStoredThinkingPref(memoryStore({ [THINKING_EFFORT_STORAGE_KEY]: "high" }))).toEqual({
      effort: "high",
      chosen: true,
    });
    expect(readStoredThinkingPref(memoryStore({ [THINKING_EFFORT_STORAGE_KEY]: "none" }))).toEqual({
      effort: "none",
      chosen: true,
    });
  });

  it("counts a stored Normal as a choice too: the person picked it", () => {
    expect(readStoredThinkingPref(memoryStore({ [THINKING_EFFORT_STORAGE_KEY]: "medium" }))).toEqual({
      effort: "medium",
      chosen: true,
    });
  });

  it("ignores the snap-only level and anything that is not a level", () => {
    expect(readStoredThinkingPref(memoryStore({ [THINKING_EFFORT_STORAGE_KEY]: "minimal" }))).toEqual(
      DEFAULT_THINKING_PREF,
    );
    expect(readStoredThinkingPref(memoryStore({ [THINKING_EFFORT_STORAGE_KEY]: "banana" }))).toEqual(
      DEFAULT_THINKING_PREF,
    );
  });

  it("reads the older on/off switch: off is a choice, on alone is not", () => {
    expect(readStoredThinkingPref(memoryStore({ [THINKING_LEGACY_STORAGE_KEY]: "off" }))).toEqual({
      effort: "none",
      chosen: true,
    });
    expect(readStoredThinkingPref(memoryStore({ [THINKING_LEGACY_STORAGE_KEY]: "on" }))).toEqual(
      DEFAULT_THINKING_PREF,
    );
  });

  it("prefers the level over the older switch", () => {
    expect(
      readStoredThinkingPref(
        memoryStore({ [THINKING_EFFORT_STORAGE_KEY]: "low", [THINKING_LEGACY_STORAGE_KEY]: "off" }),
      ),
    ).toEqual({ effort: "low", chosen: true });
  });

  it("falls back to the default when storage is blocked or missing", () => {
    expect(readStoredThinkingPref(throwingStore())).toEqual(DEFAULT_THINKING_PREF);
    expect(readStoredThinkingPref(undefined)).toEqual(DEFAULT_THINKING_PREF);
  });
});

describe("writeThinkingPref", () => {
  it("stores the level and the older switch, so a reload keeps what the person picked", () => {
    const store = memoryStore();
    writeThinkingPref("high", store);
    expect(store.getItem(THINKING_EFFORT_STORAGE_KEY)).toBe("high");
    expect(store.getItem(THINKING_LEGACY_STORAGE_KEY)).toBe("on");
    expect(readStoredThinkingPref(store)).toEqual({ effort: "high", chosen: true });
    writeThinkingPref("none", store);
    expect(store.getItem(THINKING_LEGACY_STORAGE_KEY)).toBe("off");
  });

  it("does not throw when storage is blocked", () => {
    expect(() => writeThinkingPref("low", throwingStore())).not.toThrow();
    expect(() => writeThinkingPref("low", undefined)).not.toThrow();
  });
});
