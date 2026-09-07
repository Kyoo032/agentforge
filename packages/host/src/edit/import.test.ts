import { describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";
import { assertEditUpload, EDIT_UPLOAD_MAX } from "../handlers/edit";
import { dispatch } from "../router";
import { seedEditProject } from "./harness";

describe("import mime and size (G-27)", () => {
  it("rejects disallowed mime types", () => {
    expect(() => assertEditUpload("application/pdf", 12)).toThrow(ApiError);
    expect(() => assertEditUpload("text/plain", 12)).toThrow(ApiError);
  });

  it("rejects payloads over 500 MB", () => {
    expect(() => assertEditUpload("video/mp4", EDIT_UPLOAD_MAX + 1)).toThrow(ApiError);
  });

  it("allows image, video, and edit audio types", () => {
    expect(() => assertEditUpload("image/png", 10)).not.toThrow();
    expect(() => assertEditUpload("video/mp4", 10)).not.toThrow();
    expect(() => assertEditUpload("audio/mpeg", 10)).not.toThrow();
    expect(() => assertEditUpload("audio/wav", 10)).not.toThrow();
  });

  it("does not loosen the chat media route", async () => {
    const result = await dispatch({
      method: "POST",
      path: "/api/v1/media",
      query: {},
      params: {},
      headers: { "x-agentforge-transport": "http" },
      files: [{ field: "file", filename: "a.mp3", mime: "audio/mpeg", bytes: new Uint8Array([1, 2, 3]) }],
    });
    expect(result.type).toBe("json");
    if (result.type === "json") {
      expect(result.status).toBe(400);
    }
  });

  it("rejects an oversized edit import before writing", async () => {
    const { project } = await seedEditProject("import-size");
    const result = await dispatch({
      method: "POST",
      path: `/api/v1/edit/projects/${project.id}/import`,
      query: {},
      params: {},
      headers: { "x-agentforge-transport": "http" },
      files: [{ field: "file", filename: "x.bin", mime: "application/zip", bytes: new Uint8Array([1]) }],
    });
    expect(result.type).toBe("json");
    if (result.type === "json") {
      expect(result.status).toBe(400);
    }
  });
});
