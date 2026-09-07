import { DEFAULT_CAPTION_STYLE, type Clip, type EditProject, type TitleStyle } from "./document";
import { framesToSeconds } from "./frames";

const HEX8 = /^#?[0-9A-Fa-f]{8}$/;

function normalizeHex8(hex8: string): string {
  const raw = hex8.startsWith("#") ? hex8.slice(1) : hex8;
  if (!HEX8.test(`#${raw}`)) {
    throw new Error(`invalid hex8: ${hex8}`);
  }
  return `#${raw.toUpperCase()}`;
}

/** CSS #RRGGBBAA → ASS `&HAABBGGRR`. */
export function hex8ToAssColor(hex8: string): string {
  const h = normalizeHex8(hex8).slice(1);
  const rr = h.slice(0, 2);
  const gg = h.slice(2, 4);
  const bb = h.slice(4, 6);
  const aa = h.slice(6, 8);
  return `&H${aa}${bb}${gg}${rr}`;
}

/** ASS `&HAABBGGRR` → CSS #RRGGBBAA. */
export function assColorToHex8(ass: string): string {
  const body = ass.replace(/^&H/i, "").replace(/&$/, "").toUpperCase();
  if (body.length !== 8) {
    throw new Error(`invalid ASS colour: ${ass}`);
  }
  const aa = body.slice(0, 2);
  const bb = body.slice(2, 4);
  const gg = body.slice(4, 6);
  const rr = body.slice(6, 8);
  return `#${rr}${gg}${bb}${aa}`;
}

export type TitleLayout = {
  x: number;
  y: number;
  maxWidth: number;
  textAlign: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
};

/**
 * Numpad alignment 1–9 (ASS):
 * 7 8 9 top · 4 5 6 middle · 1 2 3 bottom
 */
export function layoutTitle(style: TitleStyle, canvas: { width: number; height: number }): TitleLayout {
  const col = (style.alignment - 1) % 3;
  const row = Math.floor((style.alignment - 1) / 3);
  const textAlign: TitleLayout["textAlign"] = col === 0 ? "left" : col === 1 ? "center" : "right";
  const verticalAlign: TitleLayout["verticalAlign"] = row === 0 ? "bottom" : row === 1 ? "middle" : "top";
  const x = col === 0 ? style.marginL : col === 1 ? canvas.width / 2 : canvas.width - style.marginR;
  const y = row === 2 ? style.marginV : row === 1 ? canvas.height / 2 : canvas.height - style.marginV;
  const maxWidth = Math.max(0, canvas.width - style.marginL - style.marginR);
  return { x, y, maxWidth, textAlign, verticalAlign };
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** ASS Dialogue time: `h:mm:ss.cs` (centiseconds). */
export function framesToAssTime(frames: number, fps: number): string {
  const totalCs = Math.round(framesToSeconds(Math.max(0, frames), fps) * 100);
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${h}:${pad2(m)}:${pad2(s)}.${pad2(cs)}`;
}

function escapeAssText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\N").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

function styleKey(style: TitleStyle): string {
  return JSON.stringify(style);
}

function assStyleLine(name: string, style: TitleStyle): string {
  const borderStyle = style.box ? 3 : 1;
  const back = style.box ? hex8ToAssColor(style.box.color) : "&H00000000";
  return [
    "Style: ",
    name,
    ",",
    style.fontFamily,
    ",",
    style.fontSizePx,
    ",",
    hex8ToAssColor(style.primaryColor),
    ",",
    hex8ToAssColor(style.primaryColor),
    ",",
    hex8ToAssColor(style.outlineColor),
    ",",
    back,
    ",",
    style.bold ? -1 : 0,
    ",",
    style.italic ? -1 : 0,
    ",0,0,100,100,0,0,",
    borderStyle,
    ",",
    style.outlinePx,
    ",",
    style.shadowPx,
    ",",
    style.alignment,
    ",",
    style.marginL,
    ",",
    style.marginR,
    ",",
    style.marginV,
    ",1",
  ].join("");
}

export function titleToAssDialogue(clip: Clip, project: EditProject, styleName = "Default"): string {
  const text = clip.title?.text ?? clip.caption?.text ?? "";
  const start = framesToAssTime(clip.timelineStartFrame, project.fps);
  const end = framesToAssTime(clip.timelineStartFrame + clip.durationFrames, project.fps);
  return `Dialogue: 0,${start},${end},${styleName},,0,0,0,,${escapeAssText(text)}`;
}

export function buildAssDocument(project: EditProject): string {
  const titleClips = project.clips.filter((clip) => clip.title);
  const captionClips = project.clips.filter((clip) => clip.caption);
  const styles: { name: string; style: TitleStyle }[] = [];
  const seen = new Map<string, string>();
  let index = 0;
  const nameFor = (style: TitleStyle, prefix: string): string => {
    const key = `${prefix}:${styleKey(style)}`;
    const existing = seen.get(key);
    if (existing) {
      return existing;
    }
    index += 1;
    const name = `${prefix}${index}`;
    seen.set(key, name);
    styles.push({ name, style });
    return name;
  };

  const dialogue: string[] = [];
  for (const clip of titleClips) {
    if (!clip.title) {
      continue;
    }
    const name = nameFor(clip.title.style, "Title");
    dialogue.push(titleToAssDialogue(clip, project, name));
  }
  for (const clip of captionClips) {
    const name = nameFor(DEFAULT_CAPTION_STYLE, "Caption");
    dialogue.push(titleToAssDialogue(clip, project, name));
  }

  const styleLines = styles.map((entry) => assStyleLine(entry.name, entry.style));
  return [
    "[Script Info]",
    `Title: ${project.name}`,
    "ScriptType: v4.00+",
    `PlayResX: ${project.width}`,
    `PlayResY: ${project.height}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ...styleLines,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...dialogue,
    "",
  ].join("\n");
}
