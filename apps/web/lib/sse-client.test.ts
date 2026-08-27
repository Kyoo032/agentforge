import { describe, expect, it } from "vitest";
import { consumeSse } from "./sse-client";

describe("consumeSse", () => {
  it("parses thinking and tool events from an SSE buffer", () => {
    const { events, rest } = consumeSse(
      [
        "event: run.started\ndata: {\"type\":\"run.started\",\"runId\":\"r1\"}\n\n",
        "event: assistant.thinking\ndata: {\"type\":\"assistant.thinking\",\"text\":\"hmm\"}\n\n",
        "event: tool.started\ndata: {\"type\":\"tool.started\",\"toolKey\":\"calculator\",\"input\":{}}\n\n",
        "event: assistant.delta\ndata: {\"type\":\"assistant.delta\",\"text\":\"hi\"}\n\n",
        "event: run.failed\ndata: {\"type\":\"run.failed\",\"message\":\"nope\"}\n\npartial",
      ].join(""),
    );
    expect(rest).toBe("partial");
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "assistant.thinking",
      "tool.started",
      "assistant.delta",
      "run.failed",
    ]);
    expect(events[1]?.text).toBe("hmm");
    expect(events[4]?.message).toBe("nope");
  });

  it("skips a malformed data line instead of aborting the stream", () => {
    const { events } = consumeSse("event: assistant.delta\ndata: not-json\n\nevent: assistant.delta\ndata: {\"text\":\"ok\"}\n\n");
    expect(events).toEqual([expect.objectContaining({ type: "assistant.delta", text: "ok" })]);
  });
});
