import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as briefing from "../artifacts/market-briefing";
import { lintSchemaFields } from "./schema-lint";
import * as schemas from "./schemas";
import { FORBIDDEN_FIELD_NAMES, httpUrlSchema, isHttpUrl } from "./schemas";
import * as watch from "./watch-schemas";

function zodExports(module: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  return Object.fromEntries(
    Object.entries(module).filter((entry): entry is [string, z.ZodTypeAny] => entry[1] instanceof z.ZodType),
  );
}

describe("isHttpUrl / httpUrlSchema", () => {
  it("accepts absolute http(s) urls only", () => {
    expect(isHttpUrl("https://example.test/a")).toBe(true);
    expect(isHttpUrl("http://example.test/a")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("ftp://example.test/a")).toBe(false);
    expect(isHttpUrl("data:text/plain,hi")).toBe(false);
    expect(isHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });

  it("is enforced by the schema and by every v2 ref/link field", () => {
    expect(httpUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(httpUrlSchema.safeParse("https://example.test/a").success).toBe(true);
    const ref = { source: "yahoo", sourceUrl: "javascript:alert(1)", observedAt: "2026-09-09T10:00:00Z" };
    expect(watch.watchRefSchema.safeParse(ref).success).toBe(false);
    expect(watch.watchRefSchema.safeParse({ ...ref, sourceUrl: "https://example.test" }).success).toBe(true);
    const goodRef = { ...ref, sourceUrl: "https://example.test" };
    expect(watch.watchNewsItemSchema.safeParse({ title: "T", link: "ftp://x.test/a", ref: goodRef }).success).toBe(
      false,
    );
  });
});

describe("forbidden-field lint (C1) over the v2 schemas", () => {
  const exported = { ...zodExports(schemas), ...zodExports(watch), ...zodExports(briefing) };

  it("only httpUrlSchema remains in schemas.ts", () => {
    expect(Object.keys(zodExports(schemas))).toEqual(["httpUrlSchema"]);
  });

  it("finds the v2 zod schemas", () => {
    expect(Object.keys(exported)).toEqual(
      expect.arrayContaining([
        "marketWatchPacketSchema",
        "tickerPacketSchema",
        "quoteSchema",
        "technicalSchema",
        "marketWatchRequestSchema",
        "marketBriefingSchema",
      ]),
    );
  });

  it("finds no forbidden field on any exported market schema", () => {
    expect(lintSchemaFields(exported)).toEqual([]);
  });

  it("flags a schema that carries a directive field", () => {
    expect(lintSchemaFields({ bad: z.object({ action: z.string() }) })).toEqual(["bad.action"]);
  });

  it("flags case-insensitively and through wrappers", () => {
    const wrapped = z
      .object({
        rows: z.array(z.object({ TargetPrice: z.number().nullable().default(null) })).default([]),
        inner: z.object({ Verdict: z.string() }).nullable(),
      })
      .refine(() => true);
    expect(lintSchemaFields({ wrapped })).toEqual(["wrapped.rows[].TargetPrice", "wrapped.inner.Verdict"]);
  });

  it("keeps the forbidden list lower-case comparable", () => {
    for (const name of FORBIDDEN_FIELD_NAMES) {
      expect(lintSchemaFields({ probe: z.object({ [name.toUpperCase()]: z.string() }) })).toHaveLength(1);
    }
  });
});

describe("v2 array bounds at the API boundary", () => {
  const ref = { source: "yahoo", sourceUrl: "https://example.test", observedAt: "2026-09-09T10:00:00Z" };
  const bar = { date: "2026-09-09", open: 1, high: 1, low: 1, close: 1, volume: 0 };

  it("caps history bars, news per ticker, and the watchlist", () => {
    const bars = Array.from({ length: watch.HISTORY_BARS_MAX + 1 }, () => bar);
    expect(watch.priceHistorySchema.safeParse({ symbol: "MU", bars, ref }).success).toBe(false);
    expect(watch.priceHistorySchema.safeParse({ symbol: "MU", bars: bars.slice(1), ref }).success).toBe(true);
    const request = { prompt: "p", tickers: Array.from({ length: watch.WATCHLIST_MAX + 1 }, () => "MU") };
    expect(watch.marketWatchRequestSchema.safeParse(request).success).toBe(false);
    expect(watch.marketWatchRequestSchema.safeParse({ ...request, tickers: ["MU"] }).success).toBe(true);
  });
});
