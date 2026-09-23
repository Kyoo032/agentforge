/**
 * A Chat run that outlives its session.
 *
 * The owner sends in one session and opens another from the rail while the reply is still
 * streaming. The composer used to keep handing that stream's deltas, tool calls and failure to the
 * pane, which by then showed the other session — the reply was drawn into the wrong conversation.
 *
 * It must not be fixed by cancelling the stream: the host aborts a run whose client goes away
 * (`packages/host/src/http-adapter.ts`, `res.on("close")`), and the reply the owner asked for would
 * never be saved. So `readRunStream` reads to the end whatever happens, and only stops *drawing*
 * once `showing()` says the run's session is no longer on screen.
 */
import { describe, expect, it } from "vitest";
import { readRunStream, type RunStreamHandlers } from "@/components/chat-composer";

function frame(type: string, payload: Record<string, unknown> = {}): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
}

/** A body that hands over one chunk per read and records whether it was read to the end or cancelled. */
function body(chunks: string[]) {
  const encoder = new TextEncoder();
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks[state.pulled];
      state.pulled += 1;
      if (next === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(next));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

function recorder() {
  const seen: string[] = [];
  const handlers: RunStreamHandlers = {
    onStarted: () => seen.push("started"),
    onDelta: (text) => seen.push(`delta:${text}`),
    onThinking: (text) => seen.push(`thinking:${text}`),
    onTool: (event) => seen.push(`tool:${event.phase}:${event.toolKey}`),
    onFailed: (message) => seen.push(`failed:${message}`),
  };
  return { seen, handlers };
}

describe("readRunStream", () => {
  it("draws every event of a run whose session is on screen, in order", async () => {
    const { stream } = body([
      frame("run.started"),
      frame("assistant.thinking", { text: "hm" }),
      frame("tool.started", { toolKey: "web_search", input: { q: "x" } }),
      frame("tool.completed", { toolKey: "web_search", output: {} }),
      frame("assistant.delta", { text: "Hel" }),
      frame("assistant.delta", { text: "lo" }),
    ]);
    const { seen, handlers } = recorder();

    await readRunStream(stream, handlers);

    expect(seen).toEqual([
      "started",
      "thinking:hm",
      "tool:started:web_search",
      "tool:completed:web_search",
      "delta:Hel",
      "delta:lo",
    ]);
  });

  it("reports the run's own failure", async () => {
    const { stream } = body([frame("run.failed", { message: "Model refused" })]);
    const { seen, handlers } = recorder();

    await readRunStream(stream, handlers);

    expect(seen).toEqual(["failed:Model refused"]);
  });

  it("joins a frame split across two reads", async () => {
    const whole = frame("assistant.delta", { text: "split" });
    const { stream } = body([whole.slice(0, 12), whole.slice(12)]);
    const { seen, handlers } = recorder();

    await readRunStream(stream, handlers);

    expect(seen).toEqual(["delta:split"]);
  });

  it("stops drawing once another session is on screen, and still reads the stream to the end", async () => {
    const chunks = [
      frame("assistant.delta", { text: "first" }),
      frame("assistant.delta", { text: "second" }),
      frame("tool.started", { toolKey: "image_generate" }),
      frame("run.failed", { message: "late failure" }),
    ];
    const { stream, state } = body(chunks);
    const { seen, handlers } = recorder();
    let onScreen = true;
    const drawing: RunStreamHandlers = {
      ...handlers,
      onDelta: (text) => {
        handlers.onDelta(text);
        // The owner opens another session right after the first delta lands.
        onScreen = false;
      },
    };

    await readRunStream(stream, drawing, { showing: () => onScreen });

    expect(seen).toEqual(["delta:first"]);
    // Every chunk was pulled and the body was never cancelled: the host is left to finish the run.
    expect(state.pulled).toBe(chunks.length + 1);
    expect(state.cancelled).toBe(false);
  });

  it("keeps the stall watchdog fed for a run it has stopped drawing", async () => {
    const { stream } = body([frame("assistant.delta", { text: "a" }), frame("assistant.delta", { text: "b" })]);
    const { handlers } = recorder();
    let activity = 0;

    await readRunStream(stream, handlers, { showing: () => false, onActivity: () => (activity += 1) });

    expect(activity).toBe(2);
  });
});
