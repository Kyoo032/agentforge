import { assertAllowedEndpointUrl, isLoopbackHost } from "@agentforge/core";
import { BackendUnavailable } from "../../backend";
import { redactSecrets } from "./redact";
import {
  isHealthPayload,
  parseApiKey,
  parseAutoSetup,
  parseId,
  parseKnowledge,
  parseModelList,
  parseSearchResults,
  type AutoSetupResult,
  type KnowledgeRow,
  type ModelRow,
  type SearchHit,
  type WeKnoraCustomMetadata,
} from "./dto";

/**
 * The only thing in this process that speaks HTTP to the sidecar.
 *
 * Trust boundary: the sidecar is a bundled third-party binary on a loopback port that any local
 * process could also be sitting on. So every call carries our key, no call follows a redirect, no
 * call may address anything but loopback, every call has a deadline, and every response is parsed
 * by a total guard before a single field of it is believed. Anything that fails those checks is a
 * `BackendUnavailable`, which the registry answers by falling back to the built-in backend.
 */

/** Health is on the retrieval path; a slow answer is a failed answer. */
export const HEALTH_TIMEOUT_MS = 1_500;
export const READ_TIMEOUT_MS = 10_000;
/** Ingest embeds the whole document upstream, so writes get the long deadline. */
export const WRITE_TIMEOUT_MS = 30_000;
/** A body larger than this is not something our sidecar sends; reading it is the attack. */
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
/** How much of an error body reaches the log (after redaction). Never the exception message. */
const ERROR_LOG_CHARS = 200;

export type WeKnoraCredentials = { apiKey?: string; tenantId?: string; bearer?: string };

export type WeKnoraClientOptions = {
  /** Overridable so the cap can be proven without streaming eight megabytes in a test. */
  maxResponseBytes?: number;
  /** Extra secrets to strip from a logged error body — the gateway key the model row carries. */
  logSecrets?: string[];
};

type RequestInput = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  timeoutMs: number;
  credentials?: WeKnoraCredentials;
};

/**
 * `assertAllowedEndpointUrl` allows any HTTPS host; the sidecar is never one of those. This is the
 * stricter rule for this client: loopback only, plain HTTP, no credentials in the URL.
 */
export function assertLoopbackBaseUrl(baseUrl: string): void {
  assertAllowedEndpointUrl(baseUrl);
  const parsed = new URL(baseUrl);
  if (!isLoopbackHost(parsed.hostname)) {
    throw new BackendUnavailable(
      "weknora",
      "non_loopback",
      `WeKnora base URL must be loopback, got ${parsed.hostname}`,
    );
  }
}

function unavailable(reason: string, detail: string): BackendUnavailable {
  return new BackendUnavailable("weknora", reason, detail);
}

export class WeKnoraClient {
  constructor(
    private readonly baseUrl: string,
    private readonly credentials: WeKnoraCredentials = {},
    private readonly options: WeKnoraClientOptions = {},
  ) {
    assertLoopbackBaseUrl(baseUrl);
  }

  /** A copy of this client that authenticates as `credentials` instead. Never mutates the original. */
  withCredentials(credentials: WeKnoraCredentials): WeKnoraClient {
    return new WeKnoraClient(this.baseUrl, { ...this.credentials, ...credentials }, this.options);
  }

  /** A copy that also strips `secrets` from anything it logs. */
  withLogSecrets(secrets: Array<string | null | undefined>): WeKnoraClient {
    const extra = secrets.filter((secret): secret is string => Boolean(secret));
    return new WeKnoraClient(this.baseUrl, this.credentials, {
      ...this.options,
      logSecrets: [...(this.options.logSecrets ?? []), ...extra],
    });
  }

