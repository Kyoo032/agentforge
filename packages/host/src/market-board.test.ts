import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@agentforge/core";
import { ensureSchema } from "@agentforge/db/ensure-schema";
import { packet as packetFixture } from "./market/__fixtures__/watch";
import { BOARD_SECTIONS, buildMarketBoard, parseBoardRequest } from "./market-board";

function statusOf(fn: () => void): number | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof ApiError ? error.status : -1;
  }
}

describe("parseBoardRequest", () => {
  it("rejects a missing, empty, or malformed watchlist with 400", () => {
    for (const body of [null, [], {}, { tickers: [] }, { tickers: ["", "MU"] }, { tickers: "MU" }]) {
      expect(statusOf(() => parseBoardRequest(body))).toBe(400);
    }
  });

  it("accepts a watchlist as typed; resolution happens in the packet", () => {
    expect(parseBoardRequest({ tickers: ["MU", "bbca"] })).toEqual({ tickers: ["MU", "bbca"] });
  });
});

describe("buildMarketBoard", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
    vi.stubEnv("AGENTFORGE_RUNTIME", "stub");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    db.close();
  });

  it("asks the packet builder for tickers only, skips headlines and macro, and needs no gateway", async () => {
    const calls: Array<{ request: unknown; include: unknown }> = [];
    const board = await buildMarketBoard(
      { tickers: ["MU", "BBCA"] },
      {
        db: () => db,
        buildPacket: async (_db, request, opts = {}) => {
          calls.push({ request, include: opts.include });
          return { packet: packetFixture(), failures: [] };
        },
      },
    );
    expect(BOARD_SECTIONS).toEqual({ news: false, macro: false });
    expect(calls).toEqual([{ request: { tickers: ["MU", "BBCA"], positionContext: "" }, include: BOARD_SECTIONS }]);
    expect(board.tickers).toHaveLength(packetFixture().tickers.length);
    expect(board.tickers[0]?.symbol.yahoo).toBe("MU");
    expect(board.tickers[0]?.chart).not.toBeNull();
    expect(board.clock).toEqual(packetFixture().clock);
    expect(board.failures).toEqual([]);
  });

  it("passes the client's abort signal through to the packet builder", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    await buildMarketBoard(
      { tickers: ["MU"] },
      {
        db: () => db,
        buildPacket: async (_db, _request, opts = {}) => {
          seen = opts.signal;
          return { packet: packetFixture(), failures: [] };
        },
      },
      controller.signal,
    );
    expect(seen).toBe(controller.signal);
  });

  it("answers 400 invalid_ticker when nothing on the watchlist resolves", async () => {
    await expect(
      buildMarketBoard(
        { tickers: ["ZZZZ"] },
        {
          db: () => db,
          buildPacket: async () => ({ packet: packetFixture({ tickers: [] }), failures: ["ZZZZ: unknown symbol"] }),
        },
      ),
    ).rejects.toMatchObject({ status: 400, code: "invalid_ticker" });
  });

  it("answers 502 market_unavailable when the sources are down", async () => {
    await expect(
      buildMarketBoard(
        { tickers: ["MU"] },
        {
          db: () => db,
          buildPacket: async () => ({ packet: packetFixture({ tickers: [] }), failures: ["MU: quote: timeout"] }),
        },
      ),
    ).rejects.toMatchObject({ status: 502, code: "market_unavailable" });
  });
});
