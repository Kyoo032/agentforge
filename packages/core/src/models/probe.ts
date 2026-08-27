import { ApiError } from "../errors";
import { GATEWAY_BASE_URL, isGatewayBaseUrl } from "../gateway";
import { assertAllowedEndpointUrl } from "../security/tls";
import { chatModelFromId, type ChatModel, type ModelProvider } from "./catalog";
import { mediaKind } from "./media-kind";

export type ApiDialect = ModelProvider;

export const DEFAULT_OPENAI_BASE_URL = GATEWAY_BASE_URL;
export const DEFAULT_GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
export const DEFAULT_VOLCENGINE_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";


const DEFAULT_BY_DIALECT: Record<ApiDialect, string> = {
  openai: DEFAULT_OPENAI_BASE_URL,
  google: DEFAULT_GOOGLE_BASE_URL,
  anthropic: DEFAULT_ANTHROPIC_BASE_URL,
  volcengine: DEFAULT_VOLCENGINE_BASE_URL,
};

export function guessDialectFromKey(key: string): ApiDialect | undefined {
  const trimmed = key.trim();
  if (trimmed.startsWith("sk-ant-")) {
    return "anthropic";
  }
  if (trimmed.startsWith("AIza")) {
    return "google";
  }
  return undefined;
}

export function isOfficialOpenAIBaseUrl(baseUrl?: string): boolean {
  return /api\.openai\.com/i.test(baseUrl ?? "");
}

export function resolvedOpenAIBaseUrl(raw?: string | null): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) {
    return DEFAULT_OPENAI_BASE_URL;
  }
  return normalizeProviderBaseUrl(trimmed, guessDialectFromUrl(trimmed) ?? "openai") || DEFAULT_OPENAI_BASE_URL;
}

export function isDefaultOpenAIBaseUrl(raw?: string | null): boolean {
  return isGatewayBaseUrl(raw);
}

export function guessDialectFromUrl(raw: string): ApiDialect | undefined {
  let host = "";
  let path = "";
  try {
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    host = parsed.hostname.toLowerCase();
    path = parsed.pathname.toLowerCase();
  } catch {
    return undefined;
  }
  if (host.includes("anthropic")) {
    return "anthropic";
  }
  if (host.includes("googleapis") || host.includes("generativelanguage") || host.includes("ai.google")) {
    return "google";
  }
  if (host.includes("volces") || host.includes("volcengine") || path.includes("/api/v3")) {
    return "volcengine";
  }
  if (host.includes("openai.com")) {
    return "openai";
  }
  return undefined;
}

export function normalizeProviderBaseUrl(raw: string, kind: ApiDialect = "openai"): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return "";
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ApiError("invalid_endpoint", "Endpoint URL is not valid", 400);
  }
  // Delegate protocol + loopback-only HTTP enforcement to assertAllowedEndpointUrl
  assertAllowedEndpointUrl(trimmed);
  const dialect = guessDialectFromUrl(trimmed) ?? kind;
  const path = parsed.pathname.replace(/\/+$/, "");
  if (dialect === "google") {
    if (path === "" || path === "/") {
      parsed.pathname = "/v1beta";
    }
  } else if (dialect === "volcengine") {
    if (!path.includes("/api/v3")) {
      parsed.pathname = `${path}/api/v3`;
    }
  } else if (!path.endsWith("/v1") && !path.endsWith("/v1beta")) {
    parsed.pathname = `${path}/v1`;
  }
  return parsed.toString().replace(/\/+$/, "");
}

export function normalizeEndpointUrl(
  raw: string,
  fallback: ApiDialect = "openai",
): { url: string; dialect: ApiDialect } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { url: "", dialect: fallback };
  }
  const dialect = guessDialectFromUrl(trimmed) ?? fallback;
  return { url: normalizeProviderBaseUrl(trimmed, dialect), dialect };
}

