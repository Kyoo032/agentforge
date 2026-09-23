/** The server factory: `/healthz`, and the seam lane B extends. */
import { connect } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type PortalConfig } from "./config";
import { createLogger } from "./log";
import { createPortalServer, HEALTH_PATH, MAX_BODY_BYTES, type PortalServer } from "./server";
import { createTestStore, type TestStore } from "./testing/pg";
import { startTestPortal, type PortalHarness } from "./testing/server";

let harness: TestStore;
let config: PortalConfig;
let portal: PortalServer;
let base: string;

/**
 * One HTTP/1.1 exchange over a bare socket: these bytes go out, whatever comes back comes back.
 *
 * `fetch` is no use for the malformed requests below. It normalises a request line and may refuse
 * a Host header before a byte leaves the process, and a test of what the server does with a bad
 * request has to be able to send one. A server that never answers is reported as `""` once the
 * timeout ends the wait.
 */
function rawExchange(port: number, request: string, timeoutMs = 3_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ port, host: "127.0.0.1" });
    const chunks: Buffer[] = [];
    socket.setTimeout(timeoutMs, () => socket.destroy());
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("error", reject);
    socket.write(request);
  });
}

function statusLine(reply: string): string {
  return reply.split("\r\n")[0] ?? "";
}

function jsonBody(reply: string): Record<string, unknown> {
  return JSON.parse(reply.slice(reply.indexOf("\r\n\r\n") + 4)) as Record<string, unknown>;
}

/** Every unhandled rejection this file's process sees, so a test can assert there were none. */
const rejections: unknown[] = [];
const recordRejection = (reason: unknown): void => {
  rejections.push(reason);
};

beforeAll(async () => {
  process.on("unhandledRejection", recordRejection);
  harness = await createTestStore();
  config = loadConfig({
    PORTAL_DATA_DIR: process.cwd(),
    PORTAL_DATABASE_URL: harness.database.url,
    // 0 asks the OS for a free port, so two suites never collide.
    PORTAL_PORT: "0",
  });
  portal = createPortalServer({ config, store: harness.store });
  const { port } = await portal.listen();
  base = `http://127.0.0.1:${port}`;
}, 120_000);

afterAll(async () => {
  process.off("unhandledRejection", recordRejection);
  await portal?.close();
  await harness?.close();
});

