import { defineTool } from "@agentforge/core";
import { z } from "zod";

export const CAMPUS_FAQ = [
  {
    id: "library-hours",
    q: "library hours",
    a: "Main Library is open 7:00–23:00 on weekdays and 10:00–20:00 on weekends.",
  },
  {
    id: "dining",
    q: "dining hall",
    a: "Harbor Hall cafeteria serves breakfast 7:00–10:00 and dinner 17:00–20:00.",
  },
  {
    id: "registrar",
    q: "add drop",
    a: "Add/drop closes on the Friday of week 2. See the Registrar in Founders 120.",
  },
];

export const campusFaqLookupTool = defineTool({
  key: "campus_faq.lookup",
  name: "Campus FAQ lookup",
  description: "Look up mock campus FAQ answers",
  pack: "students",
  schema: z.object({
    query: z.string().min(1),
  }),
  execute: async ({ query }) => {
    const needle = query.toLowerCase();
    const matches = CAMPUS_FAQ.filter((item) => `${item.q} ${item.a}`.toLowerCase().includes(needle));
    return { matches };
  },
});
