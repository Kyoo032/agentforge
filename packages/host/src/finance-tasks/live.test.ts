import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readModelPinned as sharedReadModelPinned } from "../job-regen";
import { readModelPinned, readOptionalModel } from "./live";
import { runnerLocale } from "./runner";

const here = dirname(fileURLToPath(import.meta.url));

describe("readModelPinned", () => {
  it("is true only for the flag the picker sets", () => {
    expect(readModelPinned({ model: "gpt-5.6-sol", modelPinned: true })).toBe(true);
    expect(readModelPinned({ model: "gpt-5.6-sol" })).toBe(false);
    expect(readModelPinned({ model: "gpt-5.6-sol", modelPinned: false })).toBe(false);
  });

  it("refuses a truthy stand-in, so a stray string can never pin a model", () => {
    expect(readModelPinned({ modelPinned: "true" })).toBe(false);
    expect(readModelPinned({ modelPinned: 1 })).toBe(false);
    expect(readModelPinned(null)).toBe(false);
    expect(readModelPinned(undefined)).toBe(false);
    expect(readModelPinned("modelPinned")).toBe(false);
  });

  it("is independent of the model id, which every request carries", () => {
    // This is the whole point: the id alone cannot tell a pick from the studio's seeded default.
    expect(readOptionalModel({ model: "gpt-5.6-sol" })).toBe("gpt-5.6-sol");
    expect(readModelPinned({ model: "gpt-5.6-sol" })).toBe(false);
  });

  // A pin that names no model leaves the host default in charge, and that default was nobody's pick,
  // so it must not stop the job from being rescued onto a second model.
  it("is no pin without a model to hold the host to", () => {
    expect(readModelPinned({ modelPinned: true })).toBe(false);
    expect(readModelPinned({ model: "", modelPinned: true })).toBe(false);
    expect(readModelPinned({ model: "   ", modelPinned: true })).toBe(false);
    expect(readModelPinned({ model: 7, modelPinned: true })).toBe(false);
  });

  it("is the one reader every job shares, not a Finance copy of it", () => {
    expect(readModelPinned).toBe(sharedReadModelPinned);
  });
});

describe("runnerLocale", () => {
  it("answers in the language the request asked for", () => {
    expect(runnerLocale({ locale: "id" })).toBe("id");
    expect(runnerLocale({ locale: "en" })).toBe("en");
  });

  it("falls back to the run's own locale rather than to English", () => {
    // A typo in a request must never silently switch the owner's language.
    const fallback = runnerLocale({});
    expect(["en", "id"]).toContain(fallback);
    expect(runnerLocale({ locale: "fr" })).toBe(fallback);
    expect(runnerLocale({ locale: 7 })).toBe(fallback);
    expect(runnerLocale(null)).toBe(fallback);
  });

  it("is the one value the whole run reads: prompt, narration and report", () => {
    const runner = readFileSync(resolve(here, "runner.ts"), "utf8");
    expect(runner).toContain("const locale: ReportLocale = runnerLocale(body);");
    // The boot locale is no longer consulted: it answered in English for an Indonesian request.
    expect(runner).not.toContain("localeForRun()");
    expect(runner).toContain("module.buildReport(computed, prose, { locale, guard })");
    // The same value reaches the system prompt and the facts through the narrate options.
    expect(/narrate\(module, computed, \{[\s\S]*?locale,/.test(runner)).toBe(true);
  });
});

describe("the task runner passes the pin on to the job call", () => {
  it("reads it from the request body and hands it over as modelExplicit", () => {
    // The runner reaches the gateway, so the wiring is pinned by reading it rather than running it.
    const runner = readFileSync(resolve(here, "runner.ts"), "utf8");
    expect(runner).toContain('import { readModelPinned, readPrompt, requireLive, resolveModel } from "./live"');
    expect(runner).toContain("modelExplicit: readModelPinned(body)");
    expect(runner).toContain("modelExplicit: options.modelExplicit");
  });
});
