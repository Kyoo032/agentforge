import { registerPlatformTools, registerTool } from "@agentforge/core";
import { registerUniversityTools } from "@agentforge/university";
import { pastSessionsTool } from "./session-tools";

let registered = false;

export function ensureToolsRegistered(): void {
  if (registered) {
    return;
  }
  registerPlatformTools();
  registerUniversityTools();
  registerTool(pastSessionsTool);
  registered = true;
}
