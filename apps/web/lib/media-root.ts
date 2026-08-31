import path from "node:path";

export function mediaRoot(): string {
  return process.env.MEDIA_ROOT
    ? path.resolve(process.env.MEDIA_ROOT)
    : path.resolve(process.cwd(), "..", "..", "data", "media");
}
