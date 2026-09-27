import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const components = join(dirname(fileURLToPath(import.meta.url)), "../components");

function source(name: string): string {
  return readFileSync(join(components, name), "utf8");
}

describe("presentation selection toolbar", () => {
  it("keeps the selection when the pointer goes down on the toolbar", () => {
    const preview = source("presentation-preview.tsx");
    const start = preview.indexOf("onPointerDown={(event) => {");
    const handler = preview.slice(start, start + 500);
    expect(handler).toContain("presentations-selection-toolbar");
  });
});

describe("edit transport locale", () => {
  it("reads Play and the timeline hint from the edit catalog", () => {
    const preview = source("edit-preview.tsx");
    const timeline = source("edit-timeline.tsx");
    expect(preview).toContain('t("edit.preview.play")');
    expect(preview).toContain('t("edit.preview.pause")');
    expect(preview).not.toContain('playing ? "Pause" : "Play"');
    expect(timeline).toContain('t("edit.timeline.hints")');
    expect(timeline).toContain('t("edit.timeline.zoom")');
    expect(timeline).not.toContain("snap: frame · S split · Del delete");
    expect(timeline).not.toContain('aria-label="Trim start"');
  });
});
