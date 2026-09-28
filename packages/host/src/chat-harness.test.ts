import { afterAll, describe, expect, it } from "vitest";
import type { ContentPart } from "@agentforge/core";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function drain(run: AsyncIterable<string>): Promise<string> {
  let raw = "";
  for await (const chunk of run) {
    raw += chunk;
  }
  return raw;
}

function partsOf(content: unknown): ContentPart[] {
  return Array.isArray(content) ? (content as ContentPart[]) : [];
}

describe("Chat harness on the stub runtime", () => {
  afterAll(async () => {
    const { sql } = await import("@agentforge/db");
    sql.close();
  });

  it("runs the three new skills: desk cite, earlier chat, and look-not-make", async () => {
    const { agentService, getTenant } = await import("./tenant");
    const { createThread, listMessages } = await import("./threads");
    const { startModalityRun } = await import("./runs");
    const { addPastedSource } = await import("./knowledge");
    const tenant = await getTenant();
    const ready = await agentService.ensureDefaultChat(tenant);

    await addPastedSource(tenant, "Desk note", "xylophonevendornote is the only fact in this note.");
    const cited = await createThread(tenant, ready.agent.id, "Desk question");
    await drain(
      startModalityRun({
        tenant,
        threadId: cited.id,
        modality: "text",
        body: {
          content: [{ type: "text", text: "what does the desk say about xylophonevendornote" }],
          model: "gpt-5.6-luna",
        },
      }),
    );
    const citedRows = await listMessages(tenant, cited.id);
    const citedText = partsOf(citedRows.find((row) => row.role === "assistant")?.content)
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n");
    expect(citedText).toContain("[1]");
    expect(citedText).not.toContain("[99]");
    expect(citedText).not.toContain("did not have a source");

    await createThread(tenant, ready.agent.id, "Budget decision");
    const ask = await createThread(tenant, ready.agent.id, "New question");
    const pastRaw = await drain(
      startModalityRun({
        tenant,
        threadId: ask.id,
        modality: "text",
        body: { content: "what did we decide last time", model: "gpt-5.6-luna" },
      }),
    );
    expect(pastRaw).toContain("past_sessions");
    const pastRows = await listMessages(tenant, ask.id);
    const pastText = partsOf(pastRows.find((row) => row.role === "assistant")?.content)
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n");
    expect(pastText).toContain("Budget decision");
    expect(pastText).not.toMatch(/gateway key/i);

    const look = await createThread(tenant, ready.agent.id, "Look at this");
    const lookRaw = await drain(
      startModalityRun({
        tenant,
        threadId: look.id,
        modality: "image",
        body: {
          model: "gpt-5.6-luna",
          content: [
            { type: "text", text: "What is in this image?" },
            { type: "image_url", image_url: { url: TINY_PNG } },
          ],
        },
      }),
    );
    expect(lookRaw).toContain("Looking at what you attached.");
    expect(lookRaw).not.toContain("image_generate");
    expect(lookRaw).not.toContain("video_generate");
    const lookRows = await listMessages(tenant, look.id);
    const lookThinking = partsOf(lookRows.find((row) => row.role === "assistant")?.content)
      .filter((part) => part.type === "thinking")
      .map((part) => (part.type === "thinking" ? part.text : ""))
      .join("\n");
    expect(lookThinking).toContain("Looking at what you attached.");
  }, 60_000);
});
