import { describe, expect, it } from "vitest";
import { documentJobSystemPrompt, isFinanceJob } from "./document-generate";

describe("finance document prompt", () => {
  it("flags job=finance and never invents figures", () => {
    expect(isFinanceJob({ job: "finance", prompt: "breakeven" })).toBe(true);
    expect(isFinanceJob({ prompt: "breakeven" })).toBe(false);
    const prompt = documentJobSystemPrompt(true);
    expect(prompt).toMatch(/Never invent numbers/i);
    expect(prompt).toMatch(/Use only figures the user pasted/i);
    expect(documentJobSystemPrompt(false)).not.toMatch(/Never invent numbers/i);
  });
});
