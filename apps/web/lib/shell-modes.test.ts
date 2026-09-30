/**
 * The rail must never draw a mode the desk does not have. The shell mounts a moment before
 * `GET /api/v1/workspaces` answers, and it used to start from every mode: a fresh Personal install
 * (Chat, Research, Images, Videos, Presentation) drew fourteen tabs and then narrowed to five. These
 * cases pin the rule that replaced the guess (`lib/shell-modes.ts`); the frames themselves are driven
 * in a real browser (`.cursor/skills/verify-agentforge/features/rail.md`).
 */
import type { ProductMode } from "@agentforge/core/product-modes";
import { describe, expect, it } from "vitest";
import {
  browserShellModesStore,
  initialShellModes,
  modeRedirectAllowed,
  parseCachedShellModes,
  railModesPending,
  readShellModesCache,
  serializeShellModes,
  SHELL_MODES_KEY,
  shellModesCacheKey,
  shellModesFromHost,
  SKELETON_MODE_ROWS,
  UNKNOWN_DESK_MODES,
  writeShellModesCache,
  type ShellModesStore,
} from "@/lib/shell-modes";

const ALL_FOURTEEN: ProductMode[] = [
  "chat",
  "documents",
  "research",
  "finance",
  "data",
  "market",
  "legal",
  "meeting",
  "images",
  "videos",
  "music",
  "edit",
  "presentations",
  "education",
];

/** A `Storage` stand-in that remembers what was written and can be told to throw. */
function fakeStore(initial: Record<string, string> = {}, opts: { failReads?: boolean; failWrites?: boolean } = {}) {
  const data = new Map<string, string>(Object.entries(initial));
  const writes: string[] = [];
  const store: ShellModesStore = {
    getItem(key) {
      if (opts.failReads) {
        throw new Error("storage blocked");
      }
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (opts.failWrites) {
        throw new Error("quota");
      }
      writes.push(`${key}=${value}`);
      data.set(key, value);
    },
  };
  return { store, data, writes };
}

describe("initialShellModes: the first frame", () => {
  it("is Chat and an unknown desk when nothing is remembered (a brand-new install)", () => {
    expect(initialShellModes(null)).toEqual({ source: "unknown", modes: ["chat"] });
    expect(initialShellModes(undefined)).toEqual({ source: "unknown", modes: ["chat"] });
    expect(initialShellModes("")).toEqual({ source: "unknown", modes: ["chat"] });
  });

  it("is never every mode, whatever it is handed", () => {
    for (const raw of [null, "", "[]", "null", "{}", "not json", '["documents"]', '"chat"', "42"]) {
      const first = initialShellModes(raw);
      expect(first.modes).toEqual(["chat"]);
      expect(first.source).toBe("unknown");
    }
  });

  it("is the remembered desk for a returning person", () => {
    expect(initialShellModes('["chat","research","images","videos","presentations"]')).toEqual({
      source: "cache",
      modes: ["chat", "research", "images", "videos", "presentations"],
    });
    expect(initialShellModes(serializeShellModes(ALL_FOURTEEN))).toEqual({ source: "cache", modes: ALL_FOURTEEN });
  });

  it("keeps a Chat-only desk as a real desk, not as unknown", () => {
    expect(initialShellModes('["chat"]')).toEqual({ source: "cache", modes: ["chat"] });
  });

  it("does not hand out the same array twice", () => {
    const a = initialShellModes(null);
    const b = initialShellModes(null);
    expect(a.modes).not.toBe(b.modes);
    expect(a.modes).not.toBe(UNKNOWN_DESK_MODES);
    a.modes.push("documents");
    expect(initialShellModes(null).modes).toEqual(["chat"]);
    expect(UNKNOWN_DESK_MODES).toEqual(["chat"]);
  });
});

describe("parseCachedShellModes: what a remembered value may name", () => {
  it("accepts a list that names Chat and reads it in catalog order", () => {
    expect(parseCachedShellModes('["images","chat","research"]')).toEqual(["chat", "research", "images"]);
  });

  it("drops ids the catalog does not know and duplicates", () => {
    expect(parseCachedShellModes('["chat","agents","nope","images","images"]')).toEqual(["chat", "images"]);
  });

  it("refuses an empty list rather than reading it as every mode", () => {
    expect(parseCachedShellModes("[]")).toBeNull();
  });

  it("refuses a list with no Chat: a host answer always carries Chat, so this was never written by one", () => {
    expect(parseCachedShellModes('["documents","finance"]')).toBeNull();
    expect(parseCachedShellModes('["nope"]')).toBeNull();
  });

  it("refuses anything that is not a JSON array of strings", () => {
    for (const raw of ["not json", "{", '{"modes":["chat"]}', '"chat"', "true", "null", "7", "", null, undefined]) {
      expect(parseCachedShellModes(raw)).toBeNull();
    }
    expect(parseCachedShellModes('[1,2,3]')).toBeNull();
  });
});

