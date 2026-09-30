import { describe, expect, it } from "vitest";
import { GatewayCredentials } from "./credentials";
import { MAX_ERROR_CHARS, runProbeCall } from "./probe-call";
import { buildProbeRequest, PROBE_PROMPT, type ProbeRequest } from "./probe-request";

const KEY = "sk-test-KEY-0123456789";
const BASE = "https://gateway.example.test/v1";
const credentials = new GatewayCredentials(KEY, BASE);
const encoder = new TextEncoder();

type Wire = Parameters<typeof buildProbeRequest>[0]["wire"];

function request(wire: Wire, level: Parameters<typeof buildProbeRequest>[0]["level"] = "high"): ProbeRequest {
  return buildProbeRequest({ model: "m-1", wire, baseUrl: BASE, level, maxTokens: 32 });
}

/** A stream that advances a fake clock as each frame is read, so time to first token is exact. */
function stream(clock: { t: number }, frames: Array<{ at: number; data: string }>, status = 200): Response {
  let index = 0;
  // highWaterMark 0: a frame is produced only when the reader asks for it, so the fake clock moves in step
  // with the reads and never ahead of them.
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const frame = frames[index];
        index += 1;
        if (!frame) {
          controller.close();
          return;
        }
        clock.t = frame.at;
        controller.enqueue(encoder.encode(frame.data));
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}

const data = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;

function run(
  req: ProbeRequest,
  respond: (init: RequestInit | undefined, clock: { t: number }) => Promise<Response> | Response,
  options: { timeoutMs?: number } = {},
) {
  const clock = { t: 0 };
  const seen: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    return respond(init, clock);
  }) as typeof fetch;
  const record = runProbeCall(req, {
    credentials,
    fetch: fetchFn,
    timeoutMs: options.timeoutMs ?? 5_000,
    now: () => clock.t,
  });
  return { record, seen, clock };
}

