import { describe, expect, it } from "vitest";
import { shouldFailEmptyAssistant, shouldKeepToolTurn, shouldRetryWithoutTools } from "./retry";

describe("shouldRetryWithoutTools", () => {
  it("retries when tools were sent and the reply was empty", () => {
    expect(shouldRetryWithoutTools({ hasTools: true, text: false, failed: "", tooled: false })).toBe(true);
  });

  it("retries when the gateway rejects tools on reasoning models", () => {
    expect(
      shouldRetryWithoutTools({
        hasTools: true,
        text: false,
        failed: "Function tools with reasoning_effort are not supported for gpt-5.6-sol",
        tooled: false,
      }),
    ).toBe(true);
  });

  it("does not retry after a real tool call or a channel error", () => {
    expect(shouldRetryWithoutTools({ hasTools: true, text: false, failed: "", tooled: true })).toBe(false);
    expect(
      shouldRetryWithoutTools({
        hasTools: true,
        text: false,
        failed: "No available channel for model deepseek-v4-pro",
        tooled: false,
      }),
    ).toBe(false);
  });
});

describe("shouldFailEmptyAssistant", () => {
  it("fails when there is no text, thinking, or tool activity", () => {
    expect(shouldFailEmptyAssistant({ text: false, thinking: false, tooled: false })).toBe(true);
  });

  it("does not fail after a successful tool call with no prose", () => {
    expect(shouldFailEmptyAssistant({ text: false, thinking: false, tooled: true })).toBe(false);
  });

  it("does not fail when thinking or text is present", () => {
    expect(shouldFailEmptyAssistant({ text: false, thinking: true, tooled: false })).toBe(false);
    expect(shouldFailEmptyAssistant({ text: true, thinking: false, tooled: false })).toBe(false);
  });
});

describe("shouldKeepToolTurn", () => {
  it("keeps the turn after a tool ran even if the follow-up provider call failed", () => {
    expect(
      shouldKeepToolTurn({
        tooled: true,
        failed:
          "error getting file type: failed to download file from http://127.0.0.1:3000/api/v1/media/x/file",
      }),
    ).toBe(true);
  });

  it("does not swallow failures when no tool ran", () => {
    expect(shouldKeepToolTurn({ tooled: false, failed: "No available channel" })).toBe(false);
    expect(shouldKeepToolTurn({ tooled: true, failed: "" })).toBe(false);
  });
});
