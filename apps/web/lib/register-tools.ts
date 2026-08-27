import { registerPlatformTools } from "@agentforge/core";
import { registerUniversityTools } from "@agentforge/university";

let registered = false;

export function ensureToolsRegistered(): void {
  if (registered) {
    return;
  }
  registerPlatformTools();
  registerUniversityTools();
  registered = true;
}
