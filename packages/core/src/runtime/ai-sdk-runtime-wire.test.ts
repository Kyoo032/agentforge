import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiSdkRuntime } from "./ai-sdk-runtime";
import { resetLearnedEffortLimits } from "./effort-selfheal";
import type { JobMode } from "../models/mode-defaults";
import type { TenantContext } from "../tenancy/types";

/**
 * Moving the per-model rules into `models/model-policy.ts` must not move a byte on the wire for any
 * model that was already working. `__fixtures__/wire-bodies-golden.json` holds the URL and body the
 * runtime sent for 260 model, base URL, Thinking and job-mode combinations, recorded from the name-regex
 * implementation before the table existed. Here the same combinations run through the real runtime
 * and AI SDK against a stub gateway, and every request has to match.
 *
 * One deliberate exception: the 20 `gpt-6-astra` entries were re-recorded on 2026-09-30, when the runtime
 * started adding the Responses `reasoning` block the AI SDK leaves out for ids that are not `o*` or
 * `gpt-5*` (the fixture's `rerecorded` note says so). Every other entry is still the original recording.
 */

type Golden = { runs: Record<string, string> };

const golden = JSON.parse(
  readFileSync(new URL("./__fixtures__/wire-bodies-golden.json", import.meta.url), "utf8"),
) as Golden;

const tenant: TenantContext = {
  tenantId: "t",
  organizationId: "o",
  workspaceId: "w",
  userId: "u",
  role: "owner",
};

const LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;

/** Variant 0: nothing said. 1: Thinking off. 2 to 9: each level of the ladder, in order. */
function variantInput(index: number): Record<string, unknown> {
  if (index === 0) {
    return {};
  }
  if (index === 1) {
    return { thinking: false };
  }
  return { thinking: true, reasoningEffort: LEVELS[index - 2] };
}

let captured: Array<{ url: string; body: string }> = [];

beforeEach(() => {
  resetLearnedEffortLimits();
  captured = [];
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    captured.push({ url: String(url), body: String(init?.body ?? "") });
    return new Response(JSON.stringify({ error: { message: "Incorrect API key provided." } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function requestFor(key: string): Promise<string | undefined> {
  const [model, base, variant, job] = key.split("|") as [string, string, string, string];
  captured = [];
  try {
    await new AiSdkRuntime({ openai: "sk-test", openaiBaseUrl: base }).execute({
      tenant,
      runId: "r",
      modality: "text",
      version: {
        id: "v",
        agentId: "a",
        organizationId: "o",
        version: 1,
        systemPrompt: "You are helpful.",
        model,
        inputModalities: ["text"],
        config: {},
        createdAt: new Date(0),
      },
      bindings: [],
      history: [{ role: "user", parts: [{ type: "text", text: "Say ok." }] }],
      ...variantInput(Number(variant.slice(1))),
      ...(job === "chat" ? {} : { jobMode: job as JobMode }),
      onEvent: () => undefined,
    });
  } catch {
    // The stub gateway answers 401, so the run ends after its one request.
  }
  const first = captured[0];
  return first ? `${first.url} ${first.body}` : undefined;
}

describe("known models send the request they always did", () => {
  const entries = Object.entries(golden.runs);
  const byModel = new Map<string, Array<[string, string]>>();
  for (const [key, recorded] of entries) {
    const model = key.split("|")[0] as string;
    byModel.set(model, [...(byModel.get(model) ?? []), [key, recorded]]);
  }

  it("recorded a real matrix", () => {
    expect(entries.length).toBeGreaterThan(250);
    expect(byModel.size).toBeGreaterThanOrEqual(18);
  });

  for (const [model, runs] of byModel) {
    it(`${model}: ${runs.length} requests`, async () => {
      for (const [key, recorded] of runs) {
        expect(await requestFor(key), key).toBe(recorded);
      }
    });
  }
});
