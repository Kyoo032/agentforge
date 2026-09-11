import { describe, expect, it } from "vitest";
import {
  type KnowledgeBackendState,
  backendStatusLine,
  canSelectWeKnora,
  isKnowledgeBackendId,
  normalizeBackend,
} from "./knowledge-backend";

const healthy: KnowledgeBackendState = {
  id: "weknora",
  selected: "weknora",
  available: true,
  reason: null,
  health: { ok: true, detail: "200 in 4 ms" },
  outbox: 0,
};

describe("isKnowledgeBackendId", () => {
  it("accepts only the two shipped ids", () => {
    expect(isKnowledgeBackendId("builtin")).toBe(true);
    expect(isKnowledgeBackendId("weknora")).toBe(true);
    expect(isKnowledgeBackendId("sqlite")).toBe(false);
    expect(isKnowledgeBackendId(null)).toBe(false);
    expect(isKnowledgeBackendId(7)).toBe(false);
  });
});

describe("normalizeBackend", () => {
  it("returns null for anything that is not a backend payload", () => {
    expect(normalizeBackend(null)).toBeNull();
    expect(normalizeBackend(undefined)).toBeNull();
    expect(normalizeBackend("weknora")).toBeNull();
    expect(normalizeBackend([])).toBeNull();
    expect(normalizeBackend({})).toBeNull();
    expect(normalizeBackend({ id: "postgres", selected: "builtin" })).toBeNull();
  });

  it("keeps a well-formed payload", () => {
    expect(
      normalizeBackend({
        id: "weknora",
        selected: "weknora",
        available: true,
        reason: null,
        health: { ok: true, detail: "200 in 4 ms" },
        outbox: 0,
      }),
    ).toEqual(healthy);
  });

  it("defaults every optional field instead of throwing", () => {
    expect(normalizeBackend({ id: "builtin" })).toEqual({
      id: "builtin",
      selected: "builtin",
      available: false,
      reason: null,
      health: null,
      outbox: 0,
    });
  });

  it("falls back to id when selected is missing or junk", () => {
    expect(normalizeBackend({ id: "weknora", selected: "mongo" })?.selected).toBe("weknora");
    expect(normalizeBackend({ id: "builtin", selected: 3 })?.selected).toBe("builtin");
  });

  it("keeps id and selected apart when WeKnora is selected but degraded", () => {
    const parsed = normalizeBackend({
      id: "builtin",
      selected: "weknora",
      available: true,
      reason: null,
      health: { ok: false, detail: "3 failed health checks" },
      outbox: 3,
    });
    expect(parsed?.id).toBe("builtin");
    expect(parsed?.selected).toBe("weknora");
    expect(parsed?.health).toEqual({ ok: false, detail: "3 failed health checks" });
    expect(parsed?.outbox).toBe(3);
  });

  it("drops a health object without a boolean ok and trims its detail", () => {
    expect(normalizeBackend({ id: "builtin", health: { detail: "hi" } })?.health).toBeNull();
    expect(normalizeBackend({ id: "builtin", health: "ok" })?.health).toBeNull();
    expect(normalizeBackend({ id: "builtin", health: { ok: true } })?.health).toEqual({ ok: true, detail: "" });
  });

  it("clamps a junk outbox to 0 and truncates a float", () => {
    expect(normalizeBackend({ id: "builtin", outbox: -4 })?.outbox).toBe(0);
    expect(normalizeBackend({ id: "builtin", outbox: "9" })?.outbox).toBe(0);
    expect(normalizeBackend({ id: "builtin", outbox: Number.NaN })?.outbox).toBe(0);
    expect(normalizeBackend({ id: "builtin", outbox: 2.7 })?.outbox).toBe(2);
  });

  it("keeps a reason string and nulls an empty or non-string one", () => {
    expect(normalizeBackend({ id: "builtin", reason: "  not installed  " })?.reason).toBe("not installed");
    expect(normalizeBackend({ id: "builtin", reason: "   " })?.reason).toBeNull();
    expect(normalizeBackend({ id: "builtin", reason: 42 })?.reason).toBeNull();
  });
});

describe("backendStatusLine", () => {
  it("reads as built-in search when nothing is reported", () => {
    expect(backendStatusLine(null)).toBe("Built-in search");
    expect(backendStatusLine(undefined)).toBe("Built-in search");
  });

  it("reads as built-in search when built-in is the owner's choice", () => {
    expect(backendStatusLine({ ...healthy, id: "builtin", selected: "builtin", health: null })).toBe("Built-in search");
  });

  it("names WeKnora and its queue when it is answering", () => {
    expect(backendStatusLine(healthy)).toBe("WeKnora · healthy · 0 queued");
    expect(backendStatusLine({ ...healthy, outbox: 3 })).toBe("WeKnora · healthy · 3 queued");
  });

  it("says built-in is answering when WeKnora is selected but degraded", () => {
    expect(
      backendStatusLine({
        ...healthy,
        id: "builtin",
        health: { ok: false, detail: "connect ECONNREFUSED" },
        outbox: 3,
      }),
    ).toBe("WeKnora selected · degraded, built-in answering · 3 queued");
  });

  it("reports the reason when WeKnora cannot be chosen", () => {
    expect(
      backendStatusLine({
        id: "builtin",
        selected: "builtin",
        available: false,
        reason: "sidecar binary not found",
        health: null,
        outbox: 0,
      }),
    ).toBe("WeKnora not installed: sidecar binary not found");
  });

  it("still reads as built-in search when WeKnora is unavailable without a reason", () => {
    expect(
      backendStatusLine({
        id: "builtin",
        selected: "builtin",
        available: false,
        reason: null,
        health: null,
        outbox: 0,
      }),
    ).toBe("Built-in search");
  });

  it("says the health is unknown while WeKnora is still starting", () => {
    expect(backendStatusLine({ ...healthy, health: null })).toBe("WeKnora · not checked yet · 0 queued");
  });
});

describe("canSelectWeKnora", () => {
  it("is false without a backend and false when the host says unavailable", () => {
    expect(canSelectWeKnora(null)).toBe(false);
    expect(canSelectWeKnora(undefined)).toBe(false);
    expect(canSelectWeKnora({ ...healthy, available: false })).toBe(false);
  });

  it("is true when the host says the sidecar is installed", () => {
    expect(canSelectWeKnora({ ...healthy, id: "builtin", selected: "builtin" })).toBe(true);
    expect(canSelectWeKnora(healthy)).toBe(true);
  });
});
