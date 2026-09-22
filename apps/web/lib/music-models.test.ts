import { describe, expect, it } from "vitest";
import { musicPickerEmpty, readApiErrorMessage } from "./music-models";

describe("musicPickerEmpty", () => {
  it("is false while the page is still loading", () => {
    // A spinner that also shouts "no models" is a lie for the half-second before the fetch lands.
    expect(musicPickerEmpty({ loading: true, models: [] })).toBe(false);
  });

  it("is true once the host answered with nothing to pick", () => {
    expect(musicPickerEmpty({ loading: false, models: [] })).toBe(true);
  });

  it("is false as soon as there is one model", () => {
    expect(musicPickerEmpty({ loading: false, models: [{ id: "suno_music" }] })).toBe(false);
  });
});

/**
 * Two error shapes reach the studio and only one was being read.
 *
 * `jsonError` answers an `ApiError` as `{ error: { code, message } }`, which the studio already
 * showed. A gateway-gated route answers the flat `{ error: "gateway_blocked", status, message }`
 * instead (`packages/host/src/errors.ts`), and reading `.error.message` on that gives `undefined` —
 * so a blocked key, a model the key cannot use, or an exhausted quota all came out as the same
 * generic "Music generation failed".
 */
describe("readApiErrorMessage", () => {
  it("reads the enveloped message a tool failure carries", () => {
    expect(
      readApiErrorMessage({ error: { code: "tool_failed", message: "insufficient quota for suno_music" } }, "fallback"),
    ).toBe("insufficient quota for suno_music");
  });

  it("reads the flat message a gateway-blocked answer carries", () => {
    expect(
      readApiErrorMessage({ error: "gateway_blocked", status: "invalid_key", message: "Gateway key rejected" }, "x"),
    ).toBe("Gateway key rejected");
  });

  it("falls back when there is no message to show", () => {
    expect(readApiErrorMessage({}, "fallback")).toBe("fallback");
    expect(readApiErrorMessage(null, "fallback")).toBe("fallback");
    expect(readApiErrorMessage("boom", "fallback")).toBe("fallback");
    expect(readApiErrorMessage({ error: "gateway_blocked" }, "fallback")).toBe("fallback");
    expect(readApiErrorMessage({ error: { code: "tool_failed", message: "   " } }, "fallback")).toBe("fallback");
  });

  it("trims what it shows", () => {
    expect(readApiErrorMessage({ error: { message: "  no model access  " } }, "fallback")).toBe("no model access");
  });
});
