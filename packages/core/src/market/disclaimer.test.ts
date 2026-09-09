import { describe, expect, it } from "vitest";
import { AdviceLeakError, assertNoAdvice } from "./advice-guard";
import { MARKET_DISCLAIMER, MARKET_DISCLAIMER_EN, MARKET_DISCLAIMER_ID, withDisclaimer } from "./disclaimer";

describe("MARKET_DISCLAIMER", () => {
  it("matches the reference Indonesian wording", () => {
    expect(MARKET_DISCLAIMER_ID).toBe(
      "Informasi ini adalah rangkuman data dari sumber pihak ketiga, bukan rekomendasi atau saran investasi. Keputusan investasi sepenuhnya tanggung jawab pengguna.",
    );
  });

  it("joins ID and EN with a single space", () => {
    expect(MARKET_DISCLAIMER).toBe(`${MARKET_DISCLAIMER_ID} ${MARKET_DISCLAIMER_EN}`);
    expect(MARKET_DISCLAIMER_EN).toMatch(/not a recommendation/i);
  });

  it("passes the advice guard itself", () => {
    expect(() => assertNoAdvice({ disclaimer: MARKET_DISCLAIMER })).not.toThrow();
  });
});

describe("withDisclaimer", () => {
  it("returns a new object with the disclaimer stamped", () => {
    const input = { ticker: "BBCA", disclaimer: "" };
    const output = withDisclaimer(input);
    expect(output).not.toBe(input);
    expect(output.disclaimer).toBe(MARKET_DISCLAIMER);
    expect(output.ticker).toBe("BBCA");
    expect(input.disclaimer).toBe("");
  });

  it("refuses to stamp a payload that carries advice", () => {
    expect(() => withDisclaimer({ text: "beli sekarang", disclaimer: "" })).toThrow(AdviceLeakError);
  });
});
