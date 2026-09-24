import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ROUTER_IMPORT_BUDGET_MS } from "../__fixtures__/test-budgets";
import type { HostRequest, HostResult } from "../types";

// Isolation: database, settings.enc, the gate verdict and workspace-id.txt all live in the data dir.
const dataDir = mkdtempSync(join(tmpdir(), "agentforge-finance-handlers-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.AGENTFORGE_SECRETS_KEY = "d".repeat(64);
delete process.env.AGENTFORGE_RUNTIME;
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.OPENAI_API_KEY;

const KEY = "sk-finance-handler-000000000";
const SELECTED = join(dataDir, "workspace-id.txt");

type Dispatch = (request: HostRequest) => Promise<HostResult>;
let dispatch: Dispatch;

const realFetch = globalThis.fetch;

function request(method: string, path: string, extra: Partial<HostRequest> = {}): HostRequest {
  return { method, path, query: {}, params: {}, headers: {}, ...extra };
}

async function json(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const result = await dispatch(request(method, path, { body }));
  if (result.type !== "json") {
    throw new Error(`expected json, got ${result.type}`);
  }
  return { status: result.status, body: result.body };
}

/** Answers the gateway liveness probe with 200 and every model call with an empty body. */
function stubGateway(): void {
  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
}

/** One OpenAI-shaped chat-completions stream carrying `text`, then `[DONE]`. */
function sseBody(text: string): string {
  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    `data: ${JSON.stringify({
      id: "stub",
      object: "chat.completion.chunk",
      created: 0,
      model: "stub",
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  return `${chunk({ role: "assistant", content: text }, null)}${chunk({}, "stop")}data: [DONE]\n\n`;
}

/** Liveness probe stays plain JSON; the chat call gets a real stream so a job can actually finish. */
function stubGatewayAnswering(text: string): void {
  globalThis.fetch = (async (input: unknown) => {
    const url = String(typeof input === "string" ? input : ((input as { url?: string })?.url ?? input));
    if (url.includes("/chat/completions")) {
      return new Response(sseBody(text), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
}

function errorCode(body: unknown): string {
  return (body as { error?: { code?: string } } | null)?.error?.code ?? "";
}

describe("a key saved in onboarding reaches the job generators", () => {
  beforeAll(async () => {
    ({ dispatch } = await import("../router"));
    stubGateway();
    // Onboarding: the owner pastes the gateway key. This saves it under the tenant's Default desk.
    const saved = await json("POST", "/api/v1/settings", { openaiApiKey: KEY });
    expect(saved.status).toBe(200);
  }, ROUTER_IMPORT_BUDGET_MS);

  afterEach(() => {
    stubGateway();
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    const { sql } = await import("@agentforge/db");
    sql.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("reports a live runtime for the desk the key was saved on", async () => {
    const response = await json("GET", "/api/v1/settings");
    expect(response.status).toBe(200);
    expect((response.body as { runtime?: string }).runtime).toBe("ai");
  });

  it("POST /api/v1/finance does not fall back to the stub runtime", async () => {
    const response = await json("POST", "/api/v1/finance", { prompt: "Q3 margin story" });
    expect(errorCode(response.body)).not.toBe("runtime_stub");
    expect(response.status).not.toBe(503);
  });

  it("POST /api/v1/documents does not fall back to the stub runtime", async () => {
    const response = await json("POST", "/api/v1/documents", { prompt: "One page on Q3" });
    expect(errorCode(response.body)).not.toBe("runtime_stub");
    expect(response.status).not.toBe(503);
  });

  // The negatives above only prove the job got past the runtime gate. This one runs a job to
  // completion on the desk's key, so a change that swaps one failure mode for another is visible.
  it("runs a finance job to a 200 on the key saved for that desk", async () => {
    stubGatewayAnswering(
      JSON.stringify({
        items: [{ label: "Revenue", period: "2025", amount: 1000, currency: "IDR", category: "revenue" }],
      }),
    );
    const response = await json("POST", "/api/v1/finance/parse", { figures: "Revenue 2025: Rp 1.000" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      needsConfirmation: true,
      items: [expect.objectContaining({ label: "Revenue", amount: 1000, currency: "IDR", category: "revenue" })],
    });
  });

  it("wrote the selected desk to disk so a settings read with no desk resolves to it", () => {
    expect(existsSync(SELECTED)).toBe(true);
  });

  // The generators must name the desk themselves, not lean on the file: a stale selection (a desk
  // deleted outside the app, a hand-edited file) would otherwise send every job back to the stub.
  it("stays live even when workspace-id.txt points at a desk that no longer exists", async () => {
    const real = readFileSync(SELECTED, "utf8");
    writeFileSync(SELECTED, "desk-that-no-longer-exists\n", "utf8");
    try {
      const response = await json("POST", "/api/v1/finance", { prompt: "Q3 margin story" });
      expect(errorCode(response.body)).not.toBe("runtime_stub");
      expect(response.status).not.toBe(503);
    } finally {
      writeFileSync(SELECTED, real, "utf8");
    }
  });
});
