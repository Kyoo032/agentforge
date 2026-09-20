import { calculatorTool } from "./calculator";
import { datetimeTool } from "./datetime";
import { webFetchTool } from "./web-fetch";
import { webSearchTool } from "./web-search";
import { imageGenerateTool } from "./image-generate";
import { videoGenerateTool } from "./video-generate";
import { lyricsWriteTool, musicGenerateTool, speechGenerateTool } from "./music-generate";
import { registerTool } from "../registry";

export function registerPlatformTools(): void {
  registerTool(calculatorTool);
  registerTool(datetimeTool);
  registerTool(webSearchTool);
  registerTool(webFetchTool);
  registerTool(imageGenerateTool);
  registerTool(videoGenerateTool);
  registerTool(musicGenerateTool);
  registerTool(lyricsWriteTool);
  registerTool(speechGenerateTool);
}
