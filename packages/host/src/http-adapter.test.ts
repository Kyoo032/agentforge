import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostRequest } from "./types";

// Isolation: nothing in this file may reach the real data/ directory. The router and the boot hook are
// mocked out below so no handler runs, and the data dir is pointed at a temp folder as a second fence.
const dataDir = mkdtempSync(join(tmpdir(), "agentforge-http-adapter-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;

const dispatched: HostRequest[] = [];

vi.mock("./router", () => ({
  dispatch: async (request: HostRequest) => {
    dispatched.push(request);
    return { type: "json" as const, status: 200, body: { ok: true } };
  },
}));

vi.mock("./workspace", () => ({ readSelectedWorkspaceId: () => undefined }));

vi.mock("./handlers/edit", () => ({ handleBootEditJobs: async () => {} }));

const { handleNodeRequest, writeHostResult } = await import("./http-adapter");

type RequestInput = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
};

function fakeRequest({ method, url, headers = {}, body }: RequestInput): IncomingMessage {
  const stream = new PassThrough();
  stream.end(body ? Buffer.from(body, "utf8") : undefined);
  const req = stream as unknown as IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  return req;
}

type Captured = {
  res: ServerResponse;
  status: () => number;
  json: () => { error?: { code?: string; message?: string } };
  header: (name: string) => string | undefined;
};

function fakeResponse(): Captured {
  const chunks: string[] = [];
  const headers = new Map<string, string>();
  const sink = {
    statusCode: 200,
    writableFinished: false,
    setHeader(name: string, value: unknown): void {
      headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(", ") : String(value));
    },
    on(): unknown {
      return sink;
    },
    flushHeaders(): void {},
    write(chunk: unknown): boolean {
      chunks.push(String(chunk));
      return true;
    },
    end(chunk?: unknown): void {
      if (chunk !== undefined) {
        chunks.push(String(chunk));
      }
      sink.writableFinished = true;
    },
  };
  return {
    res: sink as unknown as ServerResponse,
    status: () => sink.statusCode,
    json: () => {
      try {
        return JSON.parse(chunks.join(""));
      } catch {
        return {};
      }
    },
    header: (name: string) => headers.get(name.toLowerCase()),
  };
}

const RESET_PATH = "/api/v1/settings/reset";
const LOOPBACK_HOST = "127.0.0.1:3000";
const TRANSPORT = { "x-agentforge-transport": "web" };

beforeEach(() => {
  dispatched.length = 0;
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("handleNodeRequest reset-route transport guard", () => {
  it("rejects a form-style POST to the reset route with no transport header", async () => {
    const captured = fakeResponse();
    const handled = await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: RESET_PATH,
        headers: { host: LOOPBACK_HOST, "content-type": "application/x-www-form-urlencoded" },
        body: "scope=all&confirm=RESET",
      }),
      captured.res,
    );
    expect(handled).toBe(true);
    expect(captured.status()).toBe(403);
    expect(captured.json().error?.code).toBe("forbidden");
    expect(dispatched).toHaveLength(0);
  });

  it("rejects a DELETE on the reset route with no transport header", async () => {
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "DELETE", url: RESET_PATH, headers: { host: LOOPBACK_HOST } }),
      captured.res,
    );
    expect(captured.status()).toBe(403);
    expect(dispatched).toHaveLength(0);
  });

  it("passes a JSON POST with the transport header and a loopback Host to the handler", async () => {
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: RESET_PATH,
        headers: { host: LOOPBACK_HOST, "content-type": "application/json", ...TRANSPORT },
        body: JSON.stringify({ scope: "key" }),
      }),
      captured.res,
    );
    expect(captured.status()).toBe(200);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ method: "POST", path: RESET_PATH, body: { scope: "key" } });
  });

  it("leaves other mutating routes alone when the transport header is missing", async () => {
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: "/api/v1/settings/gateway/check",
        headers: { host: "localhost:3000" },
      }),
      captured.res,
    );
    expect(captured.status()).toBe(200);
    expect(dispatched).toHaveLength(1);
  });
});

describe("handleNodeRequest Host guard", () => {
  it("rejects a mutating request whose Host is not loopback", async () => {
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: "/api/v1/settings/gateway/check",
        headers: { host: "attacker.example", ...TRANSPORT },
      }),
      captured.res,
    );
    expect(captured.status()).toBe(403);
    expect(captured.json().error?.code).toBe("forbidden");
    expect(dispatched).toHaveLength(0);
  });

  it("rejects a mutating request with no Host header at all", async () => {
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "POST", url: "/api/v1/settings/gateway/check", headers: TRANSPORT }),
      captured.res,
    );
    expect(captured.status()).toBe(403);
    expect(dispatched).toHaveLength(0);
  });

  it("accepts the bracketed IPv6 loopback Host", async () => {
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "POST", url: "/api/v1/settings/gateway/check", headers: { host: "[::1]:3000" } }),
      captured.res,
    );
    expect(captured.status()).toBe(200);
    expect(dispatched).toHaveLength(1);
  });

  it("still rejects a remote Origin on a loopback Host", async () => {
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: "/api/v1/settings/gateway/check",
        headers: { host: LOOPBACK_HOST, origin: "https://evil.example", ...TRANSPORT },
      }),
      captured.res,
    );
    expect(captured.status()).toBe(403);
    expect(dispatched).toHaveLength(0);
  });
});

describe("handleNodeRequest safe methods", () => {
  it("leaves GET untouched by the Host and transport guards", async () => {
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "GET", url: `${RESET_PATH}?scope=all`, headers: { host: "attacker.example" } }),
      captured.res,
    );
    expect(captured.status()).toBe(200);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ method: "GET", path: RESET_PATH, query: { scope: "all" } });
  });

  it("leaves a GET with no Host header untouched", async () => {
    const captured = fakeResponse();
    await handleNodeRequest(fakeRequest({ method: "GET", url: "/api/v1/ping" }), captured.res);
    expect(captured.status()).toBe(200);
    expect(dispatched).toHaveLength(1);
  });

  it("ignores non-/api paths", async () => {
    const captured = fakeResponse();
    const handled = await handleNodeRequest(
      fakeRequest({ method: "POST", url: "/not-api", headers: { host: "attacker.example" } }),
      captured.res,
    );
    expect(handled).toBe(false);
    expect(dispatched).toHaveLength(0);
  });
});

describe("writeHostResult content-type sniffing guard", () => {
  it("stamps X-Content-Type-Options: nosniff on the JSON, bytes and SSE branches", async () => {
    const asJson = fakeResponse();
    await writeHostResult(asJson.res, { type: "json", status: 200, body: { ok: true } });
    expect(asJson.header("x-content-type-options")).toBe("nosniff");

    const asBytes = fakeResponse();
    await writeHostResult(asBytes.res, {
      type: "bytes",
      status: 200,
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      filename: "shot.png",
    });
    expect(asBytes.header("x-content-type-options")).toBe("nosniff");

    const asStream = fakeResponse();
    await writeHostResult(asStream.res, {
      type: "stream",
      status: 200,
      events: (async function* () {
        yield "data: {}\n\n";
      })(),
    });
    expect(asStream.header("x-content-type-options")).toBe("nosniff");
  });
});
