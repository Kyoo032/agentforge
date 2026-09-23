/**
 * The Usage page asks for one range at a time. Switching Day → Week → Month quickly used to leave
 * every earlier request running, and whichever answered last won, so the page could show Day's
 * numbers under the Month button. `fetchRangeUsage` takes the range's AbortSignal: an aborted load
 * answers `null` and the page drops it.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fetchRangeUsage } from "@/components/usage-page";
import { applyLocale, resetLocaleForTests, t } from "./i18n";

const PAYLOAD = {
  range: "week",
  thisKey: { status: "needs_key" },
  desk: { usd: 1.5, display: "$1.50", unknownCount: 0, pricedCount: 1, modelCount: 1, byModel: [] },
  buckets: [],
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function abortError(): Error {
  return Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
}

beforeAll(() => {
  resetLocaleForTests();
  applyLocale("en");
});

describe("fetchRangeUsage", () => {
  it("asks for the range with the signal, so switching ranges really cancels the request", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => json(200, PAYLOAD));
    const result = await fetchRangeUsage("week", controller.signal, fetcher);
    expect(fetcher).toHaveBeenCalledWith("/api/v1/usage?range=week", { signal: controller.signal });
    expect(result?.error).toBeNull();
    expect(result?.usage?.range).toBe("week");
    expect(result?.usage?.desk.display).toBe("$1.50");
  });

  it("drops an answer that lands after its range was switched away", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => {
      controller.abort();
      return json(200, { ...PAYLOAD, range: "day" });
    });
    expect(await fetchRangeUsage("day", controller.signal, fetcher)).toBeNull();
  });

  it("drops the AbortError of a cancelled request instead of reporting it as a failure", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => {
      controller.abort();
      throw abortError();
    });
    expect(await fetchRangeUsage("month", controller.signal, fetcher)).toBeNull();
  });

  it("does not start a request for a range that was already switched away", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn(async () => json(200, PAYLOAD));
    expect(await fetchRangeUsage("week", controller.signal, fetcher)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("says usage is unavailable on 404 and names the status otherwise", async () => {
    const signal = new AbortController().signal;
    expect(await fetchRangeUsage("day", signal, async () => json(404, {}))).toEqual({
      usage: null,
      error: t("usage.errors.unavailable"),
    });
    expect(await fetchRangeUsage("day", signal, async () => json(500, {}))).toEqual({
      usage: null,
      error: t("usage.errors.loadStatus", { status: 500 }),
    });
  });

  it("reports an incomplete payload and a network failure in the catalog's words", async () => {
    const signal = new AbortController().signal;
    expect(await fetchRangeUsage("day", signal, async () => json(200, { range: "day" }))).toEqual({
      usage: null,
      error: t("usage.errors.incomplete"),
    });
    expect(
      await fetchRangeUsage("day", signal, async () => {
        throw new TypeError("Failed to fetch");
      }),
    ).toEqual({ usage: null, error: t("usage.errors.load") });
  });
});

describe("the Usage page wiring", () => {
  const page = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../components/usage-page.tsx"), "utf8");

  it("gives every range its own AbortController and aborts it when the range changes", () => {
    expect(page).toContain("const controller = new AbortController();");
    expect(page).toContain("void fetchRangeUsage(range, controller.signal).then((result) => {");
    expect(page).toContain("return () => controller.abort();");
  });
});
