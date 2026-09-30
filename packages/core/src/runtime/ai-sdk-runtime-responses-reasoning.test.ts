import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiSdkRuntime } from "./ai-sdk-runtime";
import { resetLearnedEffortLimits } from "./effort-selfheal";
import type { AgentVersionRecord, ToolBindingRecord } from "../agents/service";
import type { JobMode } from "../models/mode-defaults";
import type { ReasoningEffort } from "../models/reasoning-effort";
import type { TenantContext } from "../tenancy/types";
import { z } from "zod";
import { defineTool } from "../tools/define-tool";
import { registerTool, resetToolRegistry } from "../tools/registry";

/**
 * `@ai-sdk/openai` 1.3.24 writes the Responses `reasoning` block only for ids that start with `o` or
 * `gpt-5` (`getResponsesModelConfig`). Every other model that the policy table sends to /responses
 * (GPT-6, and a GPT newer than the table) used to go out with no effort at all, so the level the
 * person chose never reached the gateway. The runtime now adds the block itself when the SDK left it
 * out, in the same shape the SDK writes for gpt-5.x. Nothing leaves the machine: `fetch` is replaced
 * and the request goes through the real AI SDK.
 */

const tenant: TenantContext = {
  tenantId: "local-tenant",
  organizationId: "org",
  workspaceId: "ws",
  userId: "user",
  role: "owner",
};

function versionFor(model: string): AgentVersionRecord {
  return {
    id: `v-${model}`,
    agentId: "chat",
    organizationId: "org",
    version: 1,
    systemPrompt: "You are helpful.",
    model,
    inputModalities: ["text"],
    config: {},
    createdAt: new Date(),
  };
}

type Captured = { url: string; body: Record<string, unknown> };

function json(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message, type: "invalid_request_error" } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const bad401 = () => json(401, "Incorrect API key provided.");

function gateway(replies: Array<(request: Captured) => Response>): Captured[] {
  const seen: Captured[] = [];
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    const request: Captured = { url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> };
    seen.push(request);
    const reply = replies[seen.length - 1] ?? bad401;
    return reply(request);
  });
  return seen;
}

async function firstRequest(options: {
  model: string;
  reasoningEffort?: ReasoningEffort;
  reasoningEffortExplicit?: boolean;
  thinking?: boolean;
  jobMode?: JobMode;
  bindings?: ToolBindingRecord[];
  baseUrl?: string;
}): Promise<Captured> {
  const seen = gateway([bad401]);
  await run(options);
  const first = seen[0];
  if (!first) {
    throw new Error("the runtime sent no request");
  }
  return first;
}

async function run(options: {
  model: string;
  reasoningEffort?: ReasoningEffort;
  reasoningEffortExplicit?: boolean;
  thinking?: boolean;
  jobMode?: JobMode;
  bindings?: ToolBindingRecord[];
  baseUrl?: string;
}): Promise<void> {
  try {
    await new AiSdkRuntime({ openai: "sk-test", openaiBaseUrl: options.baseUrl ?? "https://gateway.test/v1" }).execute({
      tenant,
      runId: "run-responses-reasoning",
      modality: "text",
      version: versionFor(options.model),
      bindings: options.bindings ?? [],
      history: [{ role: "user", parts: [{ type: "text", text: "Say ok." }] }],
      ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
      ...(options.reasoningEffortExplicit === undefined ? {} : { reasoningEffortExplicit: options.reasoningEffortExplicit }),
      ...(options.thinking === undefined ? {} : { thinking: options.thinking }),
      ...(options.jobMode ? { jobMode: options.jobMode } : {}),
      onEvent: () => undefined,
    });
  } catch {
    // The stub gateway answers 401 (or a scripted 400), so the run ends after its requests.
  }
}

beforeEach(() => {
  resetLearnedEffortLimits();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetLearnedEffortLimits();
  resetToolRegistry();
});

const GPT_6_MODELS = ["gpt-6-luna", "gpt-6-sol", "gpt-6-astra"] as const;
/** The GPT-6 models that answer 400 to none, so Off floors to low. Luna and Sol take none. */
const FLOORED_MODELS: readonly string[] = ["gpt-6-astra"];

