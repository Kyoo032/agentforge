import type { IncomingMessage, ServerResponse } from "node:http";
import { WORKSPACE_COOKIE } from "@agentforge/core";
import { dispatch } from "./router";
import { readSelectedWorkspaceId } from "./workspace";
import { isAllowedMutatingApiRequest } from "./local-request";
import type { HostFile, HostRequest, HostResult } from "./types";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** Largest accepted request body (dataset uploads are 25 MB plus multipart framing). */
export const MAX_BODY_BYTES = 26 * 1024 * 1024;

class BodyTooLarge extends Error {}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const raw = header(req, "cookie") ?? "";
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) {
      out[key] = decodeURIComponent(value);
    }
  }
  return out;
}

function pathnameOf(req: IncomingMessage): { path: string; query: Record<string, string> } {
  const host = header(req, "host") ?? "127.0.0.1";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  return { path: url.pathname, query };
}

async function readBody(req: IncomingMessage): Promise<{ body?: unknown; files?: HostFile[] }> {
  const contentType = header(req, "content-type") ?? "";
  if (req.method === "GET" || req.method === "HEAD" || req.method === "DELETE") {
    return {};
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += piece.byteLength;
    if (total > MAX_BODY_BYTES) {
      req.destroy();
      throw new BodyTooLarge("Request body exceeds the 26 MB cap");
    }
    chunks.push(piece);
  }
  const buffer = Buffer.concat(chunks);
  if (buffer.length === 0) {
    return {};
  }
  if (contentType.includes("multipart/form-data")) {
    const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
    if (!boundaryMatch) {
      return {};
    }
    return parseMultipart(buffer, boundaryMatch[1].trim().replace(/^"|"$/g, ""));
  }
  if (contentType.includes("application/json")) {
    try {
      return { body: JSON.parse(buffer.toString("utf8")) };
    } catch {
      return { body: null };
    }
  }
  return { body: buffer.toString("utf8") };
}

function parseMultipart(buffer: Buffer, boundary: string): { body?: unknown; files?: HostFile[] } {
  const list: HostFile[] = [];
  const rawBoundary = `--${boundary}`;
  const parts = buffer.toString("latin1").split(rawBoundary);
  for (const part of parts) {
    if (part === "--" || part === "--\r\n" || !part.toLowerCase().includes("content-disposition")) {
      continue;
    }
    const splitAt = part.indexOf("\r\n\r\n");
    if (splitAt === -1) {
      continue;
    }
    const headers = part.slice(0, splitAt);
    let body = part.slice(splitAt + 4);
    if (body.endsWith("\r\n")) {
      body = body.slice(0, -2);
    }
    const nameMatch = headers.match(/name="([^"]+)"/);
    const fileMatch = headers.match(/filename="([^"]+)"/);
    const typeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
    if (!nameMatch) {
      continue;
    }
    if (fileMatch) {
      list.push({
        field: nameMatch[1],
        filename: fileMatch[1],
        mime: typeMatch?.[1]?.trim() || "application/octet-stream",
        bytes: Buffer.from(body, "latin1"),
      });
    }
  }
  return { files: list };
}

function applyCookies(res: ServerResponse, result: HostResult): void {
  if (result.type !== "json" || !result.cookies) {
    return;
  }
  const values = result.cookies.map(
    (cookie) =>
      `${cookie.name}=${encodeURIComponent(cookie.value)}; Path=${cookie.path ?? "/"}; SameSite=Strict; HttpOnly`,
  );
  if (values.length > 0) {
    res.setHeader("Set-Cookie", values);
  }
}

export async function writeHostResult(res: ServerResponse, result: HostResult): Promise<void> {
  if (result.type === "json") {
    applyCookies(res, result);
    res.statusCode = result.status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(result.body));
    return;
  }
  if (result.type === "bytes") {
    res.statusCode = result.status;
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    if (result.filename) {
      res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    }
    res.end(Buffer.from(result.bytes));
    return;
  }
  res.statusCode = result.status;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  for await (const chunk of result.events) {
    res.write(chunk);
  }
  res.end();
}

let editBooted = false;

export async function handleNodeRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const { path, query } = pathnameOf(req);
  if (!path.startsWith("/api/")) {
    return false;
  }
  if (!editBooted) {
    editBooted = true;
    const { handleBootEditJobs } = await import("./handlers/edit");
    void handleBootEditJobs();
  }
  const method = req.method ?? "GET";
  if (!SAFE_METHODS.has(method)) {
    const origin = header(req, "origin");
    if (!isAllowedMutatingApiRequest(origin, header(req, "referer"))) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: { code: "forbidden", message: "Local requests only" } }));
      return true;
    }
  }
  const cookies = parseCookies(req);
  let parsed: { body?: unknown; files?: HostFile[] };
  try {
    parsed = await readBody(req);
  } catch (error) {
    if (error instanceof BodyTooLarge) {
      res.statusCode = 413;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: { code: "payload_too_large", message: error.message } }));
      return true;
    }
    throw error;
  }
  const { body, files } = parsed;
  const request: HostRequest = {
    method,
    path,
    query,
    params: {},
    headers: {
      origin: header(req, "origin"),
      referer: header(req, "referer"),
      "content-type": header(req, "content-type"),
      "x-agentforge-transport": "http",
    },
    body,
    files,
    workspaceId: cookies[WORKSPACE_COOKIE] || readSelectedWorkspaceId() || null,
  };
  const result = await dispatch(request);
  await writeHostResult(res, result);
  return true;
}
