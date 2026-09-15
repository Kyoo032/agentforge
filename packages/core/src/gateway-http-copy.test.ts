import { describe, expect, it } from "vitest";
import { gatewayErrorKind, gatewayHttpFailure } from "./gateway-http-copy";
import { isRetryableModelFailure } from "./runtime/retry";

// Exactly what the gateway answered a Finance call on 2026-09-15, on a desk running in English.
const INDONESIAN_400 = JSON.stringify({
  error: { message: "Permintaan tidak valid. Periksa parameter request Anda.", status_code: 400 },
});

describe("gatewayHttpFailure", () => {
  it("answers a gateway 400 in the app locale, not the gateway's", () => {
    const en = gatewayHttpFailure(400, INDONESIAN_400, "en");
    expect(en.message).toBe(
      "The gateway rejected this request (status_code=400). Try another model, or send again with a shorter prompt.",
    );
    expect(en.message).not.toContain("Permintaan");
    expect(en.detail).toContain("Permintaan tidak valid. Periksa parameter request Anda.");

    const id = gatewayHttpFailure(400, INDONESIAN_400, "id");
    expect(id.message).toBe(
      "Gateway menolak permintaan ini (status_code=400). Coba model lain, atau kirim lagi dengan prompt yang lebih pendek.",
    );
    expect(id.detail).toBe(en.detail);
  });

  it("covers the other generic statuses in both locales", () => {
    expect(gatewayHttpFailure(401, "", "en").message).toMatch(/did not accept this API key \(status_code=401\)/);
    expect(gatewayHttpFailure(403, "", "id").message).toMatch(/^Gateway menolak permintaan ini untuk key tersebut/);
    expect(gatewayHttpFailure(429, "", "en").message).toMatch(/rate-limiting this key \(status_code=429\)/);
    expect(gatewayHttpFailure(503, "", "id").message).toMatch(/^Gateway sedang tidak tersedia \(status_code=503\)/);
  });

  it("keeps the upstream text when the status carries information we cannot reproduce", () => {
    const balance = JSON.stringify({ error: { message: "Insufficient balance", status_code: 402 } });
    expect(gatewayHttpFailure(402, balance, "en").message).toContain("Insufficient balance");
    // 404 is how the runtime learns to fall back from /responses to /chat/completions.
    expect(gatewayHttpFailure(404, "Not Found", "en").message).toContain("Not Found");
    expect(gatewayErrorKind(404)).toBeNull();
  });

  it("redacts a key the gateway echoed back in a passed-through message", () => {
    const echoed = JSON.stringify({
      error: { message: "Unprocessable: Authorization: Bearer sk-test-key-not-real-000111222333", status_code: 422 },
    });
    const failure = gatewayHttpFailure(422, echoed, "en");
    expect(failure.message).toContain("[REDACTED]");
    expect(failure.message).not.toContain("sk-test-key-not-real");
    // The status is still passed through, so the wording a support thread is searched by survives.
    expect(failure.message).toContain("status_code=422");
  });

  it("still classifies retry the same way after the copy swap", () => {
    expect(isRetryableModelFailure(gatewayHttpFailure(400, INDONESIAN_400, "en").message)).toBe(false);
    expect(isRetryableModelFailure(gatewayHttpFailure(401, "", "en").message)).toBe(false);
    expect(isRetryableModelFailure(gatewayHttpFailure(429, "", "en").message)).toBe(true);
    expect(isRetryableModelFailure(gatewayHttpFailure(500, "", "en").message)).toBe(true);
    expect(isRetryableModelFailure(gatewayHttpFailure(500, "", "id").message)).toBe(true);
  });
});
