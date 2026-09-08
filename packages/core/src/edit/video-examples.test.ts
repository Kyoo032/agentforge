import { describe, expect, it } from "vitest";
import { promptTemplateById } from "./prompt-templates";
import { VIDEO_EXAMPLES, videoExampleByFile, videoExampleFileNames, videoExampleTemplate } from "./video-examples";

describe("video examples manifest", () => {
  it("parses and lists a small bundled set", () => {
    expect(VIDEO_EXAMPLES.version).toBe(1);
    expect(VIDEO_EXAMPLES.examples.length).toBeGreaterThanOrEqual(1);
    expect(VIDEO_EXAMPLES.examples.length).toBeLessThanOrEqual(8);
  });

  it("uses plain mp4 file names with no path parts", () => {
    for (const name of videoExampleFileNames()) {
      expect(name, name).toMatch(/^[a-z0-9-]+\.mp4$/);
      expect(name).not.toContain("/");
      expect(name).not.toContain("\\");
      expect(name).not.toContain("..");
    }
  });

  it("has unique file names", () => {
    const names = videoExampleFileNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it("points every example at an existing prompt template", () => {
    for (const example of VIDEO_EXAMPLES.examples) {
      expect(promptTemplateById(example.templateId), example.templateId).toBeDefined();
      expect(videoExampleTemplate(example).id).toBe(example.templateId);
    }
  });

  it("looks examples up by file name", () => {
    const first = VIDEO_EXAMPLES.examples[0];
    expect(first).toBeDefined();
    if (!first) {
      return;
    }
    expect(videoExampleByFile(first.file)).toEqual(first);
    expect(videoExampleByFile("nope.mp4")).toBeUndefined();
  });

  it("keeps measured metadata consistent when present", () => {
    for (const example of VIDEO_EXAMPLES.examples) {
      if (example.width !== undefined || example.height !== undefined) {
        expect(example.width, example.file).toBeGreaterThan(0);
        expect(example.height, example.file).toBeGreaterThan(0);
      }
      if (example.durationSeconds !== undefined) {
        expect(example.durationSeconds, example.file).toBeGreaterThan(0);
        expect(example.durationSeconds, example.file).toBeLessThanOrEqual(15);
      }
    }
  });
});
