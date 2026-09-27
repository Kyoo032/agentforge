import { describe, expect, it } from "vitest";
import { createHostEditBackend } from "./backend";
import { withEditToolContext } from "./context";
import { addReadyClip, seedEditProject } from "./harness";

describe("applyAgentOps", () => {
  it("marks the card applied once the clip change is on the timeline", async () => {
    const { tenant, project } = await seedEditProject("apply");
    const { clipId } = await addReadyClip(project.id, project.workspaceId, "clip-apply");
    const result = await withEditToolContext({ tenant, projectId: project.id, runId: "run-apply" }, () =>
      createHostEditBackend().applyAgentOps(tenant, [{ type: "set_volume", payload: { clipId, volume: 0.2 } }]),
    );
    // The tool seam types the card as `unknown` so core does not depend on the host row shape.
    expect(result.card).toMatchObject({ status: "applied" });
    expect(result.ops).toHaveLength(1);
  });
});
