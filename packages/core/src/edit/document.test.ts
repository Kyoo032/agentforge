import { describe, expect, it } from "vitest";
import { emptyProject, projectSchema, titleStyleSchema, DEFAULT_TITLE_STYLE } from "./document";

describe("emptyProject", () => {
  it("seeds v1 video, a1 audio, and c1 caption tracks", () => {
    const project = emptyProject({
      id: "p1",
      workspaceId: "ws1",
      name: "Demo",
      aspect: "16:9",
    });
    expect(project.fps).toBe(30);
    expect(project.width).toBe(1920);
    expect(project.height).toBe(1080);
    expect(project.tracks.map((track) => [track.id, track.kind])).toEqual([
      ["v1", "video"],
      ["a1", "audio"],
      ["c1", "caption"],
    ]);
    expect(projectSchema.parse(project).id).toBe("p1");
  });

  it("maps portrait and square aspects", () => {
    expect(emptyProject({ id: "a", workspaceId: "w", name: "n", aspect: "9:16" })).toMatchObject({
      width: 1080,
      height: 1920,
    });
    expect(emptyProject({ id: "a", workspaceId: "w", name: "n", aspect: "1:1" })).toMatchObject({
      width: 1080,
      height: 1080,
    });
  });
});

describe("projectSchema", () => {
  it("rejects unknown keys", () => {
    const project = emptyProject({ id: "p1", workspaceId: "ws1", name: "Demo", aspect: "16:9" });
    expect(() => projectSchema.parse({ ...project, extra: true })).toThrow();
  });
});

describe("titleStyleSchema G-11", () => {
  it("accepts the ASS subset", () => {
    expect(titleStyleSchema.parse(DEFAULT_TITLE_STYLE).fontFamily).toBe("Inter");
  });

  it("rejects fonts, sizes, and unknown keys outside the subset", () => {
    expect(() => titleStyleSchema.parse({ ...DEFAULT_TITLE_STYLE, fontFamily: "Comic Sans" })).toThrow();
    expect(() => titleStyleSchema.parse({ ...DEFAULT_TITLE_STYLE, fontSizePx: 8 })).toThrow();
    expect(() => titleStyleSchema.parse({ ...DEFAULT_TITLE_STYLE, letterSpacing: 2 })).toThrow();
    expect(() => titleStyleSchema.parse({ ...DEFAULT_TITLE_STYLE, blur: 4 })).toThrow();
    expect(() => titleStyleSchema.parse({ ...DEFAULT_TITLE_STYLE, alignment: 10 })).toThrow();
    expect(() => titleStyleSchema.parse({ ...DEFAULT_TITLE_STYLE, primaryColor: "#FFF" })).toThrow();
  });
});
