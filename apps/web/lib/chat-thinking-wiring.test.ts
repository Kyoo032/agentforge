import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Thinking level Chat posts, pinned against the sources.
 *
 * The pane and the composer are JSX with hooks and this package's vitest run is node-only, so the wiring
 * is pinned as text (the way `chat-run-scope-wiring.test.ts` pins the session key). The behaviour under
 * it is `chat-thinking.test.ts`. The rule: the picker shows Normal from the start, but the request
 * carries a level only once the person has picked one, so the host can tell "chosen" from "defaulted".
 */
const web = join(dirname(fileURLToPath(import.meta.url)), "..");

function source(relative: string): string {
  return readFileSync(join(web, relative), "utf8").replace(/\r\n/g, "\n");
}

const composer = source("components/chat-composer.tsx");
const session = source("components/chat-session.tsx");

describe("the composer's run requests", () => {
  it("builds the Thinking fields through one helper at both send sites", () => {
    expect(composer.match(/\.\.\.thinkingRequestFields\(reasoningEffort, reasoningEffortChosen\)/g)).toHaveLength(2);
  });

  it("no longer posts the picker's level unconditionally", () => {
    expect(composer).not.toMatch(/thinking: reasoningEffort !== "none",\s*\n\s*reasoningEffort,/);
    expect(composer).not.toMatch(/^\s*reasoningEffort,\s*$/m);
  });

  it("treats a parent that does not say as chosen, so a picker nobody wired up still sends its level", () => {
    expect(composer).toContain("reasoningEffortChosen = true,");
  });

  it("still draws the picker from the level it was given", () => {
    expect(composer).toContain("value={reasoningEffort}");
  });
});

describe("the chat pane", () => {
  it("starts with the level not chosen and shows Normal", () => {
    expect(session).toContain("useState<ReasoningEffort>(DEFAULT_THINKING_PREF.effort)");
    expect(session).toContain("useState(DEFAULT_THINKING_PREF.chosen)");
  });

  it("marks the level chosen when the person picks one, and when a stored pick is restored", () => {
    const pick = session.slice(session.indexOf("function setReasoningPref("));
    expect(pick.slice(0, pick.indexOf("\n  }\n"))).toContain("setReasoningChosen(true);");
    expect(session).toContain("readStoredThinkingPref(storage)");
    expect(session).toContain("setReasoningChosen(stored.chosen);");
  });

  it("hands the flag to the composer", () => {
    expect(session).toContain("reasoningEffortChosen={reasoningChosen}");
  });
});
