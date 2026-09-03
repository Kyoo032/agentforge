import { z } from "zod";
import { defineTool } from "@agentforge/core";
import { getRunContext } from "./run-context";
import { executePastSessionsTool } from "./session-recall";

export const pastSessionsTool = defineTool({
  key: "past_sessions",
  name: "Past chats",
  description:
    "List or read the user's earlier chat sessions with this agent. Use when they mention a previous conversation.",
  schema: z.object({
    action: z.enum(["list", "read"]).describe("list = browse titles; read = open one session"),
    session_id: z.string().uuid().optional().describe("Required for read"),
    search: z.string().optional().describe("Optional title filter for list"),
  }),
  execute: async (args, tenant) => {
    const context = getRunContext();
    if (!context) {
      return { success: false, message: "Chat context unavailable" };
    }
    return executePastSessionsTool(tenant, context.agentId, context.threadId, args);
  },
});
