"use client";

/**
 * The ratio task's own call to `/api/v1/finance/parse`.
 *
 * The brief's `parseFigures` answers with rows alone, which is all the brief needs. This task needs
 * the bucket each row was put in and the evidence behind it, because that table is the thing the
 * owner confirms before anything is computed — so it reads the same response the host already
 * sends, one field wider.
 */
import type { LineItem, RatioBucket, RatioStatedRow } from "@agentforge/core/finance";
import { apiFetch } from "./api-client";

export type RatiosParsedRow = {
  readonly label: string;
  readonly period: string;
  readonly amount: number;
  readonly currency: string;
  readonly bucket: RatioBucket;
  readonly confidence: number;
  readonly source: string;
  readonly reason: string;
  readonly section: string;
};

export type RatiosParsed = {
  readonly items: LineItem[];
  readonly buckets: readonly RatiosParsedRow[];
  readonly periods: readonly string[];
  readonly subtotalsIgnored: number;
  /** The subtotal rows the sheet printed. Forwarded to the job so the maths can be held against them. */
  readonly stated: readonly RatioStatedRow[];
  readonly modelAssist: { readonly asked: number; readonly placed: number; readonly error: string | null } | null;
};

function messageOf(payload: unknown, fallback: string): string {
  const error = payload && typeof payload === "object" ? (payload as { error?: { message?: unknown } }).error : null;
  return error && typeof error.message === "string" && error.message.trim() ? error.message : fallback;
}

/** Statement text in, classified rows out. Nothing is computed by this call. */
export async function parseRatiosStatement(figures: string, model: string, fallback: string): Promise<RatiosParsed> {
  const res = await apiFetch("/api/v1/finance/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ figures, task: "ratios", model: model || undefined }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || typeof data !== "object") {
    throw new Error(messageOf(data, fallback));
  }
  const answer = data as Partial<RatiosParsed>;
  return {
    items: Array.isArray(answer.items) ? answer.items : [],
    buckets: Array.isArray(answer.buckets) ? answer.buckets : [],
    periods: Array.isArray(answer.periods) ? answer.periods : [],
    subtotalsIgnored: typeof answer.subtotalsIgnored === "number" ? answer.subtotalsIgnored : 0,
    stated: Array.isArray(answer.stated) ? answer.stated : [],
    modelAssist: answer.modelAssist ?? null,
  };
}