describe("createPortalServer", () => {
  it("answers GET /healthz", async () => {
    const response = await fetch(`${base}${HEALTH_PATH}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; time: string };
    expect(body.status).toBe("ok");
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });

  it("says nothing about the software answering", async () => {
    const response = await fetch(`${base}${HEALTH_PATH}`);
    expect(response.headers.get("x-powered-by")).toBeNull();
    expect(response.headers.get("server")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("serves only /healthz until lane B registers the rest", async () => {
    for (const path of ["/authorize", "/auth/token", "/", "/.well-known/jwks.json"]) {
      const response = await fetch(`${base}${path}`);
      expect(response.status, path).toBe(404);
    }
  });

  it("answers 405 for the wrong method on a known path", async () => {
    const response = await fetch(`${base}${HEALTH_PATH}`, { method: "POST" });
    expect(response.status).toBe(405);
  });

  it("takes a route from register(), which is how lane B builds on it", async () => {
    portal.register({
      method: "POST",
      path: "/test/echo",
      handle(request) {
        return { status: 200, json: { seen: request.body.length, method: request.method } };
      },
    });
    const response = await fetch(`${base}/test/echo`, { method: "POST", body: "hello" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ seen: 5, method: "POST" });
  });

  it("hands a handler the store, the config and the clock", async () => {
    portal.register({
      method: "GET",
      path: "/test/context",
      handle(_request, context) {
        return {
          status: 200,
          json: {
            hasStore: typeof context.store.tx === "function",
            production: context.config.production,
            now: context.clock.now().toISOString(),
          },
        };
      },
    });
    const body = (await (await fetch(`${base}/test/context`)).json()) as Record<string, unknown>;
    expect(body.hasStore).toBe(true);
    expect(body.production).toBe(false);
  });

  /**
   * SR-41. A body over the 64 KB ceiling threw a plain `Error`, which the catch-all below turned
   * into `500 internal_error` -- so the one refusal a caller can act on was reported as a fault of
   * the server's. It is a 413 with the same error body every other refusal uses.
   */
  it("answers 413 with the standard error body for a body over the server's cap", async () => {
    portal.register({
      method: "POST",
      path: "/test/big",
      handle() {
        return { status: 200, json: { reached: true } };
      },
    });
    const response = await fetch(`${base}/test/big`, {
      method: "POST",
      body: "x".repeat(MAX_BODY_BYTES + 1),
    });
    expect(response.status).toBe(413);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toBe("invalid_request");
    expect(body.reason).toBe("invalid_request");
    expect(typeof body.message_en).toBe("string");
    expect(typeof body.message_id).toBe("string");
  });

  it("answers a thrown handler with a flat 500 that describes nothing", async () => {
    portal.register({
      method: "GET",
      path: "/test/boom",
      handle() {
        throw new Error("relation \"secrets\" does not exist");
      },
    });
    const response = await fetch(`${base}/test/boom`);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toBe(JSON.stringify({ error: "internal_error" }));
    expect(text).not.toContain("secrets");
  });

  /**
   * The error path has its own error path. A logger that throws (stderr gone, EPIPE) used to throw
   * out of the catch block, and the handler is a `void`ed async function, so that became an
   * unhandled rejection. The request is contained now: the caller still gets the flat 500 and the
   * process sees no rejection.
   */
  it("contains a failure inside its own error handling, so a request never becomes an unhandled rejection", async () => {
    const brittle = createLogger({
      env: {},
      sink: () => {
        throw new Error("EPIPE: stderr is gone");
      },
    });
    const server = createPortalServer({ config, store: harness.store, log: brittle });
    server.register({
      method: "GET",
      path: "/test/boom-twice",
      handle() {
        throw new Error("handler failed");
      },
    });
    const { port } = await server.listen();
    try {
      const before = rejections.length;
      const reply = await rawExchange(
        port,
        "GET /test/boom-twice HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
      );
      expect(statusLine(reply)).toBe("HTTP/1.1 500 Internal Server Error");
      expect(jsonBody(reply)).toEqual({ error: "internal_error" });
      expect(rejections.slice(before)).toEqual([]);
    } finally {
      await server.close();
    }
  });
});

/**
 * A request the URL parser cannot resolve used to kill the process. `server.ts` built
 * `new URL(incoming.url, "http://" + <Host header>)` OUTSIDE the handler's try, inside a `void`ed
 * async function, so the TypeError became an unhandled rejection, and Node exits on one of those.
 * `Host: a b` and `GET //x:99999/healthz` were each one packet from anybody who could reach the
 * port (both reproduced against the unfixed server: exit code 1, `TypeError: Invalid URL`).
 *
 * The base is fixed now, so the Host header cannot break the parse at all, and a target that still
 * cannot be parsed is the caller's 400.
 *
 * Driven against the whole portal (every route registered, `src/testing/server.ts`) over a bare
 * socket, because a client library would tidy these requests up before sending them.
 */
describe("a request whose target or Host header is not a URL", () => {
  let full: PortalHarness;
  let fullPort: number;

  beforeAll(async () => {
    full = await startTestPortal();
    fullPort = Number(new URL(full.origin).port);
  }, 120_000);

  afterAll(async () => {
    await full?.close();
  });

  it("answers a Host header with a space in it like any other request, because Host is not read", async () => {
    const before = rejections.length;
    const reply = await rawExchange(
      fullPort,
      "GET /healthz HTTP/1.1\r\nHost: a b\r\nConnection: close\r\n\r\n",
    );

    expect(statusLine(reply)).toBe("HTTP/1.1 200 OK");
    expect(jsonBody(reply).status).toBe("ok");
    expect(rejections.slice(before)).toEqual([]);
    expect((await fetch(`${full.origin}${HEALTH_PATH}`)).status).toBe(200);
  });

  const unparseable: ReadonlyArray<readonly [string, string]> = [
    [
      "a scheme-relative target with an out-of-range port",
      "GET //x:99999/healthz HTTP/1.1\r\nHost: 127.0.0.1\r\n",
    ],
    ["an absolute-form target with an out-of-range port", "GET http://x:99999/healthz HTTP/1.1\r\nHost: 127.0.0.1\r\n"],
    ["a scheme-relative target with a space in its host", "GET //a%20b/healthz HTTP/1.1\r\nHost: 127.0.0.1\r\n"],
  ];

  for (const [name, head] of unparseable) {
    it(`answers 400 with the standard error body to ${name}, and keeps serving`, async () => {
      const before = rejections.length;
      const reply = await rawExchange(fullPort, `${head}Connection: close\r\n\r\n`);

      expect(statusLine(reply)).toBe("HTTP/1.1 400 Bad Request");
      const body = jsonBody(reply);
      expect(body.error).toBe("invalid_request");
      expect(body.reason).toBe("invalid_request");
      expect(typeof body.message_en).toBe("string");
      expect(typeof body.message_id).toBe("string");
      expect(rejections.slice(before)).toEqual([]);

      // The same process answers the next caller.
      const health = await fetch(`${full.origin}${HEALTH_PATH}`);
      expect(health.status).toBe(200);
    });
  }

  it("still routes an ordinary request whatever the Host header says", async () => {
    // The base URL no longer comes from the Host header, and nothing read from the URL needs it:
    // only the path and the query are used.
    const reply = await rawExchange(
      fullPort,
      "GET /healthz?probe=1 HTTP/1.1\r\nHost: portal.example.test:8443\r\nConnection: close\r\n\r\n",
    );
    expect(statusLine(reply)).toBe("HTTP/1.1 200 OK");
    expect(jsonBody(reply).status).toBe("ok");
  });
});
