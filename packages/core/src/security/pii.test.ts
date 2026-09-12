import { describe, expect, it } from "vitest";
import { maskOutboundRunInput, maskPii, maskPiiInParts, passesLuhn, piiWarning, scanPii } from "./pii";

describe("scanPii", () => {
  it("finds email addresses", () => {
    const findings = scanPii("Contact me at alex.rivera@example.com please");
    expect(findings).toEqual([{ kind: "email", match: "alex.rivera@example.com", index: expect.any(Number) }]);
    expect(findings[0]?.index).toBe("Contact me at ".length);
  });

  it("finds international phone numbers", () => {
    const findings = scanPii("Call +1 (415) 555-2671 after noon");
    expect(findings.some((item) => item.kind === "phone")).toBe(true);
    expect(findings.find((item) => item.kind === "phone")?.match).toMatch(/415/);
  });

  it("finds Luhn-valid card numbers and ignores invalid digit runs", () => {
    // Visa test PAN — passes Luhn.
    const valid = scanPii("Pay with 4111 1111 1111 1111 today");
    expect(valid.some((item) => item.kind === "card")).toBe(true);
    expect(passesLuhn("4111111111111111")).toBe(true);

    const invalid = scanPii("Not a card: 4111 1111 1111 1112");
    expect(invalid.some((item) => item.kind === "card")).toBe(false);
    expect(passesLuhn("4111111111111112")).toBe(false);
  });

  it("finds SSN-like id patterns", () => {
    const findings = scanPii("SSN on file: 123-45-6789");
    expect(findings.some((item) => item.kind === "id" && item.match === "123-45-6789")).toBe(true);
  });

  it("ignores random 4-digit numbers and plain prose", () => {
    expect(scanPii("Room 2042 opens at 9am")).toEqual([]);
    expect(scanPii("Please summarize the attached brief for the team.")).toEqual([]);
    expect(scanPii("hello @ world")).toEqual([]);
  });

  it("does not treat unformatted market caps as phones or ids", () => {
    const line = "volume 26367138, mkt cap 1129686761472, (yahoo, observed 2026-09-09T13:19Z)";
    expect(scanPii(line)).toEqual([]);
    expect(maskPii(line)).toBe(line);
    const idx = "mkt cap 1189000000000000, (yahoo)";
    expect(scanPii(idx)).toEqual([]);
    expect(maskPii(idx)).toBe(idx);
  });

  it("still masks a formatted phone next to a market cap", () => {
    const line = "mkt cap 1129686761472 call +1 (415) 555-2671";
    expect(maskPii(line)).toBe("mkt cap 1129686761472 call [phone]");
    expect(line).toContain("1129686761472");
  });
});

describe("maskPii", () => {
  it("replaces email with [email] and keeps the rest of the prompt", () => {
    const original = "Contact me at alex.rivera@example.com please";
    expect(maskPii(original)).toBe("Contact me at [email] please");
    expect(original).toContain("alex.rivera@example.com");
  });

  it("leaves a lone @ untouched", () => {
    expect(maskPii("hello @ world")).toBe("hello @ world");
  });

  it("masks text parts only", () => {
    const parts = maskPiiInParts([
      { type: "text", text: "mail alex.rivera@example.com" },
      { type: "image_url", image_url: { url: "/api/v1/media/x" } },
    ]);
    expect(parts[0]).toEqual({ type: "text", text: "mail [email]" });
    expect(parts[1]).toEqual({ type: "image_url", image_url: { url: "/api/v1/media/x" } });
  });

  it("masks system prompt and history for the model without mutating the source", () => {
    const input = {
      version: { systemPrompt: "Owner: alex.rivera@example.com" },
      history: [{ role: "user" as const, parts: [{ type: "text" as const, text: "Call +1 (415) 555-2671" }] }],
    };
    const masked = maskOutboundRunInput(input);
    expect(masked.version.systemPrompt).toBe("Owner: [email]");
    expect(input.version.systemPrompt).toContain("alex.rivera@example.com");
    expect(masked.history[0]?.parts[0]).toMatchObject({ type: "text", text: expect.stringContaining("[phone]") });
    expect(masked.history[0]?.parts[0]).toMatchObject({ type: "text", text: expect.not.stringContaining("415") });
  });
});

describe("piiWarning", () => {
  it("returns null when there are no findings", () => {
    expect(piiWarning([])).toBeNull();
  });

  it("returns a short sentence naming the kinds found", () => {
    const warning = piiWarning([
      { kind: "email", match: "a@b.co", index: 0 },
      { kind: "phone", match: "+14155552671", index: 10 },
    ]);
    expect(warning).toMatch(/email addresses/i);
    expect(warning).toMatch(/phone numbers/i);
    expect(warning).toMatch(/Remove personal data/i);
  });
});
