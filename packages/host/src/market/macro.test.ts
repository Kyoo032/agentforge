import { describe, expect, it } from "vitest";
import { MACRO_SYMBOLS } from "@agentforge/core/market";
import quotesFixture from "./__fixtures__/yahoo-quotes.json";
import { fetchMacro, macroLabel } from "./macro";
import type { YahooClient } from "./yahoo";

const NOW = new Date("2026-09-09T03:00:00.000Z");
const now = () => NOW;

function client(rows: unknown[] | Error): YahooClient & { asked: string[][] } {
  const asked: string[][] = [];
  return {
    asked,
    async quote(symbols) {
      asked.push([...symbols]);
      if (rows instanceof Error) {
        throw rows;
      }
      return rows;
    },
    async chart() {
      throw new Error("not used");
    },
    async search() {
      throw new Error("not used");
    },
  };
}

describe("fetchMacro", () => {
  it("asks for every MACRO_SYMBOL in one batch and labels what came back", async () => {
    const fake = client(quotesFixture.rows.filter((row) => ["ES=F", "^VIX", "IDR=X"].includes(row.symbol)));
    const snapshot = await fetchMacro({ client: fake, now });
    expect(fake.asked).toEqual([MACRO_SYMBOLS.map((entry) => entry.symbol)]);
    expect(snapshot.quotes.map((quote) => [quote.symbol, quote.label, quote.price])).toEqual([
      ["ES=F", "S&P 500 futures", 6612.25],
      ["^VIX", "VIX", 15.12],
      ["IDR=X", "USD/IDR", 16420],
    ]);
    expect(snapshot.failures).toEqual([
      "NQ=F: no quote returned",
      "YM=F: no quote returned",
      "RTY=F: no quote returned",
      "^TNX: no quote returned",
      "CL=F: no quote returned",
      "DX-Y.NYB: no quote returned",
      "^JKSE: no quote returned",
    ]);
  });

  it("turns a failed batch into one macro failure, never a throw", async () => {
    const snapshot = await fetchMacro({ client: client(new Error("ETIMEDOUT")), now });
    expect(snapshot).toEqual({ quotes: [], failures: ["macro: ETIMEDOUT"] });
  });

  it("knows the label for every macro symbol", () => {
    for (const entry of MACRO_SYMBOLS) {
      expect(macroLabel(entry.symbol)).toBe(entry.label);
    }
    expect(macroLabel("MU")).toBe("");
  });
});
