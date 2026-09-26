import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The gateway endpoint is pinned by the host (`packages/core/src/gateway/pinned.ts`) and hidden from
 * the UI. Settings names the host only in two prose strings. Onboarding does not show the address
 * at all. This is a grep rather than a render test — what matters is that a future edit cannot
 * quietly put the URL back on screen.
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

  it("onboarding does not render the gateway address", () => {
    const source = stripComments(read(ONBOARDING_SCREEN));
    expect(source).not.toMatch(/onboarding-gateway-host/);
    expect(source).not.toMatch(/onboarding\.gatewayHost/);
    expect(source).not.toMatch(/gatewayHostLabel/);
    expect(source).not.toMatch(/value=\{endpoint\}/);
    expect(source).not.toMatch(/tokotokenai/);
  });

  it("ships no gateway address in the onboarding catalogs", () => {
    const localesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "locales");
    for (const locale of ["en", "id"] as const) {
      const catalog = JSON.parse(readFileSync(join(localesDir, locale, "onboarding.json"), "utf8")) as Record<
        string,
        unknown
      >;
      expect(catalog.gatewayHost).toBeUndefined();
      expect(catalog.endpointLabel).toBeUndefined();
      expect(catalog.endpointLocked).toBeUndefined();
      expect(JSON.stringify(catalog)).not.toMatch(/tokotokenai|https?:\/\//);
    }
  });
});
