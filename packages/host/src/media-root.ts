import path from "node:path";
import { localDataDir } from "@agentforge/db/vault-key";

export function mediaRoot(): string {
  if (process.env.MEDIA_ROOT) {
    return path.resolve(process.env.MEDIA_ROOT);
  }
  return path.resolve(localDataDir(), "media");
}
