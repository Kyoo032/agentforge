/**
 * A failed Enhance says so.
 *
 * The button used to swallow every failure that was not a cancel: the prompt stayed as it was and
 * nothing on screen or in the accessibility tree said the enhance had not happened. Now a failure
 * turns the button into an error state (short label, the full reason as its tip) and writes the
 * reason into a live region that is mounted from the first render, so assistive tech announces it.
 * The environment has no DOM: the reason is tested as a function, the live region in the markup.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { EnhancePromptButton, enhanceFailureMessage } from "@/components/enhance-prompt-button";
import { applyLocale, resetLocaleForTests, t } from "./i18n";

beforeAll(() => {
  resetLocaleForTests();
  applyLocale("en");
});

describe("enhanceFailureMessage", () => {
  it("names the host's reason when it gave one", () => {
    expect(enhanceFailureMessage({ error: { message: "The gateway is unavailable right now" } })).toBe(
      t("common.enhance.failedReason", { reason: "The gateway is unavailable right now" }),
    );
  });

  it("says the prompt is unchanged when there is no reason to give", () => {
    expect(enhanceFailureMessage(null)).toBe(t("common.enhance.failed"));
    expect(enhanceFailureMessage({ error: { message: "   " } })).toBe(t("common.enhance.failed"));
    expect(enhanceFailureMessage("<html>502</html>")).toBe(t("common.enhance.failed"));
    expect(t("common.enhance.failed")).not.toBe("common.enhance.failed");
  });
});

describe("the Enhance button's live region", () => {
  it("is in the markup from the first render, empty, so a later error is announced", () => {
    const html = renderToStaticMarkup(
      <EnhancePromptButton text="Write a memo" surface="documents" testId="documents-enhance" onApply={() => {}} />,
    );
    expect(html).toMatch(/<span[^>]*role="alert"[^>]*data-testid="documents-enhance-error"[^>]*><\/span>/);
    expect(html).toContain('data-testid="documents-enhance"');
  });
});

describe("the Enhance button wiring", () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../components/enhance-prompt-button.tsx"),
    "utf8",
  ).replace(/\r\n/g, "\n");

  it("reports a failed request and a thrown one, and still ignores a cancel", () => {
    expect(source).toContain("setFailure({ text, message: enhanceFailureMessage(data) });");
    expect(source).toContain('setFailure({ text, message: t("common.enhance.failed") });');
    expect(source).toMatch(
      /abort\.signal\.aborted \|\| \(error instanceof DOMException && error\.name === "AbortError"\)\) \{\s*return;/,
    );
  });

  it("clears the error when the person edits the prompt or tries again", () => {
    // Derived, not reset in an effect: the failure belongs to the prompt text it was for.
    expect(source).toContain(
      "const error = failure !== null && failure.text === text && !busy ? failure.message : null;",
    );
    expect(source).toContain("setFailure(null);\n    const abort = new AbortController();");
  });
});