export function isChatModelId(id: string): boolean {
  return mediaKind(id) === "chat";
}

function labelFor(id: string, name?: string): string {
  if (typeof name === "string" && name.trim().length > 0) {
    return name.trim();
  }
  const leaf = id.split("/").pop();
  return leaf && leaf.length > 0 ? leaf : id;
}

type ListedItem = {
  id?: unknown;
  name?: unknown;
  display_name?: unknown;
  type?: unknown;
};

function readListedItems(body: unknown): ListedItem[] {
  if (typeof body !== "object" || body === null) {
    return [];
  }
  const data = (body as { data?: unknown; models?: unknown }).data ?? (body as { models?: unknown }).models;
  return Array.isArray(data) ? (data as ListedItem[]) : [];
}

function modelsFromListedItems(body: unknown, provider: ModelProvider): ChatModel[] {
  const seen = new Set<string>();
  const models: ChatModel[] = [];
  for (const item of readListedItems(body)) {
    const rawId = typeof item.id === "string" ? item.id : typeof item.name === "string" ? item.name : undefined;
    if (!rawId) {
      continue;
    }
    const id = rawId.startsWith("models/") ? rawId.slice("models/".length) : rawId;
    if (!isChatModelId(id)) {
      continue;
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const name = typeof item.display_name === "string" ? item.display_name : typeof item.name === "string" ? item.name : undefined;
    models.push(chatModelFromId(id, labelFor(id, name), provider));
  }
  return models;
}

export function modelsFromOpenAIList(body: unknown, provider: ModelProvider = "openai"): ChatModel[] {
  return modelsFromListedItems(body, provider);
}

type GoogleListItem = {
  name?: unknown;
  displayName?: unknown;
  supportedGenerationMethods?: unknown;
};

function readGoogleItems(body: unknown): GoogleListItem[] {
  if (typeof body !== "object" || body === null) {
    return [];
  }
  const models = (body as { models?: unknown }).models;
  return Array.isArray(models) ? (models as GoogleListItem[]) : [];
}

export function modelsFromGoogleList(body: unknown): ChatModel[] {
  const seen = new Set<string>();
  const models: ChatModel[] = [];
  for (const item of readGoogleItems(body)) {
    if (typeof item.name !== "string") {
      continue;
    }
    const methods = Array.isArray(item.supportedGenerationMethods)
      ? item.supportedGenerationMethods.filter((method): method is string => typeof method === "string")
      : [];
    if (methods.length > 0 && !methods.includes("generateContent")) {
      continue;
    }
    const id = item.name.startsWith("models/") ? item.name.slice("models/".length) : item.name;
    if (!isChatModelId(id) || id.includes("embedding")) {
      continue;
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const displayName = typeof item.displayName === "string" ? item.displayName : undefined;
    models.push(chatModelFromId(id, labelFor(id, displayName), "google"));
  }
  return models;
}

export function modelsFromAnthropicList(body: unknown): ChatModel[] {
  return modelsFromListedItems(body, "anthropic");
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError("probe_failed", "Endpoint did not return JSON", 502);
  }
}

async function getJson(
  url: string,
  headers: Record<string, string>,
  fetchFn: typeof fetch,
): Promise<unknown> {
  const response = await fetchFn(url, { headers });
  if (!response.ok) {
    throw new ApiError("probe_failed", `Could not list models from ${url} (${response.status})`, 502);
  }
  return readJson(response);
}

export async function probeOpenAIModels(input: {
  baseURL?: string;
  apiKey?: string;
  provider?: ModelProvider;
  fetch?: typeof fetch;
}): Promise<ChatModel[]> {
  const provider = input.provider ?? "openai";
  const fallback = provider === "volcengine" ? DEFAULT_VOLCENGINE_BASE_URL : DEFAULT_OPENAI_BASE_URL;
  const dialect = provider === "volcengine" ? "volcengine" : "openai";
  const base = normalizeProviderBaseUrl(input.baseURL ?? fallback, dialect) || fallback;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (input.apiKey) {
    headers.Authorization = `Bearer ${input.apiKey}`;
  }
  return modelsFromOpenAIList(await getJson(`${base}/models`, headers, input.fetch ?? fetch), provider);
}

export async function probeGoogleModels(input: {
  baseURL?: string;
  apiKey?: string;
  fetch?: typeof fetch;
}): Promise<ChatModel[]> {
  if (!input.apiKey) {
    throw new ApiError("probe_failed", "Google API key is required to list Gemini models", 400);
  }
  const base = normalizeProviderBaseUrl(input.baseURL ?? DEFAULT_GOOGLE_BASE_URL, "google") || DEFAULT_GOOGLE_BASE_URL;
  const url = new URL(`${base}/models`);
  return modelsFromGoogleList(
    await getJson(url.toString(), { Accept: "application/json", "x-goog-api-key": input.apiKey }, input.fetch ?? fetch),
  );
}

export async function probeAnthropicModels(input: {
  baseURL?: string;
  apiKey?: string;
  fetch?: typeof fetch;
}): Promise<ChatModel[]> {
  if (!input.apiKey) {
    throw new ApiError("probe_failed", "Anthropic API key is required to list Claude models", 400);
  }
  const base =
    normalizeProviderBaseUrl(input.baseURL ?? DEFAULT_ANTHROPIC_BASE_URL, "anthropic") || DEFAULT_ANTHROPIC_BASE_URL;
  const url = new URL(`${base}/models`);
  url.searchParams.set("limit", "1000");
  return modelsFromAnthropicList(
    await getJson(
      url.toString(),
      {
        Accept: "application/json",
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
      },
      input.fetch ?? fetch,
    ),
  );
}

export async function probeVolcengineModels(input: {
  baseURL?: string;
  apiKey?: string;
  fetch?: typeof fetch;
}): Promise<ChatModel[]> {
  return probeOpenAIModels({
    ...input,
    baseURL: input.baseURL ?? DEFAULT_VOLCENGINE_BASE_URL,
    provider: "volcengine",
  });
}

async function probeDialect(
  dialect: ApiDialect,
  input: { url?: string; apiKey?: string; fetch?: typeof fetch },
): Promise<{ dialect: ApiDialect; baseURL: string; models: ChatModel[] }> {
  const baseURL =
    normalizeProviderBaseUrl(input.url ?? DEFAULT_BY_DIALECT[dialect], dialect) || DEFAULT_BY_DIALECT[dialect];
  const args = { baseURL, apiKey: input.apiKey, fetch: input.fetch };
  const models =
    dialect === "google"
      ? await probeGoogleModels(args)
      : dialect === "anthropic"
        ? await probeAnthropicModels(args)
        : dialect === "volcengine"
          ? await probeVolcengineModels(args)
          : await probeOpenAIModels(args);
  return { dialect, baseURL, models };
}

export async function detectCompatibleApi(input: {
  url?: string;
  apiKey?: string;
  fetch?: typeof fetch;
}): Promise<{ dialect: ApiDialect; baseURL: string; models: ChatModel[] }> {
  const guessed =
    (input.url ? guessDialectFromUrl(input.url) : undefined) ??
    (input.apiKey ? guessDialectFromKey(input.apiKey) : undefined);
  const rest: ApiDialect[] = ["openai", "anthropic", "volcengine", "google"];
  const order = [...new Set(guessed ? [guessed, ...rest] : rest)];
  const errors: string[] = [];
  for (const dialect of order) {
    try {
      return await probeDialect(dialect, input);
    } catch (error) {
      errors.push(`${dialect}: ${error instanceof Error ? error.message : "failed"}`);
    }
  }
  throw new ApiError("probe_failed", `Could not detect a compatible API. ${errors.join(" · ")}`, 502);
}
