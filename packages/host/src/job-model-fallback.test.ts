import { ApiError } from "@agentforge/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  JOB_MODEL_DOWN_MS,
  isJobModelDown,
  jobFailureMessage,
  markJobModelDown,
  resetJobModelCircuit,
  runWithJobModelFallback,
  type JobModelOutcome,
} from "./job-model-fallback";

/** The ids the workspace listed on 2026-09-17, trimmed to what these tests exercise. */
const AVAILABLE = ["deepseek-v4-flash", "gpt-5.6-luna", "gpt-5.6-terra", "claude-sonnet-5", "gpt-5.6-sol", "glm-5.2"];

/** The exact sentence the Finance default returned on the live eval run. */
const GATEWAY_503 =
  "Could not reach deepseek-v4-flash after 3 tries. The gateway is unavailable right now (status_code=503)";

const NOW = 1_800_000_000_000;
const now = () => NOW;

/**
 * A fake runtime: a map of model id to what that model does. No network, no gateway, no settings —
 * the fallback decision is the only thing under test.
 */
function fakeRuntime(behaviour: Record<string, "ok" | Error | { streamed: Error }>) {
  const calls: string[] = [];
  const attempt = async (model: string): Promise<JobModelOutcome<string>> => {
    calls.push(model);
    const outcome = behaviour[model] ?? new Error(GATEWAY_503.replace("deepseek-v4-flash", model));
    if (outcome === "ok") {
      return { ok: true, value: `brief from ${model}` };
    }
    if (outcome instanceof Error) {
      return { ok: false, error: outcome, streamed: false };
    }
    return { ok: false, error: outcome.streamed, streamed: true };
  };
  return { attempt, calls };
}

beforeEach(() => {
  resetJobModelCircuit();
});

describe("jobFailureMessage", () => {
  it("reads Error, ApiError and string failures", () => {
    expect(jobFailureMessage(new Error("boom"))).toBe("boom");
    expect(jobFailureMessage(new ApiError("generation_failed", GATEWAY_503, 502))).toBe(GATEWAY_503);
    expect(jobFailureMessage("plain")).toBe("plain");
    expect(jobFailureMessage(null)).toBe("");
  });
});

describe("the down circuit", () => {
  it("holds a model down for five minutes, then lets it back", () => {
    expect(JOB_MODEL_DOWN_MS).toBe(5 * 60 * 1000);
    markJobModelDown("deepseek-v4-flash", NOW);
    expect(isJobModelDown("deepseek-v4-flash", NOW + 1)).toBe(true);
    expect(isJobModelDown("deepseek-v4-flash", NOW + JOB_MODEL_DOWN_MS)).toBe(false);
  });

  it("ignores case and never marks an empty id", () => {
    markJobModelDown("DeepSeek-V4-Flash", NOW);
    expect(isJobModelDown("deepseek-v4-flash", NOW + 1)).toBe(true);
    markJobModelDown("   ", NOW);
    expect(isJobModelDown("   ", NOW + 1)).toBe(false);
  });

  it("forgets everything on reset", () => {
    markJobModelDown("deepseek-v4-flash", NOW);
    resetJobModelCircuit();
    expect(isJobModelDown("deepseek-v4-flash", NOW + 1)).toBe(false);
  });
});

