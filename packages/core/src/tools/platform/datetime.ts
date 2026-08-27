import { z } from "zod";
import { defineTool } from "../define-tool";

export const datetimeTool = defineTool({
  key: "datetime",
  name: "Current datetime",
  description: "Return the current UTC timestamp",
  schema: z.object({}),
  execute: async () => ({
    iso: new Date().toISOString(),
    timezone: "UTC",
  }),
});
