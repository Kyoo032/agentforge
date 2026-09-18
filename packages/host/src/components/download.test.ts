/**
 * Integrity is the whole security story of this subsystem: the manifest pins a sha512 and these
 * bytes are only ever trusted because they match it. A mismatch must be reported as
 * `integrity_mismatch` and must never be retried into acceptance.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { componentManifest } from "./manifest";
import { downloadPackage, verifyIntegrity } from "./download";
import { ComponentError } from "./types";

const PACKAGE = componentManifest("anydoc").main;

function integrityOf(bytes: Buffer): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

function okResponse(body: Buffer): Response {
  return new Response(body, { status: 200, headers: { "content-type": "application/octet-stream" } });
}

function fetchReturning(...bodies: Buffer[]): typeof fetch {
  const queue = [...bodies];
  return vi.fn(async () => okResponse(queue.length > 1 ? (queue.shift() as Buffer) : (queue[0] as Buffer))) as never;
}

async function failureOf(work: Promise<unknown>): Promise<ComponentError> {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ComponentError);
  return error as ComponentError;
}

describe("verifyIntegrity", () => {
  it("accepts bytes whose sha512 matches the pinned SRI value", () => {
    const bytes = Buffer.from("payload");
    expect(() => verifyIntegrity(bytes, integrityOf(bytes), "pkg")).not.toThrow();
  });

  it("rejects bytes that do not match, as integrity_mismatch", () => {
    try {
      verifyIntegrity(Buffer.from("tampered"), integrityOf(Buffer.from("payload")), "pkg");
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ComponentError);
      expect((error as ComponentError).code).toBe("integrity_mismatch");
    }
  });

  it("rejects an integrity string that is not sha512 SRI", () => {
    expect(() => verifyIntegrity(Buffer.alloc(1), "md5-abc", "pkg")).toThrow(ComponentError);
  });
});

describe("downloadPackage", () => {
  it("fetches the manifest tarball and returns bytes that match the integrity it was given", async () => {
    const body = Buffer.from("tarball bytes");
    const fetchImpl = fetchReturning(body);
    const bytes = await downloadPackage({ ...PACKAGE, integrity: integrityOf(body) }, { fetchImpl });
    expect(bytes.equals(body)).toBe(true);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(PACKAGE.tarball);
  });

  it("re-downloads once on a corrupt body, then reports integrity_mismatch", async () => {
    const good = Buffer.from("good");
    const fetchImpl = vi.fn(async () => okResponse(Buffer.from("corrupt"))) as never;
    const error = await failureOf(
      downloadPackage({ ...PACKAGE, integrity: integrityOf(good) }, { fetchImpl, backoffMs: 0 }),
    );
    expect(error.code).toBe("integrity_mismatch");
    // One retry, never silently more: two attempts total.
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it("accepts a good body delivered on the retry after a corrupt one", async () => {
    const good = Buffer.from("good");
    const fetchImpl = fetchReturning(Buffer.from("corrupt"), good);
    const bytes = await downloadPackage({ ...PACKAGE, integrity: integrityOf(good) }, { fetchImpl, backoffMs: 0 });
    expect(bytes.equals(good)).toBe(true);
  });

  it("retries a transport failure up to three attempts and then reports download_failed", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 })) as never;
    const error = await failureOf(downloadPackage(PACKAGE, { fetchImpl, backoffMs: 0 }));
    expect(error.code).toBe("download_failed");
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  });

  it("reports offline when the socket never opens", async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    }) as never;
    expect((await failureOf(downloadPackage(PACKAGE, { fetchImpl, backoffMs: 0 }))).code).toBe("offline");
  });

  it("reports progress as bytes received", async () => {
    const body = Buffer.from("0123456789");
    const seen: number[] = [];
    await downloadPackage(
      { ...PACKAGE, integrity: integrityOf(body) },
      {
        fetchImpl: fetchReturning(body),
        onBytes: (received) => seen.push(received),
      },
    );
    expect(seen).toEqual([body.byteLength]);
  });
});
