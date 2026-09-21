/**
 * The one static file the portal serves: the brand mark in the page shell.
 *
 * Served rather than inlined as a `data:` URI on purpose. The CSP allows `data:` images, so a URI
 * would have worked -- and it would have put ~228 KB of base64 into EVERY sign-in page, every
 * error page and every approve screen, uncacheable, on a phone. A file with an immutable
 * `Cache-Control` is fetched once.
 *
 * This is also the first response the portal sends that is not text, so the bytes are checked
 * against the file on disk: a PNG that arrives utf8-mangled still renders as "an image" to a test
 * that only asserts a 200 and a content-type.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import { createPortalServer, type PortalServer } from "../server";
import { createTestStore, type TestStore } from "../testing/pg";
import { assetRoutes, LOGO_PATH, logoBytes } from "./assets";

let harness: TestStore;
let portal: PortalServer;
let base: string;

beforeAll(async () => {
  harness = await createTestStore();
  const config = loadConfig({
    PORTAL_DATA_DIR: process.cwd(),
    PORTAL_DATABASE_URL: harness.database.url,
    PORTAL_PORT: "0",
  });
  portal = createPortalServer({ config, store: harness.store, routes: assetRoutes() });
  const { port } = await portal.listen();
  base = `http://127.0.0.1:${port}`;
}, 120_000);

afterAll(async () => {
  await portal?.close();
  await harness?.close();
});

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("GET /assets/logo.png", () => {
  it("is served at the path the page shell asks for", () => {
    expect(LOGO_PATH).toBe("/assets/logo.png");
  });

  it("hands back the PNG byte for byte", async () => {
    const response = await fetch(`${base}${LOGO_PATH}`);
    expect(response.status).toBe(200);
    const received = new Uint8Array(await response.arrayBuffer());
    expect(received.byteLength).toBe(logoBytes().byteLength);
    expect(sha256(received)).toBe(sha256(logoBytes()));
    // The PNG signature, so a utf8 round trip is caught by name rather than only by hash.
    expect([...received.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("is a PNG the browser may not sniff, and may cache for a long time", async () => {
    const response = await fetch(`${base}${LOGO_PATH}`);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const cacheControl = response.headers.get("cache-control") ?? "";
    expect(cacheControl).toContain("public");
    expect(cacheControl).toMatch(/max-age=\d{5,}/);
    // The server's blanket `no-store` is for pages that carry a code. It must not reach this.
    expect(cacheControl).not.toContain("no-store");
  });

  it("answers a HEAD with the headers and no body", async () => {
    const response = await fetch(`${base}${LOGO_PATH}`, { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });

  it("serves nothing else out of /assets", async () => {
    // There is no directory here and no path joining: one exact path, one file read at module
    // load. A traversal has nothing to traverse, and this says so rather than assuming it.
    for (const path of ["/assets/", "/assets/logo.png/", "/assets/../config.ts", "/assets/other.png"]) {
      expect((await fetch(`${base}${path}`)).status, path).toBe(404);
    }
  });
});
