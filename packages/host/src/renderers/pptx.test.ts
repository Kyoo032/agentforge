import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { renderPptx } from "./pptx";
import { bareReport, sampleReport } from "./__fixtures__/report";

async function parts(bytes: Uint8Array, prefix: string): Promise<string[]> {
  const zip = await JSZip.loadAsync(bytes);
  return Object.keys(zip.files).filter((name) => name.startsWith(prefix));
}

async function slideText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  const xml = await Promise.all(slides.map((name) => zip.file(name)?.async("string") ?? Promise.resolve("")));
  return xml.join("").replace(/<[^>]+>/g, "");
}

describe("renderPptx", () => {
  it("returns a non-empty deck with the presentation mime and a safe filename", async () => {
    const file = await renderPptx(sampleReport());
    expect(file.bytes.length).toBeGreaterThan(0);
    expect(file.mime).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(file.filename).toBe("Margins-held-while-cash-thinned.pptx");
  });

  it("writes one native chart part per line, bar and gauge chart", async () => {
    const report = sampleReport();
    const native = report.charts.filter((chart) => chart.kind !== "heat").length;
    const charts = await parts((await renderPptx(report)).bytes, "ppt/charts/chart");
    expect(charts).toHaveLength(native);
  });

  it("gives every chart a slide, plus a title slide and a flags slide", async () => {
    const report = sampleReport();
    const slides = await parts((await renderPptx(report)).bytes, "ppt/slides/slide");
    expect(slides).toHaveLength(report.charts.length + 2);
  });

  it("carries the title, each chart's note and the flags into the slide text", async () => {
    const report = sampleReport();
    const text = await slideText((await renderPptx(report)).bytes);
    expect(text).toContain(report.title);
    expect(text).toContain("Gross margin slipped five points");
    expect(text).toContain("Eight months of runway");
    expect(text).toContain("Net margin 2026: -4%");
    // The heat chart becomes a coloured table, so its axes still have to be readable.
    expect(text).toContain("Sensitivity");
    expect(text).toContain("+10%");
  });

  it("writes a title-only deck when the report has no charts and no flags", async () => {
    const file = await renderPptx(bareReport());
    const slides = await parts(file.bytes, "ppt/slides/slide");
    expect(slides).toHaveLength(1);
    expect(await parts(file.bytes, "ppt/charts/chart")).toHaveLength(0);
  });
});
