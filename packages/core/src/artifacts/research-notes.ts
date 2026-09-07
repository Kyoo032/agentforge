import { z } from "zod";

export const researchSourceSchema = z.object({
  title: z.string().default(""),
  url: z.string().default(""),
});

export const researchNoteSchema = z.object({
  heading: z.string().min(1),
  body: z.string().min(1),
  sources: z.array(researchSourceSchema).default([]),
});

export const researchNotesSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  notes: z.array(researchNoteSchema).min(1),
});

export type ResearchSource = z.infer<typeof researchSourceSchema>;
export type ResearchNote = z.infer<typeof researchNoteSchema>;
export type ResearchNotes = z.infer<typeof researchNotesSchema>;

function sourceLine(source: ResearchSource): string {
  return `- ${source.title || source.url}${source.url ? ` (${source.url})` : ""}`;
}

export function researchNotesToMarkdown(notes: ResearchNotes): string {
  const lines = [`# ${notes.title}`, "", notes.summary, ""];
  for (const note of notes.notes) {
    lines.push(`## ${note.heading}`, "", note.body, "");
    const sources = note.sources.filter((source) => source.url || source.title);
    if (sources.length > 0) {
      lines.push("Sources:", ...sources.map(sourceLine), "");
    }
  }
  return `${lines.join("\n").trim()}\n`;
}
