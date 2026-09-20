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

/**
 * A03-2. The document goes to ffmpeg's `ass` filter, which parses it for real, and both of these
 * values come straight off the project the caller PUTs.
 */
describe("buildAssDocument refuses to let a project field write its own directives", () => {
  function documentNamed(name: string): string {
    return buildAssDocument(emptyProject({ id: "p1", workspaceId: "ws1", name, aspect: "16:9", fps: 30 }));
  }

  function sectionsOf(ass: string): string[] {
    return ass.split("\n").filter((line) => line.startsWith("["));
  }

  it("keeps an ordinary name, commas and all", () => {
    expect(documentNamed("Q3 launch, final")).toContain("Title: Q3 launch, final");
  });

  it("does not let a newline in the project name open a section", () => {
    const ass = documentNamed("Nice\n[Script Info]\nPlayResX: 1");
    expect(ass).toContain("Title: Nice [Script Info] PlayResX: 1");
    expect(sectionsOf(ass)).toEqual(["[Script Info]", "[V4+ Styles]", "[Events]"]);
    expect(ass).toContain("PlayResX: 1920");
  });

  it("does not let a carriage return or a control byte end the directive either", () => {
    const ass = documentNamed("A\r\nPlayResY: 2\u0000b\u007fc");
    expect(ass.split("\n").filter((line) => line.startsWith("PlayResY:"))).toEqual(["PlayResY: 1080"]);
    expect(ass).toContain("Title: A PlayResY: 2 b c");
  });

  it("bounds the name, so a megabyte of it cannot become the document", () => {
    const ass = documentNamed("x".repeat(5000));
    const title = ass.split("\n").find((line) => line.startsWith("Title: ")) ?? "";
    expect(title.length).toBeLessThanOrEqual("Title: ".length + 200);
  });

  /**
   * `ops.ts` constrains `fontFamily` to a two-value enum, so this is not reachable through the edit
   * API today — which is the point: the sanitizer is what keeps it unreachable if that enum ever
   * becomes a free-text field, and a project can also be read back off disk. Built here as a
   * literal because `applyOp` rightly refuses the value.
   */
  it("does not let a font family shift the fields of its Style line", () => {
    const project = emptyProject({ id: "p1", workspaceId: "ws1", name: "Styles", aspect: "16:9", fps: 30 });
    const clip: Clip = {
      id: "title-1",
      trackId: project.tracks[0]?.id ?? "v1",
      timelineStartFrame: 0,
      durationFrames: 30,
      status: "ready",
      title: {
        text: "hi",
        style: { ...DEFAULT_TITLE_STYLE, fontFamily: "Arial,999,&HFFFFFFFF\nStyle: Evil,Arial" as never },
      },
    };
    const ass = buildAssDocument({ ...project, clips: [...project.clips, clip] });
    const styleLines = ass.split("\n").filter((line) => line.startsWith("Style: "));
    expect(styleLines).toHaveLength(1);
    // 23 fields: the family stayed one of them rather than becoming four and a second Style line.
    expect(styleLines[0].split(",")).toHaveLength(23);
    expect(styleLines[0]).toContain(",Arial 999 &HFFFFFFFF Style: Evil Arial,");
    // The text survives inside that field, which is harmless; what matters is that no LINE is it.
    expect(ass.split("\n").some((line) => line.startsWith("Style: Evil"))).toBe(false);
  });
});
