import { afterEach, describe, expect, it, vi } from "vitest";
import {
  abortDesktopStream,
  getDesktopBrand,
  getDesktopBrandLogo,
  getDesktopUpdates,
  invokeDesktop,
  isElectron,
  relaunchDesktopApp,
  saveDesktopBytes,
} from "./desktop-bridge";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("desktop-bridge", () => {
  it("is not Electron when the preload bridge is missing", () => {
    expect(isElectron()).toBe(false);
    expect(getDesktopBrand()).toBeUndefined();
    expect(getDesktopBrandLogo()).toBeUndefined();
    expect(getDesktopUpdates()).toBeUndefined();
  });

  it("reads brand, data-image logo, and updates from the preload bridge", () => {
    const updates = {
      supported: true,
      state: async () => ({ supported: true }),
      check: async () => ({ supported: true }),
      download: async () => ({ supported: true }),
      install: async () => undefined,
    };
    vi.stubGlobal("window", {
      agentforge: {
        isElectron: true,
        brand: { productName: "Kemenkeu AI", gatewayName: "AIHub" },
        brandLogo: "data:image/png;base64,abc",
        updates,
      },
    });
    expect(isElectron()).toBe(true);
    expect(getDesktopBrand()).toEqual({ productName: "Kemenkeu AI", gatewayName: "AIHub" });
    expect(getDesktopBrandLogo()).toBe("data:image/png;base64,abc");
    expect(getDesktopUpdates()).toBe(updates);
  });

  it("ignores a brand logo that is not a data image", () => {
    vi.stubGlobal("window", {
      agentforge: {
        isElectron: true,
        brandLogo: "https://example.test/logo.png",
      },
    });
    expect(getDesktopBrandLogo()).toBeUndefined();
  });

  it("invokes and saves through the bridge", async () => {
    const invoke = vi.fn(async () => ({ type: "json" as const, status: 200, body: { ok: true } }));
    const saveBytes = vi.fn(async () => undefined);
    vi.stubGlobal("window", {
      agentforge: { isElectron: true, invoke, saveBytes },
    });
    await expect(
      invokeDesktop({
        requestId: "r1",
        method: "GET",
        path: "/api/v1/ping",
        query: {},
      }),
    ).resolves.toEqual({ type: "json", status: 200, body: { ok: true } });
    await saveDesktopBytes("note.txt", [1, 2]);
    expect(saveBytes).toHaveBeenCalledWith("note.txt", [1, 2]);
  });

  it("no-ops abort and save when the bridge is missing", async () => {
    abortDesktopStream("r1");
    await expect(saveDesktopBytes("note.txt", [1])).resolves.toBeUndefined();
  });

  it("passes a reset request through to the shell relaunch", async () => {
    const relaunch = vi.fn(async () => undefined);
    vi.stubGlobal("window", { agentforge: { isElectron: true, relaunch } });
    // The shell exits before it can answer, so an empty reply is the happy path.
    await expect(relaunchDesktopApp({ reset: true })).resolves.toEqual({ ok: true });
    expect(relaunch).toHaveBeenCalledWith({ reset: true });
    await expect(relaunchDesktopApp()).resolves.toEqual({ ok: true });
    expect(relaunch).toHaveBeenLastCalledWith(undefined);
  });

  it("reads an explicit ok from the shell", async () => {
    const relaunch = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("window", { agentforge: { isElectron: true, relaunch } });
    await expect(relaunchDesktopApp({ reset: true })).resolves.toEqual({ ok: true });
  });

  it("surfaces a refusal instead of reporting a restart that is not coming", async () => {
    for (const reason of ["installing-update", "already-exiting", "forbidden"]) {
      const relaunch = vi.fn(async () => ({ ok: false, reason }));
      vi.stubGlobal("window", { agentforge: { isElectron: true, relaunch } });
      await expect(relaunchDesktopApp({ reset: true })).resolves.toEqual({ ok: false, reason });
    }
  });

  it("names a refusal the shell left blank", async () => {
    const relaunch = vi.fn(async () => ({ ok: false, reason: "  " }));
    vi.stubGlobal("window", { agentforge: { isElectron: true, relaunch } });
    await expect(relaunchDesktopApp()).resolves.toEqual({ ok: false, reason: "refused" });
  });

  it("reports no relaunch on webdev, where the bridge has none", async () => {
    await expect(relaunchDesktopApp({ reset: true })).resolves.toEqual({ ok: false, reason: "unavailable" });
    vi.stubGlobal("window", { agentforge: { isElectron: true } });
    await expect(relaunchDesktopApp({ reset: true })).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});