describe("GPT-6 on Responses carries its Thinking level", () => {
  for (const model of GPT_6_MODELS) {
    describe(model, () => {
      const levels: Array<[ReasoningEffort, ReasoningEffort]> = [
        ["low", "low"],
        ["medium", "medium"],
        ["high", "high"],
        ["xhigh", "xhigh"],
        ["max", "max"],
      ];
      for (const [chosen, sent] of levels) {
        it(`sends reasoning.effort ${sent} when the person chose ${chosen}`, async () => {
          const request = await firstRequest({ model, reasoningEffort: chosen, reasoningEffortExplicit: true });
          expect(request.url).toBe("https://gateway.test/v1/responses");
          expect(request.body.reasoning).toEqual({ effort: sent, summary: "auto" });
        });
      }

      if (FLOORED_MODELS.includes(model)) {
        it("floors Off to low: GPT-6 Astra answers HTTP 400 to none (probe 2026-09-30)", async () => {
          const request = await firstRequest({ model, thinking: false });
          expect(request.body.reasoning).toEqual({ effort: "low", summary: "auto" });
        });

        it("floors Off to low when the level is named none as well", async () => {
          const request = await firstRequest({ model, reasoningEffort: "none", reasoningEffortExplicit: true });
          expect(request.body.reasoning).toEqual({ effort: "low", summary: "auto" });
        });

        it("snaps the ladder's snap-only and top levels to the model's own list", async () => {
          const minimal = await firstRequest({ model, reasoningEffort: "minimal", reasoningEffortExplicit: true });
          expect(minimal.body.reasoning).toEqual({ effort: "low", summary: "auto" });
          const ultra = await firstRequest({ model, reasoningEffort: "ultra", reasoningEffortExplicit: true });
          expect(ultra.body.reasoning).toEqual({ effort: "max", summary: "auto" });
        });
      } else {
        it("sends Off as none, with no summary: Luna and Sol answered 200 to none (probe 2026-09-30)", async () => {
          const request = await firstRequest({ model, thinking: false });
          expect(request.body.reasoning).toEqual({ effort: "none" });
        });

        it("sends none when the level is named none as well", async () => {
          const request = await firstRequest({ model, reasoningEffort: "none", reasoningEffortExplicit: true });
          expect(request.body.reasoning).toEqual({ effort: "none" });
        });

        it("snaps the ladder's snap-only and top levels to the model's own list", async () => {
          const minimal = await firstRequest({ model, reasoningEffort: "minimal", reasoningEffortExplicit: true });
          expect(minimal.body.reasoning).toEqual({ effort: "none" });
          const ultra = await firstRequest({ model, reasoningEffort: "ultra", reasoningEffortExplicit: true });
          expect(ultra.body.reasoning).toEqual({ effort: "max", summary: "auto" });
        });
      }

      it("sends the host's default level (medium) when nothing was chosen, as it does for gpt-5.x", async () => {
        const request = await firstRequest({ model });
        expect(request.body.reasoning).toEqual({ effort: "medium", summary: "auto" });
      });

      it("keeps the same body shape as gpt-5.x: reasoning right after input, before stream and store", async () => {
        const request = await firstRequest({ model, reasoningEffort: "high", reasoningEffortExplicit: true });
        expect(Object.keys(request.body)).toEqual(["model", "input", "reasoning", "stream", "store"]);
      });
    });
  }

  it("does the same for a job harness, which passes no chosen level", async () => {
    const request = await firstRequest({ model: "gpt-6-luna", jobMode: "finance" });
    expect(request.body.reasoning).toEqual({ effort: "medium", summary: "auto" });
  });

  it("keeps the tool definitions next to it", async () => {
    resetToolRegistry();
    registerTool(
      defineTool({
        key: "echo",
        name: "Echo",
        description: "Echo a number.",
        schema: z.object({ x: z.number() }),
        execute: async (args) => ({ echoed: args.x }),
      }),
    );
    const request = await firstRequest({
      model: "gpt-6-sol",
      reasoningEffort: "xhigh",
      reasoningEffortExplicit: true,
      bindings: [{ id: "b1", agentVersionId: "v", organizationId: "org", toolKey: "echo", config: {}, enabled: true }],
    });
    expect(request.body.reasoning).toEqual({ effort: "xhigh", summary: "auto" });
    expect(Array.isArray(request.body.tools)).toBe(true);
    expect(Object.keys(request.body).indexOf("reasoning")).toBeLessThan(Object.keys(request.body).indexOf("tools"));
  });

  it("maps Ultra the way the official OpenAI endpoint wants it, which GPT-6 already snapped to max", async () => {
    const request = await firstRequest({
      model: "gpt-6-luna",
      reasoningEffort: "ultra",
      reasoningEffortExplicit: true,
      baseUrl: "https://api.openai.com/v1",
    });
    expect(request.body.reasoning).toEqual({ effort: "max", summary: "auto" });
  });

  it("still steps the level down when the gateway refuses it, now that there is a level to refuse", async () => {
    const seen = gateway([
      () => json(400, "Unsupported value: 'max' for reasoning.effort. Supported values are: 'low', 'medium', 'high', 'xhigh'."),
      bad401,
    ]);
    await run({ model: "gpt-6-luna", reasoningEffort: "max", reasoningEffortExplicit: true });
    expect(seen).toHaveLength(2);
    expect(seen[0]?.body.reasoning).toEqual({ effort: "max", summary: "auto" });
    expect(seen[1]?.body.reasoning).toEqual({ effort: "xhigh", summary: "auto" });
  });

  it("drops the block for good when the model takes no such parameter", async () => {
    const seen = gateway([
      () => json(400, "Unsupported parameter: 'reasoning.effort' is not supported with this model."),
      bad401,
    ]);
    await run({ model: "gpt-6-luna", reasoningEffort: "high", reasoningEffortExplicit: true });
    expect(seen).toHaveLength(2);
    expect("reasoning" in (seen[1]?.body ?? {})).toBe(false);
  });
});

