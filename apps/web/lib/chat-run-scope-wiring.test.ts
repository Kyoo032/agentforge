import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Which session a Chat run belongs to, pinned against the sources.
 *
 * The pane and the composer are JSX with hooks and this package's vitest run is node-only, so the
 * gate is pinned here as text, the way `rail-threads-wiring.test.ts` pins the rail. What runs under
 * it — a stream read to the end but no longer drawn — is driven in `chat-run-stream.test.ts`.
 *
 * The rule: a run belongs to the session that was on screen when Send was pressed. Once the owner
 * opens another one, the run keeps streaming to the host (which saves the reply) but draws nothing
 * in the pane, never adopts a thread the owner has left, and no longer holds Send.
 */
const web = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Line endings are Biome's business, not this test's: every source is read with LF. */
function source(relative: string): string {
  return readFileSync(join(web, relative), "utf8").replace(/\r\n/g, "\n");
}

const chatSession = source("components/chat-session.tsx");
const composer = source("components/chat-composer.tsx");

describe("chat pane", () => {
  it("moves to a new session key the moment the owner opens another session", () => {
    const start = chatSession.indexOf("if (seenInitialThreadRef.current !== initialThreadId) {");
    const end = chatSession.indexOf("}", start);
    expect(start).toBeGreaterThan(-1);
    expect(chatSession.slice(start, end)).toContain("sessionEpochRef.current += 1;");
  });

  it("hands that key to the composer", () => {
    expect(chatSession).toContain("sessionKey={sessionKey}");
  });

  it("does not adopt a thread that finished being created after the owner moved on", () => {
    expect(chatSession).toContain("const startedIn = sessionEpochRef.current;");
    expect(chatSession).toContain("if (sessionEpochRef.current !== startedIn) {");
  });

  it("draws a finished run only in its own session, and shows the saved reply if the pane came back", () => {
    expect(chatSession).toContain("if (!run.showing) {");
    expect(chatSession).toContain("run.threadId === threadIdRef.current");
  });

  it("does not load one thread's messages into a pane that has moved to another", () => {
    const refresh = chatSession.slice(chatSession.indexOf("async function refreshMessages("));
    expect(refresh).toContain("if (sessionEpochRef.current === key && threadIdRef.current === id) {");
  });
});

describe("chat composer", () => {
  it("remembers the session each run started in", () => {
    expect(composer).toContain("const startedIn = sessionRef.current;");
    expect(composer).toContain("const showing = () => sessionRef.current === startedIn;");
  });

  it("starts no run for a session the owner has already left", () => {
    // Before and after the thread is resolved, on both the text and the media route: until the run
    // reaches the host nothing has been sent, so it is dropped and the draft stays in the box.
    const guard = "return; // Moved on before the run reached the host: nothing was sent, the draft stays.";
    expect(composer.split(guard).length - 1).toBe(4);
    // Anchored on each route's request body, which only its own POST carries.
    const beforeText = composer.indexOf("content: outgoing,");
    const beforeMedia = composer.indexOf("content: parts,");
    expect(beforeText).toBeGreaterThan(-1);
    expect(beforeMedia).toBeGreaterThan(-1);
    expect(composer.lastIndexOf(guard, beforeText)).toBeGreaterThan(composer.lastIndexOf("await onEnsureThread()", beforeText));
    expect(composer.lastIndexOf(guard, beforeMedia)).toBeGreaterThan(
      composer.lastIndexOf("await onEnsureThread()", beforeMedia),
    );
  });

  it("frees Send when the pane shows another session", () => {
    expect(composer).toMatch(/if \(shownSession !== sessionKey\) \{[^}]*setBusy\(false\);/);
  });

  it("reads the run through the gated reader and never cancels it", () => {
    expect(composer).toContain("await readRunStream(response.body, live, { onActivity: () => dog.touch(), showing });");
    expect(composer).not.toContain(".cancel(");
  });

  it("leaves Send to whichever run now holds it", () => {
    expect(composer).toMatch(/finally \{\s*if \(showing\(\)\) \{\s*setBusy\(false\);/);
  });

  it("clears only the draft it sent, not one typed since", () => {
    expect(composer).toContain('setText((current) => (current === typed ? "" : current));');
  });
});
