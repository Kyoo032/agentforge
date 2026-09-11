import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendUnavailable } from "../../backend";
import { WeKnoraClient } from "./client";
import { REDACTED } from "./redact";

/**
 * The client against a server that misbehaves in the two ways a process squatting on the sidecar's
 * loopback port would: an answer that never ends, and an error body with our own key in it.
 */

let server: Server;
let baseUrl: string;
/** What the route does next, set per test. */
let behaviour: "flood" | "declare" | "leak" | "ok" = "ok";

const LEAKED_KEY = "weknora-key-abcdef123456";
const CAP = 4_096;

beforeEach(async () => {
  server = createServer((_req, res) => {
    if (behaviour === "declare") {
      // Claims far more than the cap: the client must refuse before reading a byte of it.
      res.writeHead(200, { "Content-Type": "application/json", "Content-Length": String(CAP * 100) });
      res.write("{");
      return;
    }
    if (behaviour === "flood") {
      // Chunked, so there is no Content-Length to check: the cap has to hold while reading.
      res.writeHead(200, { "Content-Type": "application/json" });
      const chunk = "x".repeat(1_024);
      const pump = () => {
        for (let i = 0; i < 8; i += 1) {
          res.write(chunk);
        }
        if (!res.writableEnded && !res.destroyed) {
          setTimeout(pump, 1).unref?.();
        }
      };
      pump();
      return;
    }
    if (behaviour === "leak") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: `invalid key ${LEAKED_KEY} for tenant 1` }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  });
  baseUrl = await new Promise<string>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
});

afterEach(async () => {
  behaviour = "ok";
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function client(): WeKnoraClient {
  return new WeKnoraClient(baseUrl, { apiKey: LEAKED_KEY }, { maxResponseBytes: CAP });
}

describe("weknora client response cap", () => {
  it("refuses a body that declares more than the cap", async () => {
    behaviour = "declare";
    await expect(client().listModels()).rejects.toMatchObject({
      name: "BackendUnavailable",
      reason: "response_too_large",
    });
  }, 20_000);

  it("stops reading a stream that runs past the cap instead of buffering it", async () => {
    behaviour = "flood";
    const error = await client()
      .listModels()
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(BackendUnavailable);
    expect((error as BackendUnavailable).reason).toBe("response_too_large");
  }, 20_000);

  it("answers normally when the body is inside the cap", async () => {
    await expect(client().health()).resolves.toBe(true);
  }, 20_000);
});

describe("weknora client error bodies", () => {
  it("keeps the sidecar's error text out of the exception and the key out of the log", async () => {
    behaviour = "leak";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const error = await client()
        .listModels()
        .catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(BackendUnavailable);
      // Reason + status only: this string reaches `health.detail` on GET /api/v1/knowledge.
      expect((error as BackendUnavailable).reason).toBe("http_401");
      expect((error as BackendUnavailable).message).not.toContain("invalid key");
      expect((error as BackendUnavailable).message).not.toContain(LEAKED_KEY);
      // The body is still diagnosable, minus every secret we handed the sidecar.
      const logged = warn.mock.calls.map((call) => String(call[0])).join("\n");
      expect(logged).toContain("invalid key");
      expect(logged).toContain(REDACTED);
      expect(logged).not.toContain(LEAKED_KEY);
    } finally {
      warn.mockRestore();
    }
  }, 20_000);
});
