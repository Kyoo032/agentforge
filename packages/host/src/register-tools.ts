import { registerPlatformTools, registerTool, registerEditTools, setEditToolBackend } from "@agentforge/core";
import { registerUniversityTools } from "@agentforge/university";
import { pastSessionsTool } from "./session-tools";
import { runSqlTool } from "./sql-tool";

let registered = false;

export function ensureToolsRegistered(): void {
  if (registered) {
    return;
  }
  registerPlatformTools();
  registerUniversityTools();
  registerTool(pastSessionsTool);
  registerTool(runSqlTool);
  registerEditTools();
  registered = true;
  void import("./edit/backend").then((mod) => {
    setEditToolBackend(mod.hostEditBackend);
  });
  void import("./edit/wire-generate").then((mod) => {
    mod.ensureGenerateSubmitWired();
  });
}
