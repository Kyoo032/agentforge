/**
 * Settings load, save and language change, and what each shows when the host does not answer.
 *
 * Before: Save awaited `res.json()` with no try/finally and no `res.ok` check, so a dropped request
 * left the button disabled for good and a non-JSON 500 was cleared as "Saved"; the language select
 * switched before the save and stayed on the new language when the save failed; the first load had
 * no error path at all. Every call now goes through `readSettingsAnswer`, which never throws and
 * turns any failure into a sentence from the catalog (or the host's own message when it sent one).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { readSettingsAnswer } from "@/components/settings-page";
import { applyLocale, resetLocaleForTests, t } from "./i18n";

const here = dirname(fileURLToPath(import.meta.url));

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeAll(() => {
  resetLocaleForTests();
  applyLocale("en");
});

describe("readSettingsAnswer", () => {
  it("hands back the settings payload on success", async () => {
    const answer = await readSettingsAnswer(
      async () => json(200, { hasOpenai: true, locale: "id" }),
      "settings.saveFailed",
    );
    expect(answer).toEqual({ kind: "ok", payload: { hasOpenai: true, locale: "id" } });
  });

  it("turns a request that never came back into the catalog sentence, instead of throwing", async () => {
    const answer = await readSettingsAnswer(async () => {
      throw new TypeError("Failed to fetch");
    }, "settings.saveFailed");
    expect(answer).toEqual({ kind: "failed", message: t("settings.saveFailed") });
    expect(t("settings.saveFailed")).not.toBe("settings.saveFailed");
  });

  it("never reports a non-JSON server error as saved", async () => {
    const answer = await readSettingsAnswer(
      async () => new Response("<html>502 Bad Gateway</html>", { status: 502 }),
      "settings.saveFailed",
    );
    expect(answer).toEqual({ kind: "failed", message: t("settings.saveFailed") });
  });

  it("shows the host's own message when it sent one", async () => {
    const answer = await readSettingsAnswer(
      async () => json(400, { error: { code: "invalid_request", message: "editTurnCapUsd must be a number" } }),
      "settings.saveFailed",
    );
    expect(answer).toEqual({ kind: "failed", message: "editTurnCapUsd must be a number" });
  });

  it("treats an error body as a failure even on a 2xx", async () => {
    const answer = await readSettingsAnswer(
      async () => json(200, { error: { message: "Could not save" } }),
      "settings.saveFailed",
    );
    expect(answer).toEqual({ kind: "failed", message: "Could not save" });
  });

  it("refuses a body that is not a settings object", async () => {
    expect(await readSettingsAnswer(async () => json(200, null), "settings.loadFailed")).toEqual({
      kind: "failed",
      message: t("settings.loadFailed"),
    });
    expect(await readSettingsAnswer(async () => json(200, "ok"), "settings.loadFailed")).toEqual({
      kind: "failed",
      message: t("settings.loadFailed"),
    });
  });

  it("passes a closed gateway gate on as its own answer, so the desk can name the reason", async () => {
    const answer = await readSettingsAnswer(
      async () => json(403, { error: "gateway_blocked", status: "invalid_key", message: "Key rejected" }),
      "settings.saveFailed",
    );
    expect(answer).toEqual({ kind: "blocked", status: "invalid_key" });
  });
});

describe("settings error copy", () => {
  const load = (locale: "en" | "id") =>
    JSON.parse(readFileSync(resolve(here, "../locales", locale, "settings.json"), "utf8")) as Record<string, string>;

  it("ships the load, save and language failures in both locales", () => {
    for (const locale of ["en", "id"] as const) {
      const catalog = load(locale);
      for (const key of ["loadFailed", "saveFailed", "localeFailed"]) {
        expect(typeof catalog[key], `${locale}/${key}`).toBe("string");
        expect(catalog[key]?.trim(), `${locale}/${key}`).not.toBe("");
      }
    }
    expect(load("id").saveFailed).not.toBe(load("en").saveFailed);
  });
});

describe("the Settings page wiring", () => {
  // The checkout may be CRLF; the function-body cut below looks for the LF form of a closing brace.
  const page = readFileSync(resolve(here, "../components/settings-page.tsx"), "utf8").replace(/\r\n/g, "\n");

  /** One component function, from its signature to its closing brace at two-space indent. */
  function body(fn: string): string {
    const start = page.indexOf(fn);
    expect(start, `${fn} not found`).toBeGreaterThan(-1);
    const end = page.indexOf("\n  }\n", start);
    expect(end, `${fn} has no closing brace`).toBeGreaterThan(start);
    return page.slice(start, end);
  }

  it("always re-enables Save, whatever the request did", () => {
    const submit = body("async function onSubmit(");
    expect(submit).toContain("readSettingsAnswer(");
    expect(submit).toMatch(/\} finally \{\s*setBusy\(false\);/);
  });

  it("puts the language back when the save did not land", () => {
    const change = body("async function onLocaleChange(");
    expect(change).toContain("const previous = savedLocale;");
    expect(change).toContain("setSavedLocale(previous);");
    expect(change).toContain("setLocaleError(");
  });

  it("reports a failed first load instead of showing an empty form as if it were real", () => {
    expect(page).toContain('readSettingsAnswer(() => apiFetch("/api/v1/settings"), "settings.loadFailed")');
    expect(page).toContain('data-testid="settings-load-error"');
  });

  it("announces every settings error", () => {
    for (const testId of ["settings-load-error", "settings-error", "settings-locale-error"]) {
      const at = page.indexOf(`data-testid="${testId}"`);
      expect(at, testId).toBeGreaterThan(-1);
      expect(page.slice(Math.max(0, at - 200), at), testId).toContain('role="alert"');
    }
  });
});
