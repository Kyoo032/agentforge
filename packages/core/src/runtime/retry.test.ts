import { describe, expect, it } from "vitest";
import {
  MODEL_CONTACT_ATTEMPTS,
  contactAttemptOrdinal,
  formatContactProbe,
  formatContactProbeButton,
  formatModelContactError,
  isRetryableModelFailure,
  shouldFailEmptyAssistant,
  shouldKeepToolTurn,
  shouldRetryModelContact,
  shouldRetryWithoutTools,
} from "./retry";

describe("formatContactProbe", () => {
  it("labels the three contact attempts", () => {
    expect(formatContactProbe("gpt-5.6-luna", 1)).toBe("Probing gpt-5.6-luna · 1st try");
    expect(formatContactProbe("gpt-5.6-luna", 2)).toBe("2nd try · gpt-5.6-luna");
    expect(formatContactProbe("deepseek-v4-flash", 3)).toBe("3rd try · deepseek-v4-flash");
    expect(formatContactProbeButton(1)).toBe("1st try…");
    expect(formatContactProbeButton(2)).toBe("2nd try…");
    expect(formatContactProbeButton(3)).toBe("3rd try…");
  });
});

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

  it("does not strip tools on a temperature sanitize 400", () => {
    expect(
      shouldRetryWithoutTools({
        hasTools: true,
        text: false,
        failed: "'temperature' must be omitted or set to 1 for claude-sonnet-5 (status_code=400)",
        tooled: false,
      }),
    ).toBe(false);
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

describe("shouldRetryModelContact", () => {
  it("retries channel and network misses up to three attempts", () => {
    expect(MODEL_CONTACT_ATTEMPTS).toBe(3);
    expect(isRetryableModelFailure("No available channel for model deepseek-v4-pro")).toBe(true);
    expect(isRetryableModelFailure("fetch failed")).toBe(true);
    expect(isRetryableModelFailure("Gateway 503")).toBe(true);
    expect(
      shouldRetryModelContact({
        failed: "No available channel for model gpt-5.6-sol",
        text: false,
        tooled: false,
        attempts: 1,
      }),
    ).toBe(true);
    expect(
      shouldRetryModelContact({
        failed: "No available channel for model gpt-5.6-sol",
        text: false,
        tooled: false,
        attempts: 3,
      }),
    ).toBe(false);
  });

  it("does not retry auth, missing models, stream watchdogs, or a turn that already streamed", () => {
    expect(isRetryableModelFailure("401 Unauthorized")).toBe(false);
    expect(isRetryableModelFailure("model_not_found: nope")).toBe(false);
    expect(
      isRetryableModelFailure(
        "No first token from claude-opus-5 after 240s (timeout). Try a smaller prompt, another model, or send again.",
      ),
    ).toBe(false);
    expect(
      shouldRetryModelContact({ failed: "fetch failed", text: true, tooled: false, attempts: 1 }),
    ).toBe(false);
  });

  it("names the model after the last failed try", () => {
    expect(formatModelContactError("gpt-5.6-sol", 3, "No available channel for model gpt-5.6-sol")).toBe(
      "Could not reach gpt-5.6-sol after 3 tries. No available channel for model gpt-5.6-sol",
    );
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

describe("retry copy in Bahasa Indonesia", () => {
  it("writes the probe and probe button in id", () => {
    expect(formatContactProbe("gpt-5", 1, MODEL_CONTACT_ATTEMPTS, "id")).toBe("Menghubungi gpt-5 · percobaan ke-1");
    expect(formatContactProbe("gpt-5", 2, MODEL_CONTACT_ATTEMPTS, "id")).toBe("Percobaan ke-2 · gpt-5");
    expect(formatContactProbeButton(2, "id")).toBe("Percobaan ke-2…");
  });

  it("keeps English as the default", () => {
    expect(formatContactProbe("gpt-5", 1)).toBe("Probing gpt-5 · 1st try");
    expect(formatContactProbeButton(2)).toBe("2nd try…");
    expect(contactAttemptOrdinal(3)).toBe("3rd");
    expect(contactAttemptOrdinal(3, "id")).toBe("ke-3");
  });

  it("writes the contact error in id and does not nest the prefix", () => {
    const first = formatModelContactError("gpt-5", 3, "fetch failed", "id");
    expect(first).toBe("Tidak dapat menghubungi gpt-5 setelah 3 percobaan. fetch failed");
    expect(formatModelContactError("gpt-5", 3, first, "id")).toBe(first);
    expect(formatModelContactError("gpt-5", 3, "", "id")).toContain("Model tidak dapat dihubungi.");
  });

  it("still treats an Indonesian watchdog timeout as a hard stop", () => {
    const idle = "Tidak ada peristiwa stream dari gpt-5 selama 60 detik setelah dimulai (timeout).";
    const ttfb = "Tidak ada token pertama dari gpt-5 setelah 120 detik (timeout).";
    expect(isRetryableModelFailure(idle)).toBe(false);
    expect(isRetryableModelFailure(ttfb)).toBe(false);
  });

  it("retries the Indonesian wording of a contact failure, like the English one", () => {
    expect(isRetryableModelFailure("Tidak dapat menghubungi gpt-5 setelah 3 percobaan. fetch failed")).toBe(true);
    expect(isRetryableModelFailure("Model tidak dapat dihubungi. Coba model lain, atau kirim lagi.")).toBe(true);
    expect(isRetryableModelFailure("Stream model habis waktu")).toBe(true);
    expect(isRetryableModelFailure("Layanan tidak tersedia")).toBe(true);
    expect(isRetryableModelFailure("Model sedang kelebihan beban")).toBe(true);
    expect(isRetryableModelFailure("Galat jaringan saat menghubungi model")).toBe(true);
  });

  it("strips the prefix of a single-try English error so retries do not nest it", () => {
    const once = formatModelContactError("gpt-5", 1, "fetch failed");
    expect(once).toBe("Could not reach gpt-5 after 1 try. fetch failed");
    expect(formatModelContactError("gpt-5", 2, once)).toBe("Could not reach gpt-5 after 2 tries. fetch failed");
    const thrice = formatModelContactError("gpt-5", 3, "fetch failed");
    expect(formatModelContactError("gpt-5", 3, thrice)).toBe(thrice);
  });
});
