import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyJobThinking, type AgentRuntime, type TenantContext } from "@agentforge/core";
import { resetJobModelCircuit } from "./job-model-fallback";
import { withRunContext } from "./run-context";
import {
  appendRegenInstruction,
  collectJobAssistantRun,
  collectJobAssistantText,
  readJobRegenAttachments,
  readModelPinned,
  readOptionalInstruction,
} from "./job-regen";

type ExecuteInput = Parameters<AgentRuntime["execute"]>[0];

const executed: ExecuteInput[] = [];
/** Models the fake gateway cannot reach, with the sentence the live gateway returned on 2026-09-17. */
const unreachable = new Set<string>();
/** Models whose call stays in flight until the run's signal fires, as a slow gateway's would. */
const inFlight = new Set<string>();
/** What each in-flight call saw on its signal when it woke. */
const observedAborted: boolean[] = [];

vi.mock("@agentforge/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agentforge/core")>();
  return {
    ...actual,
    createRuntime: (): AgentRuntime => ({
      async execute(input) {
        executed.push(input);
        const model = input.version.model;
        if (inFlight.has(model)) {
          // Like the real runtime: the call ends when the caller's signal fires, with its reason.
          await new Promise<void>((resolve) =>
            input.signal?.addEventListener("abort", () => resolve(), { once: true }),
          );
          observedAborted.push(input.signal?.aborted === true);
          throw input.signal?.reason;
        }
        if (unreachable.has(model)) {
          await input.onEvent({
            type: "run.failed",
            message: `Could not reach ${model} after 3 tries. The gateway is unavailable right now (status_code=503)`,
          } as Parameters<typeof input.onEvent>[0]);
          return;
        }
        await input.onEvent({ type: "assistant.delta", text: "hello" });
      },
    }),
  };
});

vi.mock("./settings-store", () => ({ loadSettings: () => ({}), loadOwnerLocale: () => "en" }));

const tenant: TenantContext = { tenantId: "local-tenant", organizationId: "org", workspaceId: "ws-1", userId: "local", role: "owner" };

describe("collectJobAssistantText", () => {
  beforeEach(() => {
    executed.length = 0;
  });

  const base = {
    tenant,
    model: "deepseek-v4-flash",
    systemPrompt: "system",
    runPrefix: "market",
    agentId: "market",
    versionId: "market-briefing",
    prompt: "draft",
  };

  it("forwards a per-run streamWatchdog override into the runtime run input", async () => {
    const text = await collectJobAssistantText({ ...base, streamWatchdog: { ttfbMs: 180_000, idleMs: 150_000 } });
    expect(text).toBe("hello");
    expect(executed).toHaveLength(1);
    expect(executed[0]?.streamWatchdog).toEqual({ ttfbMs: 180_000, idleMs: 150_000 });
    expect(executed[0]?.version.model).toBe("deepseek-v4-flash");
  });

  it("leaves streamWatchdog unset so the model defaults apply when no override is given", async () => {
    await collectJobAssistantText(base);
    expect(executed[0]?.streamWatchdog).toBeUndefined();
  });

  it("forwards the studio mode so an always-thinking model is told not to think", async () => {
    await collectJobAssistantText({ ...base, jobMode: "finance" });
    expect(executed[0]?.jobMode).toBe("finance");
    expect(applyJobThinking({ model: base.model }, base.model, executed[0]?.jobMode)).toEqual({
      model: base.model,
      reasoning_effort: "low",
    });
  });

  it("leaves jobMode unset for a caller that is not a studio", async () => {
    await collectJobAssistantText(base);
    expect(executed[0]?.jobMode).toBeUndefined();
  });

  it("runs in the locale of the run context so job timeouts are not English on an id desk", async () => {
    await withRunContext({ threadId: "t1", agentId: "finance", locale: "id" }, () =>
      collectJobAssistantText(base),
    );
    expect(executed[0]?.locale).toBe("id");
    await collectJobAssistantText(base);
    expect(executed[1]?.locale).toBe("en");
  });
});