describe("GPT-6 against gpt-5.6 on the wire", () => {
  it("differs only in the model id and the system message's role, which the SDK spells developer for o* and gpt-5* only", async () => {
    // The Responses API accepts `system` for every model and reads it as `developer` for a reasoning
    // model, and GPT-6 has answered with it since it was listed, so this is recorded, not changed. If a
    // later SDK upgrade moves it, this test says so.
    const six = await firstRequest({ model: "gpt-6-luna", reasoningEffort: "high", reasoningEffortExplicit: true });
    const fiveSix = await firstRequest({ model: "gpt-5.6-luna", reasoningEffort: "high", reasoningEffortExplicit: true });
    const normalise = (request: Captured, model: string) =>
      JSON.stringify(request.body)
        .replace(model, "MODEL")
        .replace('"role":"developer"', '"role":"SYSTEM"')
        .replace('"role":"system"', '"role":"SYSTEM"');
    expect(normalise(six, "gpt-6-luna")).toBe(normalise(fiveSix, "gpt-5.6-luna"));
    expect((six.body.input as Array<{ role: string }>)[0]?.role).toBe("system");
    expect((fiveSix.body.input as Array<{ role: string }>)[0]?.role).toBe("developer");
  });

  it("sends no sampling parameters: the runtime strips them on /responses whatever the SDK left in", async () => {
    const request = await firstRequest({ model: "gpt-6-sol", reasoningEffort: "medium", reasoningEffortExplicit: true });
    for (const key of ["temperature", "top_p", "frequency_penalty", "presence_penalty", "max_output_tokens"]) {
      expect(key in request.body, key).toBe(false);
    }
  });
});

describe("what did not move", () => {
  it("gpt-5.6 sends the block the SDK always wrote, in the same place", async () => {
    const request = await firstRequest({ model: "gpt-5.6-luna", reasoningEffort: "high", reasoningEffortExplicit: true });
    expect(request.body.reasoning).toEqual({ effort: "high", summary: "auto" });
    expect(Object.keys(request.body)).toEqual(["model", "input", "reasoning", "stream", "store"]);
  });

  it("gpt-5.6 Off is still effort none with no summary", async () => {
    const request = await firstRequest({ model: "gpt-5.6-luna", thinking: false });
    expect(request.body.reasoning).toEqual({ effort: "none" });
  });

  it("a model with no level to send still sends no reasoning block", async () => {
    // gpt-7 is not in the table: nothing is sent unless the person chose a level.
    const request = await firstRequest({ model: "gpt-7-nova", reasoningEffort: "medium", reasoningEffortExplicit: false });
    expect(request.url).toContain("/responses");
    expect("reasoning" in request.body).toBe(false);
  });

  it("a Completions request is not given a Responses reasoning block", async () => {
    const request = await firstRequest({ model: "deepseek-v4-flash", reasoningEffort: "high", reasoningEffortExplicit: true });
    expect(request.url).toContain("/chat/completions");
    expect("reasoning" in request.body).toBe(false);
    expect(request.body.reasoning_effort).toBe("high");
  });
});

describe("a GPT newer than the table, on Responses", () => {
  it("sends the level the person chose, capped at Deep, in the same shape", async () => {
    const request = await firstRequest({ model: "gpt-7-nova", reasoningEffort: "ultra", reasoningEffortExplicit: true });
    expect(request.url).toContain("/responses");
    expect(request.body.reasoning).toEqual({ effort: "high", summary: "auto" });
  });
});
