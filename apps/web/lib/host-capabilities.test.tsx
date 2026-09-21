/**
 * Phase 8 — the capability flags in the renderer, actually rendered.
 *
 * `packages/core/src/capabilities.test.ts` owns the flags themselves: what each one is on each
 * target, and that an unknown payload reads as all-false. What it cannot prove is the half that
 * matters to a person looking at the screen — that the Electron-only controls are not on the page
 * on a hosted server, and that they still are on the desk. A flag nobody reads hides nothing.
 *
 * `renderToStaticMarkup` runs each card for real against the real `t()` and the real catalogs, so
 * a hidden control is genuinely absent from the markup rather than merely styled away.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostCapabilities, parseCapabilities } from "@agentforge/core/capabilities";
import { EVERYTHING_OFF, hasDesktopShell, hasNativeFilePicker, HostCapabilitiesFixture } from "./host-capabilities";
import { pingOnce, resetPingForTests } from "./host-ping";
import { applyLocale, resetLocaleForTests } from "./i18n";

const HOSTED = hostCapabilities({ AGENTFORGE_SERVER: "1" });
const DESK = hostCapabilities({});

vi.mock("@/lib/api-client", () => ({
  isElectron: () => electron,
  apiFetch: (path: string, init?: { method?: string }) => fetched(path, init),
}));

let electron = false;
let calls: Array<{ path: string; method: string }> = [];
let respond: (path: string) => unknown = () => ({});

async function fetched(path: string, init?: { method?: string }): Promise<Response> {
  calls.push({ path, method: init?.method ?? "GET" });
  const payload = respond(path);
  return {
    ok: payload !== null,
    json: async () => payload,
  } as Response;
}

beforeEach(() => {
  electron = false;
  calls = [];
  respond = () => ({});
  resetPingForTests();
  applyLocale("en");
});

afterEach(() => {
  resetLocaleForTests();
  resetPingForTests();
});

describe("the closed default", () => {
  it("is every flag false, and frozen so nothing can open one at runtime", () => {
    for (const value of Object.values(EVERYTHING_OFF)) {
      expect(value).toBe(false);
    }
    expect(Object.isFrozen(EVERYTHING_OFF)).toBe(true);
    // The same object `parseCapabilities` builds for a host that said nothing: a surface stays
    // hidden until the host has said it exists, which is the fail-closed direction.
    expect(EVERYTHING_OFF).toEqual(parseCapabilities(undefined));
  });
});

describe("the desktop shell tests", () => {
  it("needs the bridge AND the flag, because neither alone is the packaged app", () => {
    electron = false;
    expect(hasDesktopShell(DESK)).toBe(false);
    electron = true;
    expect(hasDesktopShell(DESK)).toBe(true);
    // A packaged build pointed at a hosted host: the bridge is there, the host says no.
    expect(hasDesktopShell(HOSTED)).toBe(false);
  });

  it("treats the native picker as its own capability, not as the shell's", () => {
    electron = true;
    expect(hasNativeFilePicker(DESK)).toBe(true);
    expect(hasNativeFilePicker(HOSTED)).toBe(false);
    electron = false;
    // Webdev: not the hosted server, and still no shell to ask. `isElectron()` alone could never
    // tell those two apart, which is the whole reason these flags exist.
    expect(hasNativeFilePicker(DESK)).toBe(false);
  });
});

describe("pingOnce", () => {
  it("fetches once however many consumers read it", async () => {
    await Promise.all([pingOnce(), pingOnce(), pingOnce()]);
    // Two providers read this payload. Two requests would race to mint the CSRF cookie on the
    // first `/api` GET, and one of them would lose its token.
    expect(calls.filter((call) => call.path === "/api/v1/ping")).toHaveLength(1);
  });

  it("memoises a failure rather than retrying per consumer", async () => {
    respond = () => {
      throw new Error("offline");
    };
    expect(await pingOnce()).toBeNull();
    expect(await pingOnce()).toBeNull();
    expect(calls).toHaveLength(1);
  });
});

describe("SettingsResetCard", () => {
  async function render(capabilities = HOSTED): Promise<string> {
    const { SettingsResetCard } = await import("@/components/settings-reset-card");
    // The card navigates after an erase, so it needs a router around it; nothing here follows a
    // route, the memory router is only what `useNavigate` requires to exist.
    return renderToStaticMarkup(
      <MemoryRouter>
        <HostCapabilitiesFixture capabilities={capabilities}>
          <SettingsResetCard />
        </HostCapabilitiesFixture>
      </MemoryRouter>,
    );
  }

  it("offers Start over on a desk and not on the hosted server", async () => {
    expect(await render(DESK)).toContain("settings-reset-all");
    // `scope: "all"` wipes the install: the database file, the media root, the settings. On a
    // hosted box that is every tenant's data, which is why the host answers `reset_disabled`.
    expect(await render(HOSTED)).not.toContain("settings-reset-all");
  });

  it("offers the account erase on the hosted server and not on a desk", async () => {
    expect(await render(HOSTED)).toContain("settings-reset-tenant");
    // A desk owner already has Start over, which does more and is theirs to run.
    expect(await render(DESK)).not.toContain("settings-reset-tenant");
  });

  it("never offers both at once, whichever target it is", async () => {
    for (const capabilities of [HOSTED, DESK]) {
      const markup = await render(capabilities);
      expect(markup.includes("settings-reset-all") && markup.includes("settings-reset-tenant")).toBe(false);
    }
  });

  it("offers neither before ping has answered", async () => {
    const markup = await render(EVERYTHING_OFF);
    expect(markup).not.toContain("settings-reset-all");
    expect(markup).not.toContain("settings-reset-tenant");
  });

  it("renders sentences rather than raw catalog keys", async () => {
    const markup = await render(HOSTED);
    // A dotted key in the DOM is `t()` saying the catalog has no copy for it.
    expect([...markup.matchAll(/settings\.reset\.[\w.]+/g)].map((match) => match[0])).toEqual([]);
  });
});

describe("SettingsStorageCard", () => {
  async function render(capabilities = HOSTED): Promise<string> {
    const { SettingsStorageCard } = await import("@/components/settings-storage-card");
    return renderToStaticMarkup(
      <HostCapabilitiesFixture capabilities={capabilities}>
        <SettingsStorageCard />
      </HostCapabilitiesFixture>,
    );
  }

  it("renders nothing where there is no ceiling", async () => {
    // A percentage of no limit is not zero, it is nothing. A desk owner does not need this product
    // to tell them their own hard drive is filling up.
    expect(await render(DESK)).toBe("");
    expect(await render(EVERYTHING_OFF)).toBe("");
  });

  it("renders the card on the hosted server", async () => {
    const markup = await render(HOSTED);
    expect(markup).toContain("settings-storage");
    expect([...markup.matchAll(/settings\.storage\.[\w.]+/g)].map((match) => match[0])).toEqual([]);
  });

  it("reads nothing at all when the card is hidden", async () => {
    await render(DESK);
    expect(calls.filter((call) => call.path === "/api/v1/storage/usage")).toHaveLength(0);
  });
});

describe("the parsers the card reads the payload with", () => {
  it("takes the host's order for the biggest objects rather than re-sorting", async () => {
    const { largestFrom } = await import("@/components/settings-storage-card");
    const payload = { largest: [{ id: "a", kind: "video", mime: "video/mp4", sizeBytes: 10 }, { id: "b", kind: "image", mime: "image/png", sizeBytes: 900 }] };
    // Deliberately out of order: the host already ordered and capped this list, and a renderer
    // that re-sorted would drift from it the first time the cap changed.
    expect(largestFrom(payload).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("drops a row with no id or no size rather than rendering a delete button for it", async () => {
    const { largestFrom } = await import("@/components/settings-storage-card");
    expect(
      largestFrom({
        largest: [{ id: "", sizeBytes: 5 }, { id: "c", sizeBytes: 0 }, { id: "d", kind: "image", mime: "", sizeBytes: 7 }],
      }).map((item) => item.id),
    ).toEqual(["d"]);
  });

  it("reads an empty list out of anything that is not one", async () => {
    const { largestFrom } = await import("@/components/settings-storage-card");
    for (const payload of [null, undefined, {}, { largest: "none" }, 7]) {
      expect(largestFrom(payload)).toEqual([]);
    }
  });

  it("unwraps the desktop IPC envelope, which nests the body", async () => {
    const { largestFrom } = await import("@/components/settings-storage-card");
    const nested = { body: { largest: [{ id: "e", kind: "image", mime: "image/png", sizeBytes: 3 }] } };
    expect(largestFrom(nested).map((item) => item.id)).toEqual(["e"]);
  });

  it("formats bytes as a person reads them", async () => {
    const { formatBytes } = await import("@/components/settings-storage-card");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(20 * 1024 ** 3)).toBe("20.0 GB");
    // A negative counter is a bug somewhere else; it must not render as "-1 B" on a tenant's screen.
    expect(formatBytes(-1)).toBe("0 B");
  });
});