describe("readModelPinned", () => {
  it("is true only for the flag the picker sets, next to the model it pins", () => {
    expect(readModelPinned({ model: "gpt-5.6-sol", modelPinned: true })).toBe(true);
    expect(readModelPinned({ model: "gpt-5.6-sol" })).toBe(false);
    expect(readModelPinned({ model: "gpt-5.6-sol", modelPinned: false })).toBe(false);
  });

  it("refuses a truthy stand-in, so a stray string can never pin a model", () => {
    expect(readModelPinned({ model: "gpt-5.6-sol", modelPinned: "true" })).toBe(false);
    expect(readModelPinned({ model: "gpt-5.6-sol", modelPinned: 1 })).toBe(false);
    expect(readModelPinned(null)).toBe(false);
    expect(readModelPinned(undefined)).toBe(false);
    expect(readModelPinned("modelPinned")).toBe(false);
  });

  it("never pins a request that names no model: the host default was nobody's choice", () => {
    expect(readModelPinned({ modelPinned: true })).toBe(false);
    expect(readModelPinned({ model: "", modelPinned: true })).toBe(false);
    expect(readModelPinned({ model: "   ", modelPinned: true })).toBe(false);
    expect(readModelPinned({ model: 7, modelPinned: true })).toBe(false);
  });
});

describe("collectJobAssistantRun with the job model fallback", () => {
  const AVAILABLE = ["deepseek-v4-flash", "gpt-5.6-luna", "gpt-5.6-terra"];
  const run = {
    tenant,
    model: "deepseek-v4-flash",
    systemPrompt: "system",
    runPrefix: "document",
    agentId: "document",
    versionId: "document-draft",
    jobMode: "documents" as const,
    prompt: "draft",
    availableModelIds: AVAILABLE,
  };

  beforeEach(() => {
    executed.length = 0;
    unreachable.clear();
    resetJobModelCircuit();
  });

  it("answers on a stand-in when the requested default is down, and says which model answered", async () => {
    unreachable.add("deepseek-v4-flash");
    const result = await collectJobAssistantRun(run);
    expect(result.text).toBe("hello");
    expect(result.model).not.toBe("deepseek-v4-flash");
    expect(AVAILABLE).toContain(result.model);
    expect(result.notice).toEqual({ code: "model_fallback", from: "deepseek-v4-flash", to: result.model });
    expect(executed.map((input) => input.version.model)).toEqual(["deepseek-v4-flash", result.model]);
  });

  it("returns the gateway's error instead of swapping a model the person pinned", async () => {
    unreachable.add("deepseek-v4-flash");
    await expect(collectJobAssistantRun({ ...run, modelExplicit: true })).rejects.toThrow(/status_code=503/);
    expect(executed.map((input) => input.version.model)).toEqual(["deepseek-v4-flash"]);
  });

  it("collectJobAssistantText hides the model that answered, which is why recording callers use the run", async () => {
    unreachable.add("deepseek-v4-flash");
    await expect(collectJobAssistantText(run)).resolves.toBe("hello");
    expect(executed).toHaveLength(2);
  });
});

/**
 * A cancelled job must stop paying. The signal reaches the runtime, which aborts the request in
 * flight; and a cancel is the caller's answer, never a model failure the fallback would retry
 * somewhere else or the circuit would remember.
 */
