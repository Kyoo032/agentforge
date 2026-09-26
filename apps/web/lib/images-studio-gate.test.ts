/**
 * The Images needs-key note and Generate button share the host gate.
 * A stub desk reports allowed: true, so both stay open (#108).
 * The studios have no DOM in this node environment, so the wiring is pinned
 * by reading the source, the same way studio-model-wiring.test.ts does.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GatewayGatePayload } from "./gateway-gate";
import { hostWithholdsLiveModel } from "./use-desk-needs-key";

const studio = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../components/images-studio.tsx"),
  "utf8",
);

function gate(patch: Partial<GatewayGatePayload>): GatewayGatePayload {
  return {
    status: "ok",
    allowed: true,
    grace: false,
    endpoint: "https://api.tokotokenai.com/v1",
    endpointLocked: true,
    checkedAt: null,
    lastOkAt: null,
    ...patch,
  };
}

describe("images needs-key note and submit share the host gate", () => {
  it("shows the note and disables submit on the same needsKey flag", () => {
    expect(studio).toContain("const needsKey = useDeskNeedsKey();");
    expect(studio).toContain("if (!prompt.trim() || generating || needsKey)");
    expect(studio).toContain("disabled={generating || !prompt.trim() || needsKey}");
    expect(studio).toMatch(/\{needsKey && !loading \? \([\s\S]*?data-testid="images-studio-needs-key"/);
    expect(studio).not.toMatch(/!ready && !loading/);
    expect(studio).not.toMatch(/disabled=\{[^}]*!ready/);
  });

  it("leaves a stub desk able to generate", () => {
    expect(hostWithholdsLiveModel(gate({ status: "stub", allowed: true }))).toBe(false);
    expect(hostWithholdsLiveModel(gate({ status: "needs_key", allowed: false }))).toBe(true);
  });
});
