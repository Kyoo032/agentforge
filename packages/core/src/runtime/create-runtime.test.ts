import { describe, expect, it } from "vitest";
import type { TenantContext } from "../tenancy/types";
import { createRuntime } from "./create-runtime";

const tenant: TenantContext = {
  tenantId: "local-tenant",
  organizationId: "org",
  workspaceId: "ws",
  userId: "user",
  role: "builder",
};

describe("createRuntime outbound PII mask", () => {
  it("lets the stub reply on the masked prompt, not the raw email", async () => {
    const previous = process.env.AGENTFORGE_RUNTIME;
    process.env.AGENTFORGE_RUNTIME = "stub";
    try {
      const runtime = createRuntime({});
      let seen = "";
      await runtime.execute({
        tenant,
        runId: "run-pii",
        modality: "text",
        version: {
          id: "v1",
          agentId: "a1",
          organizationId: "org",
          version: 1,
          systemPrompt: "You are helpful.",
          model: "stub-model",
          inputModalities: ["text"],
          config: {},
          createdAt: new Date(),
        },
        bindings: [],
        history: [
          {
            role: "user",
            parts: [{ type: "text", text: "Contact me at alex.rivera@example.com please" }],
          },
        ],
        onEvent: (event) => {
          if (event.type === "assistant.delta") {
            seen += event.text;
          }
        },
      });
      expect(seen.startsWith("I need a Toko Token gateway key")).toBe(true);
      expect(seen).not.toContain("alex.rivera@example.com");
      expect(seen).not.toContain("Contact me at");
      expect(seen).not.toMatch(/Stub reply/i);
    } finally {
      if (previous === undefined) {
        delete process.env.AGENTFORGE_RUNTIME;
      } else {
        process.env.AGENTFORGE_RUNTIME = previous;
      }
    }
  });
});
