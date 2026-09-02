import { describe, expect, it } from "vitest";
import { thinToolOutput } from "./tool-thin";

describe("thinToolOutput", () => {
  it("shrinks web_search hits to title, url, and a short description", () => {
    const long = "n".repeat(400);
    const output = {
      success: true,
      backend: "tavily",
      data: {
        web: [
          {
            title: "Example",
            url: "https://example.com",
            description: long,
            position: 1,
            extra: "drop me",
          },
        ],
      },
    };
    const thinned = thinToolOutput("web_search", output) as {
      data: { web: Array<{ title: string; url: string; description: string; extra?: string; position?: number }> };
    };
    expect(thinned.data.web[0]?.title).toBe("Example");
    expect(thinned.data.web[0]?.url).toBe("https://example.com");
    expect(thinned.data.web[0]?.description.length).toBeLessThanOrEqual(281);
    expect(thinned.data.web[0]?.description.endsWith("…")).toBe(true);
    expect(thinned.data.web[0]?.extra).toBeUndefined();
    expect(thinned.data.web[0]?.position).toBeUndefined();
    expect(output.data.web[0]?.description).toBe(long);
  });

  it("leaves error payloads untouched", () => {
    const failed = { success: false, error: "Add a Tavily key", bulky: "x".repeat(500) };
    expect(thinToolOutput("web_search", failed)).toBe(failed);

    const keyed = { error: "tool blew up", data: "y".repeat(500) };
    expect(thinToolOutput("calculator", keyed)).toBe(keyed);
  });

  it("strips data URLs and long base64 from success payloads", () => {
    const blob = "A".repeat(420);
    const output = {
      success: true,
      preview: `data:image/png;base64,${blob}`,
      note: `payload ${blob}`,
    };
    const thinned = thinToolOutput("past_sessions", output) as { preview: string; note: string };
    expect(thinned.preview).toBe("[omitted data url]");
    expect(thinned.note).toContain("[omitted binary]");
    expect(thinned.note).not.toContain(blob);
  });

  it("does not change calculator { result: 5 }", () => {
    expect(thinToolOutput("calculator", { result: 5 })).toEqual({ result: 5 });
  });

  it("fails open when output cannot be cloned", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(thinToolOutput("web_search", cyclic)).toBe(cyclic);
  });
});
