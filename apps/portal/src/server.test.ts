/** The server factory: `/healthz`, and the seam lane B extends. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "./config";
import { createPortalServer, HEALTH_PATH, MAX_BODY_BYTES, type PortalServer } from "./server";
import { createTestStore, type TestStore } from "./testing/pg";

let harness: TestStore;
let portal: PortalServer;
let base: string;

beforeAll(async () => {
  harness = await createTestStore();
  const config = loadConfig({
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
});