function json(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("a request that is sent", () => {
  it("carries the key in the wire's own header, the body it was built with, and an abort signal", async () => {
    const req = request("chat_completions");
    const { record, seen } = run(req, (_init, clock) => stream(clock, [{ at: 10, data: data({ choices: [{ delta: { content: "OK" } }] }) }]));
    await record;
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(req.url);
    const headers = seen[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual(req.body);
    expect(seen[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(seen[0]?.init?.method).toBe("POST");
  });

  it("never puts the key, the prompt or the body in the record it returns", async () => {
    const { record } = run(request("responses"), (_init, clock) => stream(clock, [{ at: 5, data: data({ type: "response.output_text.delta", delta: "OK" }) }]));
    const text = JSON.stringify(await record);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(PROBE_PROMPT);
    expect(text).not.toContain("input_text");
  });
});

describe("chat completions", () => {
  it("times the first content token, the whole call, reads usage, and keeps the answer", async () => {
    const { record } = run(request("chat_completions"), (_init, clock) =>
      stream(clock, [
        { at: 50, data: data({ choices: [{ delta: { role: "assistant" } }] }) },
        { at: 300, data: data({ choices: [{ delta: { content: "OK" } }] }) },
        {
          at: 500,
          data: `${data({
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 12, completion_tokens: 40, completion_tokens_details: { reasoning_tokens: 30 } },
          })}data: [DONE]\n\n`,
        },
      ]),
    );
    expect(await record).toMatchObject({
      status: 200,
      ok: true,
      answered: true,
      answer: "OK",
      ttftMs: 300,
      totalMs: 500,
      finishReason: "stop",
      usage: { inputTokens: 12, outputTokens: 40, reasoningTokens: 30 },
      wire: "chat_completions",
      level: "high",
      sends: "reasoning_effort=high",
      attempt: 1,
    });
  });

  it("counts a thinking delta as the first token, and reports no answer if none follows", async () => {
    const { record } = run(request("chat_completions"), (_init, clock) =>
      stream(clock, [{ at: 120, data: data({ choices: [{ delta: { reasoning_content: "hm" } }] }) }]),
    );
    expect(await record).toMatchObject({ ok: true, ttftMs: 120, answered: false });
  });

  it("reads frames split across reads and CRLF line endings", async () => {
    const whole = `data: ${JSON.stringify({ choices: [{ delta: { content: "OK" } }] })}\r\n\r\n`;
    const { record } = run(request("chat_completions"), (_init, clock) =>
      stream(clock, [
        { at: 10, data: whole.slice(0, 9) },
        { at: 20, data: whole.slice(9) },
      ]),
    );
    expect(await record).toMatchObject({ ok: true, answered: true, ttftMs: 20 });
  });

  it("calls an empty 200 accepted but not answered", async () => {
    const { record } = run(request("chat_completions"), (_init, clock) => stream(clock, [{ at: 5, data: "data: [DONE]\n\n" }]));
    expect(await record).toMatchObject({ ok: true, answered: false });
    expect((await run(request("chat_completions"), () => json(200, "")).record).ttftMs).toBeUndefined();
  });

  it("treats an error frame inside a 200 stream as the gateway refusing the request", async () => {
    const { record } = run(request("chat_completions"), (_init, clock) =>
      stream(clock, [{ at: 5, data: data({ error: { message: "upstream said no", code: "upstream_error" } }) }]),
    );
    expect(await record).toMatchObject({ status: 200, ok: false, errorCode: "upstream_error", errorMessage: "upstream said no" });
  });
});

describe("the other wires", () => {
  it("responses: first output delta, usage and reasoning tokens from response.completed", async () => {
    const { record } = run(request("responses"), (_init, clock) =>
      stream(clock, [
        { at: 100, data: data({ type: "response.reasoning_summary_text.delta", delta: "thinking" }) },
        { at: 250, data: data({ type: "response.output_text.delta", delta: "OK" }) },
        {
          at: 300,
          data: data({
            type: "response.completed",
            response: {
              status: "completed",
              usage: { input_tokens: 9, output_tokens: 21, output_tokens_details: { reasoning_tokens: 16 } },
            },
          }),
        },
      ]),
    );
    expect(await record).toMatchObject({
      ok: true,
      answered: true,
      ttftMs: 100,
      totalMs: 300,
      finishReason: "completed",
      usage: { inputTokens: 9, outputTokens: 21, reasoningTokens: 16 },
    });
  });

  it("responses: an error event is a refusal", async () => {
    const { record } = run(request("responses"), (_init, clock) =>
      stream(clock, [{ at: 5, data: data({ type: "error", error: { message: "boom", code: "server_error" } }) }]),
    );
    expect(await record).toMatchObject({ ok: false, errorCode: "server_error", errorMessage: "boom" });
  });

  it("anthropic_messages: text delta, input tokens from message_start, output tokens from message_delta", async () => {
    const { record } = run(request("anthropic_messages"), (_init, clock) =>
      stream(clock, [
        { at: 10, data: data({ type: "message_start", message: { usage: { input_tokens: 14, output_tokens: 1 } } }) },
        { at: 200, data: data({ type: "content_block_delta", delta: { type: "text_delta", text: "OK" } }) },
        { at: 260, data: data({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 6 } }) },
      ]),
    );
    expect(await record).toMatchObject({
      ok: true,
      answered: true,
      ttftMs: 200,
      finishReason: "end_turn",
      usage: { inputTokens: 14, outputTokens: 6 },
    });
  });

  it("google_generate_content: text part, usageMetadata with thought tokens, and the auth header", async () => {
    const { record, seen } = run(request("google_generate_content"), (_init, clock) =>
      stream(clock, [
        {
          at: 180,
          data: data({
            candidates: [{ content: { parts: [{ text: "OK" }] }, finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 2, thoughtsTokenCount: 55 },
          }),
        },
      ]),
    );
    expect(await record).toMatchObject({
      ok: true,
      answered: true,
      ttftMs: 180,
      finishReason: "STOP",
      usage: { inputTokens: 8, outputTokens: 2, reasoningTokens: 55 },
    });
    const sentHeaders = (seen[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(sentHeaders["x-goog-api-key"]).toBe(KEY);
  });

  it("google_generate_content: a thought part is a token but not the answer", async () => {
    const { record } = run(request("google_generate_content"), (_init, clock) =>
      stream(clock, [{ at: 70, data: data({ candidates: [{ content: { parts: [{ text: "hmm", thought: true }] } }] }) }]),
    );
    expect(await record).toMatchObject({ ok: true, ttftMs: 70, answered: false });
  });
});

describe("a request the gateway refuses", () => {
  it("records the status, the code and the message, and says the Thinking level was what it refused", async () => {
    const { record } = run(request("chat_completions", "xhigh"), () =>
      json(400, { error: { message: "Unsupported value: 'xhigh' for reasoning_effort.", code: "unsupported_value", type: "invalid_request_error" } }),
    );
    expect(await record).toMatchObject({
      status: 400,
      ok: false,
      errorCode: "unsupported_value",
      errorMessage: "Unsupported value: 'xhigh' for reasoning_effort.",
      effortRefusal: "value",
      failureKind: "other",
      answered: false,
    });
  });

  it("does not call a context or key error an effort refusal", async () => {
    const { record } = run(request("chat_completions"), () => json(401, { error: { message: "Incorrect API key provided." } }));
    const done = await record;
    expect(done).toMatchObject({ status: 401, ok: false });
    expect(done.effortRefusal).toBeUndefined();
  });

  it("scrubs the key out of a message that echoes it, and out of a network error", async () => {
    const echoed = await run(request("chat_completions"), () =>
      json(401, { error: { message: `Incorrect API key provided: ${KEY}.` } }),
    ).record;
    expect(echoed.errorMessage).not.toContain(KEY);
    expect(echoed.errorMessage).toContain("[key]");
    const thrown = await run(request("chat_completions"), () => {
      throw new TypeError(`fetch failed for ${KEY}`);
    }).record;
    expect(thrown.errorMessage).not.toContain(KEY);
  });

  it("truncates a long message and flattens its line breaks", async () => {
    const long = `line one\nline two ${"x".repeat(2_000)}`;
    const { errorMessage } = await run(request("chat_completions"), () => json(500, { error: { message: long } })).record;
    expect(errorMessage?.length).toBeLessThanOrEqual(MAX_ERROR_CHARS);
    expect(errorMessage).not.toContain("\n");
  });

  it("reads a body that is not JSON, and the shapes some gateways use", async () => {
    expect((await run(request("chat_completions"), () => json(502, "<html>Bad gateway</html>")).record).errorMessage).toBe("<html>Bad gateway</html>");
    expect((await run(request("chat_completions"), () => json(400, { message: "flat message", code: 4001 })).record)).toMatchObject({
      errorMessage: "flat message",
      errorCode: "4001",
    });
    expect((await run(request("chat_completions"), () => json(422, { detail: "fastapi style" })).record).errorMessage).toBe("fastapi style");
    expect((await run(request("chat_completions"), () => json(400, { error: "just a string" })).record).errorMessage).toBe("just a string");
    expect((await run(request("chat_completions"), () => json(404, "")).record).errorMessage).toBeUndefined();
  });

  it("names a token floor and reads the number", async () => {
    const { record } = run(request("responses"), () =>
      json(400, {
        error: {
          message: "Invalid 'max_output_tokens': integer below minimum value. Expected a value >= 16, but got 8 instead.",
          code: "integer_below_min_value",
        },
      }),
    );
    expect(await record).toMatchObject({ failureKind: "token_floor", tokenFloor: 16 });
  });

  it("names a max_tokens spelling the model refuses, in both directions", async () => {
    const wantsCompletion = await run(request("chat_completions"), () =>
      json(400, { error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } }),
    ).record;
    expect(wantsCompletion.failureKind).toBe("token_field");
    const wantsPlain = await run(
      buildProbeRequest({ model: "m", wire: "chat_completions", baseUrl: BASE, level: "low", maxTokens: 32, tokenField: "max_completion_tokens" }),
      () => json(400, { error: { message: "Unrecognized request argument supplied: max_completion_tokens" } }),
    ).record;
    expect(wantsPlain.failureKind).toBe("token_field");
  });

  it("does not mistake an effort refusal for a token problem", async () => {
    const { record } = run(request("chat_completions"), () =>
      json(400, { error: { message: "Unsupported parameter: 'reasoning_effort' is not supported with this model." } }),
    );
    expect(await record).toMatchObject({ failureKind: "other", effortRefusal: "parameter" });
  });
});

describe("a request that gets no answer", () => {
  it("gives up at the timeout and says so, with the elapsed time", async () => {
    const started = Date.now();
    const { record } = run(
      request("chat_completions"),
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
      { timeoutMs: 25 },
    );
    const done = await record;
    expect(done).toMatchObject({ status: 0, ok: false, failureKind: "timeout", answered: false });
    expect(done.errorMessage).toMatch(/25 ?ms/);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("times out a stream that opens and then stalls", async () => {
    const { record } = run(
      request("chat_completions"),
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode(data({ choices: [{ delta: { role: "assistant" } }] })));
            },
          }),
          { status: 200 },
        ),
      { timeoutMs: 30 },
    );
    expect(await record).toMatchObject({ status: 200, ok: false, failureKind: "timeout" });
  });

  it("records a network failure as status 0", async () => {
    const { record } = run(request("chat_completions"), () => {
      throw new TypeError("fetch failed");
    });
    expect(await record).toMatchObject({ status: 0, ok: false, failureKind: "network", errorMessage: "fetch failed" });
  });
});

describe("attempt numbers", () => {
  it("record which try of a call this was", async () => {
    const clock = { t: 0 };
    const done = await runProbeCall(request("chat_completions"), {
      credentials,
      fetch: (async () => stream(clock, [{ at: 1, data: data({ choices: [{ delta: { content: "OK" } }] }) }])) as typeof fetch,
      timeoutMs: 1_000,
      now: () => clock.t,
      attempt: 2,
    });
    expect(done.attempt).toBe(2);
  });
});
