import { errorFromAbortSignal, onAbort, throwIfAborted } from "./ipc-abort";

export type IpcHostRequest = {
  requestId: string;
  method: string;
  path: string;
  query: Record<string, string>;
  body?: unknown;
  files?: Array<{ field: string; filename: string; mime: string; bytes: number[] }>;
};

export type IpcHostResponse =
  | { type: "json"; status: number; body: unknown }
  | { type: "bytes"; status: number; bytes: number[]; contentType: string; filename?: string }
  | { type: "stream"; status: number; requestId: string };

declare global {
  interface Window {
    agentforge?: {
      isElectron: true;
      brand?: { productName?: string; gatewayName?: string; gatewayBaseUrl?: string };
      brandLogo?: string;
      invoke: (payload: IpcHostRequest) => Promise<IpcHostResponse>;
      stream: (requestId: string, onChunk: (chunk: string) => void) => Promise<void>;
      abortStream?: (requestId: string) => void;
      saveBytes?: (filename: string, bytes: number[]) => Promise<void>;
      updates?: {
        supported: boolean;
        state: () => Promise<{
          supported: boolean;
          status?: string;
          currentVersion?: string;
          version?: string;
          percent?: number;
          message?: string;
        }>;
        check: () => Promise<{
          supported: boolean;
          status?: string;
          currentVersion?: string;
          version?: string;
          message?: string;
        }>;
        download: () => Promise<{
          supported: boolean;
          status?: string;
          currentVersion?: string;
          version?: string;
          percent?: number;
          message?: string;
        }>;
        install: () => Promise<void>;
        onStatus?: (
          callback: (state: {
            supported: boolean;
            status?: string;
            currentVersion?: string;
            version?: string;
            percent?: number;
            message?: string;
          }) => void,
        ) => () => void;
      };
    };
  }
}

export function isElectron(): boolean {
  return typeof window !== "undefined" && Boolean(window.agentforge?.isElectron);
}

function parsePath(input: string): { path: string; query: Record<string, string> } {
  const url = new URL(input, "http://agentforge.local");
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  return { path: url.pathname, query };
}

async function filesFromBody(body: BodyInit | null | undefined): Promise<IpcHostRequest["files"]> {
  if (!(body instanceof FormData)) {
    return undefined;
  }
  const files: NonNullable<IpcHostRequest["files"]> = [];
  for (const [field, value] of body.entries()) {
    if (value instanceof File) {
      const bytes = Array.from(new Uint8Array(await value.arrayBuffer()));
      files.push({ field, filename: value.name, mime: value.type || "application/octet-stream", bytes });
    }
  }
  return files;
}

function jsonBody(body: BodyInit | null | undefined): unknown {
  if (body == null || body instanceof FormData) {
    return undefined;
  }
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  return undefined;
}

function bytesResponse(payload: Extract<IpcHostResponse, { type: "bytes" }>): Response {
  const bytes = new Uint8Array(payload.bytes);
  const headers = new Headers({ "Content-Type": payload.contentType });
  if (payload.filename) {
    headers.set("Content-Disposition", `attachment; filename="${payload.filename}"`);
  }
  return new Response(bytes, { status: payload.status, headers });
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  if (!isElectron() || !window.agentforge) {
    return fetch(input, init);
  }
  throwIfAborted(init.signal);
  const { path, query } = parsePath(input);
  const method = (init.method ?? "GET").toUpperCase();
  const requestId = crypto.randomUUID();
  const payload: IpcHostRequest = {
    requestId,
    method,
    path,
    query,
    body: jsonBody(init.body),
    files: await filesFromBody(init.body),
  };
  const result = await window.agentforge.invoke(payload);
  throwIfAborted(init.signal);
  if (result.type === "json") {
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (result.type === "bytes") {
    if (result.filename && window.agentforge.saveBytes) {
      await window.agentforge.saveBytes(result.filename, result.bytes);
    }
    return bytesResponse(result);
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const fail = () => {
        window.agentforge?.abortStream?.(requestId);
        try {
          controller.error(errorFromAbortSignal(init.signal));
        } catch {
          // already closed
        }
      };
      const stop = onAbort(init.signal, fail);
      void window.agentforge!.stream(requestId, (chunk) => {
        controller.enqueue(encoder.encode(chunk));
      }).then(
        () => {
          stop();
          try {
            controller.close();
          } catch {
            // already errored
          }
        },
        (error) => {
          stop();
          try {
            controller.error(error);
          } catch {
            // already errored
          }
        },
      );
    },
    cancel() {
      window.agentforge?.abortStream?.(requestId);
    },
  });
  return new Response(stream, {
    status: result.status,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
  });
}

export function mediaSrc(url: string): string {
  if (!isElectron()) {
    return url;
  }
  const match = url.match(/\/api\/v1\/media\/([^/]+)\/file/);
  if (match) {
    return `agentforge://media/${match[1]}`;
  }
  return url;
}
