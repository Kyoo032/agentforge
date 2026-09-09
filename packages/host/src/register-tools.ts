import { registerPlatformTools, registerTool, registerEditTools, setEditToolBackend } from "@agentforge/core";
import { registerUniversityTools } from "@agentforge/university";
import { marketTools } from "./market/tools";
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
  for (const tool of marketTools.all) {
    registerTool(tool);
  }
  registerEditTools();
  registered = true;
  void import("./edit/backend").then((mod) => {
    setEditToolBackend(mod.hostEditBackend);
  });
  void import("./edit/wire-generate").then((mod) => {
    mod.ensureGenerateSubmitWired();
  });
}
