/**
 * Drives the running app exactly as the Finance studio does — upload, parse,
 * confirm, generate, export — so a score is a statement about the product and
 * never about a private code path the owner cannot reach.
 *
 * Every request body here is the body a step component posts. The parse answers
 * with a TASK-SPECIFIC shape (periods, flows, classified buckets, proposed pairs)
 * and the whole of it is returned unread: the task's adapter, not this module,
 * decides what a row is.
 *
 * Privacy: the base URL is validated to be loopback on every call and the harness
 * refuses anything else. Financial case data never leaves the machine.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { NO_RUNTIME_CODES, UNAVAILABLE_CODES } from "./verdict.mjs";

export const IMPORT_PATH = "/api/v1/finance/import";
export const PARSE_PATH = "/api/v1/finance/parse";
export const STREAM_PATH = "/api/v1/finance/stream";
export const EXPORT_PATH = "/api/v1/finance/export";
/** The older, single-format export route. Still the only one an older host process serves. */
export const DOCX_PATH = "/api/v1/finance/docx";
export const SETTINGS_PATH = "/api/v1/settings";

/** A slow model is normal; a hung one is not. Generation gets the long budget. */
export const DEFAULT_TIMEOUT_MS = 60_000;
export const GENERATE_TIMEOUT_MS = 300_000;

export const EXPORT_MIME = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

export { NO_RUNTIME_CODES, UNAVAILABLE_CODES };

