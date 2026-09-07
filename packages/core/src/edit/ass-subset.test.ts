import { describe, expect, it } from "vitest";
import { DEFAULT_TITLE_STYLE, emptyProject, type Clip } from "./document";
import { applyOp } from "./ops";
import { assColorToHex8, buildAssDocument, framesToAssTime, hex8ToAssColor, layoutTitle } from "./ass-subset";

describe("ASS colour conversion G-11", () => {
  it("is bijective for hex8 ↔ &HAABBGGRR", () => {
    const samples = ["#FFFFFFFF", "#000000FF", "#FF000080", "#12AB34CD", "#00FF00AA"];
    for (const hex of samples) {
      expect(assColorToHex8(hex8ToAssColor(hex))).toBe(hex);
      expect(hex8ToAssColor(assColorToHex8(hex8ToAssColor(hex)))).toBe(hex8ToAssColor(hex));
    }
    expect(hex8ToAssColor("#11223344")).toBe("&H44332211");
    expect(assColorToHex8("&H44332211")).toBe("#11223344");
  });
});

describe("layoutTitle alignment 1–9", () => {
  const canvas = { width: 1920, height: 1080 };
  const style = { ...DEFAULT_TITLE_STYLE, marginL: 80, marginR: 80, marginV: 40 };

  it("maps numpad anchors", () => {
    const expected: Record<number, { x: number; y: number; textAlign: string; verticalAlign: string }> = {
      1: { x: 80, y: 1040, textAlign: "left", verticalAlign: "bottom" },
      2: { x: 960, y: 1040, textAlign: "center", verticalAlign: "bottom" },
      3: { x: 1840, y: 1040, textAlign: "right", verticalAlign: "bottom" },
      4: { x: 80, y: 540, textAlign: "left", verticalAlign: "middle" },
      5: { x: 960, y: 540, textAlign: "center", verticalAlign: "middle" },
      6: { x: 1840, y: 540, textAlign: "right", verticalAlign: "middle" },
      7: { x: 80, y: 40, textAlign: "left", verticalAlign: "top" },
      8: { x: 960, y: 40, textAlign: "center", verticalAlign: "top" },
      9: { x: 1840, y: 40, textAlign: "right", verticalAlign: "top" },
    };
    for (let alignment = 1; alignment <= 9; alignment += 1) {
      const layout = layoutTitle({ ...style, alignment }, canvas);
      expect(layout).toMatchObject(expected[alignment] ?? {});
      expect(layout.maxWidth).toBe(1920 - 160);
    }
  });
});

describe("buildAssDocument", () => {
  it("emits PlayResX/Y and Dialogue lines with centisecond timing", () => {
    let project = emptyProject({ id: "p1", workspaceId: "ws1", name: "Titles", aspect: "16:9", fps: 30 });
    const clip: Clip = {
      id: "title-1",
      trackId: "v1",
      timelineStartFrame: 30,
      durationFrames: 45,
      status: "ready",
      title: { text: "Summer Sale", style: DEFAULT_TITLE_STYLE },
    };
    project = applyOp(project, { type: "add_clip", payload: { clip } });
    project = applyOp(project, {
      type: "add_clip",
      payload: {
        clip: {
          id: "cap-1",
          trackId: "c1",
          timelineStartFrame: 0,
          durationFrames: 30,
          status: "ready",
          caption: { text: "Hello" },
        },
      },
    });
    const ass = buildAssDocument(project);
    expect(ass).toContain("PlayResX: 1920");
    expect(ass).toContain("PlayResY: 1080");
    expect(ass).toContain("Dialogue: 0,");
    expect(framesToAssTime(30, 30)).toBe("0:00:01.00");
    expect(framesToAssTime(75, 30)).toBe("0:00:02.50");
    expect(ass).toContain("0:00:01.00,0:00:02.50");
    expect(ass).toContain("Summer Sale");
    expect(ass).toContain("Hello");
  });
});
