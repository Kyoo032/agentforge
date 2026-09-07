import { readFile } from "node:fs/promises";
import { layoutTitle, type EditProject } from "@agentforge/core";
import { foldProject } from "./ops";
import { frameAt } from "./ffmpeg/recipes";

export function titleBoxForFrame(doc: EditProject, frame: number) {
  const clip = doc.clips.find(
    (item) =>
      item.title &&
      frame >= item.timelineStartFrame &&
      frame < item.timelineStartFrame + item.durationFrames,
  );
  if (!clip?.title) {
    return null;
  }
  const layout = layoutTitle(clip.title.style, { width: doc.width, height: doc.height });
  return {
    clipId: clip.id,
    text: clip.title.text,
    layout,
    primaryColor: clip.title.style.primaryColor,
    tolerance: { positionPct: 0.02, deltaE: 10, ssim: 0.85 },
  };
}

export async function renderParityFrame(projectId: string, frame: number, workspaceId?: string) {
  const doc = await foldProject(projectId, workspaceId);
  const rendered = await frameAt(doc, frame);
  const bytes = await readFile(rendered.file);
  return {
    bytes: new Uint8Array(bytes),
    contentType: "image/png" as const,
    titleBox: titleBoxForFrame(doc, frame),
    width: doc.width,
    height: doc.height,
    frame,
  };
}

export function boxWithinTolerance(
  expected: { x: number; y: number },
  actual: { x: number; y: number },
  canvasHeight: number,
  pct = 0.02,
): boolean {
  const delta = Math.abs(expected.y - actual.y) / canvasHeight;
  return delta <= pct;
}