/** The one network rule: this harness talks to the machine it runs on, or to nothing. */
export function requireLoopbackBase(base) {
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new Error(`--base must be a URL, got ${JSON.stringify(base)}`);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!LOOPBACK.has(host)) {
    throw new Error(`--base must be loopback (127.0.0.1 / localhost / ::1), got ${url.hostname}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`--base must be http or https, got ${url.protocol}`);
  }
  return `${url.origin}`;
}

export class AppError extends Error {
  constructor(code, message, status, stage) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.stage = stage;
  }
}

function errorFrom(payload, status, stage, fallback) {
  const error = payload && typeof payload === "object" ? payload.error : null;
  const code = error && typeof error.code === "string" ? error.code : "request_failed";
  const message = error && typeof error.message === "string" ? error.message : fallback;
  return new AppError(code, message, status, stage);
}

async function call(ctx, path, init, stage, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const base = requireLoopbackBase(ctx.base);
  try {
    return await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new AppError("transport_failed", `${path} did not answer: ${reason}`, 0, stage);
  }
}

/* --------------------------------------------------------------------- runtime */

/** What each `gateway.status` actually says, taken from `host/src/gateway-gate.ts`. */
export const GATEWAY_MEANING = {
  stub: "gate open without a key check (the process runs with AGENTFORGE_RUNTIME=stub); it does NOT mean model answers are stubbed",
  ok: "the gateway accepted this key",
  needs_key: "no key is saved, so nothing can be called",
  invalid_key: "the gateway rejected this key",
  unreachable: "the gateway could not be reached; the desk is open on grace",
  error: "the gateway answered with an error; the desk is open on grace",
  unknown: "the app did not report a gateway status",
};

/**
 * Read-only: what is behind this app right now? Answers with whether a key is
 * PRESENT — never with any part of its value, and never with the fingerprint.
 *
 * The two fields are about different things and the summary used to print them as
 * if they were one. `runtime` is "does a key exist, so do model calls go out for
 * real"; `gateway.status` is the gate's verdict on that key, where `stub` means
 * the process was started with `AGENTFORGE_RUNTIME=stub` and the gate is open
 * WITHOUT the key ever having been validated. A run can therefore be `runtime=ai`
 * (real calls) and `gateway=stub` (never checked) at once, which is exactly what
 * the owner's webdev is.
 */
export async function readRuntime(ctx) {
  const res = await call(ctx, SETTINGS_PATH, { method: "GET" }, "runtime");
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) {
    throw errorFrom(body, res.status, "runtime", "settings could not be read");
  }
  const providers = ["hasOpenai", "hasAnthropic", "hasGoogle", "hasVolcengine"];
  const status = body.gateway && typeof body.gateway.status === "string" ? body.gateway.status : "unknown";
  return {
    keyPresent: providers.some((flag) => body[flag] === true),
    providersWithKey: providers
      .filter((flag) => body[flag] === true)
      .map((flag) => flag.replace("has", "").toLowerCase()),
    runtime: typeof body.runtime === "string" ? body.runtime : "unknown",
    gatewayStatus: status,
    gatewayAllowed: Boolean(body.gateway?.allowed),
    /** Plain English for the header line, so nobody reads `stub` as "the answers are fake". */
    gatewayMeaning: GATEWAY_MEANING[status] ?? "the gate's verdict on the saved key",
    chatModelCount: body.probe && typeof body.probe.chatCount === "number" ? body.probe.chatCount : 0,
    locale: typeof body.locale === "string" ? body.locale : "unknown",
  };
}

/* ---------------------------------------------------------------------- import */

/** One spreadsheet in, the plain figures text the paste box takes out. */
export async function importFile(ctx, filePath, sheet) {
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append("file", new Blob([bytes]), basename(filePath));
  const path = sheet ? `${IMPORT_PATH}?sheet=${encodeURIComponent(sheet)}` : IMPORT_PATH;
  const res = await call(ctx, path, { method: "POST", body: form }, "import");
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || typeof body.figuresText !== "string") {
    throw errorFrom(body, res.status, "import", "the file could not be imported");
  }
  return {
    figuresText: body.figuresText,
    /** A document's sentences, beside its tables. One of the places a value could leak. */
    proseText: typeof body.proseText === "string" ? body.proseText : "",
    sheet: body.sheet?.name ?? body.sheet ?? null,
    /** Kept whole: the previews are one of the places a leaked value could surface. */
    sheets: Array.isArray(body.sheets)
      ? body.sheets.map((entry) => ({ name: entry.name, rowCount: entry.rowCount, preview: entry.preview }))
      : [],
    pii: body.pii ?? null,
    warnings: Array.isArray(body.warnings) ? body.warnings : [],
  };
}

/* ----------------------------------------------------------------------- parse */

/**
 * Figures text → whatever this task's parse proposes.
 *
 * The whole body comes back. The brief answers `{ items }`; cash flow adds its
 * categories and periods, the appraisal its netted flows, ratios its classified
 * buckets, budget its two sides and the pairing it proposes. The studio's confirm
 * step accepts all of that as it stands, so the harness records it unchanged —
 * that is what the owner would have confirmed.
 */
export async function parseTask(ctx, request) {
  const res = await call(
    ctx,
    PARSE_PATH,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        figures: request.figures,
        task: request.task,
        prompt: request.prompt || undefined,
        params: request.params ?? undefined,
        // A document's prose, so the figures it only ever wrote in a sentence are not lost.
        proseText: request.proseText || undefined,
        model: ctx.model || undefined,
      }),
    },
    "parse",
  );
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) {
    throw errorFrom(body, res.status, "parse", "the figures could not be parsed");
  }
  return body;
}

/* -------------------------------------------------------------------- generate */

function parseSseBlock(block) {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("");
  if (data === "") {
    return null;
  }
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function readJobStream(res, stage) {
  const text = await res.text();
  const events = text
    .split("\n\n")
    .map(parseSseBlock)
    .filter((event) => event !== null);
  const failure = events.find((event) => event.type === "job.error");
  if (failure) {
    throw new AppError(failure.code ?? "job_failed", failure.message ?? "the job failed", failure.status ?? 500, stage);
  }
  const done = events.find((event) => event.type === "job.done");
  if (!done) {
    throw new AppError("stream_incomplete", "the job stream ended without a result", 502, stage);
  }
  return { result: done.result, phases: events.filter((event) => event.type === "job.phase").map((e) => e.phase) };
}

/**
 * The studio's own generate: the body the task's step component posts, over SSE.
 *
 * The brief comes back as `{ brief, markdown, guard, items, artifactId }`; every
 * other task as `{ task, report, artifactId, markdown, guard, pii, notice? }`.
 */
export async function generateReport(ctx, body) {
  const res = await call(
    ctx,
    STREAM_PATH,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, model: ctx.model || undefined }),
    },
    "generate",
    GENERATE_TIMEOUT_MS,
  );
  if ((res.headers.get("Content-Type") ?? "").includes("application/json")) {
    throw errorFrom(await res.json().catch(() => null), res.status, "generate", "the report could not be generated");
  }
  return readJobStream(res, "generate");
}

/* ---------------------------------------------------------------------- export */

function filenameOf(disposition) {
  return disposition?.match(/filename="([^"]+)"/)?.[1] ?? null;
}

/**
 * One export, checked as a file: right mime, non-empty body, a filename to save it
 * under. `body` is built by the task's adapter the way
 * `apps/web/lib/finance-export.ts` builds it — a report for a task, a brief for
 * the brief — so a 400 here is the app refusing the studio's own request.
 */
export async function exportReport(ctx, body) {
  const res = await call(
    ctx,
    EXPORT_PATH,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    "export",
  );
  if (!res.ok) {
    throw errorFrom(await res.json().catch(() => null), res.status, "export", `the ${body.format} export failed`);
  }
  const mime = res.headers.get("Content-Type") ?? "";
  const bytes = new Uint8Array(await res.arrayBuffer());
  return {
    format: body.format,
    mime,
    mimeOk: mime.startsWith(EXPORT_MIME[body.format] ?? "@none"),
    byteLength: bytes.byteLength,
    filename: filenameOf(res.headers.get("Content-Disposition")),
    bytes,
  };
}

/**
 * The Word export through the route that predates the format picker. Used only
 * when `/finance/export` is not served, so a run still checks one real file the
 * app produced rather than none at all.
 */
export async function exportDocxLegacy(ctx, brief) {
  const res = await call(
    ctx,
    DOCX_PATH,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brief }) },
    "export",
  );
  if (!res.ok) {
    throw errorFrom(await res.json().catch(() => null), res.status, "export", "the docx export failed");
  }
  const mime = res.headers.get("Content-Type") ?? "";
  const bytes = new Uint8Array(await res.arrayBuffer());
  return {
    format: "docx",
    mime,
    mimeOk: mime.startsWith(EXPORT_MIME.docx),
    byteLength: bytes.byteLength,
    filename: filenameOf(res.headers.get("Content-Disposition")),
    bytes,
  };
}
