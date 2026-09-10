import { describe, expect, it } from "vitest";
import { generateFailureMessage } from "./generate-failure";

describe("generateFailureMessage", () => {
  it("keeps the upstream error message so the owner sees why", () => {
    expect(generateFailureMessage(400, { error: { message: "Add a gateway key in Settings." } })).toBe(
      "Generation failed (400): Add a gateway key in Settings.",
    );
    expect(generateFailureMessage(400, { message: "bad prompt" })).toBe("Generation failed (400): bad prompt");
    expect(generateFailureMessage(502, "upstream refused")).toBe("Generation failed (502): upstream refused");
  });

  it("falls back to the status alone when the body says nothing useful", () => {
    expect(generateFailureMessage(500, undefined)).toBe("Generation failed (500)");
    expect(generateFailureMessage(500, {})).toBe("Generation failed (500)");
    expect(generateFailureMessage(500, "")).toBe("Generation failed (500)");
  });

  it("truncates very long bodies", () => {
    const long = "x".repeat(1000);
    expect(generateFailureMessage(400, long).length).toBeLessThan(340);
  });
});
