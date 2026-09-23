import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The rail session block is JSX, and this package's vitest run is node-only (no jsdom),
 * so the contract is pinned against the sources: which testids exist, where they live,
 * and that the rail is the only session list left in the product.
 */
const web = join(dirname(fileURLToPath(import.meta.url)), "..");

function source(relative: string): string {
  return readFileSync(join(web, relative), "utf8");
}

const railBlock = source("components/rail-recent-threads.tsx");
const appRail = source("components/app-rail.tsx");
const chatPage = source("src/pages/chat-page.tsx");
const chatSession = source("components/chat-session.tsx");
const threadsHook = source("lib/use-chat-threads.ts");

describe("rail session block", () => {
  it("keeps the testids the harness drives", () => {
    for (const testId of ["rail-thread-list", "new-chat-link", "thread-item", "thread-delete", "threads-see-all"]) {
      expect(railBlock).toContain(`data-testid="${testId}"`);
    }
  });

  it("is the only session list: nothing routes to the retired column", () => {
    expect(existsSync(join(web, "components/chat-thread-list.tsx"))).toBe(false);
    for (const file of [railBlock, chatPage, appRail]) {
      expect(file).not.toContain("threads=all");
      expect(file).not.toContain("ChatThreadList");
      expect(file).not.toContain('data-testid="thread-list"');
    }
  });

  it("expands in place instead of linking away", () => {
    expect(railBlock).toContain('data-testid="threads-see-all"');
    expect(railBlock).toContain("aria-expanded={expanded}");
    expect(railBlock).toContain("setExpanded((open) => !open)");
    expect(railBlock).toContain('t("rail.showFewerSessions")');
    expect(railBlock).toContain('t("rail.seeAllSessions")');
    expect(railBlock).toContain("const shown = expanded ? threads : takeRecentThreads(threads, RAIL_RECENT_THREADS)");
  });

  it("caps the collapsed list with the shared constant instead of a literal", () => {
    expect(railBlock).toContain("RAIL_RECENT_THREADS");
    expect(railBlock).toContain("takeRecentThreads");
  });

  it("labels the group for assistive tech and marks the open row", () => {
    expect(railBlock).toContain('role="group"');
    expect(railBlock).toContain('aria-label={t("rail.recentSessionsAria")}');
    expect(railBlock).toContain('aria-current={active ? "true" : undefined}');
  });

  it("escapes the thread id it puts in the href", () => {
    expect(railBlock).toContain("encodeURIComponent(thread.id)");
  });

  it("leaves a deleted open thread whatever route the rail is on", () => {
    expect(railBlock).toContain("if (removed && openThread === thread.id)");
    expect(railBlock).not.toContain("onChat && activeThread === thread.id");
  });
});

describe("app rail", () => {
  it("renders the sessions under Chat and above the job modes", () => {
    const chatItem = appRail.indexOf("mode-${chatMode.href.slice(1)}");
    const sessions = appRail.indexOf("<RailRecentThreads");
    const jobModes = appRail.indexOf("rail.groupJobs");
    expect(chatItem).toBeGreaterThan(-1);
    expect(sessions).toBeGreaterThan(chatItem);
    expect(jobModes).toBeGreaterThan(sessions);
  });

  it("keeps New chat when the rail is collapsed and hides session rows there", () => {
    expect(appRail).toContain("<RailRecentThreads collapsed={collapsed} />");
    const railBlock = source("components/rail-recent-threads.tsx");
    const collapsedAt = railBlock.indexOf("if (collapsed)");
    const expandedAt = railBlock.indexOf('data-testid="rail-thread-list"');
    expect(collapsedAt).toBeGreaterThan(-1);
    expect(expandedAt).toBeGreaterThan(collapsedAt);
    const collapsedBranch = railBlock.slice(collapsedAt, expandedAt);
    expect(collapsedBranch).toContain('data-testid="new-chat-link"');
    expect(collapsedBranch).not.toContain("thread-item");
  });
});

describe("chat page", () => {
  it("mounts the session pane alone", () => {
    expect(chatPage).toContain("<ChatSession initialThreadId={thread} />");
    expect(chatPage).not.toContain('params.get("threads")');
  });
});

describe("chat session", () => {
  it("empties the pane when the rail leaves a thread for a new chat", () => {
    expect(chatSession).toContain("const lastInitialThreadRef = useRef(initialThreadId)");
    expect(chatSession).toContain(
      "const leftThread = lastInitialThreadRef.current !== undefined && initialThreadId === undefined",
    );
    expect(chatSession).toContain("if (threadIdRef.current && !leftThread) {");
  });

  it("sends into the URL's thread while its GET is still in flight instead of forking", () => {
    // Regression: `/chat?thread=<id>` + send before GET /threads/:id resolved created a second thread.
    expect(chatSession).toContain("const pendingThreadRef = useRef<string | null>(initialThreadId ?? null)");
    expect(chatSession).toContain("const openThread = threadIdRef.current ?? pendingThreadRef.current");
    expect(chatSession).toContain("if (openThread) {");
    // The fallback is the only early exit in ensureThread; the old ref-only guard must not creep back.
    expect(chatSession).not.toContain("return threadIdRef.current;");
  });

  it("drops the URL fallback whenever the pane is emptied or the thread never loaded", () => {
    // Render-time sync: a new (or absent) `?thread=` replaces the fallback.
    expect(chatSession).toContain("if (seenInitialThreadRef.current !== initialThreadId) {");
    expect(chatSession).toContain("pendingThreadRef.current = initialThreadId ?? null;");
    // Header New chat is gone. The reset branch is the remaining clear.
    expect(chatSession.split("pendingThreadRef.current = null;").length - 1).toBe(1);
    expect(chatSession).not.toContain('data-testid="new-chat"');
    // A failed load must not leave a dead id as the send target.
    expect(chatSession).toContain("pendingThreadRef.current = threadIdRef.current;");
  });

  it("keeps the send button ungated so the fallback is what carries the early send", () => {
    const composer = source("components/chat-composer.tsx");
    expect(composer).toContain("const sendDisabled = busy || enhancing || sendEmpty;");
  });
});

describe("chat threads hook", () => {
  it("reloads when the desk changes", () => {
    expect(threadsHook).toContain("const { id: workspaceId } = useWorkspaceScope()");
    expect(threadsHook).toContain("}, [scope, agentId, workspaceId]);");
  });

  it("tells every list about a delete and keeps the last good list on a load failure", () => {
    expect(threadsHook).toContain("notifyThreadsChanged();");
    expect(threadsHook).not.toContain("setThreads([]);");
  });

  it("drops the reload handle nothing called", () => {
    expect(threadsHook).not.toContain("reloadToken");
    expect(threadsHook).not.toContain("reload: () => void");
  });
});
