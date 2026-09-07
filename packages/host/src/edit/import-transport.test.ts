import { describe, expect, it } from "vitest";
import { dispatch } from "../router";
import { seedEditProject } from "./harness";

describe("import transport (G-15)", () => {
  it("rejects sourcePath over http", async () => {
    const { project } = await seedEditProject("import-http");
    const result = await dispatch({
      method: "POST",
      path: `/api/v1/edit/projects/${project.id}/import`,
      query: {},
      params: {},
      headers: { "x-agentforge-transport": "http" },
      body: { sourcePath: "/tmp/talk.mp4" },
    });
    expect(result.type).toBe("json");
    if (result.type === "json") {
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ error: { code: "invalid_request" } });
    }
  });

  it("does not treat missing sourcePath as ipc when transport is http", async () => {
    const { project } = await seedEditProject("import-http-file");
    const result = await dispatch({
      method: "POST",
      path: `/api/v1/edit/projects/${project.id}/import`,
      query: {},
      params: {},
      headers: { "x-agentforge-transport": "http" },
      body: {},
    });
    expect(result.type).toBe("json");
    if (result.type === "json") {
      expect(result.status).toBe(400);
    }
  });
});
