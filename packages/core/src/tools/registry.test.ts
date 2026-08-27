import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool } from "./define-tool";
import { listStudioTools, registerTool, resetToolRegistry } from "./registry";
import { calculatorTool } from "./platform/calculator";

describe("listStudioTools", () => {
  it("hides pack tools until that pack is selected", () => {
    resetToolRegistry();
    registerTool(calculatorTool);
    registerTool(
      defineTool({
        key: "pack_tool.search",
        name: "Pack tool",
        description: "pack tool",
        pack: "test-pack",
        schema: z.object({ query: z.string() }),
        execute: async () => ({ matches: [] }),
      }),
    );
    expect(listStudioTools().map((tool) => tool.key)).toEqual(["calculator"]);
    expect(listStudioTools("test-pack").map((tool) => tool.key).sort()).toEqual([
      "calculator",
      "pack_tool.search",
    ]);
    resetToolRegistry();
  });
});
