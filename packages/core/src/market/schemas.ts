/**
 * Shared market primitives: the http(s)-only URL schema and the forbidden
 * field names (C1). The Market Watch v2 row schemas live in watch-schemas.ts.
 */
import { z } from "zod";

const HTTP_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

/** Absolute http(s) URL; javascript:, data:, file: and friends are refused. */
export function isHttpUrl(value: string): boolean {
  try {
    return HTTP_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

export const httpUrlSchema = z.string().url().refine(isHttpUrl, { message: "must be an http(s) URL" });

/** Field names that must never appear on any market schema (C1). */
export const FORBIDDEN_FIELD_NAMES = [
  "action",
  "recommendation",
  "verdict",
  "signal",
  "rating",
  "target_price",
  "targetPrice",
  "target",
  "entry",
  "entry_price",
  "entryPrice",
  "stop_loss",
  "stopLoss",
  "take_profit",
  "takeProfit",
  "should_buy",
  "shouldBuy",
  "should_sell",
  "shouldSell",
  "buy",
  "sell",
  "hold",
  "position",
  "allocation",
  "score",
] as const;
