/**
 * The shared settings read: what a cold Chat load asks the host for.
 *
 * Measured on the dev desk, 2026-09-29: the shell's gate read, the key pill, the usage chip and the
 * composer each fetched `GET /api/v1/settings` (274 KB then), one after another, so `apiFetch`'s
 * in-flight sharing folded none of them. The rules under test are the ones that make sharing safe:
 * one request and one parse inside the window, a fresh ask after it, and nothing kept across a write.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let writeListeners: Array<() => void> = [];
const apiFetch = vi.fn();

vi.mock("./api-client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  subscribeToWrites: (listener: () => void) => {
    writeListeners.push(listener);
    return () => {
      writeListeners = writeListeners.filter((item) => item !== listener);
    };
  },
}));

import { REUSE_WINDOW_MS, forgetSettings, readSettings, resetSettingsReadForTests } from "./settings-read";

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** The api-client announcing that this renderer wrote something. */
function aWriteHappens(): void {
  for (const listener of writeListeners) {
    listener();
  }
}

beforeEach(() => {
  writeListeners = [];
  apiFetch.mockReset();
  resetSettingsReadForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readSettings", () => {
  it("makes one request for reads that do not overlap, which is what apiFetch alone could not fold", async () => {
    apiFetch.mockImplementation(async () => answer({ gateway: { status: "ok" } }));

    const shell = await readSettings({ fresh: true });
    const pill = await readSettings();
    const chip = await readSettings();
    const composer = await readSettings();

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith("/api/v1/settings");
    expect(pill).toBe(shell);
    expect(chip).toBe(shell);
    expect(composer).toBe(shell);
    expect(shell).toMatchObject({ ok: true, status: 200, body: { gateway: { status: "ok" } } });
  });

  it("shares one parse between callers that arrive while the request is out", async () => {
    apiFetch.mockImplementation(async () => answer({ n: 1 }));
    const [a, b, c] = await Promise.all([readSettings(), readSettings(), readSettings()]);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(a.body).toBe(b.body);
    expect(b.body).toBe(c.body);
  });

  it("asks again once the window has passed", async () => {
    const clock = vi.spyOn(Date, "now");
    apiFetch.mockImplementationOnce(async () => answer({ n: 1 })).mockImplementationOnce(async () => answer({ n: 2 }));

    clock.mockReturnValue(1_000_000);
    expect((await readSettings()).body).toEqual({ n: 1 });
    clock.mockReturnValue(1_000_000 + REUSE_WINDOW_MS - 1);
    expect((await readSettings()).body).toEqual({ n: 1 });
    expect(apiFetch).toHaveBeenCalledTimes(1);

    clock.mockReturnValue(1_000_000 + REUSE_WINDOW_MS);
    expect((await readSettings()).body).toEqual({ n: 2 });
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("does not answer a read that starts after a write with one that started before it", async () => {
    apiFetch
      .mockImplementationOnce(async () => answer({ hasOpenai: false }))
      .mockImplementationOnce(async () => answer({ hasOpenai: true }));

    expect((await readSettings()).body).toEqual({ hasOpenai: false });
    aWriteHappens(); // a key saved in Settings
    expect((await readSettings()).body).toEqual({ hasOpenai: true });
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("drops the answer at the end of a write as well as at the start", async () => {
    apiFetch
      .mockImplementationOnce(async () => answer({ n: 1 }))
      .mockImplementationOnce(async () => answer({ n: 2 }))
      .mockImplementationOnce(async () => answer({ n: 3 }));

    await readSettings();
    aWriteHappens(); // start of the write
    // A read that begins while the write is out may still see the old state...
    expect((await readSettings()).body).toEqual({ n: 2 });
    aWriteHappens(); // ...so the write's end drops it too.
    expect((await readSettings()).body).toEqual({ n: 3 });
  });

  it("lets the caller who was already waiting have an answer that predates a write, and nobody after it", async () => {
    let release: (response: Response) => void = () => {};
    apiFetch
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      )
      .mockImplementationOnce(async () => answer({ n: "after" }));

    const before = readSettings();
    aWriteHappens();
    const after = readSettings();
    release(answer({ n: "before" }));

    expect((await before).body).toEqual({ n: "before" });
    expect((await after).body).toEqual({ n: "after" });
  });

  it("always asks the host for a fresh read, and shares that one afterwards", async () => {
    apiFetch.mockImplementationOnce(async () => answer({ n: 1 })).mockImplementationOnce(async () => answer({ n: 2 }));

    await readSettings();
    expect((await readSettings({ fresh: true })).body).toEqual({ n: 2 });
    expect((await readSettings()).body).toEqual({ n: 2 });
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("does not keep a refusal: everyone waiting sees it, the next caller asks again", async () => {
    apiFetch
      .mockImplementationOnce(async () => answer({ error: { message: "busy" } }, 503))
      .mockImplementationOnce(async () => answer({ hasOpenai: true }));

    const refused = await readSettings();
    expect(refused).toMatchObject({ ok: false, status: 503, body: { error: { message: "busy" } } });
    expect(await readSettings()).toMatchObject({ ok: true, body: { hasOpenai: true } });
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("does not keep a dead network, and gives every waiting caller the failure", async () => {
    apiFetch
      .mockImplementationOnce(async () => {
        throw new TypeError("network down");
      })
      .mockImplementationOnce(async () => answer({ ok: true }));

    const first = readSettings();
    const second = readSettings();
    await expect(first).rejects.toThrow("network down");
    await expect(second).rejects.toThrow("network down");
    expect((await readSettings()).ok).toBe(true);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("reports an answer that is not a JSON object as an empty body rather than throwing", async () => {
    apiFetch
      .mockImplementationOnce(async () => new Response("<html>gateway timeout</html>", { status: 504 }))
      .mockImplementationOnce(async () => answer([1, 2, 3]));

    expect(await readSettings()).toEqual({ ok: false, status: 504, body: null });
    expect(await readSettings()).toEqual({ ok: true, status: 200, body: null });
  });

  it("freezes the shared body, so one reader cannot change what the others see", async () => {
    apiFetch.mockImplementation(async () => answer({ gateway: { status: "ok" }, list: [{ id: "a" }] }));
    const { body } = await readSettings();
    expect(Object.isFrozen(body)).toBe(true);
    expect(Object.isFrozen((body as { gateway: object }).gateway)).toBe(true);
    expect(Object.isFrozen((body as { list: object[] }).list[0])).toBe(true);
    expect(() => {
      (body as { gateway: { status: string } }).gateway.status = "invalid_key";
    }).toThrow(TypeError);
  });

  it("forgetSettings makes the next read ask the host", async () => {
    apiFetch.mockImplementationOnce(async () => answer({ n: 1 })).mockImplementationOnce(async () => answer({ n: 2 }));
    await readSettings();
    forgetSettings();
    expect((await readSettings()).body).toEqual({ n: 2 });
  });

  it("subscribes to writes once, however many reads are made", async () => {
    apiFetch.mockImplementation(async () => answer({}));
    await readSettings();
    await readSettings({ fresh: true });
    await readSettings();
    expect(writeListeners).toHaveLength(1);
  });
});
