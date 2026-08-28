import { z } from "zod";
import { ApiError } from "@agentforge/core";
import { extractJsonObject } from "./presentation-outline";

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

export type ResearchNotes = z.infer<typeof researchNotesSchema>;

export function parseResearchNotes(raw: unknown): ResearchNotes {
  if (typeof raw !== "string") {
    throw new ApiError("invalid_research", "Research notes must be a JSON string from the model", 502);
  }
  const jsonText = extractJsonObject(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new ApiError("invalid_research", "Model returned invalid JSON for the research notes", 502);
  }
  const result = researchNotesSchema.safeParse(parsed);
  if (!result.success) {
    throw new ApiError(
      "invalid_research",
      `Research notes failed validation: ${result.error.issues.map((issue) => issue.message).join("; ")}`,
      502,
    );
  }
  return result.data;
}

export function researchNotesToMarkdown(notes: ResearchNotes): string {
  const lines = [`# ${notes.title}`, "", notes.summary, ""];
  for (const note of notes.notes) {
    lines.push(`## ${note.heading}`, "", note.body, "");
    const sources = note.sources.filter((source) => source.url || source.title);
    if (sources.length > 0) {
      lines.push("Sources:");
      for (const source of sources) {
        lines.push(`- ${source.title || source.url}${source.url ? ` (${source.url})` : ""}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n").trim() + "\n";
}
