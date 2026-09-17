/**
 * Fetching a pinned tarball and proving it is the one the manifest names.
 *
 * SECURITY — the URL always comes from `manifest.ts` and is fetched through `fetchPublicHttps`, so
 * HTTPS, the private-host block and the byte cap are re-applied on every redirect hop. No header is
 * added beyond the helper's own User-Agent: there is nothing to authenticate to on a public registry,
 * and nothing about this machine or its owner is sent. The sha512 is checked here, in memory, before
 * `install.ts` is allowed to write a single byte anywhere.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { fetchPublicHttps } from "@agentforge/core";
import type { ComponentPackage } from "./manifest";
import { ComponentError } from "./types";

/** 16 MB: the largest pinned prebuilt is ~8 MB, so this is headroom, not a licence to grow. */
export const COMPONENT_MAX_BYTES = 16_000_000;
export const COMPONENT_TIMEOUT_MS = 60_000;
/** Transport attempts. Only the download is retried; nothing after it is. */
export const COMPONENT_MAX_ATTEMPTS = 3;
export const COMPONENT_BACKOFF_MS = 400;

export type DownloadOptions = {
  readonly fetchImpl?: typeof fetch;
  readonly abortSignal?: AbortSignal;
  /** Cumulative bytes for this package, called once the body is in hand. */
  readonly onBytes?: (received: number) => void;
  readonly backoffMs?: number;
};

const SRI = /^sha512-([A-Za-z0-9+/]+={0,2})$/;

/** Constant-time compare of the pinned digest against the one these bytes actually have. */
export function verifyIntegrity(bytes: Buffer, integrity: string, packageName: string): void {
  const match = SRI.exec(integrity.trim());
  if (!match) {
    throw new ComponentError("integrity_mismatch", `${packageName} has no usable sha512 integrity in the manifest`);
  }
  const expected = Buffer.from(match[1], "base64");
  const actual = createHash("sha512").update(bytes).digest();
  if (expected.byteLength !== actual.byteLength || !timingSafeEqual(expected, actual)) {
    throw new ComponentError(
      "integrity_mismatch",
      `${packageName} did not match its pinned sha512; the download was discarded`,
    );
  }
}

function isOffline(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  const code = typeof cause?.code === "string" ? cause.code : "";
  return ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH", "ECONNRESET", "EHOSTUNREACH"].includes(code);
}

function asDownloadError(error: unknown, packageName: string): ComponentError {
  if (error instanceof ComponentError) {
    return error;
  }
  const message = error instanceof Error && error.message ? error.message : "download failed";
  return new ComponentError(isOffline(error) ? "offline" : "download_failed", `${packageName}: ${message}`);
}

async function pause(ms: number): Promise<void> {
  if (ms > 0) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

async function fetchOnce(pkg: ComponentPackage, options: DownloadOptions): Promise<Buffer> {
  const result = await fetchPublicHttps(pkg.tarball, {
    fetchImpl: options.fetchImpl,
    maxBytes: COMPONENT_MAX_BYTES,
    timeoutMs: COMPONENT_TIMEOUT_MS,
    signal: options.abortSignal,
  });
  if (result.status !== 200) {
    throw new ComponentError("download_failed", `${pkg.name}: registry answered ${result.status}`);
  }
  return result.body;
}

/**
 * The tarball, verified. Transport failures are retried up to `COMPONENT_MAX_ATTEMPTS`; a body that
 * fails its digest is re-downloaded exactly once (the registry could have served a truncated copy)
 * and a second mismatch is final — it is never retried into acceptance.
 */
export async function downloadPackage(pkg: ComponentPackage, options: DownloadOptions = {}): Promise<Buffer> {
  const backoff = options.backoffMs ?? COMPONENT_BACKOFF_MS;
  let integrityFailures = 0;
  let last: unknown;
  for (let attempt = 1; attempt <= COMPONENT_MAX_ATTEMPTS; attempt += 1) {
    try {
      const bytes = await fetchOnce(pkg, options);
      try {
        verifyIntegrity(bytes, pkg.integrity, pkg.name);
      } catch (error) {
        integrityFailures += 1;
        if (integrityFailures > 1) {
          throw error;
        }
        last = error;
        await pause(backoff);
        continue;
      }
      options.onBytes?.(bytes.byteLength);
      return bytes;
    } catch (error) {
      if (error instanceof ComponentError && error.code === "integrity_mismatch") {
        throw error;
      }
      last = error;
      if (attempt < COMPONENT_MAX_ATTEMPTS) {
        await pause(backoff * attempt);
      }
    }
  }
  throw asDownloadError(last, pkg.name);
}
