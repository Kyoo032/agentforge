import { describe, expect, it } from "vitest";
import {
  applyZeroRetention,
  checkModelRequest,
  parseGatewayHttpError,
  readHttpErrorBody,
  sanitizeGatewayRequestBody,
  temperatureMustBeOneOrOmitted,
} from "./request-constraints";

describe("temperatureMustBeOneOrOmitted", () => {
  it("locks Claude Sonnet 5 and Claude 4 / o-series / Astra", () => {
    expect(temperatureMustBeOneOrOmitted("claude-sonnet-5")).toBe(true);
    expect(temperatureMustBeOneOrOmitted("claude-opus-5")).toBe(true);
    expect(temperatureMustBeOneOrOmitted("anthropic/claude-sonnet-5-20250514")).toBe(true);
    expect(temperatureMustBeOneOrOmitted("claude-opus-4-5")).toBe(true);
    expect(temperatureMustBeOneOrOmitted("claude-sonnet-4.6")).toBe(true);
    expect(temperatureMustBeOneOrOmitted("claude-4-opus")).toBe(true);
    expect(temperatureMustBeOneOrOmitted("o3-mini")).toBe(true);
    expect(temperatureMustBeOneOrOmitted("openai/o1")).toBe(true);
    expect(temperatureMustBeOneOrOmitted("gpt-6-astra")).toBe(true);
  });

  it("does not lock gpt-4o-mini", () => {
    expect(temperatureMustBeOneOrOmitted("gpt-4o-mini")).toBe(false);
    expect(temperatureMustBeOneOrOmitted("openai/gpt-4o")).toBe(false);
  });
});

describe("sanitizeGatewayRequestBody", () => {
  it("omits temperature and top_p for Claude Sonnet 5 when temperature is not 1", () => {
    const body = { model: "claude-sonnet-5", temperature: 0.7, top_p: 0.9, messages: [] };
    expect(sanitizeGatewayRequestBody(body, "claude-sonnet-5")).toEqual({
      model: "claude-sonnet-5",
      messages: [],
    });
  });

  it("keeps temperature: 1 on Claude Sonnet 5 but still drops top_p", () => {
    const body = { model: "claude-sonnet-5", temperature: 1, top_p: 0.9 };
    expect(sanitizeGatewayRequestBody(body, "claude-sonnet-5")).toEqual({
      model: "claude-sonnet-5",
      temperature: 1,
    });
  });

  it("strips sampling on Responses URLs even for unlocked models", () => {
    const body = { model: "gpt-4o-mini", temperature: 0.7, top_p: 0.9, n: 1 };
    expect(sanitizeGatewayRequestBody(body, "gpt-4o-mini", "https://api.tokotokenai.com/v1/responses")).toEqual({
      model: "gpt-4o-mini",
    });
  });

  it("leaves gpt-4o-mini temperature unchanged on Chat Completions", () => {
    const body = { model: "gpt-4o-mini", temperature: 0.7 };
    expect(sanitizeGatewayRequestBody(body, "gpt-4o-mini", "https://api.tokotokenai.com/v1/chat/completions")).toEqual(
      body,
    );
  });

  it("drops null sampling fields for every model", () => {
    const body = { model: "gpt-4o-mini", temperature: null, top_p: null };
    expect(sanitizeGatewayRequestBody(body, "gpt-4o-mini")).toEqual({ model: "gpt-4o-mini" });
  });

  it("checkModelRequest reports issues when stripping", () => {
    const result = checkModelRequest("claude-sonnet-5", { temperature: 0, topP: 0.5 });
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.sanitized).toEqual({});
  });
});

describe("applyZeroRetention", () => {
  it("sets store false and drops previous_response_id", () => {
    expect(applyZeroRetention({ model: "gpt-5.6", previous_response_id: "resp_1", store: true }, "https://api.openai.com/v1")).toEqual({
      model: "gpt-5.6",
      store: false,
    });
  });
});

describe("parseGatewayHttpError", () => {
  it("extracts the Claude Sonnet 5 temperature sentence from nested error JSON", () => {
    const body = JSON.stringify({
      error: {
        message: "'temperature' must be omitted or set to 1 for claude-sonnet-5",
        status_code: 400,
      },
    });
    const message = parseGatewayHttpError(400, body);
    expect(message).toContain("'temperature' must be omitted or set to 1 for claude-sonnet-5");
    expect(message).toMatch(/status_code\s*=\s*400|400/);
  });

  it("falls back to top-level message and appends status when missing", () => {
    expect(parseGatewayHttpError(502, JSON.stringify({ message: "bad gateway" }))).toContain(
      "bad gateway",
    );
    expect(parseGatewayHttpError(502, JSON.stringify({ message: "bad gateway" }))).toContain(
      "status_code=502",
    );
  });
});

describe("readHttpErrorBody", () => {
  it("reads a short JSON error and cancels the body", async () => {
    const body = JSON.stringify({ error: { message: "This token has no access to model gpt-5.6-luna" } });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });
    const text = await readHttpErrorBody(new Response(stream, { status: 403 }));
    expect(text).toContain("no access to model");
  });

  it("gives up when the error body never ends", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"error":{"message":"held open"}'));
      },
    });
    const started = Date.now();
    const text = await readHttpErrorBody(new Response(stream, { status: 403 }), 50);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(text).toContain("held open");
  });
});
