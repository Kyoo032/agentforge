import { z } from "zod";
import { defineTool } from "../define-tool";

export const datetimeTool = defineTool({
  key: "datetime",
  name: "Date & time",
  description: "Return the current UTC timestamp",
  schema: z.object({}),
  execute: async () => ({
    iso: new Date().toISOString(),
    timezone: "UTC",
  }),
});
