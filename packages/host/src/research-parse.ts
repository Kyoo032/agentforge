import { ApiError } from "@agentforge/core";
import { extractJsonObject } from "./presentation-outline";
import { researchNotesSchema, type ResearchNotes } from "./research-notes";

export type { ResearchNotes };

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
