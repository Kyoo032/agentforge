import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

/**
 * A stand-in for the WeKnora-lite sidecar: the handful of routes this host calls, with the exact
 * response envelopes upstream uses at the pinned commit (`{success, data}` everywhere except
 * `/auth/auto-setup`, which answers at the top level).
 *
 * It exists so the whole backend — bootstrap, client, mapper, outbox, degraded fallback — can be
 * tested on a machine that has no Go toolchain and no binary, which is every machine until CI
 * builds one. The integration suite runs the same assertions against the real thing.
 *
 * Retrieval is a substring match over ingested content, which is enough to prove the *plumbing*:
 * that a planted fact reaches the sidecar, comes back with our own source identity attached, and
 * survives the mapper. Ranking quality is upstream's problem, not this file's.
 */

export type FakeKnowledge = {
  id: string;
  kbId: string;
  title: string;
  content: string;
  customMetadata: Record<string, string>;
};

export type FakeWeKnora = {
  baseUrl: string;
  /** Every document currently ingested, newest last. */
  documents(): FakeKnowledge[];
  /** Embedding model rows the sidecar holds, each of which carries a gateway key. */
  models(): Array<{ id: string; name: string; type: string }>;
  /** Answer nothing at all, forever: a sidecar that is up but wedged. */
  setStalled(stalled: boolean): void;
  /** Requests seen, as `METHOD /path`, for asserting call shape. */
  calls(): string[];
  /** Headers of the most recent authenticated request. */
  lastHeaders(): Record<string, string | undefined>;
  /** Stop answering: every request is dropped mid-flight, like a killed sidecar. */
  setOffline(offline: boolean): void;
  /** Answer the next `n` requests with a 500, then recover. */
  failNext(count: number): void;
  close(): Promise<void>;
};

type State = {
  apiKey: string | null;
  tenantId: string;
  models: Array<{ id: string; name: string; type: string }>;
  knowledgeBases: Map<string, { id: string; name: string; modelId: string }>;
  knowledge: Map<string, FakeKnowledge>;
  calls: string[];
  lastHeaders: Record<string, string | undefined>;
  offline: boolean;
  stalled: boolean;
  failures: number;
};

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** `Knowledge.CustomMetadataText()`: `key: value` lines, keys sorted, blank values dropped. */
export function renderCustomMetadata(values: Record<string, string>): string {
  return Object.keys(values)
    .sort()
    .filter((key) => key.trim() && String(values[key] ?? "").trim())
    .map((key) => `${key}: ${String(values[key]).trim()}`)
    .join("\n");
}

/** Documents are stored whole; chunks are the paragraphs the host joined them from. */
function chunksOf(document: FakeKnowledge): string[] {
  return document.content.split("\n\n").filter((part) => part.trim().length > 0);
}

function searchHits(state: State, kbId: string, query: string, limit: number): unknown[] {
  const needle = query.trim().toLowerCase();
  const hits: unknown[] = [];
  for (const document of state.knowledge.values()) {
    if (document.kbId !== kbId) {
      continue;
    }
    chunksOf(document).forEach((body, index) => {
      if (!body.toLowerCase().includes(needle)) {
        return;
      }
      hits.push({
        id: `${document.id}#${index}`,
        content: body,
        knowledge_id: document.id,
        chunk_index: index,
        knowledge_title: document.title,
        // Upstream's `match_type` is an integer iota, not a string. Kept honest so a client that
        // ever started reading it would break here first.
        match_type: 0,
        score: 1 / (hits.length + 1),
        metadata: {},
        knowledge_custom_metadata: renderCustomMetadata(document.customMetadata),
      });
    });
  }
  return hits.slice(0, Math.max(1, limit));
}

function segments(url: string): string[] {
  return pathOf(url).split("/").filter(Boolean);
}

/** The path part of a request URL, with any query string dropped. */
function pathOf(url: string): string {
  const [path] = url.split("?");
  return path ?? "/";
}

/** Routes that need no credentials, exactly as upstream's middleware whitelist has them. */
function isPublic(method: string, path: string): boolean {
  return path === "/health" || (method === "POST" && path === "/api/v1/auth/auto-setup");
}

