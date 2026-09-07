import { registerTool } from "../registry";
import { EDIT_TOOLS } from "./tools";

export function registerEditTools(): void {
  for (const tool of EDIT_TOOLS) {
    registerTool(tool);
  }
}
