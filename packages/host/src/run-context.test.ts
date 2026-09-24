/**
 * `localeForRun()` — which language a job answers in.
 *
 * Three sources, most specific first: a Chat run's own context, then the locale of the person the
 * hosted request belongs to (set by `dispatch` for every gated request), then the process's frozen
 * boot locale, which is all the desktop and webdev ever have. The boot locale is mocked here so the
 * three are distinguishable; the real one is covered by `locale-boot.test.ts`.
 */
import type { AppLocale } from "@agentforge/core";
import { afterEach, describe, expect, it, vi } from "vitest";

const boot = vi.hoisted(() => ({ locale: "id" as AppLocale }));

vi.mock("./locale-boot", () => ({ getBootLocale: () => boot.locale }));

const { localeForRun, withRequestLocale, withRunContext } = await import("./run-context");

afterEach(() => {
  boot.locale = "id";
});

const RUN = { threadId: "thr_1", agentId: "agt_1" } as const;

describe("localeForRun", () => {
  it("is the boot locale outside any request, which is every desktop and webdev call", () => {
    expect(localeForRun()).toBe("id");
    boot.locale = "en";
    expect(localeForRun()).toBe("en");
  });

  it("is the request's locale inside withRequestLocale", async () => {
    const seen = await withRequestLocale(
      () => "en",
      async () => localeForRun(),
    );
    expect(seen).toBe("en");
  });

  it("follows the request through everything its handler awaits", async () => {
    const seen = await withRequestLocale(
      () => "en",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return Promise.all([
          Promise.resolve().then(localeForRun),
          new Promise((r) => setImmediate(() => r(localeForRun()))),
        ]);
      },
    );
    expect(seen).toEqual(["en", "en"]);
  });

  it("lets a Chat run's own context win over the request's", async () => {
    const seen = await withRequestLocale(
      () => "en",
      () => withRunContext({ ...RUN, locale: "id" }, async () => localeForRun()),
    );
    expect(seen).toBe("id");
  });

  it("keeps two concurrent requests apart", async () => {
    const slow = (locale: AppLocale, ms: number) =>
      withRequestLocale(
        () => locale,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, ms));
          return localeForRun();
        },
      );
    expect(await Promise.all([slow("en", 5), slow("id", 1)])).toEqual(["en", "id"]);
  });

  it("falls back to the boot locale once the request is over", async () => {
    await withRequestLocale(
      () => "en",
      async () => undefined,
    );
    expect(localeForRun()).toBe("id");
  });
});

describe("withRequestLocale", () => {
  it("reads the locale only when a handler asks for it", async () => {
    const resolve = vi.fn((): AppLocale => "en");
    await withRequestLocale(resolve, async () => "no locale needed");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("reads it at most once per request, however often it is asked", async () => {
    const resolve = vi.fn((): AppLocale => "en");
    await withRequestLocale(resolve, async () => {
      localeForRun();
      localeForRun();
      await Promise.resolve();
      localeForRun();
    });
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("answers English, not the install's locale, when the person's locale cannot be read", async () => {
    boot.locale = "id";
    const seen = await withRequestLocale(
      () => {
        throw new Error("settings payload unreadable");
      },
      async () => [localeForRun(), localeForRun()],
    );
    expect(seen).toEqual(["en", "en"]);
  });
});
