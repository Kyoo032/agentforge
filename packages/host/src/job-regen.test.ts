import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyJobThinking, type AgentRuntime, type TenantContext } from "@agentforge/core";
import { withRunContext } from "./run-context";
import {
  appendRegenInstruction,
  collectJobAssistantText,
  readJobRegenAttachments,
  readOptionalInstruction,
} from "./job-regen";

type ExecuteInput = Parameters<AgentRuntime["execute"]>[0];

const executed: ExecuteInput[] = [];

vi.mock("@agentforge/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agentforge/core")>();
  return {
    ...actual,
    createRuntime: (): AgentRuntime => ({
      async execute(input) {
        executed.push(input);
        await input.onEvent({ type: "assistant.delta", text: "hello" });
      },
    }),
  };
});

vi.mock("./settings-store", () => ({ loadSettings: () => ({}), loadOwnerLocale: () => "en" }));

const tenant: TenantContext = { tenantId: "local-tenant", organizationId: "org", workspaceId: "ws-1", userId: "local", role: "owner" };

describe("collectJobAssistantText", () => {
  beforeEach(() => {
    executed.length = 0;
  });

  const base = {
    tenant,
    model: "deepseek-v4-flash",
    systemPrompt: "system",
    runPrefix: "market",
    agentId: "market",
    versionId: "market-briefing",
    prompt: "draft",
  };

  it("forwards a per-run streamWatchdog override into the runtime run input", async () => {
    const text = await collectJobAssistantText({ ...base, streamWatchdog: { ttfbMs: 180_000, idleMs: 150_000 } });
    expect(text).toBe("hello");
    expect(executed).toHaveLength(1);
    expect(executed[0]?.streamWatchdog).toEqual({ ttfbMs: 180_000, idleMs: 150_000 });
    expect(executed[0]?.version.model).toBe("deepseek-v4-flash");
  });

  it("leaves streamWatchdog unset so the model defaults apply when no override is given", async () => {
    await collectJobAssistantText(base);
    expect(executed[0]?.streamWatchdog).toBeUndefined();
  });

  it("forwards the studio mode so an always-thinking model is told not to think", async () => {
    await collectJobAssistantText({ ...base, jobMode: "finance" });
    expect(executed[0]?.jobMode).toBe("finance");
    expect(applyJobThinking({ model: base.model }, base.model, executed[0]?.jobMode)).toEqual({
      model: base.model,
      reasoning_effort: "low",
    });
  });

  it("leaves jobMode unset for a caller that is not a studio", async () => {
    await collectJobAssistantText(base);
    expect(executed[0]?.jobMode).toBeUndefined();
  });

  it("runs in the locale of the run context so job timeouts are not English on an id desk", async () => {
    await withRunContext({ threadId: "t1", agentId: "finance", locale: "id" }, () =>
      collectJobAssistantText(base),
    );
    expect(executed[0]?.locale).toBe("id");
    await collectJobAssistantText(base);
    expect(executed[1]?.locale).toBe("en");
  });
});

describe("readOptionalInstruction", () => {
  it("trims a string instruction and ignores missing values", () => {
    expect(readOptionalInstruction({ instruction: "  shorter  " })).toBe("shorter");
    expect(readOptionalInstruction({ instruction: "" })).toBe("");
    expect(readOptionalInstruction({ prompt: "topic" })).toBe("");
    expect(readOptionalInstruction(null)).toBe("");
  });
});

describe("appendRegenInstruction", () => {
  it("appends only when the user typed guidance", () => {
    expect(appendRegenInstruction("Rewrite this section.", "")).toBe("Rewrite this section.");
    expect(appendRegenInstruction("Rewrite this section.", "Make it punchier")).toBe(
      "Rewrite this section.\n\nUser instruction:\nMake it punchier",
    );
  });
});

describe("readJobRegenAttachments", () => {
  it("returns an empty list when omitted", () => {
    expect(readJobRegenAttachments({})).toEqual([]);
    expect(readJobRegenAttachments({ attachments: null })).toEqual([]);
  });

  it("accepts image_url parts with local media or https urls", () => {
    expect(
      readJobRegenAttachments({
        attachments: [
          { type: "image_url", image_url: { url: "/api/v1/media/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/file" } },
          { type: "image_url", image_url: { url: "https://cdn.example/slide.png", detail: "low" } },
        ],
      }),
    ).toEqual([
      {
        type: "image_url",
        image_url: { url: "/api/v1/media/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/file", detail: "high" },
      },
      { type: "image_url", image_url: { url: "https://cdn.example/slide.png", detail: "low" } },
    ]);
  });

  it("rejects non-arrays and non-image parts", () => {
    expect(() => readJobRegenAttachments({ attachments: "nope" })).toThrow(/attachments must be an array/);
    expect(() =>
      readJobRegenAttachments({
        attachments: [{ type: "video_url", video_url: { url: "https://cdn.example/a.mp4" } }],
      }),
    ).toThrow(/image_url/);
  });
});
