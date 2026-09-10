/**
 * Watch board: the keyless view of a watchlist. Quotes, two years of bars,
 * technicals, and a chart per ticker straight from the packet loaders; no
 * headlines, no macro, no model. It works before any API key is saved, so a
 * trader sees prices and charts the moment a ticker is typed.
 */
import type Database from "better-sqlite3";
import { ApiError } from "@agentforge/core";
import {
  marketBoardRequestSchema,
  marketBoardSchema,
  type MarketBoard,
  type MarketBoardRequest,
} from "@agentforge/core/market";
import { buildMarketWatchPacket, type PacketClients, type PacketSections } from "./market";
import { requireTickers } from "./market-generate";

export type MarketBoardDeps = {
  db?: () => Database.Database | Promise<Database.Database>;
  now?: () => Date;
  clients?: PacketClients;
  buildPacket?: typeof buildMarketWatchPacket;
};

/** The board never fetches headlines or macro levels; those belong to the written briefing. */
export const BOARD_SECTIONS: PacketSections = { news: false, macro: false };

function requireObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("invalid_request", "Request body must be a JSON object", 400);
  }
  return body as Record<string, unknown>;
}

export function parseBoardRequest(body: unknown): MarketBoardRequest {
  const parsed = marketBoardRequestSchema.safeParse(requireObject(body));
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
    throw new ApiError("invalid_request", `Invalid watch board request: ${detail}`, 400);
  }
  return parsed.data;
}

async function openDb(deps: MarketBoardDeps): Promise<Database.Database> {
  if (deps.db) {
    return deps.db();
  }
  return (await import("@agentforge/db")).sql;
}

/** 400 for a bad body or a watchlist nothing on it resolves; 502 when every source is down. */
export async function buildMarketBoard(
  body: unknown,
  deps: MarketBoardDeps = {},
  signal?: AbortSignal,
): Promise<MarketBoard> {
  const request = parseBoardRequest(body);
  const db = await openDb(deps);
  const build = deps.buildPacket ?? buildMarketWatchPacket;
  const { packet, failures } = await build(
    db,
    { tickers: request.tickers, positionContext: "" },
    { now: deps.now, clients: deps.clients, signal, include: BOARD_SECTIONS },
  );
  requireTickers(packet, failures);
  return marketBoardSchema.parse({ tickers: packet.tickers, clock: packet.clock, failures });
}
