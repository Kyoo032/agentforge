import { describe, expect, it } from "vitest";
import { passesLuhn, piiWarning, scanPii } from "./pii";

describe("scanPii", () => {
  it("finds email addresses", () => {
    const findings = scanPii("Contact me at alex.rivera@example.com please");
    expect(findings).toEqual([
      { kind: "email", match: "alex.rivera@example.com", index: expect.any(Number) },
    ]);
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
