import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { editAgentBindings } from "@agentforge/core";
import { EDIT_AGENT_IMPORT_BUDGET_MS } from "../__fixtures__/test-budgets";

describe("edit agent timeline", () => {
  // The first import of ./agent-run evaluates the core, db, settings-store and tool-registry closure
  // (7 s cold on the Windows desk). That is the cost, not what the first case asserts, so it is
  // paid here under its own budget and the cases keep vitest's default.
  beforeAll(async () => {
    await import("./agent-run");
  }, EDIT_AGENT_IMPORT_BUDGET_MS);

  afterAll(async () => {
    const { sql } = await import("@agentforge/db");
    sql.close();
  });

  it("binds add_title and never sends the gateway a model named edit", async () => {
    const { editAgentModelId, editToolFrames } = await import("./agent-run");
    expect(editAgentModelId("edit")).not.toBe("edit");
    expect(editAgentModelId("gpt-4o-mini")).toBe("gpt-4o-mini");
    const bindings = editAgentBindings("org-1");
    expect(bindings.some((binding) => binding.toolKey === "add_title" && binding.enabled)).toBe(true);
    expect(editToolFrames({ ops: [{ type: "add_clip" }], card: { id: "c1" } })).toEqual([
      { type: "edit.ops", ops: [{ type: "add_clip" }] },
      { type: "edit.card", card: { id: "c1" } },
    ]);
  });

  it("writes a Hello title onto an empty timeline", async () => {
    const { createEditProject } = await import("./projects");
    const { getTenant } = await import("../tenant");
    const { runEditAgent } = await import("./agent-run");
    const { foldProject } = await import("./ops");
    const tenant = await getTenant();
    const doc = await createEditProject(tenant, { name: "Title", aspect: "16:9", fps: 30 });
    const events = await runEditAgent({
      tenant,
      projectId: doc.id,
      text: "Add a title card that says Hello",
    });
    const frames: string[] = [];
    for await (const frame of events) {
      frames.push(frame);
    }
    expect(frames.some((frame) => frame.includes("event: edit.ops"))).toBe(true);
    const after = await foldProject(doc.id, tenant.workspaceId);
    expect(after.clips.some((clip) => clip.title?.text === "Hello")).toBe(true);
  }, 60_000);
});
