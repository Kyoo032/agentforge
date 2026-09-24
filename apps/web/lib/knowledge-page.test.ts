/**
 * The Knowledge page's writes: Add URL, Index paste, Upload file and Pin memory.
 *
 * Two faults, one per helper. Pin memory cleared the draft without looking at the answer, so a
 * refused or failed pin looked like a saved one and the text was gone. And nothing stopped a second
 * press while the first was still out, so Add URL and Index paste could index the same source twice.
 * `sendKnowledge` is the order SR-45 set for the recording upload — `res.ok` before the body, an
 * error page read with a catch, a dead network reported rather than thrown — and
 * `createSubmitGuard` keeps one of each action in flight.
 *
 * The page itself is JSX with hooks and this package's tests run in node, so its wiring is not
 * driven here; these are the two pieces every one of those buttons goes through.
 */
import { describe, expect, it, vi } from "vitest";
import { createSubmitGuard, sendKnowledge, type KnowledgeFetch } from "@/components/knowledge-page";

vi.mock("@/lib/api-client", () => ({
  apiFetch: async () => {
    throw new Error("the real api-client must never be reached from these cases");
  },
}));

function answer(status: number, body: unknown, badJson = false): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (badJson) {
        throw new SyntaxError("Unexpected token <");
      }
      return body;
    },
  } as Response;
}

describe("sendKnowledge", () => {
  it("sends the request it was given and hands back the host's body", async () => {
    const seen: Array<{ input: string; init?: RequestInit }> = [];
    const fetcher: KnowledgeFetch = async (input, init) => {
      seen.push({ input, init });
      return answer(201, { id: "mem_1", text: "Prefers metric units", pinned: true });
    };
    const init = { method: "POST", body: JSON.stringify({ text: "Prefers metric units", pinned: true }) };

    const outcome = await sendKnowledge("/api/v1/knowledge/memories", init, "fallback", fetcher);

    expect(outcome).toEqual({ ok: true, data: { id: "mem_1", text: "Prefers metric units", pinned: true } });
    expect(seen).toEqual([{ input: "/api/v1/knowledge/memories", init }]);
  });

  it("reports a refusal in the host's own words instead of treating it as saved", async () => {
    const fetcher: KnowledgeFetch = async () => answer(400, { error: { message: "Memory text is too long" } });

    await expect(sendKnowledge("/api/v1/knowledge/memories", {}, "fallback", fetcher)).resolves.toEqual({
      ok: false,
      message: "Memory text is too long",
    });
  });

  it("survives an error page that is not JSON", async () => {
    const fetcher: KnowledgeFetch = async () => answer(502, null, true);

    await expect(sendKnowledge("/api/v1/knowledge/sources/url", {}, "Could not add URL", fetcher)).resolves.toEqual({
      ok: false,
      message: "Could not add URL",
    });
  });

  it("reports a dead network instead of throwing", async () => {
    const fetcher: KnowledgeFetch = async () => {
      throw new TypeError("Failed to fetch");
    };

    await expect(sendKnowledge("/api/v1/knowledge/sources", {}, "fallback", fetcher)).resolves.toEqual({
      ok: false,
      message: "Failed to fetch",
    });
  });

  it("counts a 2xx with an unreadable body as done", async () => {
    const fetcher: KnowledgeFetch = async () => answer(204, null, true);

    await expect(sendKnowledge("/api/v1/knowledge/memories", {}, "fallback", fetcher)).resolves.toEqual({
      ok: true,
      data: null,
    });
  });
});

describe("createSubmitGuard", () => {
  function deferred() {
    let resolve: () => void = () => {};
    let reject: (error: unknown) => void = () => {};
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("runs the action once and reports it busy until it settles", async () => {
    const seen: string[][] = [];
    const guard = createSubmitGuard<"url" | "paste">((busy) => seen.push([...busy]));
    const gate = deferred();
    const task = vi.fn(() => gate.promise);

    const first = guard.run("url", task);
    expect(guard.isBusy("url")).toBe(true);
    gate.resolve();

    await expect(first).resolves.toBe(true);
    expect(task).toHaveBeenCalledTimes(1);
    expect(guard.isBusy("url")).toBe(false);
    expect(seen).toEqual([["url"], []]);
  });

  it("drops a second press while the first is still out", async () => {
    const guard = createSubmitGuard<"url">(() => {});
    const gate = deferred();
    const task = vi.fn(() => gate.promise);

    const first = guard.run("url", task);
    const second = guard.run("url", task);
    gate.resolve();

    await expect(second).resolves.toBe(false);
    await expect(first).resolves.toBe(true);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("lets different actions run side by side", async () => {
    const guard = createSubmitGuard<"url" | "paste">(() => {});
    const url = deferred();
    const paste = deferred();

    const a = guard.run("url", () => url.promise);
    const b = guard.run("paste", () => paste.promise);
    expect(guard.isBusy("url") && guard.isBusy("paste")).toBe(true);
    url.resolve();
    paste.resolve();

    await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
  });

  it("frees the action when it throws, and does not hide the error", async () => {
    const guard = createSubmitGuard<"memory">(() => {});
    const gate = deferred();

    const run = guard.run("memory", () => gate.promise);
    gate.reject(new Error("boom"));

    await expect(run).rejects.toThrow("boom");
    expect(guard.isBusy("memory")).toBe(false);
    await expect(guard.run("memory", async () => {})).resolves.toBe(true);
  });
});
