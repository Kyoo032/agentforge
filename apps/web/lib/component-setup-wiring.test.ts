/**
 * The first-run component panel, pinned against its sources.
 *
 * Two rules matter more than the layout. It must never be able to hold up onboarding — it lives
 * beside the key form, not in front of it, and it renders nothing at all when the host has nothing
 * to install (which is every Playwright run, where the stub runtime reports `auto: false`). And
 * every word it prints has to exist in both catalogs, because a missing key would otherwise show
 * up on screen as a raw dotted path.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMPONENT_ERROR_CODES, COMPONENT_SETUP_STAGES } from "./components-client";
import enOnboarding from "../locales/en/onboarding.json";
import idOnboarding from "../locales/id/onboarding.json";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Line endings are Biome's business, not this test's: every source is read with LF. */
function source(relative: string): string {
  return readFileSync(join(web, relative), "utf8").replace(/\r\n/g, "\n");
}

const panel = source("components/component-setup.tsx");
const onboarding = source("components/onboarding-screen.tsx");
const app = source("src/App.tsx");
const hook = source("lib/use-component-setup.ts");
const client = source("lib/components-client.ts");

function leafKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) =>
    leafKeys(nested, prefix ? `${prefix}.${key}` : key),
  );
}

describe("component setup panel", () => {
  it("carries the testids the harness drives", () => {
    for (const testId of [
      "component-setup",
      "component-setup-progress",
      "component-setup-retry",
      "component-setup-done",
      "component-setup-error",
    ]) {
      expect(panel, testId).toContain(`data-testid="${testId}"`);
    }
    expect(panel).toContain("data-testid={`component-setup-stage-${stage.id}`}");
  });

  it("announces itself politely and reports the bar to assistive tech", () => {
    expect(panel).toContain('role="status"');
    expect(panel).toContain('aria-live="polite"');
    expect(panel).toContain('role="progressbar"');
    expect(panel).toContain("aria-valuemin={0}");
    expect(panel).toContain("aria-valuemax={100}");
    expect(panel).toContain("aria-valuenow={setup.percent}");
  });

  it("shows nothing when there is nothing to set up, and collapses once it is done", () => {
    expect(panel).toContain("if (!visible || !component || collapsed) {");
    expect(panel).toContain("setCollapsed(true)");
  });

  it("offers a retry and says the app works without it, only on a failure", () => {
    expect(panel).toContain('data-testid="component-setup-error"');
    expect(panel).toContain('t(`onboarding.components.errors.${setup.errorCode ?? "unknown"}`)');
    expect(panel).toContain('t("onboarding.components.worksWithout"');
    expect(panel).toContain("onClick={retry}");
  });

  it("reads the size off the host status instead of hardcoding one", () => {
    expect(panel).toContain("megabytes(component.bytes)");
    expect(panel).not.toMatch(/\bMB\b/);
  });

  it("keeps no live log pane and writes no English literal", () => {
    expect(panel).not.toContain("<pre");
    expect(panel).not.toContain("appendComponentLog");
    // Every visible string goes through the catalog.
    expect(panel).not.toMatch(/>[A-Za-z]{4,}[^<{]*</);
  });

  it("stays a small focused file", () => {
    expect(panel.split("\n").length).toBeLessThan(200);
    expect(source("lib/use-component-setup.ts").split("\n").length).toBeLessThan(200);
  });
});

describe("where the setup runs", () => {
  it("hangs off the existing Setup check section without touching the ffmpeg notice", () => {
    expect(onboarding).toContain('data-testid="onboarding-setup-check"');
    expect(onboarding).toContain("{needsFfmpeg || componentSetup.visible ? (");
    expect(onboarding).toContain("<ComponentSetupPanel view={componentSetup} />");
    expect(onboarding).toContain('<FfmpegSetupNotice doctor={doctor} onDoctor={setDoctor} variant="full" />');
  });

  it("never gates the key form on it", () => {
    const form = onboarding.slice(onboarding.indexOf('data-testid="onboarding-form"'));
    expect(form).not.toContain("componentSetup");
    expect(onboarding).toContain("disabled={busy || !openaiApiKey.trim()}");
  });

  it("runs once from the shell too, with no UI, for an owner who never sees onboarding", () => {
    expect(app).toContain("<ComponentSetupSilent />");
    expect(panel).toContain("export function ComponentSetupSilent()");
    expect(panel).toContain("useComponentSetup();\n  return null;");
  });
});

describe("the hook's rules", () => {
  it("installs only what the host called missing and automatic", () => {
    expect(hook).toContain("shouldAutoInstall(found)");
    expect(client).toContain('status?.auto === true && status?.managed !== true && status?.state === "missing"');
  });

  /**
   * Phase 7. On a hosted server the install route answers `install_disabled` (403) to every caller,
   * so the panel must not mount at all — a tenant cannot fix what only the operator can. Pinned in
   * the source, like the rule above, because this is the one decision made in the renderer rather
   * than asserted against a live host.
   */
  it("never offers an install for a component the server manages", () => {
    expect(client).toContain("row.auto && !row.managed");
    expect(client).toContain("status?.managed !== true");
  });

  it("lets Retry re-run an install the host still remembers as failed", () => {
    expect(hook).toContain('const install = shouldAutoInstall(found) || (attempt > 0 && found.state === "failed");');
    expect(hook).toContain("setAttempt((count) => count + 1);");
  });

  it("aborts on unmount and tells the owner when another window owns the run", () => {
    expect(hook).toContain("abort.abort();");
    expect(hook).toContain('if (code === "busy")');
    expect(hook).toContain("setAlreadyRunning(true);");
    expect(hook).toContain("await fetchComponents(abort.signal)");
  });

  it("goes through the shared api client and never touches the host or the bridge", () => {
    for (const file of [client, hook, panel]) {
      expect(file).not.toContain("window.agentforge");
      expect(file).not.toContain("@agentforge/host");
      expect(file).not.toContain("fetch(");
    }
    expect(client).toContain('from "./api-client"');
    expect(client).toContain('from "./job-stream"');
  });
});

describe("component setup locale catalog", () => {
  function components(catalog: typeof enOnboarding | typeof idOnboarding): Record<string, string> {
    return catalog.components as unknown as Record<string, string>;
  }

  const expected = [
    "components.title",
    "components.description",
    "components.size",
    "components.progress",
    "components.duration",
    "components.done",
    "components.retry",
    "components.worksWithout",
    "components.alreadyRunning",
    ...COMPONENT_SETUP_STAGES.map((stage) => `components.steps.${stage}`),
    ...COMPONENT_ERROR_CODES.map((code) => `components.errors.${code}`),
    "components.errors.unknown",
  ];

  it("carries every key the panel asks for, in both locales", () => {
    for (const [name, catalog] of [
      ["en", enOnboarding],
      ["id", idOnboarding],
    ] as const) {
      const keys = new Set(leafKeys(catalog));
      for (const key of expected) {
        expect(keys.has(key), `${name}.${key}`).toBe(true);
      }
    }
  });

  it("keeps en and id at exactly the same keys", () => {
    expect(leafKeys(idOnboarding).sort()).toEqual(leafKeys(enOnboarding).sort());
  });

  it("writes the Indonesian copy in Indonesian rather than leaving English in place", () => {
    const en = enOnboarding.components as Record<string, unknown>;
    const id = idOnboarding.components as Record<string, unknown>;
    for (const key of ["title", "description", "done", "retry", "alreadyRunning"]) {
      expect(id[key], key).not.toBe(en[key]);
    }
    expect((id.steps as Record<string, string>).download).toBe("Mengunduh pembaca");
  });

  it("says the reading happens on this machine, in both locales", () => {
    expect(components(enOnboarding).description).toMatch(/this machine/i);
    expect(components(idOnboarding).description).toMatch(/mesin ini/i);
  });
});
