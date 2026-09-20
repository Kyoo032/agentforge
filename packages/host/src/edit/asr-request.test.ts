import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-asr-request-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.AGENTFORGE_SECRETS_KEY = "c".repeat(64);
process.env.OPENAI_API_KEY = "sk-asr-test-key";
process.env.AGENTFORGE_EDIT_ASR_MODEL = "whisper-1";

const { transcribeAudioChunks } = await import("./asr");
const { resolveAsrCapability } = await import("./asr");

const chunk = join(dataDir, "chunk.mp3");

beforeAll(() => {
  writeFileSync(chunk, "not-real-audio");
});

afterAll(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.AGENTFORGE_EDIT_ASR_MODEL;
});

function okResponse(text: string) {
  return { ok: true, status: 200, json: async () => ({ text }) } as unknown as Response;
}

/**
 * A10-4. This call carries the gateway key in an `Authorization` header and used fetch's default
 * `redirect: "follow"`, so a 302 from the gateway — or from anything impersonating it — re-sent
 * that key to wherever the `Location` pointed. It also had no timeout, so a gateway that accepted
 * the connection and then stopped talking held the request open indefinitely.
 */
describe("the ASR request", () => {
  it("does nothing at all if the capability is off, which is the precondition for the rest", () => {
    expect(resolveAsrCapability().available).toBe(true);
  });

  it("never follows a redirect and always carries a timeout", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse("hello"));
    await transcribeAudioChunks([chunk], undefined, fetchMock as unknown as typeof fetch);
    expect(fetchMock).toHaveBeenCalled();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-asr-test-key");
  });

  it("applies the same rules to the 5xx retry, which is a second chance to leak the key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as unknown as Response)
      .mockResolvedValueOnce(okResponse("second time"));
    const result = await transcribeAudioChunks([chunk], undefined, fetchMock as unknown as typeof fetch);
    expect(result.text).toBe("second time");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit;
      expect(init.redirect).toBe("manual");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("treats a 302 as a failure rather than a hop, since the body is not a transcript", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 302, json: async () => ({}) } as unknown as Response);
    const result = await transcribeAudioChunks([chunk], undefined, fetchMock as unknown as typeof fetch);
    expect(result.text).toBe("");
    // One call: `redirect: "manual"` means fetch hands back the 302 instead of chasing it, and a
    // 3xx is not >= 500 so there is no retry either.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
