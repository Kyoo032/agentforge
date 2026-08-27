import { calculatorTool } from "./calculator";
import { datetimeTool } from "./datetime";
import { webSearchTool } from "./web-search";
import { imageGenerateTool } from "./image-generate";
import { videoGenerateTool } from "./video-generate";
import { registerTool } from "../registry";

export function registerPlatformTools(): void {
  registerTool(calculatorTool);
  registerTool(datetimeTool);
  registerTool(webSearchTool);
  registerTool(imageGenerateTool);
  registerTool(videoGenerateTool);
}
