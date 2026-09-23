import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The gateway endpoint is pinned by the host (`packages/core/src/gateway/pinned.ts`) and, since
 * 2026-09-17, hidden from the UI entirely: neither Settings nor onboarding renders it, and no field
 * may look editable. This is a grep rather than a render test because the renderer has no DOM test
 * setup — what matters is that a future edit cannot quietly put the URL back on screen.
 */

const componentsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "components");

const SETTINGS_PAGE = "settings-page.tsx";
const ONBOARDING_SCREEN = "onboarding-screen.tsx";
const KEY_STATUS = "chat-key-status.tsx";

function read(file: string): string {
  return readFileSync(join(componentsDir, file), "utf8");
}

/** Comments may still explain the pin; only rendered code can leak it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("pinned gateway endpoint stays out of the UI", () => {
  it("Settings renders no settings-endpoint row", () => {
    expect(read(SETTINGS_PAGE)).not.toMatch(/settings-endpoint/);
  });

  it("onboarding renders no onboarding-endpoint field", () => {
    expect(read(ONBOARDING_SCREEN)).not.toMatch(/onboarding-endpoint/);
  });

  it("neither surface hardcodes the gateway URL", () => {
    for (const file of [SETTINGS_PAGE, ONBOARDING_SCREEN, KEY_STATUS]) {
      expect(stripComments(read(file))).not.toMatch(/tokotokenai/);
      expect(stripComments(read(file))).not.toMatch(/gate\.endpoint/);
    }
  });

  it("drops the retired endpoint copy keys", () => {
    for (const file of [SETTINGS_PAGE, ONBOARDING_SCREEN]) {
      expect(read(file)).not.toMatch(/\.endpointLabel|\.endpointLocked/);
    }
  });

  it("onboarding shows the host as a muted line, never as an input value", () => {
    const source = read(ONBOARDING_SCREEN);
    expect(source).toMatch(/onboarding\.gatewayHost/);
    expect(source).not.toMatch(/value=\{endpoint\}/);
  });

  it("ships the onboarding host line in both locales", () => {
    const localesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "locales");
    for (const locale of ["en", "id"] as const) {
      const catalog = JSON.parse(readFileSync(join(localesDir, locale, "onboarding.json"), "utf8")) as Record<
        string,
        string
      >;
      expect(catalog.gatewayHost).toContain("{host}");
      expect(catalog.endpointLabel).toBeUndefined();
      expect(catalog.endpointLocked).toBeUndefined();
    }
  });
});
