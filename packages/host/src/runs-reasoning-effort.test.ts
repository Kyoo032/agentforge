import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntime } from "@agentforge/core";
import { ROUTER_IMPORT_BUDGET_MS } from "./__fixtures__/test-budgets";
import type { HostRequest, HostResult } from "./types";

/**
 * What Chat tells the runtime about the Thinking level: the level, and whether the person chose it.
 * The runtime sends a model the policy table does not know no effort at all unless it was chosen, so
 * the host must not turn "the body said nothing" into "the person picked medium".
 */

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-runs-effort-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.AGENTFORGE_RUNTIME = "stub";
process.env.AGENTFORGE_SECRETS_KEY = "c".repeat(64);
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.OPENAI_API_KEY;

type ExecuteInput = Parameters<AgentRuntime["execute"]>[0];
const executed: ExecuteInput[] = [];

vi.mock("@agentforge/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agentforge/core")>();
  return {
    ...actual,
    createRuntime: (): AgentRuntime => ({
      async execute(input) {
        executed.push(input);
        await input.onEvent({ type: "assistant.delta", text: "hello" });
        await input.onEvent({ type: "run.completed", runId: input.runId });
      },
    }),
  };
});

let dispatch: (request: HostRequest) => Promise<HostResult>;
let threadId = "";

function request(method: string, path: string, extra: Partial<HostRequest> = {}): HostRequest {
  return { method, path, query: {}, params: {}, headers: {}, ...extra };
}

async function postRun(body: Record<string, unknown>): Promise<void> {
  const result = await dispatch(
    request("POST", `/api/v1/threads/${threadId}/runs/text`, { params: { threadId }, body }),
  );
  if (result.type !== "stream") {
    throw new Error(`expected a stream, got ${result.type}: ${JSON.stringify((result as { body?: unknown }).body)}`);
  }
  for await (const _frame of result.events) {
    // Drain the stream: the run only finishes once its frames have been read.
  }
}

async function json<T>(method: string, path: string, body?: unknown): Promise<T> {
  const result = await dispatch(request(method, path, { body }));
  if (result.type !== "json") {
    throw new Error(`expected json, got ${result.type}`);
  }
  return (result.body ?? {}) as T;
}

beforeAll(async () => {
  ({ dispatch } = await import("./router"));
  // The first visit creates the local owner and the default chat agent, like opening Chat does.
  const chat = await json<{ agent: { id: string } }>("GET", "/api/v1/chat");
  const created = await json<{ thread: { id: string } }>("POST", "/api/v1/threads", { agentId: chat.agent.id });
  threadId = created.thread.id;
}, ROUTER_IMPORT_BUDGET_MS);

beforeEach(() => {
  executed.length = 0;
});

afterAll(async () => {
  const { sql } = await import("@agentforge/db");
  sql.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("POST /threads/:id/runs/text and the Thinking level", () => {
  it("says the level was defaulted when the body names none", async () => {
    await postRun({ content: "hello" });
    expect(executed).toHaveLength(1);
    expect(executed[0]?.reasoningEffort).toBe("medium");
    expect(executed[0]?.reasoningEffortExplicit).toBe(false);
    expect(executed[0]?.thinking).toBe(true);
  });

  it("says the level was defaulted for the request Chat sends until the person picks a level", async () => {
    // What `apps/web/lib/chat-thinking.ts` posts while Thinking is untouched: the model and the text, no
    // level. A model the policy table does not know must then be sent no effort at all.
    const catalog = await json<{ models: Array<{ id: string }> }>("GET", "/api/v1/models");
    const model = catalog.models[0]?.id;
    expect(model).toBeTruthy();
    await postRun({ content: "hello", model });
    expect(executed).toHaveLength(1);
    expect(executed[0]?.reasoningEffort).toBe("medium");
    expect(executed[0]?.reasoningEffortExplicit).toBe(false);
    expect(executed[0]?.thinking).toBe(true);
  });

  it("does not read a bare thinking: true as a choice: only a level, or Off, is one", async () => {
    await postRun({ content: "hello", thinking: true });
    expect(executed[0]?.reasoningEffort).toBe("medium");
    expect(executed[0]?.reasoningEffortExplicit).toBe(false);
  });

  it("says the person chose it when the body carries a level", async () => {
    await postRun({ content: "hello", thinking: true, reasoningEffort: "xhigh" });
    expect(executed[0]?.reasoningEffort).toBe("xhigh");
    expect(executed[0]?.reasoningEffortExplicit).toBe(true);
  });

  it("counts a UI word as a choice, and the default level sent by the picker as one too", async () => {
    await postRun({ content: "hello", reasoningEffort: "deep" });
    expect(executed[0]?.reasoningEffort).toBe("high");
    expect(executed[0]?.reasoningEffortExplicit).toBe(true);
    await postRun({ content: "hello", reasoningEffort: "medium" });
    expect(executed[1]?.reasoningEffortExplicit).toBe(true);
  });

  it("counts Off as a choice", async () => {
    await postRun({ content: "hello", thinking: false });
    expect(executed[0]?.reasoningEffort).toBe("none");
    expect(executed[0]?.reasoningEffortExplicit).toBe(true);
    expect(executed[0]?.thinking).toBe(false);
  });
});