  private headers(credentials: WeKnoraCredentials): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (credentials.bearer) {
      // The `Bearer ` prefix is matched with a literal `strings.HasPrefix` upstream: one space, exact case.
      headers.Authorization = `Bearer ${credentials.bearer}`;
    }
    if (credentials.apiKey) {
      headers["X-API-Key"] = credentials.apiKey;
    }
    if (credentials.tenantId) {
      headers["X-Tenant-ID"] = credentials.tenantId;
    }
    return headers;
  }

  private async request(input: RequestInput): Promise<unknown> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}${input.path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: input.method,
        // `manual`, not `follow`: a 302 from a process squatting on the port must not become a
        // request to wherever it points, with our key attached.
        redirect: "manual",
        headers: this.headers({ ...this.credentials, ...input.credentials }),
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        signal: AbortSignal.timeout(input.timeoutMs),
      });
    } catch (error) {
      throw unavailable("unreachable", `WeKnora ${input.method} ${input.path} failed: ${short(error)}`);
    }
    return this.readBody(res, input);
  }

  private async readBody(res: Response, input: RequestInput): Promise<unknown> {
    if (res.status >= 300 && res.status < 400) {
      await discard(res);
      throw unavailable("redirect", `WeKnora ${input.path} answered a ${res.status} redirect`);
    }
    const text = await this.readBounded(res, input);
    if (!res.ok) {
      // The body is a diagnostic, not an error message. It goes to the log — once our own secrets
      // have been taken back out of it — and never into the exception, because `health.detail`
      // carries that string all the way to `GET /api/v1/knowledge`, which the Knowledge page reads.
      console.warn(
        `knowledge-weknora: ${input.method} ${input.path} answered ${res.status}: ` +
          redactSecrets(text.slice(0, ERROR_LOG_CHARS), this.logSecrets()),
      );
      throw unavailable(`http_${res.status}`, `WeKnora ${input.method} ${input.path} answered ${res.status}`);
    }
    if (text.trim().length === 0) {
      return {};
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw unavailable("bad_shape", `WeKnora ${input.path} answered non-JSON`);
    }
  }

  /** Every secret this client could have handed the sidecar, for stripping out of a logged body. */
  private logSecrets(): Array<string | null | undefined> {
    return [this.credentials.apiKey, this.credentials.bearer, ...(this.options.logSecrets ?? [])];
  }

  /**
   * The body, never more of it than we are willing to hold.
   *
   * `res.text()` buffers the whole response *before* anything can look at its size, so a sidecar
   * (or a process squatting on its port) that answers with an endless stream would be an
   * out-of-memory kill dressed up as a knowledge query. A declared `Content-Length` over the cap is
   * refused without reading a byte; anything else is read a chunk at a time against a running
   * count, and the stream is cancelled the moment the count goes over.
   */
  private async readBounded(res: Response, input: RequestInput): Promise<string> {
    const cap = this.options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > cap) {
      await discard(res);
      throw unavailable("response_too_large", `WeKnora ${input.path} declared ${declared} bytes (cap ${cap})`);
    }
    const body = res.body;
    if (!body) {
      return "";
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const parts: string[] = [];
    let seen = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        seen += value.byteLength;
        if (seen > cap) {
          throw unavailable("response_too_large", `WeKnora ${input.path} exceeded ${cap} bytes`);
        }
        parts.push(decoder.decode(value, { stream: true }));
      }
    } finally {
      // Cancelling a finished stream is a no-op; cancelling a running one is what stops the sender.
      await reader.cancel().catch(() => {});
    }
    parts.push(decoder.decode());
    return parts.join("");
  }

  /** `GET /health` — unauthenticated, outside `/api/v1`. Shape-checked: a bare 200 is not enough. */
  async health(): Promise<boolean> {
    try {
      return isHealthPayload(await this.request({ method: "GET", path: "/health", timeoutMs: HEALTH_TIMEOUT_MS }));
    } catch {
      return false;
    }
  }

  /** Lite-only, unauthenticated. Returns the admin JWT and the tenant it belongs to. */
  async autoSetup(): Promise<AutoSetupResult> {
    const body = await this.request({
      method: "POST",
      path: "/api/v1/auth/auto-setup",
      body: {},
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    const parsed = parseAutoSetup(body);
    if (!parsed) {
      throw unavailable("bad_shape", "WeKnora auto-setup did not return a token and a tenant");
    }
    return parsed;
  }

  /** Exchange the short-lived JWT for a long-lived key. JWT-only route: no X-API-Key path exists. */
  async createApiKey(tenantId: string, bearer: string, name: string): Promise<string> {
    const body = await this.request({
      method: "POST",
      path: `/api/v1/tenants/${encodeURIComponent(tenantId)}/api-keys`,
      body: { name, full_access: true },
      timeoutMs: WRITE_TIMEOUT_MS,
      credentials: { bearer, tenantId },
    });
    const key = parseApiKey(body);
    if (!key) {
      throw unavailable("bad_shape", "WeKnora did not return an API key");
    }
    return key;
  }

  async listModels(): Promise<ModelRow[]> {
    const body = await this.request({ method: "GET", path: "/api/v1/models", timeoutMs: READ_TIMEOUT_MS });
    const rows = parseModelList(body);
    if (!rows) {
      throw unavailable("bad_shape", "WeKnora model list was not an array of models");
    }
    return rows;
  }

  /**
   * Register an embedding model row. `type` and `source` are upstream enums
   * (`internal/types/model.go`): `Embedding` is capitalised, `openai` is not.
   */
  async createModel(input: { name: string; baseUrl: string; apiKey: string; dimension: number }): Promise<string> {
    const body = await this.request({
      method: "POST",
      path: "/api/v1/models",
      body: {
        name: input.name,
        type: "Embedding",
        source: "openai",
        description: "agentforge gateway embeddings",
        parameters: {
          base_url: input.baseUrl,
          api_key: input.apiKey,
          interface_type: "openai",
          embedding_parameters: { dimension: input.dimension },
        },
      },
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    return requireId(body, "model");
  }

  /**
   * Delete a model row, taking the gateway key it holds out of the sidecar's database with it.
   * A 404 is the desired state, not an error: the row is gone either way.
   */
  async deleteModel(modelId: string): Promise<void> {
    try {
      await this.request({
        method: "DELETE",
        path: `/api/v1/models/${encodeURIComponent(modelId)}`,
        timeoutMs: WRITE_TIMEOUT_MS,
      });
    } catch (error) {
      if (error instanceof BackendUnavailable && error.reason === "http_404") {
        return;
      }
      throw error;
    }
  }

  async createKnowledgeBase(input: { name: string; description: string; modelId: string }): Promise<string> {
    const body = await this.request({
      method: "POST",
      path: "/api/v1/knowledge-bases",
      body: {
        name: input.name,
        description: input.description,
        embedding_model_id: input.modelId,
      },
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    return requireId(body, "knowledge base");
  }

  /** The KB id when it is still there, or null on 404 — a KB deleted behind our back is not an error. */
  async getKnowledgeBase(kbId: string): Promise<string | null> {
    try {
      const body = await this.request({
        method: "GET",
        path: `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}`,
        timeoutMs: READ_TIMEOUT_MS,
      });
      return parseId(body);
    } catch (error) {
      if (error instanceof BackendUnavailable && error.reason === "http_404") {
        return null;
      }
      throw error;
    }
  }

  /**
   * Ingest one document as Markdown. Two calls, because the manual-create payload has no
   * `custom_metadata` field (`types.ManualKnowledgePayload`) and `PUT /knowledge/:id` does: the
   * metadata is what lets a search hit be traced back to *our* source row rather than to a
   * knowledge id we would otherwise have to take on faith.
   */
  async ingestManual(input: {
    kbId: string;
    title: string;
    content: string;
    metadata: WeKnoraCustomMetadata;
  }): Promise<KnowledgeRow> {
    const created = await this.request({
      method: "POST",
      path: `/api/v1/knowledge-bases/${encodeURIComponent(input.kbId)}/knowledge/manual`,
      body: { title: input.title, content: input.content, status: "publish" },
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    const knowledge = parseKnowledge(created);
    if (!knowledge) {
      throw unavailable("bad_shape", "WeKnora manual ingest did not return a knowledge id");
    }
    await this.setCustomMetadata(knowledge.id, input.metadata);
    return knowledge;
  }

  async setCustomMetadata(knowledgeId: string, metadata: WeKnoraCustomMetadata): Promise<void> {
    await this.request({
      method: "PUT",
      path: `/api/v1/knowledge/${encodeURIComponent(knowledgeId)}`,
      body: { custom_metadata: metadata },
      timeoutMs: WRITE_TIMEOUT_MS,
    });
  }

  /** The document's row, or null when it is gone. */
  async getKnowledge(knowledgeId: string): Promise<KnowledgeRow | null> {
    try {
      const body = await this.request({
        method: "GET",
        path: `/api/v1/knowledge/${encodeURIComponent(knowledgeId)}`,
        timeoutMs: READ_TIMEOUT_MS,
      });
      return parseKnowledge(body);
    } catch (error) {
      if (error instanceof BackendUnavailable && error.reason === "http_404") {
        return null;
      }
      throw error;
    }
  }

  /** Delete is asynchronous upstream (it returns a task id); a 404 is already the desired state. */
  async deleteKnowledge(knowledgeId: string): Promise<void> {
    try {
      await this.request({
        method: "DELETE",
        path: `/api/v1/knowledge/${encodeURIComponent(knowledgeId)}`,
        timeoutMs: WRITE_TIMEOUT_MS,
      });
    } catch (error) {
      if (error instanceof BackendUnavailable && error.reason === "http_404") {
        return;
      }
      throw error;
    }
  }

  async hybridSearch(input: { kbId: string; query: string; limit: number }): Promise<SearchHit[]> {
    const body = await this.request({
      method: "POST",
      path: `/api/v1/knowledge-bases/${encodeURIComponent(input.kbId)}/hybrid-search`,
      body: { query_text: input.query, match_count: input.limit },
      timeoutMs: READ_TIMEOUT_MS,
    });
    const hits = parseSearchResults(body);
    if (!hits) {
      throw unavailable("bad_shape", "WeKnora hybrid-search did not return a result array");
    }
    return hits;
  }
}

function requireId(body: unknown, what: string): string {
  const id = parseId(body);
  if (!id) {
    throw unavailable("bad_shape", `WeKnora did not return a ${what} id`);
  }
  return id;
}

function short(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160);
}

/** Drop a body we have decided not to read, so the socket is not left half-consumed. */
async function discard(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // Already closed by the peer; there is nothing left to release.
  }
}
