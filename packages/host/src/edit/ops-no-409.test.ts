import { describe, expect, it } from "vitest";
import { dispatch } from "../router";
import { addReadyClip, seedEditProject } from "./harness";
import { appendOps } from "./ops";

describe("ops never 409 (G-12)", () => {
  it("accepts owner ops while an agent run is conceptually mid-flight", async () => {
    const { project } = await seedEditProject("no-409");
    await addReadyClip(project.id, project.workspaceId, "clip-lock");
    await appendOps(
      project.id,
      [{ type: "set_volume", payload: { clipId: "clip-lock", volume: 0.8 }, cardId: "card-mid" }],
      { actor: "agent:inflight", cardId: "card-mid", workspaceId: project.workspaceId },
    );
    const result = await dispatch({
      method: "POST",
      path: `/api/v1/edit/projects/${project.id}/ops`,
      query: {},
      params: {},
      headers: { "x-agentforge-transport": "http" },
      body: {
        ops: [{ type: "set_volume", payload: { clipId: "clip-lock", volume: 1 } }],
      },
    });
    expect(result.type).toBe("json");
    if (result.type !== "json") {
      return;
    }
    expect(result.status).not.toBe(409);
    expect(result.status).toBe(200);
  });
});