export async function startFakeWeKnora(): Promise<FakeWeKnora> {
  const state: State = {
    apiKey: null,
    tenantId: "1",
    models: [],
    knowledgeBases: new Map(),
    knowledge: new Map(),
    calls: [],
    lastHeaders: {},
    offline: false,
    stalled: false,
    failures: 0,
  };
  const server = createServer((req, res) => {
    void handle(state, req, res).catch(() => {
      if (!res.headersSent) {
        json(res, 500, { success: false, error: "fake weknora failed" });
      }
    });
  });
  const baseUrl = await listen(server);
  return {
    baseUrl,
    documents: () => [...state.knowledge.values()],
    models: () => [...state.models],
    setStalled: (stalled: boolean) => {
      state.stalled = stalled;
    },
    calls: () => [...state.calls],
    lastHeaders: () => ({ ...state.lastHeaders }),
    setOffline: (offline: boolean) => {
      state.offline = offline;
    },
    failNext: (count: number) => {
      state.failures = count;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

async function handle(state: State, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase();
  const path = pathOf(req.url ?? "/");
  state.calls.push(`${method} ${path}`);
  state.lastHeaders = { ...req.headers } as Record<string, string | undefined>;
  if (state.offline) {
    req.socket.destroy();
    return;
  }
  if (state.stalled && path !== "/health") {
    // Socket held open, nothing written: the client's own timeout is the only thing that ends it.
    return;
  }
  if (state.failures > 0) {
    state.failures -= 1;
    json(res, 500, { success: false, error: "fake weknora is unwell" });
    return;
  }
  if (!isPublic(method, path) && !authorized(state, req, path)) {
    json(res, 401, { success: false, error: "unauthorized" });
    return;
  }
  const body = method === "GET" || method === "DELETE" ? {} : await readBody(req);
  route(state, { method, path, body }, res);
}

function authorized(state: State, req: IncomingMessage, path: string): boolean {
  const bearer = String(req.headers.authorization ?? "");
  if (path.includes("/api-keys")) {
    // JWT-only upstream: an API key is not accepted on this route.
    return bearer.startsWith("Bearer ");
  }
  const key = req.headers["x-api-key"];
  return typeof key === "string" && key.length > 0 && key === state.apiKey;
}

type Request = { method: string; path: string; body: Record<string, unknown> };

function route(state: State, request: Request, res: ServerResponse): void {
  const parts = segments(request.path);
  if (request.path === "/health") {
    json(res, 200, { status: "ok" });
    return;
  }
  if (request.method === "POST" && request.path === "/api/v1/auth/auto-setup") {
    json(res, 200, {
      success: true,
      message: "Auto-setup successful",
      token: `jwt-${randomUUID()}`,
      refresh_token: `refresh-${randomUUID()}`,
      memberships: [{ tenant_id: Number(state.tenantId), tenant_name: "local", role: "owner" }],
      active_tenant: { id: Number(state.tenantId) },
    });
    return;
  }
  if (request.method === "POST" && parts[2] === "tenants" && parts[4] === "api-keys") {
    state.apiKey = `key-${randomUUID()}`;
    json(res, 201, {
      success: true,
      data: { id: 1, name: request.body.name, token: state.apiKey, api_key: state.apiKey },
    });
    return;
  }
  if (parts[2] === "models") {
    routeModels(state, request, res);
    return;
  }
  if (parts[2] === "knowledge-bases") {
    routeKnowledgeBases(state, request, parts, res);
    return;
  }
  if (parts[2] === "knowledge" && parts[3]) {
    routeKnowledge(state, request, parts[3], res);
    return;
  }
  json(res, 404, { success: false, error: "not found" });
}

function routeModels(state: State, request: Request, res: ServerResponse): void {
  const modelId = segments(request.path)[3];
  if (request.method === "DELETE" && modelId) {
    const before = state.models.length;
    state.models = state.models.filter((model) => model.id !== modelId);
    if (state.models.length === before) {
      json(res, 404, { success: false, error: "model not found" });
      return;
    }
    json(res, 200, { success: true, message: "deleted" });
    return;
  }
  if (request.method === "GET") {
    json(res, 200, { success: true, data: state.models });
    return;
  }
  if (request.method === "POST") {
    const model = {
      id: `model-${randomUUID()}`,
      name: String(request.body.name ?? ""),
      type: String(request.body.type ?? ""),
    };
    state.models.push(model);
    json(res, 201, { success: true, data: model });
    return;
  }
  json(res, 404, { success: false, error: "not found" });
}

function routeKnowledgeBases(state: State, request: Request, parts: string[], res: ServerResponse): void {
  const kbId = parts[3];
  if (request.method === "POST" && !kbId) {
    const kb = {
      id: `kb-${randomUUID()}`,
      name: String(request.body.name ?? ""),
      modelId: String(request.body.embedding_model_id ?? ""),
    };
    state.knowledgeBases.set(kb.id, kb);
    json(res, 201, { success: true, data: { ...kb, embedding_model_id: kb.modelId } });
    return;
  }
  if (!kbId || !state.knowledgeBases.has(kbId)) {
    json(res, 404, { success: false, error: "knowledge base not found" });
    return;
  }
  if (request.method === "GET" && parts.length === 4) {
    json(res, 200, { success: true, data: state.knowledgeBases.get(kbId) });
    return;
  }
  if (request.method === "POST" && parts[4] === "knowledge" && parts[5] === "manual") {
    const document: FakeKnowledge = {
      id: `knowledge-${randomUUID()}`,
      kbId,
      title: String(request.body.title ?? ""),
      content: String(request.body.content ?? ""),
      customMetadata: {},
    };
    state.knowledge.set(document.id, document);
    // Manual create answers 200 (not 201) upstream, and publishes as `pending`.
    json(res, 200, {
      success: true,
      data: { id: document.id, title: document.title, parse_status: "pending", type: "manual" },
    });
    return;
  }
  if (request.method === "POST" && parts[4] === "hybrid-search") {
    const limit = Number(request.body.match_count ?? 4);
    json(res, 200, {
      success: true,
      data: searchHits(state, kbId, String(request.body.query_text ?? ""), limit),
    });
    return;
  }
  json(res, 404, { success: false, error: "not found" });
}

function routeKnowledge(state: State, request: Request, id: string, res: ServerResponse): void {
  const document = state.knowledge.get(id);
  if (!document) {
    json(res, 404, { success: false, error: "knowledge not found" });
    return;
  }
  if (request.method === "GET") {
    json(res, 200, { success: true, data: { id, title: document.title, parse_status: "completed" } });
    return;
  }
  if (request.method === "PUT") {
    const raw = request.body.custom_metadata;
    if (raw && typeof raw === "object") {
      document.customMetadata = Object.fromEntries(
        Object.entries(raw as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
      );
    }
    json(res, 200, { success: true, data: { id, title: document.title, parse_status: "completed" } });
    return;
  }
  if (request.method === "DELETE") {
    state.knowledge.delete(id);
    json(res, 200, { success: true, message: "Delete task submitted", data: { task_id: randomUUID() } });
    return;
  }
  json(res, 404, { success: false, error: "not found" });
}
