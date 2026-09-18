import { describe, expect, it } from "vitest";
import { PII_MASK, maskOutboundRunInput, maskPii, maskPiiInParts, passesLuhn, piiWarning, scanPii } from "./pii";

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

describe("Indonesian identifiers", () => {
  // Invented numbers. `99` is the province code reserved for fixtures; the rest are format samples.
  it("masks a NIK, an NPWP and an 08xx phone", () => {
    expect(maskPii("NIK 3273010101900001")).toBe("NIK [nik]");
    expect(maskPii("Karyawan 9901011505880042 aktif")).toBe("Karyawan [nik] aktif");
    expect(maskPii("NPWP 09.254.294.3-407.000")).toBe("NPWP [npwp]");
    expect(maskPii("HP 081234567890")).toBe("HP [phone]");
    expect(maskPii("No. Rekening: 1234567890")).toBe("No. Rekening: [account]");
  });

  it("has a token for every kind it can report", () => {
    expect(Object.keys(PII_MASK).sort()).toEqual([
      "account",
      "card",
      "email",
      "id",
      "name",
      "nik",
      "npwp",
      "phone",
    ]);
  });
});

describe("money is never masked", () => {
  // F: `1.250.000.000.000` came back as `[phone]` and a Luhn-lucky bare total as `[card]`. Both
  // rewrote a figure a Finance brief is built from, which is the one thing masking may not do.
  it("leaves dot-grouped rupiah totals alone at every magnitude", () => {
    for (const amount of [
      "1.250.000.000",
      "1.250.000.000.000",
      "1.250.000.000.000.000",
      "876.540.000.000.000.000",
      "3.500.000,50",
      "1,250,000,000",
    ]) {
      expect({ amount, masked: maskPii(amount) }).toEqual({ amount, masked: amount });
    }
  });

  it("leaves bare totals alone even when they happen to pass Luhn", () => {
    for (const amount of ["87654000000000", "8765400000000000", "876540000000000000", "1250000000000000"]) {
      expect({ amount, masked: maskPii(amount) }).toEqual({ amount, masked: amount });
    }
    expect(passesLuhn("87654000000000")).toBe(true);
  });

  it("still masks a card a person actually wrote out", () => {
    expect(maskPii("Pay with 4111 1111 1111 1111 today")).toBe("Pay with [card] today");
    expect(maskPii("Card 4111111111111111 on file")).toBe("Card [card] on file");
  });
});

describe("an accounting negative is still money", () => {
  // F: a sheet wrote 2024 cost of sales as `(23.960.000.000)`. The opening bracket read as phone
  // formatting, the grouping veto only knew bare digits, and the figure reached the parser as
  // `[phone])` — the brief's EBIT, its interest cover and every ratio built on them went with it.
  it("leaves bracketed, signed, spaced and currency-wrapped figures alone", () => {
    for (const amount of [
      "(23.960.000.000)",
      "(4.025.000.000)",
      "( 23.960.000.000 )",
      "(1,234,567.00)",
      "(23 960 000 000)",
      "-23.960.000.000",
      "+23.960.000.000",
      "Rp (1.250.000.000)",
      "(Rp1.250.000.000)",
      "USD (65,000,000,000)",
      "Rp 23.960.000.000",
      "1.250.000,50",
    ]) {
      expect({ amount, masked: maskPii(amount) }).toEqual({ amount, masked: amount });
    }
  });

  it("keeps both figures of the row the parser is handed", () => {
    const row = "Harga Pokok Penjualan | (23.960.000.000) | (4.025.000.000)";
    expect(maskPii(row)).toBe(row);
  });

  // F: a PDF flattens its table to one line, so two figures stand side by side with only a space
  // between them. The matcher offered `368.000.000 9` — a phone-shaped slice cut across both — and
  // masking it took `7.368.000.000` and `9.004.650.000` out of an annual report in one move.
  it("never masks a slice cut out of two amounts standing side by side", () => {
    for (const line of [
      "Laba kotor 7.368.000.000 9.004.650.000",
      "Beban penjualan 2.210.400.000 2.635.800.000",
      "Kas dan setara kas awal tahun 1.120.000.000 1.586.500.000",
      "Laba bersih 1,736,800,000 2,585,000,000",
    ]) {
      expect({ line, masked: maskPii(line) }).toEqual({ line, masked: line });
    }
  });

  it("still masks a phone, whatever brackets or country code it carries", () => {
    for (const phone of [
      "+62 812-3456-7890",
      "(021) 555-1234",
      "(0812) 3456-789",
      "0812 3456 7890",
      "+1 (415) 555-2671",
      "021-5551234",
    ]) {
      expect({ phone, masked: maskPii(phone) }).toEqual({ phone, masked: "[phone]" });
    }
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
