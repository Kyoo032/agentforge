import { registerTool } from "@agentforge/core";
import { campusFaqLookupTool } from "./tools/campus-faq";
import { courseCatalogSearchTool } from "./tools/course-catalog";

export function registerUniversityTools(): void {
  registerTool(courseCatalogSearchTool);
  registerTool(campusFaqLookupTool);
}
