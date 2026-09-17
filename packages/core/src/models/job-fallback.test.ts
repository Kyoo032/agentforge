import { describe, expect, it } from "vitest";
import {
  JOB_FALLBACK_TAIL,
  MODEL_FALLBACK_NOTICE,
  isGatewayUnavailableFailure,
  jobFallbackChain,
  nextJobFallbackModel,
} from "./job-fallback";

/** What the workspace actually offered on 2026-09-17, trimmed to the ids the tests care about. */
const LIVE = [
  "gpt-5.6-sol",
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "claude-sonnet-5",
  "deepseek-v4-flash",
  "glm-5.2",
  "kimi-k3",
];

describe("isGatewayUnavailableFailure", () => {
  it("matches the 503 the Finance default returned on the live eval run", () => {
    expect(
      isGatewayUnavailableFailure(
        "Could not reach deepseek-v4-flash after 3 tries. The gateway is unavailable right now (status_code=503)",
      ),
    ).toBe(true);
  });

  it("matches the Indonesian twin of that sentence", () => {
    expect(
      isGatewayUnavailableFailure(
        "Tidak dapat menghubungi deepseek-v4-flash setelah 3 percobaan. Gateway sedang tidak tersedia",
      ),
    ).toBe(true);
  });

  it("matches the 10s response-header abort", () => {
    expect(isGatewayUnavailableFailure("Gateway unreachable: no response within 10s")).toBe(true);
  });

  it("matches the first-token watchdog in both locales", () => {
    expect(
      isGatewayUnavailableFailure("No first token from deepseek-v4-flash after 240s (timeout). Try a smaller prompt."),
    ).toBe(true);
    expect(isGatewayUnavailableFailure("Tidak ada token pertama dari deepseek-v4-flash setelah 240 detik")).toBe(true);
  });

  it("matches bare transport failures", () => {
    for (const text of [
      "fetch failed",
      "connect ECONNREFUSED 127.0.0.1:443",
      "socket hang up",
      "no available channel",
      "The gateway is unavailable right now (status_code=502)",
      "The gateway is unavailable right now (status_code=504)",
    ]) {
      expect(isGatewayUnavailableFailure(text), text).toBe(true);
    }
  });

  it("never falls back on auth, request or content failures", () => {
    for (const text of [
      "The gateway did not accept this API key (status_code=401)",
      "The gateway refused this request for this key (status_code=403)",
      "The gateway rejected this request (status_code=400)",
      "model_not_found: deepseek-v4-flash",
      "This model's maximum context length is 128000 tokens",
      "invalid_request: messages must be an array",
      "The gateway is rate-limiting this key (status_code=429)",
      "Gateway sedang membatasi laju key ini",
      "content_filter: the response was blocked",
      "The gateway rejected this request (status_code=422)",
    ]) {
      expect(isGatewayUnavailableFailure(text), text).toBe(false);
    }
  });

  // The runtime wraps an empty answer in the same "Could not reach X after N tries" sentence as a
  // real outage. The detail, not the prefix, decides.
  it("never falls back when the model answered with nothing", () => {
    expect(
      isGatewayUnavailableFailure(
        "Could not reach gpt-5.6-sol after 1 try. The model returned no text. Try another model, or turn off tools if this endpoint rejects them.",
      ),
    ).toBe(false);
  });

  it("treats an empty message as not classifiable", () => {
    expect(isGatewayUnavailableFailure("   ")).toBe(false);
  });
});

describe("jobFallbackChain", () => {
  it("keeps the mode ranking first, then the shared tail, and never repeats an id", () => {
    expect(jobFallbackChain("finance", LIVE)).toEqual([
      "deepseek-v4-flash",
      "gpt-5.6-luna",
      "claude-sonnet-5",
      "gpt-5.6-sol",
      "kimi-k3",
    ]);
  });

  it("only offers ids the workspace actually lists", () => {
    expect(jobFallbackChain("finance", ["deepseek-v4-flash", "gpt-5.6-luna"])).toEqual([
      "deepseek-v4-flash",
      "gpt-5.6-luna",
    ]);
  });

  it("returns the live spelling of an id, not the hint's spelling", () => {
    expect(jobFallbackChain("research", ["MiniMax-M3"])).toEqual(["MiniMax-M3"]);
  });

  it("falls back to the shared tail alone when the mode is unknown", () => {
    expect(jobFallbackChain(undefined, LIVE)).toEqual(["gpt-5.6-luna", "claude-sonnet-5", "gpt-5.6-sol", "kimi-k3"]);
  });

  it("is empty when nothing in the ranking is live", () => {
    expect(jobFallbackChain("finance", ["some-model-nobody-ranked"])).toEqual([]);
  });

  it("gives every job mode somewhere to land on the live catalog", () => {
    for (const mode of ["documents", "research", "presentations", "finance", "data", "market", "legal"] as const) {
      expect(jobFallbackChain(mode, LIVE).length, mode).toBeGreaterThan(1);
    }
  });
});

describe("nextJobFallbackModel", () => {
  it("skips the model that just failed", () => {
    expect(nextJobFallbackModel({ mode: "finance", current: "deepseek-v4-flash", availableIds: LIVE })).toBe(
      "gpt-5.6-luna",
    );
  });

  it("skips models the circuit marked down", () => {
    expect(
      nextJobFallbackModel({
        mode: "finance",
        current: "deepseek-v4-flash",
        availableIds: LIVE,
        isDown: (id) => id === "gpt-5.6-luna",
      }),
    ).toBe("claude-sonnet-5");
  });

  it("compares the current model case-insensitively", () => {
    expect(nextJobFallbackModel({ mode: "research", current: "minimax-m3", availableIds: ["MiniMax-M3"] })).toBe(
      undefined,
    );
  });

  it("returns undefined when every candidate is down", () => {
    expect(
      nextJobFallbackModel({
        mode: "finance",
        current: "deepseek-v4-flash",
        availableIds: LIVE,
        isDown: () => true,
      }),
    ).toBe(undefined);
  });

  it("offers the top of the chain when the current model is not ranked at all", () => {
    expect(nextJobFallbackModel({ mode: "finance", current: "some-desk-default", availableIds: LIVE })).toBe(
      "deepseek-v4-flash",
    );
  });
});

describe("notice contract", () => {
  it("is a stable code the UI localises, not a sentence", () => {
    expect(MODEL_FALLBACK_NOTICE).toBe("model_fallback");
  });

  it("ranks the tail by what answered on the live gateway", () => {
    expect(JOB_FALLBACK_TAIL[0]).toBe("gpt-5.6-luna");
    expect(JOB_FALLBACK_TAIL).toContain("claude-sonnet-5");
  });
});
