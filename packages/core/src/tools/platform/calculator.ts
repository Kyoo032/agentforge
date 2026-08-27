import { z } from "zod";
import { ApiError } from "../../errors";
import { defineTool } from "../define-tool";

function evaluateExpression(expression: string): number {
  if (!/^[\d\s+\-*/().]+$/.test(expression)) {
    throw new ApiError("invalid_tool_args", "Expression may only contain numbers and + - * / ( )", 400);
  }
  const result = Function(`"use strict"; return (${expression})`)();
  if (typeof result !== "number" || !Number.isFinite(result)) {
    throw new ApiError("invalid_tool_args", "Expression did not evaluate to a finite number", 400);
  }
  return result;
}

export const calculatorTool = defineTool({
  key: "calculator",
  name: "Calculator",
  description: "Evaluate a basic arithmetic expression",
  schema: z.object({
    expression: z.string().min(1),
  }),
  execute: async ({ expression }) => ({ result: evaluateExpression(expression) }),
});