describe("collectJobAssistantRun and the job's signal", () => {
  const AVAILABLE = ["deepseek-v4-flash", "gpt-5.6-luna", "gpt-5.6-terra"];
  const run = {
    tenant,
    model: "deepseek-v4-flash",
    systemPrompt: "system",
    runPrefix: "market",
    agentId: "market",
    versionId: "market-briefing",
    jobMode: "market" as const,
    prompt: "draft",
    availableModelIds: AVAILABLE,
  };

  beforeEach(() => {
    executed.length = 0;
    observedAborted.length = 0;
    unreachable.clear();
    inFlight.clear();
    resetJobModelCircuit();
  });

  it("hands the signal to the runtime run input", async () => {
    const controller = new AbortController();
    await collectJobAssistantRun({ ...run, signal: controller.signal });
    expect(executed[0]?.signal).toBe(controller.signal);
  });

  it("leaves the run input without a signal when the caller has none", async () => {
    await collectJobAssistantRun(run);
    expect(executed[0]).not.toHaveProperty("signal");
  });

  it("rejects promptly when the caller leaves mid-call, and the runtime sees the abort", async () => {
    inFlight.add("deepseek-v4-flash");
    const controller = new AbortController();
    const pending = collectJobAssistantRun({ ...run, signal: controller.signal });
    await vi.waitFor(() => expect(executed).toHaveLength(1));

    controller.abort(new Error("client left"));
    const outcome = await Promise.race([
      pending.then(
        () => "resolved",
        (error: unknown) => error,
      ),
      new Promise((resolve) => setTimeout(() => resolve("still running"), 1_000)),
    ]);

    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toBe("client left");
    expect(observedAborted).toEqual([true]);
    // No stand-in was started for a cancel.
    expect(executed.map((input) => input.version.model)).toEqual(["deepseek-v4-flash"]);

    // And the model was not marked down: the next job starts on it again.
    inFlight.clear();
    await expect(collectJobAssistantRun(run)).resolves.toMatchObject({ model: "deepseek-v4-flash" });
    expect(executed[1]?.version.model).toBe("deepseek-v4-flash");
  });

  it("starts no call once the caller has already left", async () => {
    const controller = new AbortController();
    controller.abort(new Error("client left"));
    await expect(collectJobAssistantRun({ ...run, signal: controller.signal })).rejects.toThrow("client left");
    expect(executed).toEqual([]);
  });

  it("starts no stand-in when the caller leaves after the first model failed", async () => {
    unreachable.add("deepseek-v4-flash");
    const controller = new AbortController();
    const pending = collectJobAssistantRun({
      ...run,
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "run.failed") {
          controller.abort(new Error("client left"));
        }
      },
    });
    await expect(pending).rejects.toThrow("client left");
    expect(executed.map((input) => input.version.model)).toEqual(["deepseek-v4-flash"]);
  });
});

describe("readOptionalInstruction", () => {
  it("trims a string instruction and ignores missing values", () => {
    expect(readOptionalInstruction({ instruction: "  shorter  " })).toBe("shorter");
    expect(readOptionalInstruction({ instruction: "" })).toBe("");
    expect(readOptionalInstruction({ prompt: "topic" })).toBe("");
    expect(readOptionalInstruction(null)).toBe("");
  });
});

describe("appendRegenInstruction", () => {
  it("appends only when the user typed guidance", () => {
    expect(appendRegenInstruction("Rewrite this section.", "")).toBe("Rewrite this section.");
    expect(appendRegenInstruction("Rewrite this section.", "Make it punchier")).toBe(
      "Rewrite this section.\n\nUser instruction:\nMake it punchier",
    );
  });
});

describe("readJobRegenAttachments", () => {
  it("returns an empty list when omitted", () => {
    expect(readJobRegenAttachments({})).toEqual([]);
    expect(readJobRegenAttachments({ attachments: null })).toEqual([]);
  });

  it("accepts image_url parts with local media or https urls", () => {
    expect(
      readJobRegenAttachments({
        attachments: [
          { type: "image_url", image_url: { url: "/api/v1/media/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/file" } },
          { type: "image_url", image_url: { url: "https://cdn.example/slide.png", detail: "low" } },
        ],
      }),
    ).toEqual([
      {
        type: "image_url",
        image_url: { url: "/api/v1/media/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/file", detail: "high" },
      },
      { type: "image_url", image_url: { url: "https://cdn.example/slide.png", detail: "low" } },
    ]);
  });

  it("rejects non-arrays and non-image parts", () => {
    expect(() => readJobRegenAttachments({ attachments: "nope" })).toThrow(/attachments must be an array/);
    expect(() =>
      readJobRegenAttachments({
        attachments: [{ type: "video_url", video_url: { url: "https://cdn.example/a.mp4" } }],
      }),
    ).toThrow(/image_url/);
  });
});
