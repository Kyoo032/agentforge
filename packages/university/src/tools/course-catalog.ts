import { defineTool } from "@agentforge/core";
import { z } from "zod";

export const COURSE_CATALOG = [
  { code: "CS101", title: "Intro to Computer Science", instructor: "Dr. Patel", credits: 4 },
  { code: "CS201", title: "Data Structures", instructor: "Dr. Okonkwo", credits: 4 },
  { code: "HIST210", title: "Modern World History", instructor: "Prof. Alvarez", credits: 3 },
  { code: "BIO110", title: "General Biology", instructor: "Dr. Chen", credits: 4 },
];

export const courseCatalogSearchTool = defineTool({
  key: "course_catalog.search",
  name: "Course catalog search",
  description: "Search the mock university course catalog by code, title, or instructor",
  pack: "students",
  schema: z.object({
    query: z.string().min(1),
  }),
  execute: async ({ query }) => {
    const needle = query.toLowerCase();
    const matches = COURSE_CATALOG.filter((course) =>
      `${course.code} ${course.title} ${course.instructor}`.toLowerCase().includes(needle),
    );
    return { matches };
  },
});