describe("runWithJobModelFallback", () => {
  it("returns the first model's answer with no notice when it works", async () => {
    const runtime = fakeRuntime({ "deepseek-v4-flash": "ok" });
    const run = await runWithJobModelFallback(
      { model: "deepseek-v4-flash", jobMode: "finance", availableModelIds: AVAILABLE, now },
      runtime.attempt,
    );
    expect(run.value).toBe("brief from deepseek-v4-flash");
    expect(run.model).toBe("deepseek-v4-flash");
    expect(run.notice).toBeUndefined();
    expect(runtime.calls).toEqual(["deepseek-v4-flash"]);
  });

  it("answers on the next ranked model when the default returns 503", async () => {
    const runtime = fakeRuntime({ "deepseek-v4-flash": new Error(GATEWAY_503), "gpt-5.6-luna": "ok" });
    const run = await runWithJobModelFallback(
      { model: "deepseek-v4-flash", jobMode: "finance", availableModelIds: AVAILABLE, now },
      runtime.attempt,
    );
    expect(run.value).toBe("brief from gpt-5.6-luna");
    expect(run.model).toBe("gpt-5.6-luna");
    expect(run.notice).toEqual({ code: "model_fallback", from: "deepseek-v4-flash", to: "gpt-5.6-luna" });
    expect(runtime.calls).toEqual(["deepseek-v4-flash", "gpt-5.6-luna"]);
  });

  it("falls back on the 10s response-header abort too", async () => {
    const runtime = fakeRuntime({
      "deepseek-v4-flash": new Error("Gateway unreachable: no response within 10s"),
      "gpt-5.6-luna": "ok",
    });
    const run = await runWithJobModelFallback(
      { model: "deepseek-v4-flash", jobMode: "finance", availableModelIds: AVAILABLE, now },
      runtime.attempt,
    );
    expect(run.model).toBe("gpt-5.6-luna");
  });

  it("marks the failed model down so the next job skips it without paying the three tries", async () => {
    const first = fakeRuntime({ "deepseek-v4-flash": new Error(GATEWAY_503), "gpt-5.6-luna": "ok" });
    await runWithJobModelFallback(
      { model: "deepseek-v4-flash", jobMode: "finance", availableModelIds: AVAILABLE, now },
      first.attempt,
    );

    const second = fakeRuntime({ "gpt-5.6-luna": "ok" });
    const run = await runWithJobModelFallback(
      { model: "deepseek-v4-flash", jobMode: "finance", availableModelIds: AVAILABLE, now },
      second.attempt,
    );
    expect(second.calls).toEqual(["gpt-5.6-luna"]);
    expect(run.model).toBe("gpt-5.6-luna");
    expect(run.notice).toEqual({ code: "model_fallback", from: "deepseek-v4-flash", to: "gpt-5.6-luna" });
  });

  it("tries the down model again once the circuit has expired", async () => {
    markJobModelDown("deepseek-v4-flash", NOW);
    const runtime = fakeRuntime({ "deepseek-v4-flash": "ok" });
    const run = await runWithJobModelFallback(
      {
        model: "deepseek-v4-flash",
        jobMode: "finance",
        availableModelIds: AVAILABLE,
        now: () => NOW + JOB_MODEL_DOWN_MS,
      },
      runtime.attempt,
    );
    expect(runtime.calls).toEqual(["deepseek-v4-flash"]);
    expect(run.notice).toBeUndefined();
  });

  it("never swaps a model the person pinned in the UI", async () => {
    const runtime = fakeRuntime({ "deepseek-v4-flash": new ApiError("generation_failed", GATEWAY_503, 502) });
    await expect(
      runWithJobModelFallback(
        {
          model: "deepseek-v4-flash",
          jobMode: "finance",
          modelExplicit: true,
          availableModelIds: AVAILABLE,
          now,
        },
        runtime.attempt,
      ),
    ).rejects.toThrow(GATEWAY_503);
    expect(runtime.calls).toEqual(["deepseek-v4-flash"]);
  });

  it("never swaps on a 4xx, auth or content failure", async () => {
    for (const message of [
      "The gateway did not accept this API key (status_code=401)",
      "The gateway rejected this request (status_code=400)",
      "This model's maximum context length is 128000 tokens",
    ]) {
      const runtime = fakeRuntime({ "deepseek-v4-flash": new Error(message), "gpt-5.6-luna": "ok" });
      await expect(
        runWithJobModelFallback(
          { model: "deepseek-v4-flash", jobMode: "finance", availableModelIds: AVAILABLE, now },
          runtime.attempt,
        ),
      ).rejects.toThrow(message);
      expect(runtime.calls, message).toEqual(["deepseek-v4-flash"]);
      expect(isJobModelDown("deepseek-v4-flash", NOW + 1), message).toBe(false);
    }
  });

  it("never re-runs a prompt the model had already started answering", async () => {
    const runtime = fakeRuntime({
      "deepseek-v4-flash": { streamed: new Error("No stream events from deepseek-v4-flash for 60s after it started") },
      "gpt-5.6-luna": "ok",
    });
    await expect(
      runWithJobModelFallback(
        { model: "deepseek-v4-flash", jobMode: "finance", availableModelIds: AVAILABLE, now },
        runtime.attempt,
      ),
    ).rejects.toThrow("No stream events");
    expect(runtime.calls).toEqual(["deepseek-v4-flash"]);
  });

  it("preserves the original ApiError, status and all, when it gives up", async () => {
    const error = new ApiError("generation_failed", GATEWAY_503, 502);
    const runtime = fakeRuntime({ "deepseek-v4-flash": error });
    await expect(
      runWithJobModelFallback(
        { model: "deepseek-v4-flash", jobMode: "finance", availableModelIds: ["deepseek-v4-flash"], now },
        runtime.attempt,
      ),
    ).rejects.toBe(error);
  });

  it("retries once only, and surfaces the stand-in's own error", async () => {
    const runtime = fakeRuntime({
      "deepseek-v4-flash": new Error(GATEWAY_503),
      "gpt-5.6-luna": new Error("Could not reach gpt-5.6-luna after 3 tries. The gateway is unavailable right now"),
    });
    await expect(
      runWithJobModelFallback(
        { model: "deepseek-v4-flash", jobMode: "finance", availableModelIds: AVAILABLE, now },
        runtime.attempt,
      ),
    ).rejects.toThrow("gpt-5.6-luna");
    expect(runtime.calls).toEqual(["deepseek-v4-flash", "gpt-5.6-luna"]);
    expect(isJobModelDown("gpt-5.6-luna", NOW + 1)).toBe(true);
  });

  it("only ever offers a model the workspace lists", async () => {
    const runtime = fakeRuntime({ "deepseek-v4-flash": new Error(GATEWAY_503) });
    await expect(
      runWithJobModelFallback(
        { model: "deepseek-v4-flash", jobMode: "finance", availableModelIds: ["deepseek-v4-flash"], now },
        runtime.attempt,
      ),
    ).rejects.toThrow(GATEWAY_503);
    expect(runtime.calls).toEqual(["deepseek-v4-flash"]);
  });

  it("serves a mode it was given no name for from the shared tail", async () => {
    const runtime = fakeRuntime({ "deepseek-v4-flash": new Error(GATEWAY_503), "gpt-5.6-luna": "ok" });
    const run = await runWithJobModelFallback(
      { model: "deepseek-v4-flash", availableModelIds: AVAILABLE, now },
      runtime.attempt,
    );
    expect(run.model).toBe("gpt-5.6-luna");
  });

  it("skips a stand-in that is itself marked down", async () => {
    markJobModelDown("gpt-5.6-luna", NOW);
    const runtime = fakeRuntime({ "deepseek-v4-flash": new Error(GATEWAY_503), "claude-sonnet-5": "ok" });
    const run = await runWithJobModelFallback(
      { model: "deepseek-v4-flash", jobMode: "finance", availableModelIds: AVAILABLE, now },
      runtime.attempt,
    );
    expect(run.model).toBe("claude-sonnet-5");
    expect(runtime.calls).toEqual(["deepseek-v4-flash", "claude-sonnet-5"]);
  });
});
