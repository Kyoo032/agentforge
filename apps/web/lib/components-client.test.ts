/**
 * The Components client is the renderer half of a host contract that is already frozen
 * (`packages/host/src/components/types.ts`): six stages, five states, seven error codes.
 *
 * Two things are pinned here. First, nothing the host sends may reach the UI unvalidated — a
 * payload this file does not recognise becomes "no components", never a throw on first paint,
 * because this panel sits next to the key form and must never be able to block it. Second, the
 * reducer is pure: every event folds into a new object, so a stage list can be rendered from it
 * without a single mutation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvent } from "@agentforge/core/jobs";

const { apiFetch } = vi.hoisted(() => ({
  apiFetch: vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(),
}));

vi.mock("./api-client", () => ({ apiFetch }));

import {
  COMPONENT_ERROR_CODES,
  COMPONENT_SETUP_STAGES,
  EMPTY_SETUP,
  fetchComponents,
  installComponent,
  parseComponents,
  pickComponentToSetUp,
  reduceSetup,
  shouldAutoInstall,
  type ComponentStatus,
  type SetupState,
} from "./components-client";

const READY: ComponentStatus = {
  id: "anydoc",
  version: "0.2.4",
  state: "ready",
  source: "bundled",
  auto: true,
  bytes: 0,
};

const MISSING: ComponentStatus = {
  id: "anydoc",
  version: "0.2.4",
  state: "missing",
  source: null,
  auto: true,
  bytes: 8_000_000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function sseResponse(events: readonly unknown[]): Response {
  const body = events.map((event) => `event: message\ndata: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function phase(stage: string, state: string, durationMs?: number): JobEvent {
  return { type: "job.phase", phase: stage, label: stage, state, durationMs } as JobEvent;
}

function fold(events: readonly JobEvent[], from: SetupState = EMPTY_SETUP): SetupState {
  return events.reduce(reduceSetup, from);
}

function stageState(state: SetupState, id: string): string | undefined {
  return state.stages.find((stage) => stage.id === id)?.state;
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe("component payload validation", () => {
  it("reads the documented status row", () => {
    const rows = parseComponents({
      components: [{ id: "anydoc", version: "0.2.4", auto: true, state: "ready", source: "bundled", bytes: 0 }],
    });
    expect(rows).toEqual([READY]);
  });

  it("carries the failure only when the host sent one", () => {
    const [row] = parseComponents({
      components: [
        {
          id: "anydoc",
          version: "0.2.4",
          auto: true,
          state: "failed",
          source: null,
          bytes: 8_000_000,
          error: { code: "offline", message: "No network" },
        },
      ],
    });
    expect(row?.error).toEqual({ code: "offline", message: "No network" });
    expect(parseComponents({ components: [{ ...MISSING }] })[0]?.error).toBeUndefined();
  });

  it("treats anything it does not recognise as no components instead of throwing", () => {
    for (const payload of [null, undefined, 0, "components", [], {}, { components: null }, { components: "anydoc" }]) {
      expect(() => parseComponents(payload)).not.toThrow();
      expect(parseComponents(payload)).toEqual([]);
    }
  });

  it("drops a row whose state, source, auto or bytes is off-contract", () => {
    const rows = parseComponents({
      components: [
        { ...MISSING, state: "downloading" },
        { ...MISSING, source: "npm" },
        { ...MISSING, auto: "yes" },
        { ...MISSING, bytes: "8000000" },
        { ...MISSING, bytes: Number.NaN },
        { ...MISSING, id: 7 },
        null,
        MISSING,
      ],
    });
    expect(rows).toEqual([MISSING]);
  });

  it("drops an error whose code is not one of the seven", () => {
    const [row] = parseComponents({
      components: [{ ...MISSING, state: "failed", error: { code: "kaboom", message: "nope" } }],
    });
    expect(row?.error).toBeUndefined();
  });
});

describe("the auto-install decision", () => {
  it("installs only a component the host marked missing and auto", () => {
    expect(shouldAutoInstall(MISSING)).toBe(true);
    expect(shouldAutoInstall({ ...MISSING, auto: false })).toBe(false);
    expect(shouldAutoInstall(READY)).toBe(false);
    expect(shouldAutoInstall({ ...MISSING, state: "unsupported" })).toBe(false);
    expect(shouldAutoInstall({ ...MISSING, state: "installing" })).toBe(false);
    expect(shouldAutoInstall({ ...MISSING, state: "failed" })).toBe(false);
    expect(shouldAutoInstall(null)).toBe(false);
  });

  it("shows nothing at all for a component that is ready, unsupported, or not automatic", () => {
    expect(pickComponentToSetUp([READY])).toBeNull();
    expect(pickComponentToSetUp([{ ...MISSING, state: "unsupported" }])).toBeNull();
    expect(pickComponentToSetUp([{ ...MISSING, auto: false }])).toBeNull();
    expect(pickComponentToSetUp([])).toBeNull();
  });

  it("picks up a run another window already started, and a failure left behind", () => {
    expect(pickComponentToSetUp([READY, { ...MISSING, state: "installing" }])?.state).toBe("installing");
    expect(pickComponentToSetUp([{ ...MISSING, state: "failed" }])?.state).toBe("failed");
    expect(pickComponentToSetUp([MISSING])).toEqual(MISSING);
  });
});

describe("setup reducer", () => {
  it("starts idle with every stage pending and nothing downloaded", () => {
    expect(EMPTY_SETUP.status).toBe("idle");
    expect(EMPTY_SETUP.percent).toBe(0);
    expect(EMPTY_SETUP.stages.map((stage) => stage.id)).toEqual([...COMPONENT_SETUP_STAGES]);
    expect(EMPTY_SETUP.stages.every((stage) => stage.state === "pending")).toBe(true);
  });

  it("never mutates the state it was handed", () => {
    const before = JSON.stringify(EMPTY_SETUP);
    const next = reduceSetup(EMPTY_SETUP, phase("check", "running"));
    expect(JSON.stringify(EMPTY_SETUP)).toBe(before);
    expect(next).not.toBe(EMPTY_SETUP);
    expect(next.stages[0]).not.toBe(EMPTY_SETUP.stages[0]);
  });

  it("walks a stage from pending to running to succeeded and keeps its duration", () => {
    const running = fold([phase("check", "running")]);
    expect(running.status).toBe("running");
    expect(stageState(running, "check")).toBe("running");

    const done = fold([phase("check", "succeeded", 12)], running);
    expect(stageState(done, "check")).toBe("succeeded");
    expect(done.stages.find((stage) => stage.id === "check")?.durationMs).toBe(12);
    expect(stageState(done, "download")).toBe("pending");
  });

  it("records a skipped stage the same way a second launch reports it", () => {
    const skipped = fold(COMPONENT_SETUP_STAGES.map((id) => phase(id, "skipped")));
    expect(skipped.stages.every((stage) => stage.state === "skipped")).toBe(true);
    expect(skipped.percent).toBe(100);
  });

  it("ignores a phase id that is not part of the component contract", () => {
    const next = fold([phase("drafting", "running")]);
    expect(next.stages).toEqual(EMPTY_SETUP.stages);
  });

  it("takes bytes from the download step and turns them into a percentage", () => {
    const state = fold([
      phase("check", "succeeded", 3),
      phase("download", "running"),
      {
        type: "job.step",
        phase: "download",
        label: "Downloading",
        detail: "@firecrawl/anydoc",
        current: 0,
        total: 100,
      },
    ]);
    expect(state.total).toBe(100);
    expect(state.received).toBe(0);
    // One of six stages finished, the seventh of the bar not yet moving.
    expect(state.percent).toBe(17);

    const half = fold(
      [{ type: "job.step", phase: "download", label: "Downloading", detail: "pkg", current: 50, total: 100 }],
      state,
    );
    expect(half.received).toBe(50);
    expect(half.percent).toBe(25);

    const full = fold(
      [{ type: "job.step", phase: "download", label: "Downloading", detail: "pkg", current: 100, total: 100 }],
      half,
    );
    expect(full.percent).toBe(33);
  });

  it("never lets a bad byte count push the bar past the end or backwards", () => {
    const state = fold([
      phase("download", "running"),
      { type: "job.step", phase: "download", label: "Downloading", detail: "pkg", current: 400, total: 100 },
    ]);
    expect(state.percent).toBe(17);
    const negative = fold(
      [{ type: "job.step", phase: "download", label: "Downloading", detail: "pkg", current: -5, total: 100 }],
      state,
    );
    expect(negative.percent).toBe(0);
  });

  it("ignores a step that carries no usable total", () => {
    const state = fold([
      phase("download", "running"),
      { type: "job.step", phase: "download", label: "Downloading", detail: "pkg", current: 5 },
      { type: "job.step", phase: "verify", label: "Verifying", current: 9, total: 9 },
    ]);
    expect(state.total).toBe(0);
    expect(state.received).toBe(0);
  });

  it("ends done at a full bar", () => {
    const state = fold([phase("check", "succeeded", 1), { type: "job.done", result: { id: "anydoc" } }]);
    expect(state.status).toBe("done");
    expect(state.percent).toBe(100);
  });

  it("ends failed on the stage that failed, with the contract code", () => {
    const state = fold([
      phase("check", "succeeded", 1),
      phase("download", "running"),
      phase("download", "failed", 900),
      { type: "job.error", code: "offline", message: "No network", status: 503 },
    ]);
    expect(state.status).toBe("failed");
    expect(state.errorCode).toBe("offline");
    expect(stageState(state, "download")).toBe("failed");
    expect(state.percent).toBeLessThan(100);
  });

  it("fails the stage still running when the error arrives without its own phase event", () => {
    const state = fold([
      phase("unpack", "running"),
      {
        type: "job.error",
        code: "unpack_failed",
        message: "boom",
        status: 500,
      },
    ]);
    expect(stageState(state, "unpack")).toBe("failed");
    expect(state.errorCode).toBe("unpack_failed");
  });

  it("leaves errorCode unset for a code outside the contract so the UI shows a generic sentence", () => {
    const state = fold([{ type: "job.error", code: "request_failed", message: "?", status: 0 }]);
    expect(state.status).toBe("failed");
    expect(state.errorCode).toBeUndefined();
    expect(COMPONENT_ERROR_CODES).not.toContain("request_failed");
  });
});

describe("talking to the host", () => {
  it("asks the documented route and hands back parsed rows", async () => {
    apiFetch.mockResolvedValue(jsonResponse({ components: [{ ...READY }] }));
    await expect(fetchComponents()).resolves.toEqual([READY]);
    expect(apiFetch.mock.calls[0]?.[0]).toBe("/api/v1/components");
  });

  it("reports no components rather than failing when the route is absent or the host is down", async () => {
    apiFetch.mockResolvedValue(jsonResponse({ error: { code: "not_found" } }, 404));
    await expect(fetchComponents()).resolves.toEqual([]);
    apiFetch.mockRejectedValue(new Error("offline"));
    await expect(fetchComponents()).resolves.toEqual([]);
    apiFetch.mockResolvedValue(new Response("<html>", { status: 200, headers: { "Content-Type": "text/html" } }));
    await expect(fetchComponents()).resolves.toEqual([]);
  });

  it("streams an install over the shared job helper and returns the final status", async () => {
    const seen: JobEvent[] = [];
    apiFetch.mockResolvedValue(
      sseResponse([
        { type: "job.phase", phase: "check", label: "Checking", state: "running" },
        { type: "job.done", result: { ...READY, source: "downloaded" } },
      ]),
    );
    const status = await installComponent("anydoc", (event) => seen.push(event));
    expect(status).toEqual({ ...READY, source: "downloaded" });
    expect(seen.map((event) => event.type)).toEqual(["job.phase", "job.done"]);

    const [url, init] = apiFetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/components/install/stream");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ id: "anydoc" });
  });

  it("surfaces a contract error code from the stream", async () => {
    apiFetch.mockResolvedValue(sseResponse([{ type: "job.error", code: "busy", message: "already", status: 409 }]));
    await expect(installComponent("anydoc", () => undefined)).rejects.toMatchObject({ code: "busy" });
  });
});