describe("shellModesFromHost: the answer", () => {
  it("is the desk's own list, with Chat forced in", () => {
    expect(shellModesFromHost(["chat", "research", "images", "videos", "presentations"])).toEqual({
      source: "host",
      modes: ["chat", "research", "images", "videos", "presentations"],
    });
    expect(shellModesFromHost(["research"]).modes).toEqual(["chat", "research"]);
  });

  it("reads a row that stores nothing as every mode: the rule for a desk that predates the column", () => {
    for (const stored of [undefined, null, []]) {
      expect(shellModesFromHost(stored)).toEqual({ source: "host", modes: ALL_FOURTEEN });
    }
  });
});

describe("what each source is allowed to do", () => {
  it("draws the skeleton only while nothing is known", () => {
    expect(railModesPending("unknown")).toBe(true);
    expect(railModesPending("cache")).toBe(false);
    expect(railModesPending("host")).toBe(false);
  });

  it("redirects away from a hidden mode only on the host's answer", () => {
    expect(modeRedirectAllowed("unknown")).toBe(false);
    expect(modeRedirectAllowed("cache")).toBe(false);
    expect(modeRedirectAllowed("host")).toBe(true);
  });

  it("holds four skeleton rows: the job modes of a fresh Personal desk", () => {
    expect(SKELETON_MODE_ROWS).toBe(4);
  });
});

describe("the storage key", () => {
  it("is one key on a Personal desk, where there is no tenant", () => {
    expect(SHELL_MODES_KEY).toBe("agentforge-shell-modes");
    expect(shellModesCacheKey(null)).toBe("agentforge-shell-modes");
    expect(shellModesCacheKey(undefined)).toBe("agentforge-shell-modes");
    expect(shellModesCacheKey("   ")).toBe("agentforge-shell-modes");
  });

  it("carries the tenant on the hosted app, so one account never reads another's", () => {
    expect(shellModesCacheKey("tenant_a")).toBe("agentforge-shell-modes:tenant_a");
    expect(shellModesCacheKey(" tenant_b ")).toBe("agentforge-shell-modes:tenant_b");
    expect(shellModesCacheKey("tenant_a")).not.toBe(shellModesCacheKey("tenant_b"));
  });
});

describe("the browser cache", () => {
  it("round trips the host's answer into the next first frame", () => {
    const { store } = fakeStore();
    const key = shellModesCacheKey(null);
    expect(initialShellModes(readShellModesCache(key, store))).toEqual({ source: "unknown", modes: ["chat"] });
    writeShellModesCache(key, ["chat", "research", "images", "videos", "presentations"], store);
    expect(initialShellModes(readShellModesCache(key, store))).toEqual({
      source: "cache",
      modes: ["chat", "research", "images", "videos", "presentations"],
    });
  });

  it("does not rewrite a value that has not changed (the shell asks on every navigation)", () => {
    const { store, writes } = fakeStore();
    const key = shellModesCacheKey(null);
    writeShellModesCache(key, ["chat", "research"], store);
    writeShellModesCache(key, ["chat", "research"], store);
    writeShellModesCache(key, ["chat", "research"], store);
    expect(writes).toEqual(['agentforge-shell-modes=["chat","research"]']);
    writeShellModesCache(key, ["chat", "research", "images"], store);
    expect(writes).toHaveLength(2);
  });

  it("keeps two tenants apart in one browser", () => {
    const { store } = fakeStore();
    writeShellModesCache(shellModesCacheKey("tenant_a"), ALL_FOURTEEN, store);
    writeShellModesCache(shellModesCacheKey("tenant_b"), ["chat"], store);
    expect(initialShellModes(readShellModesCache(shellModesCacheKey("tenant_b"), store)).modes).toEqual(["chat"]);
    expect(initialShellModes(readShellModesCache(shellModesCacheKey("tenant_a"), store)).modes).toEqual(ALL_FOURTEEN);
    expect(initialShellModes(readShellModesCache(shellModesCacheKey("tenant_c"), store)).source).toBe("unknown");
  });

  it("treats a blocked or absent store as nothing remembered, and never throws", () => {
    const key = shellModesCacheKey(null);
    expect(readShellModesCache(key, undefined)).toBeNull();
    expect(readShellModesCache(key, fakeStore({}, { failReads: true }).store)).toBeNull();
    expect(() => writeShellModesCache(key, ["chat"], undefined)).not.toThrow();
    expect(() => writeShellModesCache(key, ["chat"], fakeStore({}, { failWrites: true }).store)).not.toThrow();
    expect(() => writeShellModesCache(key, ["chat"], fakeStore({}, { failReads: true }).store)).not.toThrow();
    expect(initialShellModes(readShellModesCache(key, fakeStore({}, { failReads: true }).store))).toEqual({
      source: "unknown",
      modes: ["chat"],
    });
  });

  it("finds no browser storage under vitest, which is node-only", () => {
    expect(browserShellModesStore()).toBeUndefined();
  });

  it("stores exactly the modes, nothing else", () => {
    expect(serializeShellModes(["chat", "images"])).toBe('["chat","images"]');
  });
});
